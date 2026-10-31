Tu es mon développeur sur Happy Place, le dashboard interne de Bigger Boat, un cabinet de recrutement d'environ 220 personnes. Je suis la Product Manager. Happy Place réunit quatre modules : **Actus**, **Boîte à idées**, **Points bloquants** et **Indicateurs**. Il sert au pilotage, pas à la conversation : chaque module répond à une question opérationnelle précise. Irritant prioritaire : les managers publient peu (7 brouillons pour 1 actu publiée en septembre), parce que publier prend trop de temps.

Le dépôt existe déjà : c'est une base fonctionnelle (Vite, TanStack Start/Router, React, shadcn/ui, Supabase avec RLS, connexion anonyme, rôles collaborateur / manager / admin choisis via `public.choisir_mon_role`, tests `private.run_smoke_tests()`). Mon travail consiste à la faire évoluer vers le périmètre de ma soutenance, pas à la reconstruire.

### Avant de coder
1. Lis `README.md`, `AGENTS.md`, `package.json`, `src/` (notamment `src/routes/_authenticated/index.tsx`, `src/lib/dashboard.ts`, les routes `manage.*`) et toutes les migrations `supabase/`. Respecte les règles d'`AGENTS.md` (smoke tests après toute migration touchant ENUM, trigger ou statuts ; ne pas réintroduire de liste blanche).
2. Lis `maquettes/LISEZ-MOI-maquettes.md` : il dit quelles maquettes Stitch (V2) servent de référence visuelle, quoi reproduire et quoi ignorer. Les images donnent la mise en page, ce fichier et les règles ci-dessous priment en cas de conflit. Ne copie pas le `code.html` de Stitch : réutilise le design system de l'app (`src/styles.css`, `components/ui`).
3. Réponds par un **plan** : ce qui existe déjà et que tu réutilises, ce qui manque (audience, statuts, circuit, personas), fichiers à créer ou modifier, ordre. Signale tout écart entre le dépôt et ce prompt. Attends mon accord avant d'écrire du code.

### Ce que je veux dans cette étape (fondations uniquement)

**1. Un fichier `CLAUDE.md` à la racine**, que tu relis à chaque session. Il contient : le contexte ci-dessus, les personas, les règles de validation, les statuts, la charte, les contraintes, la convention de commits, et un renvoi vers `AGENTS.md` et `maquettes/LISEZ-MOI-maquettes.md`.

**2. Personas et sélecteur « Changer de rôle »** en haut de l'écran, à droite du logo, qui affiche la personne connectée (ex. « Inès · Collaboratrice · Direction Commerciale »). Le dépôt a déjà une connexion anonyme et `choisir_mon_role` : dis-moi dans le plan comment tu t'appuies dessus (ou la remplaces proprement) pour qu'on puisse basculer d'une persona à l'autre en un clic, sans vraie authentification, et sans casser les RLS.

| Persona | Rôle | Particularité |
|---|---|---|
| Inès | Collaboratrice, Direction Commerciale | Propose des actus que Marc valide ; auteure type des démos |
| Marc | Manager, Direction Commerciale | Publie sans validation pour son équipe ; valide les contenus d'Inès |
| Camille | Collaboratrice, équipe Communication | Case **Relecteur Comm** cochée : voit en plus l'onglet **Relecture** |
| Julien | Collaborateur, équipe Communication | Deuxième relecteur Comm : permet de montrer qu'un relecteur ne valide pas son propre contenu |
| Sophie | Manager, équipe Communication | Manager de Camille et de Julien |
| Karim | Admin, équipe IT | Ne publie ni ne valide : gère utilisateurs, case Relecteur, relances |

« Mon équipe » = Direction Commerciale (18 personnes). « Plusieurs équipes / Tout le cabinet » = 220 personnes. Prénoms uniquement, jamais de nom de famille. Date de référence des données fictives : 31 octobre 2026.

Ajoute des **données fictives** cohérentes avec les maquettes : quelques équipes, les 6 personas, et une dizaine d'actus à des statuts variés (En rédaction, À valider (manager), À valider (Comm), À modifier (manager), À modifier (Comm), Publié, Refusé), dont les exemples « Signature du contrat Atlas : 12 postes à pourvoir au T1 », « Nouveau processus de relance candidats », « Bienvenue à nos 3 nouveaux consultants », « Résultats du T3 de la Direction Commerciale ».

**3. Une notion d'audience** (deux valeurs seulement : `mon_equipe` et `plusieurs_equipes`, affichées « Mon équipe » et « Plusieurs équipes / Tout le cabinet »), avec une migration et ses RLS si elle n'existe pas. Aucune autre audience.

**4. Un moteur de circuit unique**, une seule fonction pure, testée : `getCircuit(module, audience, roleAuteur)` qui renvoie le circuit (aucun / manager / relecteur Comm / manager puis relecteur Comm) et le texte annoncé à l'auteur. Si la base calcule déjà le circuit, l'app l'appelle : ne duplique pas la règle des deux côtés. Écris des tests unitaires qui couvrent **chaque ligne** de ce tableau (règles v7) :

