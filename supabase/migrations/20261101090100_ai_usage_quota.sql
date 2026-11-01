-- =====================================================================
-- Tranche Actus · Migration 2/2 · Quota d'appels à l'assistant IA
-- 1 nov. 2026
--
-- Clé du quota = l'identifiant utilisateur (claim JWT "sub" = auth.users.id),
-- PAS l'email : les personas sont des comptes anonymes, le claim "email" du
-- JWT peut être absent même après choisir_persona. "sub" est lui toujours
-- présent, persona ou pas.
--
-- La fonction Edge "format-actu" appelle check_and_bump_ai_usage avec le
-- client Supabase service_role (qui contourne la RLS) pour compter et
-- plafonner les appels à 50 par utilisateur et par jour. Table et fonction
-- en schéma public (nécessaire pour être appelables via supabase.rpc()),
-- mais aucun droit n'est accordé à anon/authenticated : seul service_role
-- (utilisé uniquement côté fonction Edge, jamais dans le navigateur) y a accès.
-- =====================================================================

create table if not exists public.ai_usage_daily (
  user_id uuid not null,
  day date not null default current_date,
  calls int not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage_daily enable row level security;
-- Aucune policy : ni anon ni authenticated n'ont accès ; seul service_role
-- (qui contourne RLS) peut lire/écrire, depuis la fonction Edge.

revoke all on public.ai_usage_daily from public, anon, authenticated;

create or replace function public.check_and_bump_ai_usage(_user_id uuid, _limit int default 50)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _count int;
begin
  insert into public.ai_usage_daily (user_id, day, calls)
  values (_user_id, current_date, 1)
  on conflict (user_id, day) do update
    set calls = ai_usage_daily.calls + 1
  returning calls into _count;

  return _count <= _limit;
end;
$$;

revoke all on function public.check_and_bump_ai_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.check_and_bump_ai_usage(uuid, int) to service_role;
