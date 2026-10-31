-- =====================================================================
-- Fondations v1 · Migration 2/2 · Personas de démonstration
-- 31 oct. 2026
--
-- choisir_persona(_persona) permet de basculer en un clic entre 6 profils
-- fixes (Inès, Marc, Camille, Julien, Sophie, Karim) sans vraie
-- authentification. Contrairement à choisir_mon_role (qui laisse le client
-- choisir librement rôle/équipe/prénom), ici le rôle/l'équipe/la case
-- Relecteur Comm de chaque persona sont câblés en dur dans la fonction :
-- le client ne fournit que la clé, donc aucune escalade de privilège n'est
-- possible par ce chemin.
--
-- ⚠️ Accès libre de démonstration : à remplacer par une vraie authentification
-- avant toute utilisation non pédagogique (voir CLAUDE.md).
--
-- Reprend le mécanisme déjà en place dans choisir_mon_role
-- (20261016100000_entree_directe.sql) pour l'attribution d'email interne au
-- compte anonyme courant. Nécessite que les équipes "Communication" et "IT"
-- existent dans public.teams (ajoutées par supabase/seed.sql) : la fonction
-- elle-même ne les crée pas, ce sont des équipes fixes de démo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.choisir_persona(_persona text)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _first text;
  _role public.app_role;
  _team text;
  _is_reviewer boolean := false;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Session introuvable : recharge la page.' USING ERRCODE = '42501';
  END IF;

  CASE lower(coalesce(_persona, ''))
    WHEN 'ines'    THEN _email := 'ines@happyplace.test';    _first := 'Inès';    _role := 'collaborateur'; _team := 'Direction Commerciale';
    WHEN 'marc'    THEN _email := 'marc@happyplace.test';    _first := 'Marc';    _role := 'manager';       _team := 'Direction Commerciale';
    WHEN 'camille' THEN _email := 'camille@happyplace.test'; _first := 'Camille'; _role := 'collaborateur'; _team := 'Communication'; _is_reviewer := true;
    WHEN 'julien'  THEN _email := 'julien@happyplace.test';  _first := 'Julien';  _role := 'collaborateur'; _team := 'Communication'; _is_reviewer := true;
    WHEN 'sophie'  THEN _email := 'sophie@happyplace.test';  _first := 'Sophie';  _role := 'manager';       _team := 'Communication';
    WHEN 'karim'   THEN _email := 'karim@happyplace.test';   _first := 'Karim';   _role := 'admin';         _team := 'IT';
    ELSE RAISE EXCEPTION 'Persona inconnue : %', _persona USING ERRCODE = '22023';
  END CASE;

  -- Démo multi-poste : si l'email de la persona est détenu par une autre
  -- session anonyme, on le libère (elle redevient anonyme, sans profil,
  -- comme un compte tout neuf — même état que gère déjà choisir_mon_role).
  UPDATE auth.users SET email = NULL WHERE lower(email) = _email AND id <> _uid;
  UPDATE auth.users SET email = _email WHERE id = _uid AND lower(coalesce(email, '')) <> _email;

  INSERT INTO public.allowed_users (email, first_name, last_name, team, is_reviewer)
  VALUES (_email, _first, NULL, CASE WHEN _role = 'collaborateur' THEN _team END, _is_reviewer)
  ON CONFLICT (email) DO UPDATE
    SET first_name = excluded.first_name,
        team = excluded.team,
        is_reviewer = excluded.is_reviewer
  RETURNING id INTO _id;

  BEGIN
    INSERT INTO public.allowed_user_roles (allowed_user_id, role)
    VALUES (_id, _role)
    ON CONFLICT (allowed_user_id) DO UPDATE
      SET role = excluded.role, updated_at = now();
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'Impossible de changer de persona : dernier admin de la démo.';
  END;

  DELETE FROM public.manager_teams WHERE allowed_user_id = _id;
  IF _role = 'manager' THEN
    INSERT INTO public.manager_teams (allowed_user_id, team) VALUES (_id, _team);
  END IF;

  RETURN _role;
END;
$$;

REVOKE ALL ON FUNCTION public.choisir_persona(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.choisir_persona(text) TO authenticated;
