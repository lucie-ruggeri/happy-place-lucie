-- =====================================================================
-- Tranche Actus · Migration 1/2 · Nom du manager de son équipe
-- 1 nov. 2026
--
-- Un collaborateur ne peut pas lire la ligne allowed_users/manager_teams
-- d'un tiers (RLS "Users see own entry" / "Managers see own teams").
-- Cette fonction lui donne uniquement le prénom du manager de SA propre
-- équipe, pour la frise de circuit de l'éditeur d'actu ("Toi → Marc → Publié").
-- Même granularité que les autres fonctions "qui suis-je" (private.hp_*).
-- =====================================================================

create or replace function public.my_manager_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(a.first_name), ''), a.email)
  from public.manager_teams mt
  join public.allowed_users a on a.id = mt.allowed_user_id
  where lower(btrim(mt.team)) = lower(btrim(private.hp_team()))
  limit 1;
$$;

revoke all on function public.my_manager_name() from public, anon;
grant execute on function public.my_manager_name() to authenticated;
