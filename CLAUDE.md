# CLAUDE.md — Happy Place

Dashboard interne de **Bigger Boat**, cabinet de recrutement fictif d'environ 220 personnes. Quatre modules : **Actus**, **Boîte à idées**, **Points bloquants**, **Indicateurs**. Outil de pilotage, pas de conversation : chaque module répond à une question opérationnelle précise.

Irritant prioritaire (raison d'être de la refonte en cours) : les managers publient peu (7 brouillons pour 1 actu publiée en septembre) parce que publier prend trop de temps. Les étapes à venir visent à raccourcir ce chemin sans sacrifier le contrôle (relecture Comm, validation manager).

Date de référence des données fictives : **31 octobre 2026**.

## Avant de coder

1. Lis `AGENTS.md` (conventions du dépôt) et `maquettes/LISEZ-MOI-maquettes.md` (mapping écrans Stitch V2 → flows, liste « à ignorer »). En cas de conflit entre une maquette et ce fichier, **ce fichier et les règles de validation v7 priment**.
2. Après toute migration touchant un ENUM, un trigger ou une fonction liée aux statuts : `select * from private.run_smoke_tests();` — toutes les lignes à `ok = true`.
3. Ne réintroduis pas de liste blanche d'emails : les règles RLS par rôle restent la référence (connexion anonyme, `public.choisir_mon_role`).

## Personas de démonstration

Six profils fixes, activables en un clic via le sélecteur de rôle (en-tête) ou l'écran `/choisir-role`. Fonction SQL : `public.choisir_persona(_persona text)`.

| Persona | Rôle | Particularité |
|---|---|---|
| Inès | Collaboratrice, Direction Commerciale | Propose des actus que Marc valide ; auteure type des démos |
| Marc | Manager, Direction Commerciale | Publie sans validation pour son équipe ; valide les contenus d'Inès |
| Camille | Collaboratrice, équipe Communication | Case **Relecteur Comm** cochée : voit en plus l'onglet **Relecture** |
| Julien | Collaborateur, équipe Communication | Deuxième relecteur Comm : un relecteur ne valide jamais son propre contenu |
| Sophie | Manager, équipe Communication | Manager de Camille et de Julien |
| Karim | Admin, équipe IT | Ne publie ni ne valide : gère utilisateurs, case Relecteur, relances |

« Mon équipe » = Direction Commerciale (18 personnes, narratif). « Plusieurs équipes / Tout le cabinet » = 220 personnes (narratif). Prénoms uniquement dans l'affichage, jamais de nom de famille, pour ces 6 personas.

⚠️ **`choisir_persona` est un accès libre de démonstration, sans authentification réelle** : n'importe quelle session anonyme peut devenir n'importe laquelle des 6 personas d'un simple appel RPC. C'est volontaire pour la pédagogie/la démo, mais **à remplacer par une vraie authentification avant toute utilisation non pédagogique**.

Note sur le champ « équipe » affiché : pour un collaborateur, c'est `allowed_users.team` ; pour un manager, c'est sa première équipe dans `manager_teams` (ex. Marc/Sophie) ; **un admin n'a pas de notion d'équipe stockée** dans le modèle actuel — l'« équipe IT » de Karim est narrative (persona), pas une donnée en base.

## Audience

Deux valeurs en base (`public.news_audience`), nommées différemment du libellé affiché :

| Valeur en base | Libellé affiché | Vocabulaire métier (`getCircuit`) |
|---|---|---|
| `mon_equipe` | Mon équipe | `mon_equipe` |
| `tout_le_cabinet` | Plusieurs équipes / Tout le cabinet | `plusieurs_equipes` |

Le nom `tout_le_cabinet` est conservé en base (décision actée : pas de migration de renommage, pour ne pas toucher aux fonctions `submit_news`/`review_news` déjà en production). Seul l'affichage dit « Plusieurs équipes / Tout le cabinet ». `src/lib/circuit.ts` utilise le vocabulaire `plusieurs_equipes` ; convertir à l'appel pour le module Actu (`audience === "tout_le_cabinet" ? "plusieurs_equipes" : "mon_equipe"`).

## Les 7 statuts

| Valeur en base (`news_status`) | Libellé affiché |
|---|---|
| `brouillon` | En rédaction |
| `a_valider_manager` | À valider (manager) |
| `a_valider_comm` | À valider (Comm) |
| `a_modifier_manager` | À modifier (manager) |
| `a_modifier_comm` | À modifier (Comm) |
| `publiée` | Publié |
| `refusée` | Refusé |

Labels centralisés dans `src/components/status-badge.tsx` (`NEWS_STATUS_LABELS`). Le statut d'une actu existante ne se change que par `public.submit_news`/`public.review_news` (SQL) — jamais par un `UPDATE` direct depuis l'app (bloqué par le trigger `news_v2_guard`, voir « Écarts connus »).

## Moteur de circuit (règles v7)

`src/lib/circuit.ts`, fonction pure `getCircuit(module, audience, roleAuteur)`, testée dans `src/lib/circuit.test.ts` (une correspondance par ligne du tableau).

| Module | Audience | Auteur collaborateur | Auteur manager |
|---|---|---|---|
| Point bloquant | Toutes | Publié tout de suite ; contrôle après coup par le manager | Publié tout de suite, aucun contrôle |
| Idée | Mon équipe | Publiée tout de suite ; contrôle après coup | Publiée tout de suite |
| Idée | Plusieurs équipes | Relecteur Comm (manager notifié) | Relecteur Comm |
| Indicateur | Mon équipe | Publié tout de suite ; contrôle après coup | Publié tout de suite |
| Indicateur | Plusieurs équipes | Manager | Publié tout de suite |
| Actu | Mon équipe | Manager | Publiée tout de suite |
| Actu | Plusieurs équipes | Manager, puis relecteur Comm | Relecteur Comm |

Pour le module Actu, `getCircuit` **reflète** la logique déjà en base (`public.submit_news`/`public.review_news`, migration `20261030120100_news_v2_audience_circuits_rls.sql`) — elle ne la duplique pas en vue d'un vrai flow : aucun formulaire de soumission réel n'est encore branché (hors périmètre de cette étape). Pour les 3 autres modules, aucune infrastructure BDD de circuit n'existe encore.

### Règles transverses

- Pas d'auto-validation : un relecteur ne valide jamais son propre contenu (message : « Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu. »).
- Trois actions pour un valideur : Valider et publier · Demander une modification (commentaire obligatoire) · Refuser (motif en liste `à clarifier` / `en désaccord avec les process` / `doublon` / `autre` + commentaire ≤ 500 caractères, définitif).
- Si l'audience change pendant une correction, le circuit est recalculé (`reviewed_audience` vs `audience` dans `public.news`).

## Charte graphique

- Fond écru `#FBF9F8` ; cartes blanches, bordure 1px `#E6E6E1`, rayon 8px.
- Texte et bouton principal anthracite `#171818`. Accent rose poudré `#FCDBDB` (à valider) / `#DEBFBF` (à modifier) pour badges et états actifs.
- Validation réussie : vert doux `#DFF3E4`, bordure/texte `#2F7D4A`.
- Erreur : texte `#BA1A1A` sur fond `#FFDAD6`.
- Titres en Comfortaa, texte en Inter, étiquettes et badges en JetBrains Mono.
- Minimaliste, sans ombres lourdes. Interface en français.
- Tokens dans `src/styles.css` (`:root`, format `oklch`) ; polices chargées dans `src/routes/__root.tsx`.

## Contraintes

- Données fictives uniquement. Aucune clé secrète dans le code ; jamais de clé `service_role` côté navigateur ; seul `.env` (non versionné) porte les variables.
- Chaque vérification (champ obligatoire, format, droit) a son propre message d'erreur, affiché sous le champ concerné.
- Commits petits, en français, au format `type: description` (ex. `feat: moteur de circuit`).
- Mise en page web desktop d'abord ; une grille flexible qui ne casse pas sur petit écran suffit, pas de parcours mobile dédié.

## Écarts connus

- **`news_v2_guard` casse deux écrans pré-existants** (indépendant des fondations, migration du 30 oct. déjà en base avant cette étape) : tout `UPDATE` de `news.status` par le rôle `authenticated` hors de `submit_news`/`review_news` est bloqué, et `author`/`author_email` sont silencieusement réinitialisés à leur valeur précédente. Corrigé dans `src/routes/_authenticated/manage.news.tsx` (champs Statut et Auteur désactivés en édition, avec note explicative) ; le formulaire inline du dashboard a été supprimé (remplacé par le nouveau shell « Actualités du cabinet / Mes actus »).
- **Pas de formulaire de publication/validation réel** : les boutons « + Nouvelle actu », « Relecture », « Paramètres » mènent à des pages stub (« bientôt disponible »). Prochaine étape de la roadmap.
- **Pas de case « Relecteur Comm » éditable dans l'interface admin** (`manage.users.tsx`) : la colonne `allowed_users.is_reviewer` existe et est câblée pour les 6 personas (seed), mais aucun écran ne permet encore à Karim de la cocher pour un autre compte.

## Pour aller plus loin

- `README.md` : installation, connexion anonyme, `choisir_mon_role`.
- `AGENTS.md` : conventions de code (branding, exports, stockage, formats numériques).
- `maquettes/LISEZ-MOI-maquettes.md` : correspondance écrans Stitch V2 → flows, liste « à ignorer ».
