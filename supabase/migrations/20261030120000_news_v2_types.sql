-- =====================================================================
-- Happy Place v2 · Migration 1/2 · Nouveaux types (actus)
-- 30 oct. 2026 · D33, D34, D48, D49, D57, D63
--
-- Fichier séparé : Postgres n'autorise pas l'utilisation d'une valeur
-- d'ENUM ajoutée (ALTER TYPE ... ADD VALUE) dans la même transaction.
-- La migration 2/2 utilise ces valeurs, elle doit donc passer après.
-- =====================================================================

-- 1) Statuts de publication : 2 valeurs existantes + 5 nouvelles (Règles v7, onglet Statuts)
--    « brouillon » et « publiée » ne bougent pas (D57) : aucun contenu existant n'est touché.
alter type public.news_status add value if not exists 'a_valider_manager' after 'brouillon';
alter type public.news_status add value if not exists 'a_valider_comm'    after 'a_valider_manager';
alter type public.news_status add value if not exists 'a_modifier_manager' after 'a_valider_comm';
alter type public.news_status add value if not exists 'a_modifier_comm'   after 'a_modifier_manager';
alter type public.news_status add value if not exists 'refusée'           after 'publiée';

-- 2) Audience d'une actu : 2 valeurs pour la V1 (D18, D33).
--    « plusieurs_equipes » viendra plus tard par un simple ADD VALUE :
--    les équipes ciblées sont déjà dans une table de liaison (news_audience_teams).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'news_audience') then
    create type public.news_audience as enum ('mon_equipe', 'tout_le_cabinet');
  end if;
end $$;

-- 3) Mode de saisie : sert au suivi du KPI « publication express » (part des actus dictées ou collées)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'news_input_mode') then
    create type public.news_input_mode as enum ('dictee', 'notes', 'ecrit');
  end if;
end $$;
