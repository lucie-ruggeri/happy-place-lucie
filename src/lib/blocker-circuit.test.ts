import { describe, expect, it } from "vitest";
import { selectCurrentlyWithdrawn, type BlockerSnapshot, type WithdrawHistoryRow } from "./blocker-circuit";

function blockersById(entries: Record<string, BlockerSnapshot>): Map<string, BlockerSnapshot> {
  return new Map(Object.entries(entries));
}

describe("selectCurrentlyWithdrawn", () => {
  it("retrait seul : le point reste présent, encore à modifier (manager)", () => {
    const history: WithdrawHistoryRow[] = [
      { content_id: "b1", note: "Doublon avec un autre point", changed_at: "2026-11-03T09:00:00Z" },
    ];
    const byId = blockersById({
      b1: { title: "CRM en panne", department: "Direction Commerciale", statut_publication: "a_modifier_manager" },
    });
    const result = selectCurrentlyWithdrawn(history, byId);
    expect(result).toHaveLength(1);
    expect(result[0].current_status).toBe("a_modifier_manager");
  });

  it("retrait puis republication : le point disparaît", () => {
    const history: WithdrawHistoryRow[] = [
      { content_id: "b1", note: "Doublon avec un autre point", changed_at: "2026-11-03T09:00:00Z" },
    ];
    const byId = blockersById({
      b1: { title: "CRM en panne", department: "Direction Commerciale", statut_publication: "publiée" },
    });
    expect(selectCurrentlyWithdrawn(history, byId)).toHaveLength(0);
  });

  it("retrait puis abandon : le point reste présent, abandonné", () => {
    const history: WithdrawHistoryRow[] = [
      { content_id: "b1", note: "Doublon avec un autre point", changed_at: "2026-11-03T09:00:00Z" },
    ];
    const byId = blockersById({
      b1: { title: "CRM en panne", department: "Direction Commerciale", statut_publication: "abandonnée" },
    });
    const result = selectCurrentlyWithdrawn(history, byId);
    expect(result).toHaveLength(1);
    expect(result[0].current_status).toBe("abandonnée");
  });

  it("deux retraits du même point : ne garde que le plus récent", () => {
    const history: WithdrawHistoryRow[] = [
      { content_id: "b1", note: "Premier retrait", changed_at: "2026-11-01T09:00:00Z" },
      { content_id: "b1", note: "Second retrait", changed_at: "2026-11-03T09:00:00Z" },
    ];
    const byId = blockersById({
      b1: { title: "CRM en panne", department: "Direction Commerciale", statut_publication: "a_modifier_manager" },
    });
    const result = selectCurrentlyWithdrawn(history, byId);
    expect(result).toHaveLength(1);
    expect(result[0].note).toBe("Second retrait");
  });

  it("point introuvable dans blockersById : ignoré sans erreur", () => {
    const history: WithdrawHistoryRow[] = [
      { content_id: "introuvable", note: "x", changed_at: "2026-11-03T09:00:00Z" },
    ];
    expect(selectCurrentlyWithdrawn(history, blockersById({}))).toHaveLength(0);
  });
});
