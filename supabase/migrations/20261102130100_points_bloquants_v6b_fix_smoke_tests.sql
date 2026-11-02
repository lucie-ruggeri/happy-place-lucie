-- =====================================================================
-- Points bloquants v6b · Retire une assertion invérifiable du test de fumée
-- 2 nov. 2026
--
-- run_smoke_tests() est SECURITY DEFINER, exécutée du début à la fin avec
-- les droits de son propriétaire (postgres, superutilisateur) : la RLS est
-- donc totalement contournée, pour toute requête, y compris les appels à
-- blocker_follower_counts(). set_config('request.jwt.claims', ...) alimente
-- bien auth.jwt()/hp_email()/hp_role() (utilisés par les vérifications
-- manuelles en PL/pgSQL des autres fonctions, comme withdraw_blocker), mais
-- ne déclenche jamais la RLS elle-même, qui dépend du rôle Postgres actif,
-- pas du contenu du JWT simulé. L'assertion "point invisible → 0 ligne"
-- ne peut donc pas être observée depuis ce harnais : une requête directe,
-- dans le même contexte, renverrait aussi 1 ligne, pour la même raison —
-- ce n'est pas une fuite de blocker_follower_counts() (relue : toujours
-- SECURITY INVOKER, aucun contournement), juste une limite du harnais.
-- Les deux autres assertions du compteur restent valides : elles ne
-- dépendent pas de la RLS (le point testé est visible pour smoke.manager
-- même sans RLS, puisqu'il gère l'équipe).
--
-- Aucun changement à hp_count_followers ni à blocker_follower_counts.
-- Seul changement : la 3e assertion du compteur est retirée, remplacée
-- par ce commentaire — reste du corps identique octet pour octet à la
-- version appliquée dans 20261102130000.
-- =====================================================================

