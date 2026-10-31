-- =====================================================================
-- Happy Place v2 · Migration 2/2 · Audience, circuits de validation, RLS (actus)
-- 30 oct. 2026 · D18, D26, D27, D31-D35, D43, D48, D49, D52, D56, R1-R6, R9
--
-- Ce que fait ce fichier :
--   A. Case « Relecteur Comm » sur le compte (D27)
--   B. Nouveaux champs de l'actu (audience, suivi du circuit, commentaire du valideur)
--      + reprise des données : les actus existantes passent à « tout le cabinet » (D34)
--   C. Table news_audience_teams : les équipes ciblées par « Mon équipe »
--   D. Historique des statuts des actus (R6, comme submission_status_history)
--   E. Fonctions « qui suis-je ? » utilisées par la RLS
--   F. Règles RLS des actus, réécrites autour de l'audience (D35)
--   G. Le statut ne se change que par 2 fonctions : submit_news et review_news
--      (le circuit est calculé par la base, pas par l'interface)
--
-- Prérequis : migration 20261030120000_news_v2_types.sql passée.
-- Après passage : select * from private.run_smoke_tests();  (toutes les lignes à ok = true)
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- A. Case « Relecteur Comm » (D27) : une case sur le compte, pas un rôle.
--    Modifiable par l'admin seulement (les règles RLS existantes d'allowed_users s'appliquent).
-- ---------------------------------------------------------------------
alter table public.allowed_users
  add column if not exists is_reviewer boolean not null default false;

comment on column public.allowed_users.is_reviewer is
  'Case « Relecteur Comm » cochée par l''admin (D27). Au moins 2 relecteurs (D68, roadmap).';

-- ---------------------------------------------------------------------
-- B. Nouveaux champs de l'actu
-- ---------------------------------------------------------------------
alter table public.news
  add column if not exists audience public.news_audience not null default 'tout_le_cabinet',
  add column if not exists input_mode public.news_input_mode,
  add column if not exists submitted_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists manager_validated_by_email text,
  add column if not exists manager_validated_at timestamptz,
  add column if not exists reviewed_audience public.news_audience,
  add column if not exists review_category public.rejection_category,
  add column if not exists review_note text,
  add column if not exists updated_at timestamptz not null default now();

-- D34 : « ne rien masquer de ce qui est déjà visible ».
-- ADD COLUMN ... DEFAULT 'tout_le_cabinet' remplit toutes les actus existantes avec cette valeur.
-- Contrôle : la migration s'arrête si une seule actu existante n'est pas « tout le cabinet ».
do $$
declare _ko int;
begin
  select count(*) into _ko from public.news where audience <> 'tout_le_cabinet';
  if _ko > 0 then
    raise exception 'Reprise D34 : % actu(s) existante(s) ne sont pas à « tout le cabinet »', _ko;
  end if;
end $$;

-- Date de publication des actus déjà publiées : on prend la date de création (seule date connue).
-- Sert de point de départ au KPI « délai de publication ».
update public.news set published_at = created_at
where status = 'publiée' and published_at is null;

alter table public.news
  drop constraint if exists news_review_note_length,
  add constraint news_review_note_length check (review_note is null or char_length(review_note) <= 500),
  drop constraint if exists news_refusal_complete,
  add constraint news_refusal_complete check (
    status <> 'refusée' or (review_category is not null and coalesce(btrim(review_note), '') <> '')
  );

comment on column public.news.audience is
  'D18/D33 : mon_equipe ou tout_le_cabinet. Existants et défaut : tout_le_cabinet (D34). Équipes ciblées : news_audience_teams.';
comment on column public.news.reviewed_audience is
  'Audience au moment d''une demande de modification : si l''auteur la change, le circuit est recalculé (R9, D43).';
comment on column public.news.review_note is
  'Dernier commentaire du valideur (demande de modification ou refus), 500 caractères max (R2, R3).';

create index if not exists news_status_audience_idx on public.news (status, audience);
create index if not exists news_author_email_idx on public.news (lower(author_email));

-- ---------------------------------------------------------------------
-- C. Équipes ciblées par une actu « Mon équipe »
--    V1 : exactement 1 ligne (contrôlé par submit_news).
--    Plus tard « Plusieurs équipes » : ADD VALUE sur news_audience + autoriser plusieurs lignes.
-- ---------------------------------------------------------------------
create table if not exists public.news_audience_teams (
  news_id uuid not null references public.news (id) on delete cascade,
  team text not null references public.teams (name) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  primary key (news_id, team)
);
create index if not exists news_audience_teams_team_idx on public.news_audience_teams (team);
alter table public.news_audience_teams enable row level security;

-- ---------------------------------------------------------------------
-- D. Historique des statuts (R6), en lecture seule, écrit par trigger
-- ---------------------------------------------------------------------
create table if not exists public.news_status_history (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.news (id) on delete cascade,
  old_status public.news_status,
  new_status public.news_status not null,
  audience public.news_audience not null,
  action text,                         -- creation | envoi | valider | modifier | refuser | automatique
  changed_by_email text,               -- null si automatique (revalidation annuelle)
  is_automatic boolean not null default false,
  rejection_category public.rejection_category,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists news_status_history_news_idx on public.news_status_history (news_id, changed_at);
alter table public.news_status_history enable row level security;

-- ---------------------------------------------------------------------
-- E. Fonctions « qui suis-je ? »
--    SECURITY DEFINER : elles lisent les tables de droits sans déclencher leur RLS
--    (évite les boucles entre règles). search_path fixé à public : les triggers existants
--    appelés depuis ces fonctions trouvent leurs tables ; les noms restent qualifiés.
-- ---------------------------------------------------------------------

-- Email de la personne connectée. Version élèves : profil anonyme avec une adresse interne
-- (choisir_mon_role) → on lit auth.users si le jeton n'a pas d'email.
create or replace function private.hp_email()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid())
  ));
