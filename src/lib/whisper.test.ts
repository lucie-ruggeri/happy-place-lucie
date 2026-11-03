import { describe, expect, it } from "vitest";
import { whisperErrorMessage, exceedsDictationLimits, type WhisperErrorCode } from "@/lib/whisper";

describe("whisperErrorMessage", () => {
  const codes: WhisperErrorCode[] = [
    "unauthorized",
    "invalid_request",
    "too_long",
    "quota",
    "timeout",
    "unavailable",
  ];
  for (const code of codes) {
    it(`renvoie un message non vide pour "${code}"`, () => {
      expect(whisperErrorMessage(code).length).toBeGreaterThan(0);
    });
  }
});

describe("exceedsDictationLimits", () => {
  it("accepte un enregistrement dans les limites", () => {
    expect(exceedsDictationLimits({ seconds: 30, bytes: 1024 * 1024 })).toBe(false);
  });

  it("refuse au-delà de 60 secondes", () => {
    expect(exceedsDictationLimits({ seconds: 61, bytes: 1000 })).toBe(true);
  });

  it("refuse au-delà de 2 Mo", () => {
    expect(exceedsDictationLimits({ seconds: 10, bytes: 2 * 1024 * 1024 + 1 })).toBe(true);
  });
});
