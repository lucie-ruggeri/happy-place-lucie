import { describe, expect, it } from "vitest";
import { getCircuit } from "./circuit";

// Une correspondance exacte avec le tableau « règles v7 » du prompt-fondations :
// 7 blocs describe (une ligne du tableau chacun), 2 cas it chacun (auteur
// collaborateur / manager) = 14 cas.

describe("Point bloquant — toutes audiences", () => {
  it("collaborateur : publié tout de suite, contrôle après coup", () => {
    const c1 = getCircuit("point_bloquant", "mon_equipe", "collaborateur");
    const c2 = getCircuit("point_bloquant", "plusieurs_equipes", "collaborateur");
    for (const c of [c1, c2]) {
      expect(c.kind).toBe("aucun");
      expect(c.immediate).toBe(true);
      expect(c.postControl).toBe(true);
    }
  });

  it("manager : publié tout de suite, aucun contrôle", () => {
    const c1 = getCircuit("point_bloquant", "mon_equipe", "manager");
    const c2 = getCircuit("point_bloquant", "plusieurs_equipes", "manager");
    for (const c of [c1, c2]) {
      expect(c.kind).toBe("aucun");
      expect(c.immediate).toBe(true);
      expect(c.postControl).toBe(false);
    }
  });
});

describe("Idée — Mon équipe", () => {
  it("collaborateur : publiée tout de suite, contrôle après coup", () => {
    const c = getCircuit("idee", "mon_equipe", "collaborateur");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
    expect(c.postControl).toBe(true);
  });

  it("manager : publiée tout de suite", () => {
    const c = getCircuit("idee", "mon_equipe", "manager");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
    expect(c.postControl).toBe(false);
  });
});

describe("Idée — Plusieurs équipes", () => {
  it("collaborateur : relecteur Comm (manager notifié)", () => {
    const c = getCircuit("idee", "plusieurs_equipes", "collaborateur");
    expect(c.kind).toBe("relecteur_comm");
    expect(c.immediate).toBe(false);
  });

  it("manager : relecteur Comm", () => {
    const c = getCircuit("idee", "plusieurs_equipes", "manager");
    expect(c.kind).toBe("relecteur_comm");
    expect(c.immediate).toBe(false);
  });
});

describe("Indicateur — Mon équipe", () => {
  it("collaborateur : publié tout de suite, contrôle après coup", () => {
    const c = getCircuit("indicateur", "mon_equipe", "collaborateur");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
    expect(c.postControl).toBe(true);
  });

  it("manager : publié tout de suite", () => {
    const c = getCircuit("indicateur", "mon_equipe", "manager");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
    expect(c.postControl).toBe(false);
  });
});

describe("Indicateur — Plusieurs équipes", () => {
  it("collaborateur : manager", () => {
    const c = getCircuit("indicateur", "plusieurs_equipes", "collaborateur");
    expect(c.kind).toBe("manager");
    expect(c.immediate).toBe(false);
  });

  it("manager : publié tout de suite", () => {
    const c = getCircuit("indicateur", "plusieurs_equipes", "manager");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
  });
});

describe("Actu — Mon équipe", () => {
  it("collaborateur : manager", () => {
    const c = getCircuit("actu", "mon_equipe", "collaborateur");
    expect(c.kind).toBe("manager");
    expect(c.immediate).toBe(false);
  });

  it("manager : publiée tout de suite", () => {
    const c = getCircuit("actu", "mon_equipe", "manager");
    expect(c.kind).toBe("aucun");
    expect(c.immediate).toBe(true);
  });
});

describe("Actu — Plusieurs équipes", () => {
  it("collaborateur : manager puis relecteur Comm", () => {
    const c = getCircuit("actu", "plusieurs_equipes", "collaborateur");
    expect(c.kind).toBe("manager_puis_relecteur_comm");
    expect(c.immediate).toBe(false);
  });

  it("manager : relecteur Comm", () => {
    const c = getCircuit("actu", "plusieurs_equipes", "manager");
    expect(c.kind).toBe("relecteur_comm");
    expect(c.immediate).toBe(false);
  });
});

// Les deux cas "Actu" ci-dessus doivent rester alignés avec la logique déjà
// en base (voir supabase/migrations/20261030120100_news_v2_audience_circuits_rls.sql) :
//  - submit_news, ligne ~463-480 : collaborateur -> a_valider_manager ; manager + mon_equipe -> publiée.
//  - submit_news, ligne ~476-480 : manager + tout_le_cabinet -> a_valider_comm.
//  - review_news, ligne ~541-546 : manager valide une actu "tout_le_cabinet" -> a_valider_comm (étape 2 du circuit D).
describe("Actu — aligné sur submit_news/review_news", () => {
  it("collaborateur + mon_equipe correspond à la cible a_valider_manager de submit_news", () => {
    expect(getCircuit("actu", "mon_equipe", "collaborateur").kind).toBe("manager");
  });

  it("manager + plusieurs_equipes correspond à la cible a_valider_comm de submit_news", () => {
    expect(getCircuit("actu", "plusieurs_equipes", "manager").kind).toBe("relecteur_comm");
  });

  it("collaborateur + plusieurs_equipes correspond au circuit D (manager puis comm) de submit_news/review_news", () => {
    expect(getCircuit("actu", "plusieurs_equipes", "collaborateur").kind).toBe("manager_puis_relecteur_comm");
  });
});
