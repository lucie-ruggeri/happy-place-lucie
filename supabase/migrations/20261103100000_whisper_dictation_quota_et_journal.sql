-- =====================================================================
-- Dictée Whisper via Make + journal des dictées
-- 3 nov. 2026
--
-- A. Quota par fonctionnalité (D79 réutilisé, pas dupliqué) : ai_usage_daily
--    n'avait qu'une clé (user_id, day) — un seul compteur partagé entre
--    format-actu et la future transcription Whisper. On ajoute une colonne
--    feature, défaut 'format-actu' : aucun changement de comportement pour
--    format-actu (son appel RPC omet le paramètre, retombe sur le défaut).
--
-- B. private.send_make_webhook (D78/D84) réutilisée telle quelle, aucun
--    changement. public.log_dictation_event est le seul point d'entrée,
--    appelé UNIQUEMENT par le navigateur (jamais par la fonction Edge, pour
--    éviter les doublons) : valeurs hors liste refusées silencieusement,
--    nombres bornés, jamais bloquant. author déduit de private.hp_email()
--    (qui retombe déjà sur auth.uid() si le JWT n'a pas de claim email,
--    voir 20261030120100_news_v2_audience_circuits_rls.sql) — jamais fourni
--    par le client. Aucun news_id, aucun audio, aucun texte dans le message.
--
-- C. Garde-fou go/no-go (4 nov.) : public.get_dictation_engine_setting() lit
--    la clé 'dictation_engine' de private.automation_config ('browser' par
--    défaut si absente), pour que l'éditeur sache s'il doit proposer Whisper.
--
-- Après passage : select * from private.run_smoke_tests();  (toutes les lignes à ok = true)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Quota par fonctionnalité
-- ---------------------------------------------------------------------
alter table public.ai_usage_daily
  add column if not exists feature text not null default 'format-actu';

alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_pkey;
alter table public.ai_usage_daily add primary key (user_id, day, feature);

create or replace function public.check_and_bump_ai_usage(
  _user_id uuid,
  _limit int default 50,
  _feature text default 'format-actu'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _count int;
begin
  insert into public.ai_usage_daily (user_id, day, feature, calls)
  values (_user_id, current_date, _feature, 1)
  on conflict (user_id, day, feature) do update
    set calls = ai_usage_daily.calls + 1
  returning calls into _count;

  return _count <= _limit;
end;
$$;

revoke all on function public.check_and_bump_ai_usage(uuid, int, text) from public, anon, authenticated;
grant execute on function public.check_and_bump_ai_usage(uuid, int, text) to service_role;

-- ---------------------------------------------------------------------
-- B. Journal des dictées : appelé par le navigateur, jamais par l'Edge
--    Function (évite les doublons). duration_ms = délai entre la fin
--    d'enregistrement et la réception du texte, mesuré côté client.
-- ---------------------------------------------------------------------
create or replace function public.log_dictation_event(
  _event_type text,
  _engine text,
  _duration_ms int,
  _audio_seconds int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _author_first text;
  _environment text;
  _payload jsonb;
begin
  if _event_type not in ('dictation_ok', 'dictation_failed', 'dictation_fallback') then
    return;
  end if;
  if _engine not in ('whisper', 'browser') then
    return;
  end if;

  select a.first_name into _author_first
  from public.allowed_users a
  where a.email = private.hp_email();

  select value into _environment from private.automation_config where key = 'environment';

  _payload := jsonb_build_object(
    'type', 'dictation_event',
    'event_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'event_id', gen_random_uuid(),
    'event_type', _event_type,
    'engine', _engine,
    'duration_ms', greatest(0, least(coalesce(_duration_ms, 0), 120000)),
    'audio_seconds', greatest(0, least(coalesce(_audio_seconds, 0), 60)),
    'author', _author_first,
    'environment', _environment
  );

  perform private.send_make_webhook(_payload);
exception when others then
  -- Jamais bloquant : un échec du journal ne doit jamais remonter au client.
  null;
end;
$$;

revoke all on function public.log_dictation_event(text, text, int, int) from public, anon;
grant execute on function public.log_dictation_event(text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- C. Garde-fou go/no-go : lecture seule, défaut fermé ('browser').
-- ---------------------------------------------------------------------
create or replace function public.get_dictation_engine_setting()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select value from private.automation_config where key = 'dictation_engine'),
    'browser'
  );
$$;

revoke all on function public.get_dictation_engine_setting() from public, anon;
grant execute on function public.get_dictation_engine_setting() to authenticated;

-- ---------------------------------------------------------------------
-- D. Smoke tests : ajoute 3 assertions (quota isolé par fonctionnalité,
--    journal jamais bloquant même config vide, réglage par défaut fermé).
--    Corps identique à 20261102140000, sauf les ajouts marqués "Whisper".
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
  _n2 uuid; _n3 uuid; _payload jsonb; _net_cnt_before int;
  -- Whisper
  _wh_user uuid; _wh_ok1 boolean; _wh_ok2 boolean; _wh_setting text;
BEGIN
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
    -- harnais (voir 20261102130100 pour l'explication complète).

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
    -- et un changement de statut réussit malgré tout.
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

    -- Whisper · log_dictation_event ne bloque jamais, même sans configuration
    -- (la config vient d'être supprimée ci-dessus, hp.seeding est encore désactivé).
    BEGIN
      PERFORM log_dictation_event('dictation_ok', 'whisper', 2500, 12);
      _res := _res || jsonb_build_object('t', 'log_dictation_event : aucune erreur si la configuration est vide (Whisper)', 'ok', true, 'd', 'appel sans exception');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'log_dictation_event : aucune erreur si la configuration est vide (Whisper)', 'ok', false, 'd', SQLERRM);
    END;
    BEGIN
      PERFORM log_dictation_event('valeur_inconnue', 'whisper', 1000, 10);
      _res := _res || jsonb_build_object('t', 'log_dictation_event : refuse un event_type hors liste (Whisper)', 'ok', true, 'd', 'ignoré sans erreur');
    EXCEPTION WHEN OTHERS THEN
      _res := _res || jsonb_build_object('t', 'log_dictation_event : refuse un event_type hors liste (Whisper)', 'ok', false, 'd', SQLERRM);
    END;

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

    -- Whisper · réglage go/no-go fermé par défaut.
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
