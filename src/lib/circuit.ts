// Moteur de circuit (règles v7) : une fonction pure, sans appel réseau, qui dit
// quel circuit de validation s'applique à un contenu et quel texte l'annoncer
// à l'auteur. Couvre les 4 modules du dashboard ; sert à l'affichage (frise,
// badges) tant qu'aucun formulaire réel n'est construit.
//
// Pour le module "actu", elle reflète fidèlement la logique déjà calculée en
// base par public.submit_news / public.review_news (supabase/migrations/
// 20261030120100_news_v2_audience_circuits_rls.sql) : ne pas modifier l'une
// sans répercuter le changement dans l'autre. Pour les 3 autres modules
// (idée, point bloquant, indicateur), aucune infrastructure BDD de circuit
// n'existe encore (hors périmètre de cette étape) : cette fonction anticipe
// les règles du tableau v7.

export type CircuitModule = "actu" | "idee" | "point_bloquant" | "indicateur";

// Vocabulaire métier, commun aux 4 modules. Pour "actu", l'audience en base
// s'appelle encore "tout_le_cabinet" (supabase/migrations/20261030120000_news_v2_types.sql) ;
// l'appelant doit convertir avant d'appeler getCircuit, voir src/components/audience-badge.tsx.
export type CircuitAudience = "mon_equipe" | "plusieurs_equipes";

export type CircuitAuteurRole = "collaborateur" | "manager";

export type CircuitKind =
  | "aucun"
  | "manager"
  | "relecteur_comm"
  | "manager_puis_relecteur_comm";

export interface Circuit {
  /** Nature du circuit : qui doit valider avant publication (ou "aucun"). */
  kind: CircuitKind;
  /** true si le contenu est visible tout de suite, sans valideur bloquant. */
  immediate: boolean;
  /** true si un manager peut revenir sur le contenu après coup, sans bloquer la publication. */
  postControl: boolean;
  /** Texte annoncé à l'auteur juste après l'envoi. */
  announcement: string;
}

export function getCircuit(
  module: CircuitModule,
  audience: CircuitAudience,
  roleAuteur: CircuitAuteurRole,
): Circuit {
  if (module === "point_bloquant") {
    // Toutes audiences : publié tout de suite ; contrôle après coup seulement
    // si l'auteur est collaborateur (règle transverse, pas de circuit bloquant).
    return roleAuteur === "manager"
      ? { kind: "aucun", immediate: true, postControl: false, announcement: "Publié tout de suite, aucun contrôle." }
      : {
          kind: "aucun",
          immediate: true,
          postControl: true,
          announcement: "Publié tout de suite ; contrôle après coup par le manager.",
        };
  }

  if (module === "idee") {
    if (audience === "mon_equipe") {
      return roleAuteur === "manager"
        ? { kind: "aucun", immediate: true, postControl: false, announcement: "Publiée tout de suite." }
        : {
            kind: "aucun",
            immediate: true,
            postControl: true,
            announcement: "Publiée tout de suite ; contrôle après coup.",
          };
    }
    // Plusieurs équipes : relecteur Comm dans tous les cas (manager notifié si l'auteur est collaborateur).
    return {
      kind: "relecteur_comm",
      immediate: false,
      postControl: false,
      announcement:
        roleAuteur === "collaborateur"
          ? "Envoyée au relecteur Comm (ton manager est notifié)."
          : "Envoyée au relecteur Comm.",
    };
  }

  if (module === "indicateur") {
    if (audience === "mon_equipe") {
      return roleAuteur === "manager"
        ? { kind: "aucun", immediate: true, postControl: false, announcement: "Publié tout de suite." }
        : {
            kind: "aucun",
            immediate: true,
            postControl: true,
            announcement: "Publié tout de suite ; contrôle après coup.",
          };
    }
    // Plusieurs équipes : manager si collaborateur, publié tout de suite si manager.
    return roleAuteur === "manager"
      ? { kind: "aucun", immediate: true, postControl: false, announcement: "Publié tout de suite." }
      : { kind: "manager", immediate: false, postControl: false, announcement: "Envoyé à ton manager pour validation." };
  }

  // module === "actu" — reflète submit_news/review_news (voir commentaire en tête de fichier)
  if (audience === "mon_equipe") {
    return roleAuteur === "manager"
      ? { kind: "aucun", immediate: true, postControl: false, announcement: "Publiée tout de suite." }
      : { kind: "manager", immediate: false, postControl: false, announcement: "Envoyée à ton manager pour validation." };
  }
  // Plusieurs équipes : relecteur Comm seul si manager, manager puis relecteur Comm si collaborateur.
  return roleAuteur === "manager"
    ? { kind: "relecteur_comm", immediate: false, postControl: false, announcement: "Envoyée à la relecture Comm." }
    : {
        kind: "manager_puis_relecteur_comm",
        immediate: false,
        postControl: false,
        announcement: "Envoyée à ton manager, puis à la relecture Comm.",
      };
}
