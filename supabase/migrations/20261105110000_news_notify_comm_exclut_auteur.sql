-- =====================================================================
-- Actus · L'auteur relecteur ne reçoit pas le mail de relecture Comm
-- 5 nov. 2026
--
-- Constat (test Camille, actu « Tout le cabinet », validée par Sophie) :
-- private.news_v2_notify_comm envoyait actu_a_relire à TOUS les relecteurs
-- (is_reviewer = true), y compris l'auteur de l'actu. Or un relecteur ne valide
-- jamais son propre contenu (review_news) : Camille recevait un mail qu'elle
-- ne pouvait pas traiter.
--
-- Correction : la boucle exclut le relecteur dont l'e-mail est celui de l'auteur
-- (comparaison en minuscules). Corps identique à 20261105100000 sinon (garde
-- hp.seeding, bloc exception).
--
-- Écart assumé : si l'auteur est le seul relecteur, personne n'est notifié
-- (cohérent avec la règle d'auto-validation ; le journal news_event part toujours).
--
-- Smoke tests : repart du corps de 20261105100000 et ajoute 1 assertion
-- (bloc « Auteur relecteur exclu »), sans rien retirer.
--
-- Après passage : select * from private.run_smoke_tests();  (toutes les lignes à ok = true)
-- =====================================================================

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
  if coalesce(current_setting('hp.seeding', true), '') = 'on' then
    return new;
  end if;

  if new.status = 'a_valider_comm' and (old.status is distinct from new.status) then
    _audience_label := case when new.audience = 'mon_equipe' then 'Mon équipe' else 'Plusieurs équipes / Tout le cabinet' end;
    for rv in
      select first_name
      from public.allowed_users
      where is_reviewer
        and lower(email) is distinct from lower(new.author_email)
    loop
      perform private.call_make_webhook('actu_a_relire', coalesce(rv.first_name, 'Relecteur Comm'), new.title, _audience_label);
    end loop;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Smoke tests : corps de 20261105100000 + bloc « Auteur relecteur exclu »
-- ---------------------------------------------------------------------
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
  -- D24
  _n2 uuid; _n3 uuid; _payload jsonb; _net_cnt_before int;
  -- R9
  _collab2 uuid; _poleMgr uuid; _poleTeam text := 'ZZ Test fumée Pole';
  _b10 uuid; _b11 uuid; _b12 uuid;
  -- Correction 3 (rappel de brouillon, tout auteur)
  _n4 uuid; _n5 uuid; _n6 uuid; _n7 uuid; _ts2 timestamptz;
  -- Whisper
  _wh_user uuid; _wh_ok1 boolean; _wh_ok2 boolean; _wh_setting text;
  -- Notification manager (actu_a_valider)
  _nm1 uuid; _nm2 uuid; _net_a int; _net_b int;
  -- Auteur relecteur exclu
  _nm3 uuid; _nr int;
BEGIN
  -- D24 : aucun envoi réel pendant les smoke tests, même si D78 est déjà
  -- configuré sur cette base (sans quoi chaque run polluerait le vrai Sheet).
  PERFORM set_config('hp.seeding', 'on', true);

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

    -- Points bloquants · notification Slack et cloche à la publication (R9)
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO allowed_users(email, team) VALUES ('smoke.collab2@test.invalid', _team) RETURNING id INTO _collab2;
    INSERT INTO allowed_user_roles(allowed_user_id, role) VALUES (_collab2, 'collaborateur');
    INSERT INTO teams(name) VALUES (_poleTeam) ON CONFLICT DO NOTHING;
    INSERT INTO allowed_users(email) VALUES ('smoke.pole.manager@test.invalid') RETURNING id INTO _poleMgr;
    INSERT INTO allowed_user_roles(allowed_user_id, role) VALUES (_poleMgr, 'manager');
    INSERT INTO manager_teams(allowed_user_id, team) VALUES (_poleMgr, _poleTeam);

    -- Jamais de vrai envoi Slack pendant les tests, quelle que soit la
    -- configuration déjà en place sur cette base (même précaution que D24).
    DELETE FROM private.automation_config WHERE key IN ('make_webhook_url', 'make_webhook_secret');
    PERFORM set_config('hp.seeding', '', true);

    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, audience, tool)
      VALUES ('Blocage R9 mon équipe', _poleTeam, _team, 'smoke.collab@test.invalid', 'critical', 'publiée', 'mon_equipe', 'Outil de test')
      RETURNING id INTO _b10;
    SELECT count(*) INTO _cnt FROM blocker_notifications
      WHERE blocker_id = _b10 AND recipient_email IN ('smoke.manager@test.invalid', 'smoke.collab2@test.invalid', 'smoke.pole.manager@test.invalid');
    _res := _res || jsonb_build_object('t', 'R9 mon_equipe : manager d''équipe, membre d''équipe et manager du pôle notifiés', 'ok', _cnt = 3, 'd', _cnt || ' notification(s)');

    SELECT count(*) INTO _cnt FROM blocker_notifications WHERE blocker_id = _b10 AND recipient_email = 'smoke.collab@test.invalid';
    _res := _res || jsonb_build_object('t', 'R9 : l''auteur n''est jamais notifié de son propre point', 'ok', _cnt = 0, 'd', _cnt || ' notification(s)');

    SELECT message INTO _st FROM blocker_notifications WHERE blocker_id = _b10 AND recipient_email = 'smoke.manager@test.invalid';
    _res := _res || jsonb_build_object('t', 'R9 : message « Nouveau point bloquant : <titre> (<outil>) »', 'ok',
      _st = 'Nouveau point bloquant : Blocage R9 mon équipe (Outil de test)', 'd', coalesce(_st, 'aucun'));

    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO blockers(title, department, created_by_email, severity, statut_publication, audience, tool)
      VALUES ('Blocage R9 cabinet', _poleTeam, 'smoke.admin@test.invalid', 'warning', 'publiée', 'tout_le_cabinet', 'Outil de test 2')
      RETURNING id INTO _b11;
    SELECT count(*) INTO _cnt FROM blocker_notifications
      WHERE blocker_id = _b11 AND recipient_email IN ('smoke.manager@test.invalid', 'smoke.pole.manager@test.invalid');
    _res := _res || jsonb_build_object('t', 'R9 tout_le_cabinet : les managers de tous les pôles sont notifiés', 'ok', _cnt = 2, 'd', _cnt || ' notification(s)');

    SELECT count(*) INTO _cnt FROM blocker_notifications WHERE blocker_id = _b11 AND recipient_email = 'smoke.collab2@test.invalid';
    _res := _res || jsonb_build_object('t', 'R9 tout_le_cabinet : un collaborateur non-manager n''est pas notifié', 'ok', _cnt = 0, 'd', _cnt || ' notification(s)');

    BEGIN
      INSERT INTO blockers(title, department, created_by_email, severity, statut_publication, audience, tool)
        VALUES ('Blocage sans config d''envoi', _poleTeam, 'smoke.collab@test.invalid', 'info', 'publiée', 'tout_le_cabinet', 'Outil de test 3');
      _res := _res || jsonb_build_object('t', 'R9 : la publication réussit même sans configuration d''envoi', 'ok', true, 'd', 'insertion réussie');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'R9 : la publication réussit même sans configuration d''envoi', 'ok', false, 'd', SQLERRM);
    END;

    -- Forme du message Slack (fonction pure, sans dépendre de pg_net)
    _payload := private.blocker_event_payload(
      gen_random_uuid(), 'Blocage test', 'CRM candidats', 'Direction Commerciale', 'critical',
      'Inès', 'mon_equipe', 'https://example.invalid', 'test'
    );
    _res := _res || jsonb_build_object('t', 'blocker_event_payload : forme du message, pas de description (R9)', 'ok',
      _payload->>'type' = 'blocker_event'
      AND _payload->>'event_type' = 'blocker_published'
      AND _payload->>'blocker_id' IS NOT NULL
      AND _payload->>'event_id' IS NOT NULL
      AND _payload->>'event_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
      AND _payload->>'tool' = 'CRM candidats'
      AND _payload->>'pole' = 'Direction Commerciale'
      AND _payload->>'severity_label' = 'Critique'
      AND _payload->>'author' = 'Inès'
      AND _payload->>'audience_label' = 'Mon équipe'
      AND NOT (_payload ? 'description')
      AND _payload->>'environment' = 'test',
      'd', _payload::text);

    -- Garde anti-seed : aucun envoi mis en file même avec une configuration
    -- valide (même mécanisme que D24).
    PERFORM set_config('hp.seeding', 'on', true);
    INSERT INTO private.automation_config(key, value) VALUES ('make_webhook_url', 'https://example.invalid/webhook')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value;
    INSERT INTO private.automation_config(key, value) VALUES ('make_webhook_secret', 'smoke-secret')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value;
    SELECT count(*) INTO _net_cnt_before FROM net.http_request_queue;
    INSERT INTO blockers(title, department, team, created_by_email, severity, statut_publication, audience, tool)
      VALUES ('Blocage de seed simulé', _poleTeam, _team, 'smoke.collab@test.invalid', 'warning', 'publiée', 'mon_equipe', 'Outil de test 4')
      RETURNING id INTO _b12;
    SELECT count(*) INTO _cnt FROM net.http_request_queue;
    _res := _res || jsonb_build_object('t', 'R9 : aucun envoi Slack déclenché pour un point créé pendant un seed', 'ok',
      _cnt = _net_cnt_before, 'd', (_cnt - _net_cnt_before) || ' requête(s) en plus');
    SELECT count(*) INTO _cnt FROM blocker_notifications WHERE blocker_id = _b12;
    _res := _res || jsonb_build_object('t', 'R9 : aucune notification cloche créée pour un point créé pendant un seed', 'ok', _cnt = 0, 'd', _cnt || ' notification(s)');

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

    -- Rappel de brouillon étendu à tout auteur (correction 3) : jamais de vrai
    -- envoi Slack pendant les tests, même précaution que pour R9 ci-dessus.
    DELETE FROM private.automation_config WHERE key IN ('make_webhook_url', 'make_webhook_secret');

    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience, created_at)
      VALUES ('Brouillon collaborateur ancien', 'Corps', 'brouillon', 'mon_equipe', now() - interval '2 days')
      RETURNING id INTO _n4;

    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience, created_at)
      VALUES ('Brouillon manager ancien', 'Corps', 'brouillon', 'mon_equipe', now() - interval '2 days')
      RETURNING id INTO _n5;
    INSERT INTO news(title, body, status, audience, created_at)
      VALUES ('Brouillon récent', 'Corps', 'brouillon', 'mon_equipe', now() - interval '2 hours')
      RETURNING id INTO _n6;

    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience, created_at)
      VALUES ('Brouillon envoyé avant le passage du cron', 'Corps', 'brouillon', 'mon_equipe', now() - interval '2 days')
      RETURNING id INTO _n7;
    PERFORM submit_news(_n7);

    PERFORM private.run_news_draft_reminders();

    SELECT draft_reminder_at IS NOT NULL INTO _bool FROM news WHERE id = _n4;
    _res := _res || jsonb_build_object('t', 'Rappel créé pour un brouillon de collaborateur de plus d''un jour (correction 3)', 'ok', _bool, 'd', _bool::text);

    SELECT draft_reminder_at IS NOT NULL INTO _bool FROM news WHERE id = _n5;
    _res := _res || jsonb_build_object('t', 'Rappel créé pour un brouillon de manager de plus d''un jour (non régressé)', 'ok', _bool, 'd', _bool::text);

    SELECT draft_reminder_at INTO _ts FROM news WHERE id = _n6;
    _res := _res || jsonb_build_object('t', 'Pas de rappel avant le délai (1 jour par défaut)', 'ok', _ts IS NULL, 'd', coalesce(_ts::text, 'aucun'));

    SELECT draft_reminder_at INTO _ts FROM news WHERE id = _n7;
    _res := _res || jsonb_build_object('t', 'Pas de rappel pour un brouillon déjà envoyé avant le passage du cron', 'ok', _ts IS NULL, 'd', coalesce(_ts::text, 'aucun'));

    SELECT draft_reminder_at INTO _ts FROM news WHERE id = _n4;
    PERFORM private.run_news_draft_reminders();
    SELECT draft_reminder_at INTO _ts2 FROM news WHERE id = _n4;
    _res := _res || jsonb_build_object('t', 'Un seul rappel même si le cron tourne deux fois', 'ok', _ts = _ts2, 'd', coalesce(_ts2::text, 'aucun'));

    -- D24 · news_event_payload : forme du message, indépendante de pg_net.
    _payload := private.news_event_payload(
      'submitted', gen_random_uuid(), 'Inès', 'collaborateur', 'mon_equipe', 'a_valider_manager',
      now() - interval '47 minutes', null, 'test'
    );
    _res := _res || jsonb_build_object('t', 'news_event_payload : forme du message (D24)', 'ok',
      _payload->>'type' = 'news_event'
      AND _payload->>'event_type' = 'submitted'
      AND _payload->>'news_id' IS NOT NULL
      AND _payload->>'event_id' IS NOT NULL
      AND _payload->>'event_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
      AND _payload->>'author' = 'Inès'
      AND _payload->>'author_role' = 'collaborateur'
      AND _payload->>'audience' = 'mon_equipe'
      AND _payload->>'status_to' = 'a_valider_manager'
      AND _payload->'ai_assisted' = 'null'::jsonb
      AND _payload->>'environment' = 'test',
      'd', _payload::text);

    -- D24 · minutes_since_creation : calcul exact à partir d'une date fixe.
    _payload := private.news_event_payload(
      'published', gen_random_uuid(), 'Marc', 'manager', 'tout_le_cabinet', 'publiée',
      now() - interval '125 minutes', null, 'test'
    );
    _res := _res || jsonb_build_object('t', 'news_event_payload : minutes_since_creation calculé (D24)', 'ok',
      (_payload->>'minutes_since_creation')::int = 125, 'd', _payload->>'minutes_since_creation');

    -- D24 · send_make_webhook ne bloque jamais, même sans configuration,
    -- et un changement de statut réussit malgré tout (hp.seeding désactivé
    -- pour isoler ce test de la garde anti-seed, au lieu de la garde elle-même).
    PERFORM set_config('hp.seeding', '', true);
    DELETE FROM private.automation_config WHERE key IN ('make_webhook_url', 'make_webhook_secret');
    BEGIN
      PERFORM private.send_make_webhook(jsonb_build_object('type', 'news_event'));
      _res := _res || jsonb_build_object('t', 'send_make_webhook : aucune erreur si la configuration est vide (D24)', 'ok', true, 'd', 'appel sans exception');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'send_make_webhook : aucune erreur si la configuration est vide (D24)', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      INSERT INTO news(title, body, author, status) VALUES ('Actu de test événements', 'Corps', 'Smoke', 'brouillon') RETURNING id INTO _n2;
      UPDATE news SET status = 'a_valider_manager' WHERE id = _n2;
      _res := _res || jsonb_build_object('t', 'Un changement de statut réussit même sans configuration d''envoi (D24)', 'ok',
        (SELECT status::text FROM news WHERE id = _n2) = 'a_valider_manager', 'd', (SELECT status::text FROM news WHERE id = _n2));
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'Un changement de statut réussit même sans configuration d''envoi (D24)', 'ok', false, 'd', SQLERRM);
    END;

    -- D24 · garde anti-seed : aucune requête mise en file, même avec une
    -- configuration valide, tant que hp.seeding vaut 'on'.
    PERFORM set_config('hp.seeding', 'on', true);
    INSERT INTO private.automation_config(key, value) VALUES ('make_webhook_url', 'https://example.invalid/webhook')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value;
    INSERT INTO private.automation_config(key, value) VALUES ('make_webhook_secret', 'smoke-secret')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value;
    SELECT count(*) INTO _net_cnt_before FROM net.http_request_queue;
    INSERT INTO news(title, body, author, status) VALUES ('Actu de seed simulé', 'Corps', 'Smoke', 'brouillon') RETURNING id INTO _n3;
    UPDATE news SET status = 'publiée' WHERE id = _n3;
    SELECT count(*) INTO _cnt FROM net.http_request_queue;
    _res := _res || jsonb_build_object('t', 'Aucun envoi déclenché pour une actu créée pendant un seed (D24)', 'ok',
      _cnt = _net_cnt_before, 'd', (_cnt - _net_cnt_before) || ' requête(s) en plus');

    -- Notification manager (actu_a_valider) · garde anti-seed : aucune requête
    -- mise en file quand hp.seeding vaut 'on', ni pour a_valider_manager ni pour
    -- a_valider_comm (la configuration example.invalid est encore en place).
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience)
      VALUES ('Actu à valider (seed simulé)', 'Corps', 'brouillon', 'mon_equipe')
      RETURNING id INTO _nm1;
    SELECT count(*) INTO _net_a FROM net.http_request_queue;
    PERFORM submit_news(_nm1);
    SELECT count(*) INTO _net_b FROM net.http_request_queue;
    _res := _res || jsonb_build_object('t', 'Aucun mail manager pour une actu soumise pendant un seed (actu_a_valider)', 'ok',
      _net_b = _net_a, 'd', (_net_b - _net_a) || ' requête(s) en plus');

    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience)
      VALUES ('Actu cabinet à relire (seed simulé)', 'Corps', 'brouillon', 'tout_le_cabinet')
      RETURNING id INTO _nm2;
    SELECT count(*) INTO _net_a FROM net.http_request_queue;
    PERFORM submit_news(_nm2);
    SELECT count(*) INTO _net_b FROM net.http_request_queue;
    _res := _res || jsonb_build_object('t', 'Aucun mail Comm pour une actu soumise pendant un seed (garde ajoutée à actu_a_relire)', 'ok',
      _net_b = _net_a, 'd', (_net_b - _net_a) || ' requête(s) en plus');

    -- Notification manager · envoi réel simulé (hors seed) : une actu de
    -- collaborateur soumise à son manager met en file le news_event « submitted »
    -- (journal) + un mail actu_a_valider par manager de l'équipe (ici un seul :
    -- smoke.manager). Les requêtes sont annulées avec la transaction du test.
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.collab@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience)
      VALUES ('Actu à valider (envoi simulé)', 'Corps', 'brouillon', 'mon_equipe')
      RETURNING id INTO _nm1;
    PERFORM set_config('hp.seeding', '', true);
    SELECT count(*) INTO _net_a FROM net.http_request_queue;
    PERFORM submit_news(_nm1);
    SELECT count(*) INTO _net_b FROM net.http_request_queue;
    PERFORM set_config('hp.seeding', 'on', true);
    _res := _res || jsonb_build_object('t', 'Un mail actu_a_valider part pour le manager de l''équipe de l''auteur (journal + 1 mail)', 'ok',
      _net_b - _net_a = 2, 'd', (_net_b - _net_a) || ' requête(s) mise(s) en file (2 attendues)');

    -- Auteur relecteur exclu : le manager de test devient relecteur, puis soumet
    -- une actu « Tout le cabinet » (circuit : directement a_valider_comm). Sont mis
    -- en file : le news_event « submitted » (journal) + un mail actu_a_relire par
    -- relecteur SAUF l'auteur, soit 1 + (N - 1) = N requêtes pour N relecteurs.
    -- Sans la correction, il y en aurait N + 1.
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE allowed_users SET is_reviewer = true WHERE id = _mgr;
    SELECT count(*) INTO _nr FROM allowed_users WHERE is_reviewer;
    PERFORM set_config('request.jwt.claims', '{"email":"smoke.manager@test.invalid"}', true);
    INSERT INTO news(title, body, status, audience)
      VALUES ('Actu cabinet d''un auteur relecteur', 'Corps', 'brouillon', 'tout_le_cabinet')
      RETURNING id INTO _nm3;
    PERFORM set_config('hp.seeding', '', true);
    SELECT count(*) INTO _net_a FROM net.http_request_queue;
    PERFORM submit_news(_nm3);
    SELECT count(*) INTO _net_b FROM net.http_request_queue;
    PERFORM set_config('hp.seeding', 'on', true);
    _res := _res || jsonb_build_object('t', 'L''auteur relecteur ne reçoit pas le mail de relecture Comm (journal + autres relecteurs)', 'ok',
      _net_b - _net_a = _nr, 'd', (_net_b - _net_a) || ' requête(s) mise(s) en file (' || _nr || ' attendues)');

    -- Whisper · quota isolé par fonctionnalité : 50 appels format-actu
    -- n'épuisent pas les 30 appels transcribe-dictation du même utilisateur.
    _wh_user := gen_random_uuid();
    FOR _cnt IN 1..50 LOOP
      PERFORM public.check_and_bump_ai_usage(_wh_user, 50, 'format-actu');
    END LOOP;
    SELECT public.check_and_bump_ai_usage(_wh_user, 30, 'transcribe-dictation') INTO _wh_ok1;
    _res := _res || jsonb_build_object('t', 'Quota isolé : transcribe-dictation n''est pas affecté par 50 appels format-actu (Whisper)', 'ok', _wh_ok1, 'd', _wh_ok1::text);
    SELECT public.check_and_bump_ai_usage(_wh_user, 50, 'format-actu') INTO _wh_ok2;
    _res := _res || jsonb_build_object('t', 'Quota isolé : format-actu reste épuisé après le 51e appel (Whisper)', 'ok', NOT _wh_ok2, 'd', _wh_ok2::text);

    -- Whisper · réglage go/no-go fermé par défaut. La clé est supprimée dans la transaction
    -- du test (annulée par HP_SMOKE_ROLLBACK) : le test ne dépend plus du réglage réel de la base.
    DELETE FROM private.automation_config WHERE key = 'dictation_engine';
    SELECT public.get_dictation_engine_setting() INTO _wh_setting;
    _res := _res || jsonb_build_object('t', 'get_dictation_engine_setting : « browser » par défaut si la clé est absente (Whisper)', 'ok', _wh_setting = 'browser', 'd', _wh_setting);

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
