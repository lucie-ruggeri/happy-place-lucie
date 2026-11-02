-- =====================================================================
-- Points bloquants v4a · Nouvelle valeur d'ENUM "abandonnée" (D85)
-- 2 nov. 2026
--
-- Isolée dans sa propre migration/transaction : Postgres interdit d'utiliser
-- une valeur tout juste ajoutée par ALTER TYPE ... ADD VALUE dans la même
-- transaction (un DEFAULT, un index ou une policy qui la citerait échouerait).
-- Rien d'autre ici : aucune policy, aucun DEFAULT, aucune fonction ne cite
-- cette valeur dans ce fichier. news_status est un type Postgres séparé
-- (même liste de valeurs par convention, voir CLAUDE.md) : aucun risque
-- pour les actus, qui ne connaissent pas "abandonnée".
-- =====================================================================

alter type public.publication_status add value 'abandonnée';