CREATE OR REPLACE FUNCTION private.run_smoke_tests()
 RETURNS TABLE(test text, ok boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  _res jsonb := '[]'::jsonb;
  _collab uuid; _mgr uuid; _adm uuid;
  _s1 uuid; _s2 uuid; _b uuid; _n uuid;
  _b2 uuid; _b3 uuid; _b4 uuid; _b5 uuid; _b6 uuid; _b7 uuid; _b8 uuid; _b9 uuid;
  _st text; _cnt int; _err text; _bool boolean; _ts timestamptz;
  _team text := 'ZZ Test fumée';
BEGIN
  BEGIN
    INSERT INTO teams(name) VALUES (_team) ON CONFLICT DO NOTHING;
    INSERT INTO allowed_users(email, team) VALUES ('smoke.collab@test.invalid', _team) RETURNING id INTO _collab;
    INSERT INTO allowed_user_roles(allowed_user_id, role) VALUES (_collab, 'collaborateur');
    INSERT INTO allowed_users(email) VALUES ('smoke.manager@test.invalid') RETURNING id INTO _mgr;
    INSERT INTO allowed_user_roles(allowed_user_id, role) VALUES (_mgr, 'manager');
    INSERT INTO manager_teams(allowed_user_id, team) VALUES (_mgr, _team);
    INSERT INTO allowed_users(email) VALUES ('smoke.admin@test.invalid') RETURNING id INTO _adm;
    INSERT INTO allowed_user_roles(allowed_user_id, role) VALUES (_adm, 'admin');

    -- Collaborateur : soumission
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO submissions(author_name, team, content) VALUES ('Smoke', 'x', 'Demande de test 1') RETURNING id, status::text INTO _s1, _st;
    _res := _res || jsonb_build_object('t', 'Soumission créée « en attente », dans l''équipe du collaborateur',
      'ok', _st = 'en attente' AND (SELECT team FROM submissions WHERE id = _s1) = _team, 'd', _st);
    INSERT INTO submissions(author_name, team, content) VALUES ('Smoke', 'x', 'Demande de test 2') RETURNING id INTO _s2;

    -- Manager : validation et refus
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    BEGIN
      UPDATE submissions SET status = 'validée' WHERE id = _s1;
      _res := _res || jsonb_build_object('t', 'Le manager valide une demande en attente', 'ok', true, 'd', 'validée');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'Le manager valide une demande en attente', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      UPDATE submissions SET status = 'refusée', rejection_category = 'doublon', rejection_note = 'Test' WHERE id = _s2;
      _res := _res || jsonb_build_object('t', 'Le manager refuse une demande avec un motif', 'ok', true, 'd', 'refusée');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'Le manager refuse une demande avec un motif', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      UPDATE submissions SET status = 'refusée' WHERE id = _s1;
      _res := _res || jsonb_build_object('t', 'Le manager ne peut pas revenir sur une demande validée', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'Le manager ne peut pas revenir sur une demande validée', 'ok', true, 'd', 'refusé par la base');
    END;
    SELECT count(*) INTO _cnt FROM submission_status_history WHERE submission_id IN (_s1, _s2);
    _res := _res || jsonb_build_object('t', 'Historique : 4 lignes (2 créations, 1 validation, 1 refus)', 'ok', _cnt = 4, 'd', _cnt || ' ligne(s)');

    -- Revalidation annuelle
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE submissions SET revalidate_at = now() - interval '1 day' WHERE id = _s1;
    PERFORM private.expire_revalidations();
    SELECT status::text INTO _st FROM submissions WHERE id = _s1;
    _res := _res || jsonb_build_object('t', 'Revalidation annuelle : une demande validée échue repasse « en attente »', 'ok', _st = 'en attente', 'd', _st);

    -- Points bloquants
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.admin@test.invalid"}', true);
    INSERT INTO blockers(title, department) VALUES ('Blocage de test', 'Test') RETURNING id, status::text INTO _b, _st;
    _res := _res || jsonb_build_object('t', 'Point bloquant créé au statut OUVERT', 'ok', _st = 'OUVERT', 'd', _st);
    BEGIN
      UPDATE blockers SET status = 'RÉSOLU' WHERE id = _b;
      _res := _res || jsonb_build_object('t', 'OUVERT → RÉSOLU refusé', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'OUVERT → RÉSOLU refusé', 'ok', true, 'd', 'refusé par la base');
    END;
    BEGIN
      UPDATE blockers SET status = 'EN COURS' WHERE id = _b;
      UPDATE blockers SET status = 'SURVEILLANCE' WHERE id = _b;
      UPDATE blockers SET status = 'RÉSOLU' WHERE id = _b;
      _res := _res || jsonb_build_object('t', 'OUVERT → EN COURS → SURVEILLANCE → RÉSOLU accepté', 'ok', true, 'd', 'RÉSOLU');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'OUVERT → EN COURS → SURVEILLANCE → RÉSOLU accepté', 'ok', false, 'd', SQLERRM);
    END;

    -- Points bloquants · abandon par l'auteur (D85)
    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication)
      VALUES ('Blocage à retirer', _team, _team, 'smoke.collab@test.invalid', 'warning', 'publiée') RETURNING id INTO _b2;
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    PERFORM withdraw_blocker(_b2, 'Commentaire de test');
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    BEGIN
      PERFORM abandon_blocker(_b2);
      SELECT statut_publication::text INTO _st FROM blockers WHERE id = _b2;
      _res := _res || jsonb_build_object('t', 'abandon_blocker : l''auteur abandonne un point à modifier', 'ok', _st = 'abandonnée', 'd', _st);
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'abandon_blocker : l''auteur abandonne un point à modifier', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      PERFORM resubmit_blocker(_b2, 'Nouveau titre', 'Nouvelle description');
      _res := _res || jsonb_build_object('t', 'abandon_blocker : pas de réouverture possible après abandon', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'abandon_blocker : pas de réouverture possible après abandon', 'ok', true, 'd', SQLERRM);
    END;

    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication)
      VALUES ('Blocage à retirer 2', _team, _team, 'smoke.collab@test.invalid', 'warning', 'publiée') RETURNING id INTO _b3;
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    PERFORM withdraw_blocker(_b3, 'Commentaire de test 2');
    BEGIN
      -- jwt toujours smoke.manager : non-auteur de ce point.
      PERFORM abandon_blocker(_b3);
      _res := _res || jsonb_build_object('t', 'abandon_blocker : un non-auteur est refusé', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'abandon_blocker : un non-auteur est refusé', 'ok', true, 'd', SQLERRM);
    END;

    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication)
      VALUES ('Blocage publié', _team, _team, 'smoke.collab@test.invalid', 'warning', 'publiée') RETURNING id INTO _b4;
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    BEGIN
      PERFORM abandon_blocker(_b4);
      _res := _res || jsonb_build_object('t', 'abandon_blocker : refusé si le point n''est pas « à modifier »', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'abandon_blocker : refusé si le point n''est pas « à modifier »', 'ok', true, 'd', SQLERRM);
    END;

    -- Points bloquants · rappel unique après un retrait (D85, R8 point 3)
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, updated_at)
      VALUES ('Blocage ancien', _team, _team, 'smoke.collab@test.invalid', 'warning', 'a_modifier_manager', now() - interval '4 days')
      RETURNING id INTO _b5;
    PERFORM private.run_blocker_withdraw_reminders();
    SELECT withdraw_reminder_at IS NOT NULL INTO _bool FROM blockers WHERE id = _b5;
    SELECT count(*) INTO _cnt FROM blocker_notifications
      WHERE blocker_id = _b5 AND recipient_email = 'smoke.collab@test.invalid' AND message LIKE 'Rappel%';
    _res := _res || jsonb_build_object('t', 'Rappel envoyé pour un retrait dont le délai est dépassé', 'ok', _bool AND _cnt = 1, 'd', _cnt || ' notification(s)');

    PERFORM private.run_blocker_withdraw_reminders();
    SELECT count(*) INTO _cnt FROM blocker_notifications
      WHERE blocker_id = _b5 AND recipient_email = 'smoke.collab@test.invalid' AND message LIKE 'Rappel%';
    _res := _res || jsonb_build_object('t', 'Un seul rappel même si le cron tourne deux fois', 'ok', _cnt = 1, 'd', _cnt || ' notification(s)');

    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, updated_at)
      VALUES ('Blocage récent', _team, _team, 'smoke.collab@test.invalid', 'warning', 'a_modifier_manager', now() - interval '1 day')
      RETURNING id INTO _b6;
    PERFORM private.run_blocker_withdraw_reminders();
    SELECT withdraw_reminder_at INTO _ts FROM blockers WHERE id = _b6;
    _res := _res || jsonb_build_object('t', 'Pas de rappel avant le délai (3 jours par défaut)', 'ok', _ts IS NULL, 'd', coalesce(_ts::text, 'aucun'));

    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, updated_at)
      VALUES ('Blocage republié avant rappel', _team, _team, 'smoke.collab@test.invalid', 'warning', 'publiée', now() - interval '4 days')
      RETURNING id INTO _b7;
    PERFORM private.run_blocker_withdraw_reminders();
    SELECT withdraw_reminder_at INTO _ts FROM blockers WHERE id = _b7;
    _res := _res || jsonb_build_object('t', 'Pas de rappel pour un point déjà republié', 'ok', _ts IS NULL, 'd', coalesce(_ts::text, 'aucun'));

    -- Compteur "N personnes concernées" (flow 2-9)
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, audience)
      VALUES ('Blocage avec suiveurs', _team, _team, 'smoke.collab@test.invalid', 'warning', 'publiée', 'mon_equipe')
      RETURNING id INTO _b8;
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    SELECT follower_count INTO _cnt FROM blocker_follower_counts() WHERE blocker_id = _b8;
    _res := _res || jsonb_build_object('t', 'Compteur : l''auteur est déjà suiveur à la création', 'ok', _cnt = 1, 'd', _cnt || ' suiveur(s)');

    PERFORM follow_blocker(_b8);
    SELECT follower_count INTO _cnt FROM blocker_follower_counts() WHERE blocker_id = _b8;
    _res := _res || jsonb_build_object('t', 'Compteur : +1 après follow_blocker', 'ok', _cnt = 2, 'd', _cnt || ' suiveur(s)');

    -- Assertion "point invisible → 0 ligne" retirée : invérifiable depuis ce
    -- harnais. run_smoke_tests() est SECURITY DEFINER et tourne du début à
    -- la fin en tant que postgres (superutilisateur), qui contourne la RLS
    -- pour toute requête — y compris blocker_follower_counts(), qui est
    -- pourtant bien SECURITY INVOKER et sans contournement (code relu, non
    -- modifié ici). set_config('request.jwt.claims', ...) alimente auth.jwt()
    -- mais ne déclenche jamais la RLS elle-même, qui dépend du rôle Postgres
    -- réellement actif. En production, un vrai appel authentifié depuis
    -- l'app s'exécute avec le rôle "authenticated" : la RLS s'applique
    -- normalement à ce moment-là. Pour vérifier la non-visibilité à la main
    -- dans le SQL Editor (hors de ce harnais) :
    --   set local role authenticated;
    --   select set_config('request.jwt.claims', '{"email":"ines@happyplace.test"}', true);
    --   select * from blocker_follower_counts(); -- ne doit pas lister un point d'une autre équipe en "Mon équipe"
    --   reset role;

    -- Actualités
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    INSERT INTO news(title, body, author, status) VALUES ('Actu de test', 'Corps', 'Smoke', 'brouillon') RETURNING id INTO _n;
    UPDATE news SET status = 'publiée' WHERE id = _n;
    _res := _res || jsonb_build_object('t', 'Actualité : brouillon puis publiée, échéance de revalidation posée', 'ok',
      (SELECT revalidate_at IS NOT NULL FROM news WHERE id = _n), 'd', (SELECT status::text FROM news WHERE id = _n));

    -- Référentiel des équipes
    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN
      UPDATE teams SET name = 'ZZ Test fumée 2' WHERE name = _team;
      _res := _res || jsonb_build_object('t', 'Référentiel : renommer une équipe met à jour utilisateurs, managers et demandes', 'ok',
        (SELECT team FROM allowed_users WHERE id = _collab) = 'ZZ Test fumée 2'
        AND (SELECT team FROM manager_teams WHERE allowed_user_id = _mgr) = 'ZZ Test fumée 2'
        AND (SELECT team FROM submissions WHERE id = _s1) = 'ZZ Test fumée 2', 'd', 'ZZ Test fumée 2');
      _team := 'ZZ Test fumée 2';
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'Référentiel : renommer une équipe met à jour utilisateurs, managers et demandes', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      DELETE FROM teams WHERE name = _team;
      _res := _res || jsonb_build_object('t', 'Référentiel : supprimer une équipe encore utilisée est refusé', 'ok', false, 'd', 'accepté à tort');
    EXCEPTION
      WHEN foreign_key_violation THEN
        _res := _res || jsonb_build_object('t', 'Référentiel : supprimer une équipe encore utilisée est refusé', 'ok', true, 'd', 'refusé par la base');
      WHEN OTHERS THEN
        _res := _res || jsonb_build_object('t', 'Référentiel : supprimer une équipe encore utilisée est refusé', 'ok', false, 'd', SQLERRM);
    END;

    RAISE EXCEPTION 'HP_SMOKE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'HP_SMOKE_ROLLBACK' THEN
      _res := _res || jsonb_build_object('t', 'Exécution du test de fumée', 'ok', false, 'd', 'Erreur inattendue : ' || SQLERRM);
    END IF;
  END;

  SELECT count(*) INTO _cnt FROM private.audit_enum_literals();
  _res := _res || jsonb_build_object('t', 'Aucune valeur d''ENUM obsolète dans les fonctions', 'ok', _cnt = 0, 'd', _cnt || ' anomalie(s)');

  RETURN QUERY SELECT x->>'t', (x->>'ok')::boolean, x->>'d' FROM jsonb_array_elements(_res) x;
END;
$function$;