$$;

create or replace function private.hp_role()
returns public.app_role language sql stable security definer set search_path = public, pg_temp as $$
  select r.role
  from public.allowed_users a
  join public.allowed_user_roles r on r.allowed_user_id = a.id
  where a.email = private.hp_email();
$$;

create or replace function private.hp_team()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select a.team from public.allowed_users a where a.email = private.hp_email();
$$;

create or replace function private.hp_is_reviewer()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select a.is_reviewer from public.allowed_users a where a.email = private.hp_email()), false);
$$;

create or replace function private.hp_manages_team(_team text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.manager_teams mt
    join public.allowed_users a on a.id = mt.allowed_user_id
    where a.email = private.hp_email()
      and lower(btrim(mt.team)) = lower(btrim(_team))
  );
$$;

-- Équipe de l'auteur d'une actu (collaborateur : son équipe ; manager : null).
create or replace function private.hp_user_team(_email text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select a.team from public.allowed_users a where a.email = lower(_email);
$$;

-- La personne connectée fait-elle partie de l'audience « Mon équipe » de cette actu ?
create or replace function private.hp_in_news_teams(_news_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.news_audience_teams t
    where t.news_id = _news_id
      and (lower(t.team) = lower(coalesce(private.hp_team(), '')) or private.hp_manages_team(t.team))
  );
$$;

-- Peut-on lire cette actu ? (même logique que les règles de F, réutilisée par les tables liées)
create or replace function private.hp_can_read_news(_news_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.news n
    where n.id = _news_id
      and private.hp_role() is not null
      and (
        lower(n.author_email) = private.hp_email()
        or (private.hp_role() = 'admin' and n.status in ('a_valider_manager', 'a_valider_comm', 'publiée', 'refusée'))
        or (n.status = 'publiée' and (n.audience = 'tout_le_cabinet' or private.hp_in_news_teams(n.id)))
        or (n.status in ('a_valider_manager', 'a_modifier_manager')
            and private.hp_role() = 'manager'
            and private.hp_manages_team(private.hp_user_team(n.author_email)))
        or (n.status in ('a_valider_comm', 'a_modifier_comm') and private.hp_is_reviewer())
      )
  );
$$;

-- L'auteur peut-il encore modifier cette actu ? (En rédaction ou À modifier)
create or replace function private.hp_can_edit_news(_news_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.news n
    where n.id = _news_id
      and lower(n.author_email) = private.hp_email()
      and n.status in ('brouillon', 'a_modifier_manager', 'a_modifier_comm')
  );
$$;

grant usage on schema private to authenticated;
grant execute on function
  private.hp_email(), private.hp_role(), private.hp_team(), private.hp_is_reviewer(),
  private.hp_manages_team(text), private.hp_user_team(text), private.hp_in_news_teams(uuid),
  private.hp_can_read_news(uuid), private.hp_can_edit_news(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- F. RLS des actus, réécrite autour de l'audience (D35)
--    On supprime toutes les règles existantes de news, puis on les recrée.
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'news' loop
    execute format('drop policy %I on public.news', p.policyname);
  end loop;
end $$;

alter table public.news enable row level security;

-- Lecture : l'auteur voit ses actus ; l'audience voit les actus publiées ;
-- le manager voit la file de ses équipes ; les relecteurs voient la file Comm ;
-- l'admin voit tout sauf les textes encore chez leur auteur.
create policy news_select on public.news
  for select to authenticated
  using (
    private.hp_role() is not null
    and (
      lower(author_email) = private.hp_email()
      -- admin : tout sauf les textes encore chez leur auteur (En rédaction, À modifier)
      or (private.hp_role() = 'admin' and status in ('a_valider_manager', 'a_valider_comm', 'publiée', 'refusée'))
      or (status = 'publiée' and (audience = 'tout_le_cabinet' or private.hp_in_news_teams(id)))
      or (status in ('a_valider_manager', 'a_modifier_manager')
          and private.hp_role() = 'manager'
          and private.hp_manages_team(private.hp_user_team(author_email)))
      or (status in ('a_valider_comm', 'a_modifier_comm') and private.hp_is_reviewer())
    )
  );

-- Création : collaborateurs et managers (D26), toujours en brouillon, à son nom.
-- L'admin ne publie plus : il garde le paramétrage (D26).
create policy news_insert on public.news
  for insert to authenticated
  with check (
    private.hp_role() in ('collaborateur', 'manager')
    and lower(author_email) = private.hp_email()
    and status = 'brouillon'
  );

-- Modification du contenu : l'auteur, tant que l'actu est En rédaction ou À modifier.
-- Le changement de statut est bloqué par le trigger news_v2_guard (voir G).
create policy news_update on public.news
  for update to authenticated
  using (
    lower(author_email) = private.hp_email()
    and status in ('brouillon', 'a_modifier_manager', 'a_modifier_comm')
  )
  with check (lower(author_email) = private.hp_email());

-- Suppression : l'auteur (avant publication) ; l'admin (gestion des données).
create policy news_delete on public.news
  for delete to authenticated
  using (
    (lower(author_email) = private.hp_email()
      and status in ('brouillon', 'a_modifier_manager', 'a_modifier_comm'))
    or private.hp_role() = 'admin'
  );

-- Équipes ciblées
drop policy if exists news_audience_teams_select on public.news_audience_teams;
drop policy if exists news_audience_teams_insert on public.news_audience_teams;
drop policy if exists news_audience_teams_delete on public.news_audience_teams;

create policy news_audience_teams_select on public.news_audience_teams
  for select to authenticated
  using (private.hp_can_read_news(news_id));

-- Un collaborateur ne cible que son équipe ; un manager, une des équipes qu'il gère.
create policy news_audience_teams_insert on public.news_audience_teams
  for insert to authenticated
  with check (
    private.hp_can_edit_news(news_id)
    and (
      (private.hp_role() = 'collaborateur' and lower(team) = lower(private.hp_team()))
      or (private.hp_role() = 'manager' and private.hp_manages_team(team))
    )
  );

create policy news_audience_teams_delete on public.news_audience_teams
  for delete to authenticated
  using (private.hp_can_edit_news(news_id));

-- Historique : lecture seule, pour qui peut lire l'actu. Aucune écriture depuis l'app.
drop policy if exists news_status_history_select on public.news_status_history;
create policy news_status_history_select on public.news_status_history
  for select to authenticated
  using (private.hp_can_read_news(news_id));

grant select, insert, update, delete on public.news_audience_teams to authenticated;
grant select on public.news_status_history to authenticated;
revoke insert, update, delete on public.news_status_history from authenticated, anon;

-- ---------------------------------------------------------------------
-- G. Triggers et fonctions du circuit
-- ---------------------------------------------------------------------

-- G1. À la création : auteur imposé par la base (nom + email de la personne connectée).
create or replace function private.news_v2_set_author()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _me text := private.hp_email();
begin
  if _me is not null and private.hp_role() in ('collaborateur', 'manager') then
    new.author_email := _me;
    select coalesce(nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), ''), a.email)
      into new.author
      from public.allowed_users a where a.email = _me;
  end if;
  return new;
