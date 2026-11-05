import { supabase } from "@/integrations/supabase/client";

const AI_TIMEOUT_MS = 25_000; // la fonction Edge réessaie / bascule de modèle en interne (budget 22s)

export type AiMode = "dictee" | "notes" | "ecrit";

export type AiFormatResult = { title: string; body: string };

/**
 * Met en forme des notes en titre + texte via la fonction Edge format-actu
 * (Gemini, clé dans les secrets Supabase). Ne lève jamais d'exception : en
 * cas d'erreur, de quota dépassé ou de dépassement des 10 secondes, renvoie
 * null — l'appelant doit alors proposer la rédaction manuelle, le formulaire
 * ne doit jamais bloquer.
 */
export async function formatActuWithAI(notes: string, mode: AiMode): Promise<AiFormatResult | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
  const call = (async (): Promise<AiFormatResult | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("format-actu", {
        body: { notes, mode },
      });
      if (error) return null;
      const title = typeof data?.title === "string" ? data.title.trim() : "";
      const body = typeof data?.body === "string" ? data.body.trim() : "";
      if (!title || !body) return null;
      return { title, body };
    } catch {
      return null;
    }
  })();
  return Promise.race([call, timeout]);
}

/**
 * Mise en forme de secours, 100 % locale (aucun appel réseau) : utilisée quand
 * l'assistant IA ne répond pas, pour que le formulaire ne reste jamais vide.
 * Titre = première phrase (90 caractères max), texte = notes nettoyées en
 * paragraphes. Ce n'est PAS de l'IA : l'appelant ne doit pas poser ai_assisted.
 */
export function formatActuLocally(notes: string): AiFormatResult {
  const cleaned = notes
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s\-–•*]+/, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
    .map((l) => (/[.!?…:]$/.test(l) ? l : `${l}.`));
  const first = (cleaned[0] ?? "").replace(/[.!?…:]+$/, "");
  let title = first.split(/(?<=[.!?])\s+/)[0] ?? first;
  if (title.length > 90) title = title.slice(0, 87).replace(/\s+\S*$/, "") + "…";
  return { title, body: cleaned.join("\n\n") };
}
