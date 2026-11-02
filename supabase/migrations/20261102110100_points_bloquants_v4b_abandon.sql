-- =====================================================================
-- Points bloquants v4b · Abandon par l'auteur (D85, R8 complétée)
-- 2 nov. 2026
--
-- Suite à un retrait par le manager (a_modifier_manager), l'auteur a 3
-- issues : corriger et republier (resubmit_blocker, déjà en place depuis
-- la v3) ; abandonner définitivement (cette migration) ; ne rien faire
-- (rappel, v4c à venir). "abandonnée" (ajoutée dans la migration v4a,
-- transaction séparée) n'a aucun chemin de retour : aucune fonction
-- n'accepte ce statut en entrée, donc pas de réouverture possible —
-- sécurité par construction, pas par l'interface.
-- =====================================================================

create or replace function public.abandon_blocker(_id uuid)
returns public.publication_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.blockers; _mgr record; _follower record;
begin
  select * into b from public.blockers where id = _id for update;
  if not found or lower(b.created_by_email) is distinct from private.hp_email() then
    raise exception 'Point bloquant introuvable ou tu n''en es pas l''auteur' using errcode = '42501';
  end if;
  if b.statut_publication <> 'a_modifier_manager' then
    raise exception 'Ce point bloquant n''est pas à modifier' using errcode = 'P0001';
  end if;

  perform set_config('hp.action', 'abandon', true);
  update public.blockers set statut_publication = 'abandonnée', updated_at = now() where id = _id;
  perform set_config('hp.action', '', true);

  -- Notifie les managers de l'équipe de l'auteur (même ensemble que la publication initiale)
  -- et toutes les personnes concernées (blocker_followers).
  if b.team is not null then
    for _mgr in
      select a.email from public.manager_teams mt
        join public.allowed_users a on a.id = mt.allowed_user_id
      where mt.team = b.team
    loop
      perform private.hp_notify_blocker(_id, _mgr.email,
        format('%s a abandonné son point « %s »', coalesce(b.created_by_email, 'Un collaborateur'), b.title));
    end loop;
  end if;
  for _follower in select email from public.blocker_followers where blocker_id = _id loop
    perform private.hp_notify_blocker(_id, _follower.email,
      format('Le point « %s » a été abandonné par son auteur', b.title));
  end loop;

  return 'abandonnée';
end $$;

revoke all on function public.abandon_blocker(uuid) from public, anon;
grant execute on function public.abandon_blocker(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Tests de fumée : 4 lignes pour abandon_blocker (une par règle), ajoutées
-- à la suite des tests "Points bloquants" déjà en place. Les points de
-- test sont insérés avec les colonnes déjà renseignées (statut, équipe,
-- auteur) : le trigger blockers_v2_before_insert ne s'applique qu'aux
-- rôles authenticated/anon, pas à ce bloc exécuté en tant que propriétaire
-- de la fonction (comme pour le bloc "Points bloquants" déjà existant).
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
  _b2 uuid; _b3 uuid; _b4 uuid;
  _st text; _cnt int; _err text;
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
