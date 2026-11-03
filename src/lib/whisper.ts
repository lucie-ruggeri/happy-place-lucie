import { supabase } from "@/integrations/supabase/client";

// Marge sous le délai serveur de 12s (transcribe-dictation -> Make).
const WHISPER_CLIENT_TIMEOUT_MS = 14_000;
const MAX_AUDIO_SECONDS = 60;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export type WhisperErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "too_long"
  | "quota"
  | "timeout"
  | "unavailable";

const WHISPER_ERROR_MESSAGES: Record<WhisperErrorCode, string> = {
  unauthorized: "Session expirée, reconnecte-toi.",
  invalid_request: "Enregistrement invalide, réessaie.",
  too_long: "Enregistrement trop long (60 secondes et 2 Mo maximum).",
  quota: "Limite quotidienne de dictée Whisper atteinte, réessaie demain.",
  timeout: "Le service de dictée met trop de temps à répondre.",
  unavailable: "Le service de dictée est momentanément indisponible.",
};

/** Message en français pour un code d'erreur stable renvoyé par transcribe-dictation. */
export function whisperErrorMessage(code: WhisperErrorCode): string {
  return WHISPER_ERROR_MESSAGES[code];
}

function isWhisperErrorCode(value: unknown): value is WhisperErrorCode {
  return typeof value === "string" && value in WHISPER_ERROR_MESSAGES;
}

/** Même garde-fou que transcribe-dictation (60s, 2 Mo), vérifié côté client
 * avant l'upload pour échouer vite sans aller-retour réseau inutile. */
export function exceedsDictationLimits(input: { seconds: number; bytes: number }): boolean {
  return input.seconds > MAX_AUDIO_SECONDS || input.bytes > MAX_AUDIO_BYTES;
}

export type WhisperOutcome = { ok: true; text: string } | { ok: false; code: WhisperErrorCode };

/**
 * Appelle transcribe-dictation. Ne lève jamais d'exception : toute erreur
 * (réseau, quota, taille, délai dépassé) renvoie { ok: false, code }, à
 * l'appelant de décider du repli sur la dictée du navigateur (D80).
 */
export async function transcribeWithWhisper(input: {
  audio_base64: string;
  mime_type: string;
  audio_seconds: number;
}): Promise<WhisperOutcome> {
  const timeout = new Promise<WhisperOutcome>((resolve) =>
    setTimeout(() => resolve({ ok: false, code: "timeout" }), WHISPER_CLIENT_TIMEOUT_MS),
  );
  const call = (async (): Promise<WhisperOutcome> => {
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-dictation", { body: input });
      if (error) {
        let code: unknown;
        try {
          const ctx = (error as { context?: Response }).context;
          const body = await ctx?.json();
          code = body?.error;
        } catch {
          code = undefined;
        }
        return { ok: false, code: isWhisperErrorCode(code) ? code : "unavailable" };
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) return { ok: false, code: "unavailable" };
      return { ok: true, text };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  })();
  return Promise.race([call, timeout]);
}

export type DictationLogEventType = "dictation_ok" | "dictation_failed" | "dictation_fallback";
export type DictationEngine = "whisper" | "browser";

/** Journal des dictées (type='dictation_event' côté base) : jamais bloquant. */
export async function logDictationEvent(input: {
  event_type: DictationLogEventType;
  engine: DictationEngine;
  duration_ms: number;
  audio_seconds: number;
}): Promise<void> {
  try {
    await supabase.rpc("log_dictation_event", {
      _event_type: input.event_type,
      _engine: input.engine,
      _duration_ms: Math.round(input.duration_ms),
      _audio_seconds: Math.round(input.audio_seconds),
    });
  } catch {
    // Jamais bloquant : un échec du journal ne doit jamais remonter à l'utilisateur.
  }
}

/** Garde-fou go/no-go (admin) : 'browser' par défaut si la clé est absente. */
export async function fetchDictationEngineSetting(): Promise<DictationEngine> {
  try {
    const { data } = await supabase.rpc("get_dictation_engine_setting");
    return data === "whisper" ? "whisper" : "browser";
  } catch {
    return "browser";
  }
}
