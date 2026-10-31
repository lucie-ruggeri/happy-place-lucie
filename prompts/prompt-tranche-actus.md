Tu es mon développeur sur Happy Place. Lis d'abord `CLAUDE.md`, `AGENTS.md` et `maquettes/LISEZ-MOI-maquettes.md`. Les fondations sont faites (commits a, b, c) : personas, sélecteur, moteur `getCircuit`, 7 statuts, fonctions SQL `submit_news` / `review_news`, composants `StatusBadge`, `AudienceBadge`, `CircuitStepper`. Cette étape construit la **tranche verticale « Actus »** : de la création d'une actu par son auteur jusqu'à sa publication ou son refus, avec tous les rôles que le circuit traverse. C'est la démo du jury du vendredi 6 novembre : elle doit tourner de bout en bout, en ligne, sans erreur.

## Avant de coder (mode Plan)
1. Relis le code existant : `submit_news` / `review_news` (migrations), `src/lib/circuit.ts`, `src/routes/_authenticated/index.tsx`, les composants partagés, le stub « Nouvelle actu » et le stub « Relecture ».
2. Réponds par un plan : fichiers, ordre, ce que tu réutilises, et ce que tu proposes de simuler. Signale les écarts entre les flows et la base. Attends mon accord.

## Les 4 flows à implémenter (référence : maquettes V2)

**Flow 1-1 · Inès (collaboratrice) publie une actu** → maquettes `publication_express_variante_a_mon_quipe`, `..._b_tout_le_cabinet`, `..._c_erreurs`.
- « + Nouvelle actu » ouvre l'éditeur : choix **Dicter · Coller des notes · Écrire**.
- **Dicter** est simulé (faux enregistrement : micro animé, bouton Stop, puis un texte de dictée fictif). **Coller des notes** et **Écrire** sont réels.
- **Mise en forme par l'IA** : propose un titre et un texte à partir des notes ou de la dictée, modifiables avant envoi. Pour cette étape, appelle une vraie IA seulement si c'est possible sans exposer de clé secrète dans le navigateur (par exemple via une Edge Function Supabase dont la clé reste dans les secrets du projet) ; sinon fais une version simulée mais crédible, derrière une fonction unique `formatActuWithAI(notes)` facile à remplacer. Dis-moi dans le plan ce que tu proposes et pourquoi. Rien n'est envoyé sans que j'aie relu.
- Champs : Titre, Texte, Visuel facultatif (JPG, PNG, WebP, 5 Mo max), Audience (deux options). Carte « Ce qui va se passer » avec la frise `CircuitStepper` : **Toi → Marc → Publié** pour « Mon équipe », **Toi → Marc → Relecteur Comm → Publié** pour « Plusieurs équipes / Tout le cabinet ». Les textes viennent de `getCircuit`.
- Boutons « Envoyer pour validation » (appelle `submit_news`) et « Enregistrer en brouillon ».
- Messages d'erreur distincts sous chaque champ : « Erreur : le titre est obligatoire », « Erreur : le texte est obligatoire », « Erreur : format ou poids du visuel (JPG, PNG, WebP, 5 Mo maximum) », et un message si l'audience n'est pas choisie.

**Flow 2-1 · Marc (manager) publie une actu** → maquettes `..._variante_d_marc_mon_quipe`, `..._variante_e_marc_plusieurs_quipes`.
- Même éditeur. « Mon équipe » : frise **Toi → Publié**, bouton « Publier maintenant » (publiée tout de suite) et « Plus tard (rappel demain) » (reste En rédaction). « Plusieurs équipes / Tout le cabinet » : **Toi → Relecteur Comm → Publié**, bouton « Envoyer à la relecture Comm ». Sélecteur « Équipe concernée » seulement si le manager gère plusieurs équipes.
- Le rappel du lendemain peut être simulé : un badge « Rappel demain » suffit.

