import { describe, expect, it } from "vitest";
import { MIC_DENIED_MSG, NO_SPEECH_MSG, UNSUPPORTED_MSG, resolveDictationOutcome } from "./news-editor";

describe("resolveDictationOutcome", () => {
  it("silence totale, fin naturelle sans erreur (onend) : aucune parole détectée, pas de repli", () => {
    const outcome = resolveDictationOutcome({ hadResult: false });
    expect(outcome.message).toBe(NO_SPEECH_MSG);
    expect(outcome.fallback).toBe(false);
  });

  it("erreur explicite no-speech sans texte reconnu : aucune parole détectée, pas de repli", () => {
    const outcome = resolveDictationOutcome({ hadResult: false, errorCode: "no-speech" });
    expect(outcome.message).toBe(NO_SPEECH_MSG);
    expect(outcome.fallback).toBe(false);
  });

  it("minuteur de 8s sans résultat (même signature que la fin naturelle) : aucune parole détectée, pas de repli", () => {
    const outcome = resolveDictationOutcome({ hadResult: false, errorCode: undefined });
    expect(outcome.message).toBe(NO_SPEECH_MSG);
    expect(outcome.fallback).toBe(false);
  });

  it("micro refusé : message dédié, repli simulé activé", () => {
    const outcome = resolveDictationOutcome({ hadResult: false, errorCode: "not-allowed" });
    expect(outcome.message).toBe(MIC_DENIED_MSG);
    expect(outcome.fallback).toBe(true);
  });

  it("micro refusé même si du texte avait déjà été reconnu : message dédié prioritaire, repli activé", () => {
    const outcome = resolveDictationOutcome({ hadResult: true, errorCode: "service-not-allowed" });
    expect(outcome.message).toBe(MIC_DENIED_MSG);
    expect(outcome.fallback).toBe(true);
  });

  it("autre erreur après au moins un résultat reconnu : message générique, repli activé", () => {
    const outcome = resolveDictationOutcome({ hadResult: true, errorCode: "network" });
    expect(outcome.message).toBe(UNSUPPORTED_MSG);
    expect(outcome.fallback).toBe(true);
  });

  it("fin naturelle avec résultat reconnu, sans erreur : rien à afficher", () => {
    const outcome = resolveDictationOutcome({ hadResult: true });
    expect(outcome.message).toBeNull();
    expect(outcome.fallback).toBe(false);
  });
});
