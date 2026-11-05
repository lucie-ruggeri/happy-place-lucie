// Fonction Edge "format-actu" : met en forme des notes brutes en titre + texte
// d'actu via l'API Gemini. La clé GEMINI_API_KEY vit uniquement dans les
// secrets du projet Supabase (Dashboard > Edge Functions > Secrets) — jamais
// dans le navigateur ni dans le dépôt. Appelée via supabase.functions.invoke,
// qui transmet automatiquement le JWT de la session en cours.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Modèles essayés dans l'ordre : si le premier est surchargé (503/429) ou
// absent (404), on bascule sur le suivant au lieu d'échouer.
const GEMINI_MODELS = [
  Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];
const MAX_NOTES_LENGTH = 4000;
const DAILY_QUOTA = 50;
const GEMINI_ATTEMPT_TIMEOUT_MS = 7000; // par tentative
const TOTAL_BUDGET_MS = 22000; // marge sous le timeout de 25s côté client

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
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  const userId = userIdFromJwt(req.headers.get("Authorization"));
  if (!userId) {
    return jsonResponse({ error: "Authentification requise." }, 401);
  }

  let notes = "";
  try {
    const body = await req.json();
    notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  if (!notes) {
    return jsonResponse({ error: "Notes vides." }, 400);
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return jsonResponse(
      { error: `Notes trop longues (${MAX_NOTES_LENGTH} caractères maximum).` },
      400,
    );
  }

  // Quota : 50 appels/jour/utilisateur, compté via service_role (bypass RLS).
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed, error: quotaError } = await supabaseAdmin.rpc(
    "check_and_bump_ai_usage",
    { _user_id: userId, _limit: DAILY_QUOTA },
  );
  if (quotaError) {
    return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 500);
  }
  if (!allowed) {
    return jsonResponse(
      { error: "Limite quotidienne de l'assistant IA atteinte, réessaie demain ou rédige directement." },
      429,
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 500);
  }

  const prompt =
    "Tu reformules des notes en une actualité interne professionnelle pour un cabinet de " +
    "recrutement, en français. Réponds UNIQUEMENT avec un JSON de la forme " +
    '{"title": "...", "body": "..."}, sans texte autour, sans balises markdown. ' +
    "Le titre fait 90 caractères maximum. N'invente aucun fait absent des notes.\n\nNotes :\n" +
    notes;

  // Tentatives successives (modèles de repli, 2 essais par modèle) dans un
  // budget de temps global. Une réponse 4xx autre que 404/429 est définitive.
  const startedAt = Date.now();
  let resp: Response | null = null;
  outer: for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS - 2000) break outer;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_ATTEMPT_TIMEOUT_MS);
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
            signal: controller.signal,
          },
        );
        clearTimeout(timeout);
        if (r.ok) {
          resp = r;
          break outer;
        }
        console.error("Gemini", model, r.status, (await r.text()).slice(0, 300));
        if (r.status === 404) continue outer; // modèle inconnu → suivant
        if (r.status !== 429 && r.status < 500) break outer;
      } catch (e) {
        clearTimeout(timeout);
        console.error("format-actu", model, e instanceof Error ? e.name : "erreur");
      }
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  try {
    if (!resp) {
      return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 502);
    }

    const data = await resp.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 502);
    }

    let parsed: { title?: unknown; body?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      const lines = text.split("\n").filter((l: string) => l.trim());
      parsed = { title: lines[0]?.slice(0, 90) ?? "", body: lines.slice(1).join("\n") };
    }

    const title = String(parsed.title ?? "").trim().slice(0, 90);
    const bodyText = String(parsed.body ?? "").trim();
    if (!title || !bodyText) {
      return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 502);
    }

    return jsonResponse({ title, body: bodyText });
  } catch (e) {
    console.error("format-actu", e instanceof Error ? e.name : "erreur");
    return jsonResponse({ error: "L'assistant IA est momentanément indisponible." }, 502);
  }
});
