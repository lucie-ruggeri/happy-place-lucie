// Fonction Edge "transcribe-dictation" : transcrit un enregistrement audio via
// un scénario Make (Whisper), appelé en POST JSON. L'adresse et le secret du
// scénario vivent uniquement dans les secrets du projet Supabase
// (WHISPER_WEBHOOK_URL, WHISPER_WEBHOOK_SECRET) — jamais dans le dépôt, ni
// VITE_, ni private.automation_config (table réservée à D78/D84).
//
// Contrat de réponse : succès -> { text }, extrait du champ "text" renvoyé
// par Make. Échec -> { error: "<code stable>" }, jamais le JSON brut de
// Make (codes : unauthorized, invalid_request, too_long, quota, timeout,
// unavailable). Ne journalise rien côté base : le journal des dictées
// (public.log_dictation_event) n'est appelé que par le navigateur, pour
// éviter un double événement en cas de repli.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_AUDIO_SECONDS = 60;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const DAILY_QUOTA = 30;
const MAKE_TIMEOUT_MS = 12_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

// "sub" (= auth.users.id) est toujours présent dans le JWT, même pour un
// compte anonyme/persona dont le claim "email" peut être absent.
function userIdFromJwt(authHeader: string | null): string | null {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1]));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const userId = userIdFromJwt(req.headers.get("Authorization"));
  if (!userId) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let audio_base64 = "";
  let mime_type = "";
  let audio_seconds = NaN;
  try {
    const body = await req.json();
    audio_base64 = typeof body?.audio_base64 === "string" ? body.audio_base64 : "";
    mime_type = typeof body?.mime_type === "string" ? body.mime_type : "";
    audio_seconds = typeof body?.audio_seconds === "number" ? body.audio_seconds : NaN;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (!audio_base64 || !mime_type || !Number.isFinite(audio_seconds)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  // Taille décodée approximative, sans décoder le buffer juste pour le rejeter.
  const approxBytes = Math.floor(audio_base64.length * 0.75);
  if (audio_seconds > MAX_AUDIO_SECONDS || approxBytes > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "too_long" }, 400);
  }

  // Quota : 30 appels/jour/utilisateur, isolé de format-actu (feature dédiée).
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed, error: quotaError } = await supabaseAdmin.rpc(
    "check_and_bump_ai_usage",
    { _user_id: userId, _limit: DAILY_QUOTA, _feature: "transcribe-dictation" },
  );
  if (quotaError) {
    return jsonResponse({ error: "unavailable" }, 500);
  }
  if (!allowed) {
    return jsonResponse({ error: "quota" }, 429);
  }

  const url = Deno.env.get("WHISPER_WEBHOOK_URL");
  const secret = Deno.env.get("WHISPER_WEBHOOK_SECRET");
  if (!url || !secret) {
    return jsonResponse({ error: "unavailable" }, 502);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAKE_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64, mime_type, audio_seconds, secret }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return jsonResponse({ error: "unavailable" }, 502);
    }

    const data = await resp.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) {
      return jsonResponse({ error: "unavailable" }, 502);
    }

    return jsonResponse({ text });
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error && e.name === "AbortError") {
      return jsonResponse({ error: "timeout" }, 504);
    }
    return jsonResponse({ error: "unavailable" }, 502);
  }
});
