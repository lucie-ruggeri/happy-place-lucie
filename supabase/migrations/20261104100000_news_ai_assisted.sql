-- =====================================================================
-- Actus · Signal « rédigée avec l'aide de l'IA » (mesure de KPI)
-- 4 nov. 2026
--
-- Jusqu'ici, le journal des événements (D24, 20261102140000) envoyait
-- ai_assisted = null en dur : l'assistant IA (format-actu) ne remplit que
-- l'éditeur en mémoire, rien n'était conservé.
--
-- Ajout : colonne news.ai_assisted, posée par l'éditeur.
--   true  = l'IA a proposé le texte (même retouché ensuite) ;
--   false = rédigée sans l'IA ;
--   null  = inconnu (actus antérieures à cette migration, jamais rétro-remplies
--           pour ne pas fausser les mesures).
-- Le signal est déclaratif (posé par l'app, comme input_mode) : le garde-fou
-- news_v2_guard ne le verrouille pas, c'est une mesure et non une règle de circuit.
--
-- private.news_event_payload() est inchangée (elle reçoit déjà _ai_assisted) :
-- les smoke tests existants, qui l'appellent avec null, restent valides.
--
-- Aucune valeur d'ENUM ajoutée (D81 respecté).
--
-- Après passage : select * from private.run_smoke_tests();  (toutes les lignes à ok = true)
-- =====================================================================

alter table public.news
  add column if not exists ai_assisted boolean;

comment on column public.news.ai_assisted is
  'Le texte a été proposé par l''assistant IA (même retouché ensuite) ; null = inconnu (actus antérieures). Alimente le journal des événements (D24).';

-- Corps identique à 20261102140000, sauf l'argument _ai_assisted (new.ai_assisted au lieu de null).
create or replace function private.news_v2_log_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _event_type text;
  _author_first text;
  _author_role public.app_role;
  _environment text;
  _payload jsonb;
begin
  -- Garde anti-seed/anti-test : aucun envoi pendant un chargement de données
  -- de démonstration ou un run de smoke tests (voir seed.sql, run_smoke_tests()).
  if coalesce(current_setting('hp.seeding', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'brouillon' then
      return null;
    end if;
    _event_type := 'draft_created';
  elsif new.status is distinct from old.status then
    _event_type := case new.status
      when 'a_valider_manager' then 'submitted'
      when 'a_valider_comm' then 'submitted'
      when 'publiée' then 'published'
      when 'a_modifier_manager' then 'modification_requested'
      when 'a_modifier_comm' then 'modification_requested'
      when 'refusée' then 'refused'
      else null
    end;
  end if;

  if _event_type is null then
    return null;
  end if;

  select a.first_name, r.role into _author_first, _author_role
  from public.allowed_users a
  join public.allowed_user_roles r on r.allowed_user_id = a.id
  where a.email = lower(new.author_email);

  select value into _environment from private.automation_config where key = 'environment';

  _payload := private.news_event_payload(
    _event_type, new.id, _author_first, _author_role, new.audience, new.status,
    new.created_at, new.ai_assisted, _environment
  );

  perform private.send_make_webhook(_payload);
  return null;
exception when others then
  -- Jamais bloquant, même en cas d'erreur imprévue avant l'appel réseau
  -- (ex. jointure sur allowed_users) : l'action de l'utilisateur doit réussir.
  return null;
end;
$$;
