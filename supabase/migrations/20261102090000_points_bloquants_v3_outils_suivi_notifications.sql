-- =====================================================================
-- Points bloquants v3 · Outils, suivi, notifications
-- 2 nov. 2026
--
-- Ajoute, sans toucher au comportement déjà testé de set_blocker_status /
-- withdraw_blocker / resubmit_blocker (mêmes messages d'erreur, même ordre
-- de vérification — seule une notification est ajoutée juste avant leur
-- `return`) :
--   1. public.tools (nom, pôle responsable) — lu par le formulaire de
--      signalement, jamais codé en dur côté app.
--   2. public.blocker_followers (« personnes concernées ») et
--      public.blocker_notifications (badge simple, pas d'e-mail).
--   3. Un trigger AFTER INSERT (pas une modification du BEFORE INSERT
--      existant : une ligne ne peut pas se suivre elle-même avant d'exister
--      en base) qui ajoute l'auteur comme 1er follower et notifie les
--      managers de son équipe.
--   4. public.follow_blocker(_id) : ajoute l'appelant aux suiveurs.
--
-- Après passage : select * from private.run_smoke_tests();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Outils et pôles responsables (D65)
-- ---------------------------------------------------------------------
create table if not exists public.tools (
  name text primary key,
  department text not null references public.teams (name) on update cascade on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.tools enable row level security;
drop policy if exists tools_select on public.tools;
create policy tools_select on public.tools for select to authenticated
  using (private.hp_role() is not null);
grant select on public.tools to authenticated;
-- Pas de policy insert/update/delete : gestion admin de la liste (flow 3-3)
-- hors périmètre de cette tranche ; modification via le SQL Editor pour l'instant.

insert into public.tools (name, department) values
  ('CRM candidats', 'Direction Commerciale'),
  ('Job boards', 'Direction recrutement'),
  ('Messagerie / Slack / Visio', 'IT'),
  ('Outil de paie et notes de frais', 'Finance'),
  ('Postes, réseau, VPN, imprimantes', 'IT'),
  ('Happy Place', 'IT')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 2. Suivi (« personnes concernées ») et notifications
-- ---------------------------------------------------------------------
create table if not exists public.blocker_followers (
  blocker_id uuid not null references public.blockers (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, email)
);
alter table public.blocker_followers enable row level security;
drop policy if exists blocker_followers_select on public.blocker_followers;
create policy blocker_followers_select on public.blocker_followers for select to authenticated
  using (lower(email) = private.hp_email() or private.hp_role() = 'admin');
grant select on public.blocker_followers to authenticated;
-- Pas de policy insert/update/delete : écriture uniquement via follow_blocker()
-- et le trigger de création, tous deux SECURITY DEFINER.

create table if not exists public.blocker_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  blocker_id uuid references public.blockers (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.blocker_notifications enable row level security;
drop policy if exists blocker_notifications_select on public.blocker_notifications;
create policy blocker_notifications_select on public.blocker_notifications for select to authenticated
  using (lower(recipient_email) = private.hp_email());
drop policy if exists blocker_notifications_update on public.blocker_notifications;
create policy blocker_notifications_update on public.blocker_notifications for update to authenticated
  using (lower(recipient_email) = private.hp_email())
  with check (lower(recipient_email) = private.hp_email());
grant select, update on public.blocker_notifications to authenticated;

-- Helper anti-auto-notification, réutilisé par toutes les fonctions ci-dessous.
create or replace function private.hp_notify_blocker(_blocker_id uuid, _recipient text, _message text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _recipient is null or lower(_recipient) = private.hp_email() then return; end if;
  insert into public.blocker_notifications (recipient_email, blocker_id, message)
  values (lower(_recipient), _blocker_id, _message);
end $$;

revoke all on function private.hp_notify_blocker(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. À la création : auteur = 1er follower, managers de l'équipe notifiés.
--    AFTER INSERT (pas une extension du BEFORE INSERT existant) : la ligne
--    blockers doit déjà exister pour que la FK blocker_followers.blocker_id
--    soit satisfaite.
-- ---------------------------------------------------------------------
create or replace function private.blockers_v2_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _mgr record;
begin
  if new.created_by_email is not null then
    insert into public.blocker_followers (blocker_id, email)
    values (new.id, lower(new.created_by_email))
    on conflict do nothing;
  end if;
  if new.team is not null then
    for _mgr in
      select a.email from public.manager_teams mt
        join public.allowed_users a on a.id = mt.allowed_user_id
      where mt.team = new.team
    loop
      perform private.hp_notify_blocker(new.id, _mgr.email,
        format('Nouveau point bloquant publié par %s : « %s »',
               coalesce(new.created_by_email, 'un collaborateur'), new.title));
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists blockers_v2_after_insert on public.blockers;
create trigger blockers_v2_after_insert
after insert on public.blockers
for each row execute function private.blockers_v2_after_insert();

-- ---------------------------------------------------------------------
-- 4. Extension des 3 fonctions existantes : notification ajoutée juste
--    avant leur `return`, aucune autre ligne modifiée.
-- ---------------------------------------------------------------------

-- 4a. set_blocker_status : notifie l'auteur et les suiveurs à chaque changement.
create or replace function public.set_blocker_status(_id uuid, _status public.blocker_status)
returns public.blocker_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.blockers; _follower record;
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
  perform private.hp_notify_blocker(_id, b.created_by_email,
    format('Le statut de « %s » est passé à %s', b.title, _status));
  for _follower in select email from public.blocker_followers where blocker_id = _id loop
    perform private.hp_notify_blocker(_id, _follower.email,
      format('Le statut de « %s » est passé à %s', b.title, _status));
  end loop;
  return _status;
end $$;

-- 4b. withdraw_blocker : notifie l'auteur du retrait.
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
  perform private.hp_notify_blocker(_id, b.created_by_email,
    format('Ton point « %s » a été retiré : %s', b.title, _note));
  return 'a_modifier_manager';
end $$;

-- 4c. resubmit_blocker : notification ajoutée pour cohérence (no-op aujourd'hui,
--     l'appelant est toujours l'auteur, hp_notify_blocker l'ignore par construction).
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
  perform private.hp_notify_blocker(_id, b.created_by_email,
    format('Point « %s » corrigé et republié', _title));
  return 'publiée';
end $$;

-- ---------------------------------------------------------------------
-- 5. follow_blocker : ajoute l'appelant aux « personnes concernées ».
-- ---------------------------------------------------------------------
create or replace function public.follow_blocker(_id uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare _n int;
begin
  if not exists (select 1 from public.blockers where id = _id) then
    raise exception 'Point bloquant introuvable' using errcode = 'P0002';
  end if;
  insert into public.blocker_followers (blocker_id, email) values (_id, private.hp_email())
    on conflict (blocker_id, email) do nothing;
  select count(*) into _n from public.blocker_followers where blocker_id = _id;
  return _n;
end $$;

revoke all on function public.follow_blocker(uuid) from public, anon;
grant execute on function public.follow_blocker(uuid) to authenticated;