end $$;

drop trigger if exists news_v2_set_author on public.news;
create trigger news_v2_set_author
  before insert on public.news
  for each row execute function private.news_v2_set_author();

-- G2. Garde-fou : depuis l'app (rôle authenticated), on ne change ni le statut,
--     ni l'auteur, ni les champs du circuit. Seules submit_news / review_news
--     (SECURITY DEFINER, donc exécutées sous un autre rôle) et les tâches automatiques le peuvent.
create or replace function private.news_v2_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status then
      raise exception 'Le statut d''une actu se change avec submit_news ou review_news'
        using errcode = '42501';
    end if;
    -- l'auteur ne change pas, sauf anonymisation au départ de la personne (« Utilisateur supprimé »)
    if new.author_email is distinct from 'Utilisateur supprimé' then new.author_email := old.author_email; end if;
    if new.author is distinct from 'Utilisateur supprimé' then new.author := old.author; end if;
    new.submitted_at := old.submitted_at;
    new.published_at := old.published_at;
    new.manager_validated_by_email := old.manager_validated_by_email;
    new.manager_validated_at := old.manager_validated_at;
    new.reviewed_audience := old.reviewed_audience;
    new.review_category := old.review_category;
    new.review_note := old.review_note;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists news_v2_guard on public.news;