**Flow 2-5 · Marc valide les actus de son équipe** → maquettes `validation_..._variante_a_marc_mon_quipe`, `..._b_marc_tout_le_cabinet`, `..._panneau_refus_avec_erreurs`.
- File « Soumissions en attente » : les actus À valider (manager) de ses équipes. Fiche de validation : frise de circuit, contenu, auteur, date, badges.
- Trois actions : **Valider** (« Valider et publier » pour Mon équipe ; « Valider et transmettre à la Comm » pour Plusieurs équipes), **Demander une modification** (commentaire obligatoire : « Erreur : le commentaire est obligatoire »), **Refuser** (motif en liste : À clarifier, En désaccord avec les process, Doublon, Autre ; commentaire non vide et ≤ 500 caractères, compteur 0/500 ; « Un refus est définitif » ; erreurs « Erreur : choisis un motif » et « Erreur : commentaire vide ou trop long »). Appelle `review_news`.

**Flow 1-5 · Camille (relectrice Comm) relit** → maquettes `validation_..._variante_c_camille_file_relecture`, `..._d_camille_propre_actu_bloqu_e`, `..._e_camille_actu_de_marc_2`.
- Onglet **Relecture** (visible pour Camille et Julien) : file partagée à gauche, fiche à droite, mêmes trois actions. « Valider et publier » publie.
- **Pas d'auto-validation** : sur sa propre actu, les trois boutons sont grisés avec « Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu. » (la base la refuse aussi : vérifie que l'app affiche un message clair si la base refuse).
- Actu de Marc : frise **Marc (envoyé) → Relecteur Comm → Publié**, phrase « Actu d'un manager : aucune validation avant la relecture Comm. »

**Côté auteur : « Mes actus »** (dashboard) : chaque ligne affiche son statut, le commentaire du valideur pour À modifier et Refusé (refus marqué « Refus définitif »), et un bouton « Corriger et renvoyer » (À modifier) ou « Reprendre » (En rédaction). Si l'audience change pendant la correction, le circuit est recalculé.

## Données
- Mets à jour le seed pour qu'Inès voie ses 5 statuts dans « Mes actus » (ajoute une actu En rédaction et une À valider (Comm)) ; renomme « Camille Roux » et « Maxime Caron » des demandes validées pour ne plus entrer en collision avec les personas. Donne-moi le SQL à coller dans Supabase, dans l'ordre, et applique `run_smoke_tests()` après toute migration touchant statuts, ENUM ou trigger.
- Pas de nouvelle valeur d'ENUM d'audience : garde `tout_le_cabinet` en base.

## Contraintes
- Interface en français, prénoms seulement, charte Happy Place déjà en place, desktop d'abord.
- Aucune clé secrète dans le code ni dans le dépôt ; ne touche pas à `.env`.
- Chaque vérification a son propre message d'erreur, sous le champ. Toasts de confirmation pour chaque action réussie (« Actu envoyée à Marc », « Actu publiée »…).
- Commits en français `type: description`, **un commit par flow** (1-1, 2-1, 2-5, 1-5), `npm run typecheck`, `npm test` et `npm run build` verts avant chaque commit, et un test par ligne de règle si tu ajoutes de la logique. Pas de `git push` : je pousse moi-même.
- Arrête-toi après chaque commit avec une liste précise de ce que je dois tester dans le navigateur (quelle persona, quel clic, quel résultat attendu).

## Hors périmètre
Changement d'audience après publication (4-1), correction après publication (4-2), points bloquants, idées, indicateurs, administration, notifications réelles par e-mail ou Slack.

## Critères d'acceptation
Le scénario de démo passe sans erreur : Inès dicte et envoie une actu « Mon équipe » → Marc la valide et elle est publiée → Inès en envoie une pour « Plusieurs équipes / Tout le cabinet » → Marc la transmet → Camille la relit et la publie ; Marc publie une actu « Mon équipe » en un clic ; Camille ne peut pas valider sa propre actu ; un refus et une demande de modification apparaissent dans « Mes actus » de l'auteur avec leur commentaire.
