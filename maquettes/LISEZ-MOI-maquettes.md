# Maquettes Stitch — mode d'emploi pour le build

Dossier : `maquettes/stitch_happy_place_dashboard_design/`. Chaque sous-dossier contient `screen.png` (référence visuelle) et `code.html` (code Stitch, à ne pas copier tel quel : l'app a déjà son design system, voir `src/styles.css` et `components/ui`). `happy_place/DESIGN.md` est la charte exportée par Stitch.

Règle : **les images donnent la mise en page, ce fichier donne ce qui compte**. En cas de conflit, ce fichier et les règles de validation v7 priment sur l'image.

## Correspondance écrans → flows

| Dossier | Flow | Ce qu'il faut reproduire |
|---|---|---|
| `publication_express_variante_a_…_mon_quipe` | 1-1 (Inès) | Barre d'étapes, sélecteur Dicter / Coller des notes / Écrire, brouillon IA (titre, texte, visuel), carte audience, frise « Toi → Marc → Publié », boutons « Envoyer pour validation » et « Enregistrer en brouillon » |
| `…variante_b_…_tout_le_cabinet` | 1-1 (Inès) | Idem avec la frise « Toi → Marc → Relecteur Comm → Publié » |
| `…variante_c_erreurs_…` | 1-1 | Messages : « Erreur : le titre est obligatoire », « Erreur : format ou poids du visuel (JPG, PNG, WebP, 5 Mo maximum) » |
| `…variante_d_marc_mon_quipe` | 2-1 (Marc) | Frise « Toi → Publié », boutons « Publier maintenant » et « Plus tard (rappel demain) » |
| `…variante_e_marc_plusieurs_quipes` | 2-1 (Marc) | Frise « Toi → Relecteur Comm → Publié », bouton « Envoyer à la relecture Comm », sélecteur « Équipe concernée » |
| `dashboard_d_in_s_fil_des_actus_et_mes_actus` | dashboard | Fil « Actualités du cabinet » avec badge d'audience, bloc « Mes actus » avec les statuts, bouton « + Nouvelle actu » |
| `validation_…_variante_a_marc_mon_quipe` | 2-5 | Frise 3 étapes, trois actions, bouton « Valider et publier » |
| `validation_…_variante_b_marc_tout_le_cabinet` | 2-5 | Frise 4 étapes, bouton « Valider et transmettre à la Comm » |
| `validation_…_variante_c_camille_file_relecture` | 1-5 | File partagée à gauche, fiche à droite, « Valider et publier » |
| `validation_…_variante_d_camille_propre_actu_bloqu_e` | 1-5 (R5) | Boutons grisés + « Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu. » |
| `validation_…_variante_e_camille_actu_de_marc` | 1-5 | Frise « Marc (envoyé) → Relecteur Comm → Publié » |
| `validation_…_panneau_refus_avec_erreurs` | refus (R3) | Motif en liste (À clarifier, En désaccord avec les process, Doublon, Autre), commentaire 0/500, « Un refus est définitif », erreurs « choisis un motif » et « commentaire vide ou trop long » |

## À ignorer (présent sur les images, hors périmètre)

Menus « Missions & Mandats », « Vivier Talents », « Comptes Clients » et profils « Associé Gérant » / « Partner ». Choix de visuel par l'IA, alerte Push ou Slack, bouton « Relancer un pair », commentaire de relecture facultatif, blocs de budget et de mandats, « Vérification de conformité », « votes » sur la carte Idées, audiences « Toute l'agence » et « Cercle Partners ». Mentions de Direction Générale dans la validation. Dates 2024 et 2025.

## Données à utiliser

Inès (collaboratrice, Direction Commerciale), Marc (manager, Direction Commerciale), Camille (équipe Communication, relectrice Comm), Julien (autre relecteur Comm), Sophie (manager de Camille). « Mon équipe » = 18 personnes, « Plusieurs équipes / Tout le cabinet » = 220 personnes.

## Règles qui priment (v7, actu)

- Collaborateur, « Mon équipe » : manager. Collaborateur, plusieurs équipes : manager puis relecteur Comm.
- Manager, « Mon équipe » : publié tout de suite. Manager, plusieurs équipes : relecteur Comm.
- Trois actions pour un valideur : valider, demander une modification (commentaire obligatoire), refuser (motif + commentaire 500 caractères max, définitif).
- Pas d'auto-validation : un relecteur ne valide jamais son propre contenu.