create trigger news_v2_guard
  before update on public.news
  for each row execute function private.news_v2_guard();

-- G3. Historique : une ligne par changement de statut (et à la création).
create or replace function private.news_v2_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _action text := nullif(current_setting('hp.action', true), '');
  _me text := private.hp_email();
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.news_status_history
      (news_id, old_status, new_status, audience, action, changed_by_email, is_automatic,
       rejection_category, note)
    values
      (new.id,
       case when tg_op = 'UPDATE' then old.status end,
       new.status, new.audience,
       coalesce(_action, case when tg_op = 'INSERT' then 'creation' else 'automatique' end),
       _me,
       _me is null,
       case when new.status = 'refusée' then new.review_category end,
       case when new.status in ('refusée', 'a_modifier_manager', 'a_modifier_comm') then new.review_note end);
  end if;
  return null;
end $$;

drop trigger if exists news_v2_history on public.news;
create trigger news_v2_history
  after insert or update of status on public.news
  for each row execute function private.news_v2_history();

-- G4. submit_news : l'auteur envoie (ou renvoie) son actu.
--     La base calcule le circuit (Règles v7, onglet « À plat - Validation ») :
--       Manager      + Mon équipe        → Publié tout de suite         (circuit A)
--       Manager      + Tout le cabinet   → À valider (Comm)             (circuit C)
--       Collaborateur + Mon équipe       → À valider (manager)          (circuit B)
--       Collaborateur + Tout le cabinet  → À valider (manager) puis Comm (circuit D)
--     Renvoi après « À modifier » : retour chez le même valideur, sauf si l'audience a changé (R9).
create or replace function public.submit_news(_news_id uuid)
returns public.news_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n public.news;
  _me text := private.hp_email();
  _role public.app_role := private.hp_role();
  _team text;
  _nb_teams int;
  _target public.news_status;
  _restart boolean;
