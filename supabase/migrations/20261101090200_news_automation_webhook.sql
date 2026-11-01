-- =====================================================================
-- Tranche Actus · Rappel du lendemain + notification webhook (Make)
-- 1 nov. 2026 · commit 2-1
--
-- A. Rappel du lendemain pour un brouillon de manager resté en l'état
--    (irritant n°1, décision D20) — calqué sur private.run_departures()
--    (supabase/migrations/20261006172727_...sql) déjà en place.
-- B. Notification réelle vers un webhook Make.com, via pg_net (déjà
--    disponible sur Supabase, appels HTTP asynchrones depuis SQL) :
--      - "rappel_brouillon" quand un brouillon de manager passe le cap d'1 jour
--      - "actu_a_relire" quand une actu arrive en file de relecture Comm
--    URL et secret lus dans private.automation_config (jamais dans le
--    dépôt ni le navigateur) : table à renseigner toi-même après coup,
--    voir le second bloc SQL fourni séparément. Si la config est absente
--    ou l'appel échoue, aucune erreur ne remonte : l'app n'est jamais bloquée.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Stockage du secret/URL — jamais de droit accordé à anon/authenticated.
-- ---------------------------------------------------------------------
create table if not exists private.automation_config (
  key text primary key,
  value text not null
);
revoke all on private.automation_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Appel webhook générique, jamais bloquant.
-- ---------------------------------------------------------------------
create or replace function private.call_make_webhook(_type text, _prenom text, _titre text, _audience text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _url text;
  _secret text;
begin
  select value into _url from private.automation_config where key = 'make_webhook_url';
  select value into _secret from private.automation_config where key = 'make_webhook_secret';
  if _url is null or _secret is null then
    return;
  end if;

  perform net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('type', _type, 'prenom', _prenom, 'titre', _titre, 'audience', _audience, 'secret', _secret)
  );
exception when others then
  -- Un webhook qui échoue ne doit jamais bloquer l'application.
  null;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Rappel du lendemain (colonne + fonction cron)
-- ---------------------------------------------------------------------
alter table public.news add column if not exists draft_reminder_at timestamptz;

create or replace function private.run_news_draft_reminders()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select n.id, n.title, n.audience, a.first_name
    from public.news n
    join public.allowed_users a on lower(a.email) = lower(n.author_email)
    join public.allowed_user_roles ro on ro.allowed_user_id = a.id
    where n.status = 'brouillon'
      and n.draft_reminder_at is null
      and n.created_at <= now() - interval '1 day'
      and ro.role = 'manager'
  loop
    update public.news set draft_reminder_at = now() where id = r.id;
    perform private.call_make_webhook(
      'rappel_brouillon',
      coalesce(r.first_name, 'Manager'),
      r.title,
      case when r.audience = 'mon_equipe' then 'Mon équipe' else 'Plusieurs équipes / Tout le cabinet' end
    );
  end loop;
end;
$$;

select cron.schedule('news-draft-reminders-daily', '10 3 * * *', 'select private.run_news_draft_reminders();');

-- ---------------------------------------------------------------------
-- B. Notification à la Comm quand une actu arrive en file de relecture
--    (un appel par relecteur actif : is_reviewer = true).
-- ---------------------------------------------------------------------
create or replace function private.news_v2_notify_comm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rv record;
  _audience_label text;
begin
  if new.status = 'a_valider_comm' and (old.status is distinct from new.status) then
    _audience_label := case when new.audience = 'mon_equipe' then 'Mon équipe' else 'Plusieurs équipes / Tout le cabinet' end;
    for rv in select first_name from public.allowed_users where is_reviewer loop
      perform private.call_make_webhook('actu_a_relire', coalesce(rv.first_name, 'Relecteur Comm'), new.title, _audience_label);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists news_v2_notify_comm on public.news;
create trigger news_v2_notify_comm
after update of status on public.news
for each row execute function private.news_v2_notify_comm();