| Module | Audience | Auteur collaborateur | Auteur manager |
|---|---|---|---|
| Point bloquant | Toutes | Publié tout de suite ; contrôle après coup par le manager | Publié tout de suite, aucun contrôle |
| Idée | Mon équipe | Publiée tout de suite ; contrôle après coup | Publiée tout de suite |
| Idée | Plusieurs équipes | Relecteur Comm (manager notifié) | Relecteur Comm |
| Indicateur | Mon équipe | Publié tout de suite ; contrôle après coup | Publié tout de suite |
| Indicateur | Plusieurs équipes | Manager | Publié tout de suite |
| Actu | Mon équipe | Manager | Publiée tout de suite |
| Actu | Plusieurs équipes | Manager, puis relecteur Comm | Relecteur Comm |

Règles transverses à encoder : pas d'auto-validation (un relecteur ne valide jamais son propre contenu, ses boutons sont grisés avec le message « Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu. ») ; trois actions pour un valideur (Valider et publier · Demander une modification, commentaire obligatoire · Refuser, motif en liste « À clarifier / En désaccord avec les process / Doublon / Autre » + commentaire de 500 caractères max, définitif) ; si l'audience change pendant une correction, le circuit est recalculé.

**5. Les 7 statuts** et leurs libellés affichés : En rédaction · À valider (manager) · À valider (Comm) · À modifier (manager) · À modifier (Comm) · Publié · Refusé. (En base, « En rédaction » = `brouillon`.) Regarde ce que le dépôt a déjà comme statuts et propose la migration minimale pour arriver à ces 7 ; applique les smoke tests après.

**6. Shell du dashboard**, conforme à la maquette « dashboard d'Inès » : les 4 modules en cartes (Actus active), colonne « Actualités du cabinet » avec badge d'audience, colonne « Mes actus » avec les statuts, boutons « + Nouvelle actu », « + Idée », « + Point bloquant », « + Indicateur » (seuls les boutons de la tranche en cours seront actifs ; les autres restent présents mais désactivés avec l'infobulle « bientôt »). Navigation selon le rôle : onglet Relecture pour Camille et Julien, menus « Gérer les données » et « Paramètres » pour Karim, « Mes contenus » pour les contributeurs. Pas de menus « Missions & Mandats », « Vivier Talents », « Comptes Clients », pas de « Associé Gérant ».

**7. Composants partagés** : badge de statut (7 variantes), badge d'audience, toast de confirmation, message d'erreur sous un champ, frise de circuit (étapes terminées cochées, étape en cours en rose poudré). Mise en page **web desktop d'abord** (outil de gestion utilisé au bureau) ; prévois seulement une grille flexible qui ne casse pas sur petit écran, sans écran ni parcours spécifique au mobile.

### Charte Happy Place
- Fond écru `#FBF9F8` ; cartes blanches, bordure 1 px `#E6E6E1`, rayon 8 px.
- Texte et bouton principal anthracite `#171818`. Accent rose poudré `#FCDBDB` / `#DEBFBF` pour badges et états actifs. Validation réussie : vert doux `#DFF3E4`, bordure `#2F7D4A`.
- Erreur `#BA1A1A` sur fond `#FFDAD6`.
- Titres en Comfortaa, texte en Inter, étiquettes et badges en JetBrains Mono.
- Minimaliste, sans ombres lourdes. Interface en français.

### Contraintes
- Données fictives uniquement. Aucune clé secrète dans le code ; jamais de clé `service_role` côté navigateur ; seul le `.env` (non versionné) porte les variables ; ne touche pas au `.env`.
- Chaque vérification (champ obligatoire, format, droit) a son **propre message d'erreur**, affiché sous le champ concerné.
- Commits petits, en français, au format `type: description` (ex. `feat: moteur de circuit`). Un commit à la fin de cette étape. Je pousse moi-même avec GitHub Desktop : ne fais pas de `git push`.

### Hors périmètre de cette étape
Aucun formulaire, aucun flow de publication ou de validation, aucun appel IA, rien sur le changement d'audience ou la correction après publication (flows 4-1 et 4-2, roadmap). Pas de refonte de ce qui marche déjà dans les modules existants.

### Critères d'acceptation
- `npm run typecheck` et `npm run build` passent ; l'app se lance sur http://localhost:3000 ; les tests du moteur de circuit passent (une ligne de test par ligne du tableau) ; `private.run_smoke_tests()` est vert après chaque migration.
- Le sélecteur de rôle change le dashboard et la navigation (Relecture visible seulement pour Camille et Julien, menus admin seulement pour Karim).
- Les badges de statut et d'audience s'affichent sur les données fictives, avec les deux audiences et les 7 statuts.
- Le dashboard ressemble à la maquette V2 « dashboard d'Inès » (hors éléments de la liste « À ignorer »).
- Aucune clé secrète dans le dépôt.
- `CLAUDE.md` créé et à jour.

Quand le plan est validé et le code écrit, termine par : ce qui est fait, ce qui reste, et les questions que tu t'es posées sur les règles.
