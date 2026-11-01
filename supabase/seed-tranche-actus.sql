-- ============================================================
-- Tranche Actus (1 nov. 2026) — données additionnelles
-- ============================================================
-- Delta ciblé, PAS un rejeu complet de seed.sql (qui commence par des DELETE
-- et effacerait les actus déjà créées en testant l'éditeur). À coller une
-- seule fois dans le SQL Editor Supabase, puis vérifier
-- select * from private.run_smoke_tests();

-- 1. Les 2 actus manquantes pour Inès (brouillon + à valider Comm), pour
--    qu'elle voie ses 5 statuts dans "Mes actus".
INSERT INTO public.news (title, body, author, status, audience, submitted_at, published_at, created_at) VALUES
('Nouveau partenariat école de code',
 'Un partenariat est en discussion avec une école de code pour accueillir des alternants Data dès janvier.',
 'Inès', 'brouillon', 'mon_equipe', NULL, NULL, now() - interval '1 day'),
('Lancement de la newsletter mensuelle du cabinet',
 'Une newsletter mensuelle réunira les temps forts du cabinet pour l''ensemble des équipes, toutes directions confondues.',
 'Inès', 'a_valider_comm', 'tout_le_cabinet', now() - interval '2 days', NULL, now() - interval '3 days');

-- 2. author_email (forcé à NULL par le trigger set_news_author_email tant
--    qu'il n'y a pas de JWT dans l'éditeur SQL) : on le corrige juste après.
UPDATE public.news SET author_email = 'ines@happyplace.test'
WHERE title IN ('Nouveau partenariat école de code', 'Lancement de la newsletter mensuelle du cabinet')
  AND author_email IS NULL;

-- 3. La newsletter a déjà été validée par Marc (circuit D : auteur
--    collaborateur, déjà passé par le manager) — pour donner à Camille/Julien
--    un cas "sans bandeau manager" en plus de "Bienvenue à nos 3 nouveaux
--    consultants" (circuit C, auteur Marc, déjà seedée).
UPDATE public.news SET manager_validated_by_email = 'marc@happyplace.test', manager_validated_at = now() - interval '2 days'
WHERE title = 'Lancement de la newsletter mensuelle du cabinet';

-- 4. Équipe ciblée pour le brouillon "Mon équipe" (table de liaison contrôlée
--    par submit_news lors d'un vrai envoi ; renseignée nous-mêmes ici).
INSERT INTO public.news_audience_teams (news_id, team)
SELECT id, 'Direction Commerciale' FROM public.news WHERE title = 'Nouveau partenariat école de code'
ON CONFLICT DO NOTHING;

-- 5. Renommage : collision de prénom avec la persona Camille (Relectrice Comm).
UPDATE public.submissions SET author_name = 'Léna Roux' WHERE author_name = 'Camille Roux';
