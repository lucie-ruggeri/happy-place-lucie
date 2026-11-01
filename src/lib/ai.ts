import { supabase } from "@/integrations/supabase/client";

const AI_TIMEOUT_MS = 10_000;

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
