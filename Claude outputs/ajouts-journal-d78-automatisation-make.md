# Happy Place — Ajouts au journal (1er nov. 2026) : D78

À fusionner dans `journal-des-decisions.md` (ligne D78) et `argumentaire-decisions.md` (fiche D78). Gardé à part, comme D70 à D77. Le prompt qui applique cette décision est `prompt-tranche-actus.md` (commit 2-1 et section « Automatisation »).

## 1. Ligne à ajouter dans le tableau « Décisions »

| ID | Date | Phase | Thème | Décision | Justification | Décidé par | Statut | Lien | Critère | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| D78 | 01/11 | Build | Automatisation | Automatiser avec Make (scénario à webhook) et des e-mails Gmail, déclenchés par la base Supabase via pg_net, pour deux cas : (1) rappel unique du lendemain à un manager dont le brouillon dort (D20) ; (2) alerte aux relecteurs Comm quand une actu arrive en file « À valider (Comm) ». Le message envoyé est minimal (type, prénom, titre, audience, secret). L'adresse du webhook et le secret vivent dans une table privée de la base, jamais dans le dépôt ni le navigateur. Si l'envoi échoue, l'app n'est jamais bloquée. Pour la démo, tous les e-mails vont vers l'adresse de Lucie (les personas sont fictifs). | Le critère d'évaluation attend une automatisation, pas seulement une IA. Le rappel du lendemain répond à l'irritant n°1 (7 brouillons de managers pour 1 actu publiée). Make a été vu en formation et donne une adresse publique tout de suite ; il évite d'héberger un outil ou d'ouvrir un tunnel. Une base qui appelle le webhook évite de donner à l'outil la clé la plus sensible. | Lucie | À réaliser | Complète D20, D74, D77 (le lot Relances en est la vision cible) | BC02 A2.3 C1, A2.2 C1, A2.3 C2 | Échange du 1er nov. |

## 2. Fiche pour l'argumentaire

### D78 · Automatiser les rappels et les alertes avec Make, déclenché par la base

**Question** : Quelle automatisation montrer au jury, avec quel outil, et comment la sécuriser ?

**Choix** : Un scénario Make (webhook → filtre sur le secret → routeur → e-mail Gmail) appelé par Supabase quand un brouillon de manager dort depuis plus d'un jour, ou qu'une actu passe à « À valider (Comm) ». Message minimal, secret partagé, échec jamais bloquant.

**Pourquoi**
- L'irritant n°1 est un problème de relance : sans rappel, le brouillon d'un manager reste en brouillon. L'automatisation agit directement sur le KPI « brouillons publiés ».
- L'alerte aux relecteurs évite que la file « À valider (Comm) » dorme : c'est le maillon le plus fragile du circuit C et D.
- Make a été vu à Maestro : outil défendable, déjà maîtrisé, scénario monté et testé en moins d'une heure.
- Le webhook Make est public dès sa création : pas d'hébergement, pas de tunnel.
- C'est la base qui envoie le message : l'outil d'automatisation n'a pas besoin de la clé « service_role » et ne reçoit que le prénom et le titre.
- Le secret est vérifié par un filtre dans Make, et stocké dans une table privée verrouillée (RLS, aucun droit pour les utilisateurs).
- Un échec du webhook (Make indisponible, quota dépassé) est silencieux : l'application et le badge « Brouillon en attente depuis hier » continuent de fonctionner.
- Les deux cas partagent la même fonction : un troisième cas se branche en une ligne.

**Options écartées**
- Badge seul, sans envoi : n'est pas une automatisation, aucun message ne part.
- n8n : plus souple, mais demande un hébergement ou un tunnel pour recevoir le webhook, sans bénéfice pour deux e-mails.
- Zapier : même logique que Make, mais non vu en formation.
- Edge Function Supabase + service d'e-mail : plus de code et un compte d'envoi à gérer, pour le même résultat.
- Notification Slack : demande un espace de travail ; l'e-mail est plus rapide à monter. Un canal Slack reste possible en remplaçant le module de sortie.
- Faire interroger la base par Make toutes les x minutes : donne la clé « service_role » à un outil externe et consomme des opérations pour rien.

**Limites assumées**
- E-mails envoyés à une seule adresse pour la démo (personas fictifs).
- Plan gratuit de Make : nombre d'opérations limité par mois, suffisant pour la démo et les tests.
- Le secret est stocké en clair dans une table privée : acceptable pour une démo, à passer dans un coffre (Vault) pour une vraie mise en production.
- Pas de notification pour l'audience elle-même : hors périmètre V1.

**Question probable du jury** : « Pourquoi un outil no-code plutôt que du code, et que se passe-t-il quand Make tombe ? »

**Réponse** : Le critère demande d'intégrer des outils d'automatisation, et Make me donne un scénario testé en une heure, avec un secret et un filtre. La base reste maîtresse : elle déclenche, Make ne fait qu'envoyer. Si Make est indisponible, l'envoi échoue en silence, l'app continue et le badge dans « Mes actus » joue le rôle de rappel visuel.

## 3. Questions ouvertes à noter

- Passer le secret dans le coffre Supabase (Vault) après le jury ?
- Ajouter un canal Slack pour les alertes aux relecteurs ?
- Quel seuil de relance réel (1 jour) après les tests du 3 nov. ?