begin
  select * into n from public.news where id = _news_id for update;
  if not found or lower(n.author_email) is distinct from _me then
    raise exception 'Actu introuvable ou tu n''en es pas l''auteur' using errcode = '42501';
  end if;
  if n.status not in ('brouillon', 'a_modifier_manager', 'a_modifier_comm') then
    raise exception 'Cette actu n''est plus modifiable (statut : %)', n.status using errcode = 'P0001';
  end if;
  if _role not in ('collaborateur', 'manager') then
    raise exception 'Seuls les collaborateurs et les managers publient des actus (D26)' using errcode = '42501';
  end if;
  if coalesce(btrim(n.title), '') = '' then
    raise exception 'Le titre est obligatoire' using errcode = '23514';
  end if;
  if coalesce(btrim(n.body), '') = '' then
    raise exception 'Le texte est obligatoire' using errcode = '23514';
  end if;

  -- Audience
  if n.audience = 'tout_le_cabinet' then
    delete from public.news_audience_teams where news_id = n.id;
  else
    select count(*) into _nb_teams from public.news_audience_teams where news_id = n.id;
    if _nb_teams = 0 then
      if _role = 'collaborateur' then
        _team := private.hp_team();
      else
        select mt.team into _team from public.manager_teams mt
          join public.allowed_users a on a.id = mt.allowed_user_id
          where a.email = _me;
        if (select count(*) from public.manager_teams mt
              join public.allowed_users a on a.id = mt.allowed_user_id where a.email = _me) > 1 then
          raise exception 'Choisis l''équipe parmi celles que tu gères' using errcode = '23514';
        end if;
      end if;
      if _team is null then
        raise exception 'Aucune équipe trouvée pour « Mon équipe »' using errcode = '23514';
      end if;
      insert into public.news_audience_teams (news_id, team) values (n.id, _team);
    elsif _nb_teams > 1 then
      raise exception '« Mon équipe » vise une seule équipe en V1' using errcode = '23514';
    end if;
    -- l'équipe ciblée doit être celle de l'auteur (ou une de ses équipes s'il est manager)
    if exists (
      select 1 from public.news_audience_teams t where t.news_id = n.id and not (
        (_role = 'collaborateur' and lower(t.team) = lower(coalesce(private.hp_team(), '')))
        or (_role = 'manager' and private.hp_manages_team(t.team)))
    ) then
      raise exception 'Tu ne peux viser que ton équipe' using errcode = '42501';
    end if;
  end if;

  -- Circuit
  _restart := n.status = 'brouillon' or n.reviewed_audience is distinct from n.audience;
  if not _restart and n.status = 'a_modifier_manager' then
    _target := 'a_valider_manager';
  elsif not _restart and n.status = 'a_modifier_comm' then
    _target := 'a_valider_comm';
  elsif _role = 'collaborateur' then
    if not exists (
      select 1 from public.manager_teams mt
      where lower(btrim(mt.team)) = lower(btrim(coalesce(private.hp_team(), '')))
    ) then
      raise exception 'Ton équipe n''a pas de manager : contacte l''admin' using errcode = 'P0001';
    end if;
    _target := 'a_valider_manager';
  elsif n.audience = 'mon_equipe' then
    _target := 'publiée';
  else
    _target := 'a_valider_comm';
  end if;

  perform set_config('hp.action', 'envoi', true);
  update public.news set
    status = _target,
    submitted_at = now(),
    published_at = case when _target = 'publiée' then now() else null end,
    manager_validated_by_email = case when _restart then null else manager_validated_by_email end,
    manager_validated_at = case when _restart then null else manager_validated_at end,
    reviewed_audience = null
  where id = n.id;
  perform set_config('hp.action', '', true);
  return _target;
end $$;

-- G5. review_news : le valideur décide (R1) — 'valider' | 'modifier' | 'refuser'.
--     Pas d'auto-validation (R5). Si un autre relecteur a déjà traité l'actu : erreur « déjà traitée ».
create or replace function public.review_news(
  _news_id uuid,
  _decision text,
  _category public.rejection_category default null,
  _note text default null
)
returns public.news_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n public.news;
  _me text := private.hp_email();
  _step text;
  _target public.news_status;
begin
  select * into n from public.news where id = _news_id for update;
  if not found then
    raise exception 'Actu introuvable' using errcode = 'P0002';
  end if;

  if n.status = 'a_valider_manager' then
    _step := 'manager';
    if not (private.hp_role() = 'manager' and private.hp_manages_team(private.hp_user_team(n.author_email))) then
      raise exception 'Seul un manager de l''équipe de l''auteur peut valider cette actu' using errcode = '42501';
    end if;
  elsif n.status = 'a_valider_comm' then
    _step := 'comm';
    if not private.hp_is_reviewer() then
      raise exception 'Seuls les relecteurs Comm peuvent valider cette actu' using errcode = '42501';
    end if;
  else
    raise exception 'Cette actu a déjà été traitée' using errcode = 'P0001';
  end if;

  if lower(n.author_email) = _me then
    raise exception 'Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu' using errcode = '42501';
  end if;

  _note := nullif(btrim(coalesce(_note, '')), '');
  if _note is not null and char_length(_note) > 500 then
    raise exception 'Le commentaire fait 500 caractères maximum' using errcode = '23514';
  end if;

  perform set_config('hp.action', _decision, true);

  if _decision = 'valider' then
    if _step = 'manager' and n.audience = 'tout_le_cabinet' then
      _target := 'a_valider_comm';          -- circuit D, étape 2
    else
      _target := 'publiée';
    end if;
    update public.news set
      status = _target,
      published_at = case when _target = 'publiée' then now() else published_at end,
      manager_validated_by_email = case when _step = 'manager' then _me else manager_validated_by_email end,
      manager_validated_at = case when _step = 'manager' then now() else manager_validated_at end,
      review_category = null,
      review_note = null
    where id = n.id;

  elsif _decision = 'modifier' then
    if _note is null then
      raise exception 'Le commentaire est obligatoire' using errcode = '23514';
    end if;
    _target := case _step when 'manager' then 'a_modifier_manager' else 'a_modifier_comm' end::public.news_status;
    update public.news set
      status = _target, review_note = _note, review_category = null, reviewed_audience = n.audience
    where id = n.id;

  elsif _decision = 'refuser' then
    if _category is null then
      raise exception 'Choisis un motif' using errcode = '23514';
    end if;
    if _note is null then
      raise exception 'Le commentaire est obligatoire' using errcode = '23514';
    end if;
    _target := 'refusée';
    update public.news set
      status = _target, review_category = _category, review_note = _note
    where id = n.id;

  else
    raise exception 'Décision inconnue : valider, modifier ou refuser' using errcode = '22023';
  end if;

  perform set_config('hp.action', '', true);
  return _target;
end $$;

revoke all on function public.submit_news(uuid) from public, anon;
revoke all on function public.review_news(uuid, text, public.rejection_category, text) from public, anon;
grant execute on function public.submit_news(uuid) to authenticated;
grant execute on function public.review_news(uuid, text, public.rejection_category, text) to authenticated;
