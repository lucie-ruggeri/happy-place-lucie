import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { applyNewsImage, type MediaDraft, type NewsLink } from "@/lib/news-media";
import type { News } from "@/lib/dashboard";
import type { AiMode } from "@/lib/ai";

export type NewsDraftInput = {
  title: string;
  body: string;
  /** Valeur base : "mon_equipe" | "tout_le_cabinet" (jamais "plusieurs_equipes", voir CLAUDE.md). */
  audience: string;
  input_mode: AiMode;
  links: NewsLink[];
  media: MediaDraft;
};

/** Crée un brouillon d'actu (statut forcé "brouillon" par la policy news_insert). */
export async function createNewsDraft(input: NewsDraftInput): Promise<News> {
  const { data, error } = await supabase
    .from("news")
    .insert({
      title: input.title,
      body: input.body,
      audience: input.audience as never,
      input_mode: input.input_mode as never,
      links: input.links as unknown as Json,
      status: "brouillon",
    })
    .select("*")
    .single();
  if (error) throw error;
  await applyNewsImage(data.id, input.media);
  return data as News;
}

/** Modifie un brouillon ou une actu "à modifier" (policy news_update). Le statut n'est pas touché ici. */
export async function updateNewsDraft(id: string, input: NewsDraftInput): Promise<News> {
  const { data, error } = await supabase
    .from("news")
    .update({
      title: input.title,
      body: input.body,
      audience: input.audience as never,
      input_mode: input.input_mode as never,
      links: input.links as unknown as Json,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await applyNewsImage(id, input.media);
  return data as News;
}

/** Envoie l'actu dans le circuit de validation. La base calcule la cible (voir submit_news). */
export async function submitNews(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("submit_news", { _news_id: id });
  if (error) throw error;
  return data as string;
}

/** Prénom du manager de l'équipe de l'appelant (pour la frise de circuit), ou null (ex. : manager lui-même). */
export async function fetchMyManagerName(): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_manager_name");
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Équipes gérées par le manager connecté (même requête que index.tsx). */
export async function fetchMyManagedTeams(email: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("manager_teams")
    .select("team, allowed_users!inner(email)")
    .eq("allowed_users.email", email.toLowerCase());
  if (error) throw error;
  return (data ?? []).map((t) => t.team).sort();
}

/** Équipe émettrice d'une actu "Mon équipe" (nécessaire pour submit_news si le manager en gère plusieurs). */
export async function setAudienceTeam(newsId: string, team: string): Promise<void> {
  const { error } = await supabase.from("news_audience_teams").upsert({ news_id: newsId, team });
  if (error) throw error;
}
