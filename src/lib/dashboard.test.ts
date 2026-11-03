import { describe, expect, it } from "vitest";
import { formatDateMiseAJour, MODULE_ORDER } from "@/lib/dashboard";

describe("MODULE_ORDER", () => {
  it("Actus, Points bloquants, Indicateurs, Boîte à idées, dans cet ordre (correction 2)", () => {
    expect(MODULE_ORDER).toEqual(["actus", "points_bloquants", "indicateurs", "idees"]);
  });
});

describe("formatDateMiseAJour", () => {
  it("formate une date valide en français, fuseau Europe/Paris, sans heure", () => {
    expect(formatDateMiseAJour("2026-10-28T12:00:00+00:00")).toBe("Mis à jour le 28 octobre 2026");
  });

  it("renvoie une chaîne vide si la date est absente", () => {
    expect(formatDateMiseAJour(null)).toBe("");
    expect(formatDateMiseAJour(undefined)).toBe("");
  });

  it("écrit « 1er » pour le premier jour du mois", () => {
    expect(formatDateMiseAJour("2026-11-01T12:00:00+00:00")).toBe("Mis à jour le 1er novembre 2026");
  });
});
