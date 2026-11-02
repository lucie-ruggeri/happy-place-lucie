-- =====================================================================
-- Actus · Journal des événements vers Make (D24)
-- 2 nov. 2026
--
-- Réutilise entièrement l'envoi webhook de D78 (20261101090200_news_automation_webhook.sql) :
-- private.call_make_webhook garde exactement sa signature et son comportement
-- (même payload envoyé pour "rappel_brouillon"/"actu_a_relire"), mais délègue
-- maintenant sa partie basse ("lire l'URL/le secret, net.http_post, avaler les
-- erreurs") à une nouvelle fonction private.send_make_webhook(jsonb), seul
-- point d'envoi réel. Pas de deuxième secret : même table private.automation_config.
--
-- Nouveau : un trigger sur public.news construit un message JSON minimal
-- (private.news_event_payload, fonction pure, aucun effet de bord — testable
-- sans dépendre des tables internes de pg_net) à chaque étape clé du circuit,
-- et l'envoie avec private.send_make_webhook. type = 'news_event'.
--
-- Garde anti-seed/anti-test : GUC de session hp.seeding (même mécanisme que
-- hp.action déjà utilisé par submit_news/review_news). seed.sql l'active autour
-- de son bloc d'insertion des actus ; run_smoke_tests() l'active aussi, sans
-- quoi chaque lancement des tests de fumée enverrait de faux événements dans
-- le Google Sheet réel si D78 est déjà configuré sur cette base.
--
-- ai_assisted : aucun signal persisté n'existe aujourd'hui (formatActuWithAI
-- ne fait que remplir title/body en mémoire côté éditeur). Toujours NULL dans
-- cette étape — câblage réel hors périmètre ici (accord explicite).
--
-- Après passage : select * from private.run_smoke_tests();  (toutes les lignes à ok = true)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Point d'envoi unique, extrait de call_make_webhook (D78) sans changer
--    son comportement. Reste SECURITY DEFINER : seule façon de lire le secret.
-- ---------------------------------------------------------------------
create or replace function private.send_make_webhook(_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _url text;
  _secret text;
begin
  select value into _url from private.automation_config where key = 'make_webhook_url';
  select value into _secret from private.automation_config where key = 'make_webhook_secret';
  if _url is null or _secret is null then
    return;
  end if;

  perform net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := _payload || jsonb_build_object('secret', _secret)
  );
exception when others then
  -- Un webhook qui échoue ne doit jamais bloquer l'application.
  null;
end;
$$;

-- D78 inchangée pour l'appelant : même signature, même payload final
-- (type, prenom, titre, audience, secret), même comportement si la config est vide.
create or replace function private.call_make_webhook(_type text, _prenom text, _titre text, _audience text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.send_make_webhook(
    jsonb_build_object('type', _type, 'prenom', _prenom, 'titre', _titre, 'audience', _audience)
  );
exception when others then
  null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Construction pure du message (D24) : aucun effet de bord, testable
--    directement par smoke test sans dépendre de pg_net.
-- ---------------------------------------------------------------------
create or replace function private.news_event_payload(
  _event_type text,
  _news_id uuid,
  _author_first text,
  _author_role public.app_role,
  _audience public.news_audience,
  _status_to public.news_status,
  _created_at timestamptz,
  _ai_assisted boolean,
  _environment text
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'type', 'news_event',
    'event_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'event_id', gen_random_uuid(),
    'event_type', _event_type,
    'news_id', _news_id,
    'author', _author_first,
    'author_role', _author_role,
    'audience', _audience,
    'status_to', _status_to,
    'minutes_since_creation', round(extract(epoch from (now() - _created_at)) / 60)::int,
    'ai_assisted', _ai_assisted,
    'environment', _environment
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Trigger : un événement par étape clé, basé sur le statut final
--    (pas sur la fonction qui l'a déclenché — submit_news ou review_news).
--    draft_created      : insertion en 'brouillon'
--    submitted          : passage à 'a_valider_manager' ou 'a_valider_comm'
--    published          : passage à 'publiée'
--    modification_requested : passage à 'a_modifier_manager' ou 'a_modifier_comm'
--    refused            : passage à 'refusée'
-- ---------------------------------------------------------------------
create or replace function private.news_v2_log_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _event_type text;
  _author_first text;
  _author_role public.app_role;
  _environment text;
  _payload jsonb;
begin
  -- Garde anti-seed/anti-test : aucun envoi pendant un chargement de données
  -- de démonstration ou un run de smoke tests (voir seed.sql, run_smoke_tests()).
  if coalesce(current_setting('hp.seeding', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'brouillon' then
      return null;
    end if;
    _event_type := 'draft_created';
  elsif new.status is distinct from old.status then
    _event_type := case new.status
      when 'a_valider_manager' then 'submitted'
      when 'a_valider_comm' then 'submitted'
      when 'publiée' then 'published'
      when 'a_modifier_manager' then 'modification_requested'
      when 'a_modifier_comm' then 'modification_requested'
      when 'refusée' then 'refused'
      else null
    end;
  end if;

  if _event_type is null then
    return null;
  end if;

  select a.first_name, r.role into _author_first, _author_role
  from public.allowed_users a
  join public.allowed_user_roles r on r.allowed_user_id = a.id
  where a.email = lower(new.author_email);

  select value into _environment from private.automation_config where key = 'environment';

  _payload := private.news_event_payload(
    _event_type, new.id, _author_first, _author_role, new.audience, new.status,
    new.created_at, null, _environment
  );

  perform private.send_make_webhook(_payload);
  return null;
exception when others then
  -- Jamais bloquant, même en cas d'erreur imprévue avant l'appel réseau
  -- (ex. jointure sur allowed_users) : l'action de l'utilisateur doit réussir.
  return null;
end;
$$;

drop trigger if exists news_v2_log_event on public.news;
create trigger news_v2_log_event
  after insert or update of status on public.news
  for each row execute function private.news_v2_log_event();

-- ---------------------------------------------------------------------
-- 4. Smoke tests : garde hp.seeding + 4 nouvelles assertions.
--    Corps identique à 20261102130100, sauf les ajouts marqués "D24".
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
