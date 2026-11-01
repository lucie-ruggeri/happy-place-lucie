-- =====================================================================
-- Points bloquants v2 · Audience, publication immédiate, contrôle après coup
-- 1 nov. 2026
--
-- Extrait de D:\PROJETS\migrations-en-reserve\20261030130000_modules_v2_audience_publication.sql
-- (fichier d'origine laissé intact). Ce fichier NE contient QUE la partie
-- « 2. POINTS BLOQUANTS » de la migration d'origine, plus les 5 éléments du
-- « socle commun » dont elle dépend (vérifié : rien d'autre, aucune
-- dépendance vers les parties Idées/submissions ou Indicateurs/metrics,
-- et aucune des deux tables n'est touchée).
--
-- Après passage : select * from private.run_smoke_tests();
-- =====================================================================

-- ---------------------------------------------------------------------
-- Socle commun (repris à l'identique de la migration d'origine, section 0)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'publication_status') then
    -- mêmes valeurs que news_status (D63) : un seul vocabulaire pour les 4 modules
    create type public.publication_status as enum (
      'brouillon', 'a_valider_manager', 'a_valider_comm',
      'a_modifier_manager', 'a_modifier_comm', 'publiée', 'refusée');
  end if;
end $$;

-- Voit-on un contenu « Mon équipe » de cette équipe ? (membre de l'équipe ou un de ses managers)
create or replace function private.hp_sees_team(_audience public.news_audience, _team text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select _audience = 'tout_le_cabinet'
      or lower(coalesce(_team, '')) = lower(coalesce(private.hp_team(), '#'))
      or (_team is not null and private.hp_manages_team(_team));
$$;
grant execute on function private.hp_sees_team(public.news_audience, text) to authenticated;

-- Supprime toutes les règles RLS d'une table (avant réécriture complète)
create or replace function private.hp_drop_policies(_table text)
returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = _table loop
    execute format('drop policy %I on public.%I', p.policyname, _table);
  end loop;
end $$;

-- Historique de publication commun aux 3 modules (R6) ; le traitement des idées
-- garde son propre historique (submission_status_history, inchangé).
create table if not exists public.publication_history (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('idee', 'point_bloquant', 'indicateur')),
  content_id uuid not null,
  author_email text,
  old_status public.publication_status,
  new_status public.publication_status not null,
  audience public.news_audience,
  action text,
  changed_by_email text,
  is_automatic boolean not null default false,
  rejection_category public.rejection_category,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists publication_history_content_idx on public.publication_history (module, content_id, changed_at);
alter table public.publication_history enable row level security;
drop policy if exists publication_history_select on public.publication_history;
create policy publication_history_select on public.publication_history
  for select to authenticated
  using (private.hp_role() = 'admin'
         or lower(author_email) = private.hp_email()
         or lower(changed_by_email) = private.hp_email());
grant select on public.publication_history to authenticated;

-- Trigger générique : arguments = module, colonne de l'auteur, colonne du commentaire, colonne du motif
create or replace function private.publication_history_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  _me text := private.hp_email();
  _new public.publication_status := (j ->> 'statut_publication')::public.publication_status;
begin
  if tg_op = 'INSERT' or (o ->> 'statut_publication') is distinct from (j ->> 'statut_publication') then
    insert into public.publication_history
      (module, content_id, author_email, old_status, new_status, audience, action,
       changed_by_email, is_automatic, rejection_category, note)
    values
      (tg_argv[0], (j ->> 'id')::uuid, j ->> tg_argv[1],
       (o ->> 'statut_publication')::public.publication_status, _new,
       (j ->> 'audience')::public.news_audience,
       coalesce(nullif(current_setting('hp.action', true), ''),
                case when tg_op = 'INSERT' then 'creation' else 'automatique' end),
       _me, _me is null,
       case when _new = 'refusée' then (j ->> tg_argv[3])::public.rejection_category end,
       case when _new in ('refusée', 'a_modifier_manager', 'a_modifier_comm') then j ->> tg_argv[2] end);
  end if;
  return null;
end $$;

-- =====================================================================
-- POINTS BLOQUANTS (blockers) — repris à l'identique de la migration
-- d'origine, section 2. Ne touche ni submissions ni metrics.
-- =====================================================================
alter table public.blockers
  add column if not exists created_by_email text,
  add column if not exists team text references public.teams (name) on update cascade on delete restrict,
  add column if not exists audience public.news_audience not null default 'tout_le_cabinet',
  add column if not exists statut_publication public.publication_status not null default 'publiée',
  add column if not exists published_at timestamptz,
  add column if not exists reviewed_audience public.news_audience,
  add column if not exists pub_review_note text;

-- Reprise : les points existants restent visibles par tous (déjà le cas), publiés.
update public.blockers set published_at = coalesce(published_at, created_at) where published_at is null;

alter table public.blockers
  alter column statut_publication set default 'brouillon',
  drop constraint if exists blockers_pub_note_length,
  add constraint blockers_pub_note_length check (pub_review_note is null or char_length(pub_review_note) <= 500),
  drop constraint if exists blockers_team_if_mon_equipe,
  add constraint blockers_team_if_mon_equipe check (audience <> 'mon_equipe' or team is not null);

comment on column public.blockers.team is 'Équipe de l''auteur (audience « Mon équipe », contrôle après coup par ses managers, R8).';
comment on column public.blockers.department is 'Pôle responsable : ses managers font avancer le statut OUVERT → RÉSOLU (D62).';
comment on column public.blockers.statut_publication is 'Toujours publié tout de suite (pas de validation) ; À modifier (manager) après un retrait (R8).';

-- 2a. Création : auteur, équipe, publication immédiate
create or replace function private.blockers_v2_before_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare _role public.app_role := private.hp_role(); _nb int;
begin
  if current_user in ('authenticated', 'anon') then
    new.created_by_email := private.hp_email();
    if _role = 'collaborateur' then
      new.team := private.hp_team();
    elsif new.team is null then
      select count(*) into _nb from public.manager_teams mt
        join public.allowed_users a on a.id = mt.allowed_user_id where a.email = private.hp_email();
      if _nb = 1 then
        select mt.team into new.team from public.manager_teams mt
          join public.allowed_users a on a.id = mt.allowed_user_id where a.email = private.hp_email();
      elsif new.audience = 'mon_equipe' then
        raise exception 'Choisis l''équipe parmi celles que tu gères' using errcode = '23514';
      end if;
    end if;
    new.statut_publication := 'publiée';
    new.published_at := now();
    new.pub_review_note := null; new.reviewed_audience := null;
  end if;
  return new;
end $$;
drop trigger if exists blockers_v2_before_insert on public.blockers;
create trigger blockers_v2_before_insert before insert on public.blockers
  for each row execute function private.blockers_v2_before_insert();

drop trigger if exists blockers_v2_history on public.blockers;
create trigger blockers_v2_history after insert or update of statut_publication on public.blockers
  for each row execute function private.publication_history_log('point_bloquant', 'created_by_email', 'pub_review_note', 'aucun_motif');

-- 2b. RLS (aucune mise à jour directe : tout passe par les fonctions)
select private.hp_drop_policies('blockers');
alter table public.blockers enable row level security;

create policy blockers_select on public.blockers for select to authenticated
using (
  private.hp_role() is not null and (
    lower(created_by_email) = private.hp_email()
    or (team is not null and private.hp_manages_team(team))          -- contrôle après coup (R8)
    or private.hp_manages_team(department)                           -- pôle responsable (D62)
    or (private.hp_role() = 'admin' and statut_publication in ('publiée', 'refusée'))
    or (statut_publication = 'publiée' and private.hp_sees_team(audience, team))
  ));

create policy blockers_insert on public.blockers for insert to authenticated
with check (
  private.hp_role() in ('collaborateur', 'manager')
  and lower(created_by_email) = private.hp_email()
  and (team is null or lower(team) = lower(coalesce(private.hp_team(), '#')) or private.hp_manages_team(team)));

create policy blockers_delete on public.blockers for delete to authenticated
using ((lower(created_by_email) = private.hp_email() and statut_publication = 'a_modifier_manager')
       or private.hp_role() = 'admin');

-- 2c. État de la panne (D62) : managers du pôle responsable ; l'admin seulement si le pôle
--     ne correspond à aucune équipe (points anciens « GENERAL »)
create or replace function public.set_blocker_status(_id uuid, _status public.blocker_status)
returns public.blocker_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.blockers;
begin
  select * into b from public.blockers where id = _id for update;
  if not found then raise exception 'Point bloquant introuvable' using errcode = 'P0002'; end if;
  if b.statut_publication <> 'publiée' then
    raise exception 'Ce point bloquant n''est pas publié' using errcode = 'P0001';
  end if;
  if not (
    (private.hp_role() = 'manager' and private.hp_manages_team(b.department))
    or (private.hp_role() = 'admin'
        and not exists (select 1 from public.teams t where lower(t.name) = lower(btrim(b.department))))
  ) then
    raise exception 'Seuls les managers du pôle responsable font avancer ce point' using errcode = '42501';
  end if;
  update public.blockers set status = _status, updated_at = now() where id = _id;
  return _status;
end $$;

-- 2d. Contrôle après coup (R8) : retrait par un manager de l'équipe de l'auteur collaborateur
create or replace function public.withdraw_blocker(_id uuid, _note text)
returns public.publication_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.blockers;
begin
  select * into b from public.blockers where id = _id for update;
  if not found then raise exception 'Point bloquant introuvable' using errcode = 'P0002'; end if;
  if not (private.hp_role() = 'manager' and b.team is not null and private.hp_manages_team(b.team)) then
    raise exception 'Seul un manager de l''équipe de l''auteur peut retirer ce point' using errcode = '42501';
  end if;
  if b.statut_publication <> 'publiée' or b.created_by_email is null
     or not exists (select 1 from public.allowed_users a join public.allowed_user_roles r on r.allowed_user_id = a.id
                    where a.email = lower(b.created_by_email) and r.role = 'collaborateur') then
    raise exception 'Seul un point publié par un collaborateur peut être retiré' using errcode = 'P0001';
  end if;
  _note := nullif(btrim(coalesce(_note, '')), '');
  if _note is null then raise exception 'Le commentaire est obligatoire' using errcode = '23514'; end if;
  if char_length(_note) > 500 then raise exception 'Le commentaire fait 500 caractères maximum' using errcode = '23514'; end if;
  perform set_config('hp.action', 'retirer', true);
  update public.blockers set statut_publication = 'a_modifier_manager', pub_review_note = _note,
    reviewed_audience = b.audience, updated_at = now() where id = _id;
  perform set_config('hp.action', '', true);
  return 'a_modifier_manager';
end $$;

-- 2e. L'auteur corrige et republie directement (R8)
create or replace function public.resubmit_blocker(
  _id uuid, _title text, _description text, _severity public.blocker_severity default null,
  _audience public.news_audience default null)
returns public.publication_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.blockers;
begin
  select * into b from public.blockers where id = _id for update;
  if not found or lower(b.created_by_email) is distinct from private.hp_email() then
    raise exception 'Point bloquant introuvable ou tu n''en es pas l''auteur' using errcode = '42501';
  end if;
  if b.statut_publication <> 'a_modifier_manager' then
    raise exception 'Ce point bloquant n''est pas à modifier' using errcode = 'P0001';
  end if;
  if coalesce(btrim(_title), '') = '' then raise exception 'Le titre est obligatoire' using errcode = '23514'; end if;
  perform set_config('hp.action', 'envoi', true);
  update public.blockers set title = _title, description = _description,
    severity = coalesce(_severity, severity), audience = coalesce(_audience, audience),
    statut_publication = 'publiée', published_at = now(), reviewed_audience = null, updated_at = now()
  where id = _id;
  perform set_config('hp.action', '', true);
  return 'publiée';
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution (scopés aux seules fonctions des points bloquants)
-- ---------------------------------------------------------------------
revoke all on function
  public.set_blocker_status(uuid, public.blocker_status),
  public.withdraw_blocker(uuid, text),
  public.resubmit_blocker(uuid, text, text, public.blocker_severity, public.news_audience)
from public, anon;
grant execute on function
  public.set_blocker_status(uuid, public.blocker_status),
  public.withdraw_blocker(uuid, text),
  public.resubmit_blocker(uuid, text, text, public.blocker_severity, public.news_audience)
to authenticated;
revoke execute on function private.hp_drop_policies(text) from public, authenticated, anon;
