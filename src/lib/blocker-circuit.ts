import { supabase } from "@/integrations/supabase/client";
import type { Blocker } from "@/lib/dashboard";

export type Tool = { name: string; department: string };

/** Outils du cabinet et leur pôle responsable (table public.tools, lecture seule côté app). */
export async function fetchTools(): Promise<Tool[]> {
  const { data, error } = await supabase.from("tools").select("name, department").order("name");
  if (error) throw error;
  return data ?? [];
}

export type BlockerCreateInput = {
  title: string;
  description: string;
  /** Pôle résolu à partir de l'outil choisi (voir CLAUDE.md : la détection de doublon se fait par pôle). */
  department: string;
  severity: "critical" | "warning" | "info";
  /** Valeur base : "mon_equipe" | "tout_le_cabinet" (jamais "plusieurs_equipes", voir CLAUDE.md). */
  audience: string;
  /** Équipe émettrice : seulement quand un manager gérant plusieurs équipes vise "Mon équipe". */
  team?: string;
};

/** Signale un point bloquant (publication immédiate, voir blockers_v2_before_insert). */
export async function createBlockerReport(input: BlockerCreateInput): Promise<Blocker> {
  const { data, error } = await supabase
    .from("blockers")
    .insert({
      title: input.title,
      description: input.description || null,
      department: input.department,
      severity: input.severity as never,
      audience: input.audience as never,
      ...(input.team ? { team: input.team } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Blocker;
}

/** Points publiés et non résolus du même pôle, visibles par l'appelant (RLS fait le tri). */
export async function fetchBlockerDuplicates(department: string): Promise<Blocker[]> {
  const { data, error } = await supabase
    .from("blockers")
    .select("*")
    .eq("department", department)
    .eq("statut_publication", "publiée")
    .neq("status", "RÉSOLU")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data ?? []) as Blocker[];
}

/** Ajoute l'appelant aux « personnes concernées » d'un point ; renvoie le nombre de suiveurs. */
export async function followBlocker(id: string): Promise<number> {
  const { data, error } = await supabase.rpc("follow_blocker", { _id: id });
  if (error) throw error;
  return data as number;
}

/** Fait avancer le statut de traitement (OUVERT → RÉSOLU) : seuls les managers du pôle
 * responsable (ou l'admin si le pôle ne correspond à aucune équipe), voir set_blocker_status. */
export async function setBlockerStatus(input: { id: string; status: string }): Promise<string> {
  const { data, error } = await supabase.rpc("set_blocker_status", {
    _id: input.id,
    _status: input.status as never,
  });
  if (error) throw error;
  return data as string;
}

/** Points bloquants signalés par l'appelant, hors abandonnés (D85 : ils sortent de ses listes),
 * pour "Mes points bloquants". */
export async function fetchMyBlockers(email: string): Promise<Blocker[]> {
  const { data, error } = await supabase
    .from("blockers")
    .select("*")
    .ilike("created_by_email", email)
    .neq("statut_publication", "abandonnée")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as Blocker[];
}

/** Retrait après coup par un manager de l'équipe de l'auteur collaborateur (flow 2-8, R8). */
export async function withdrawBlocker(input: { id: string; note: string }): Promise<string> {
  const { data, error } = await supabase.rpc("withdraw_blocker", { _id: input.id, _note: input.note });
  if (error) throw error;
  return data as string;
}

/** L'auteur corrige et republie directement un point retiré (flow 2-8, R8). */
export async function resubmitBlocker(input: {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  audience: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("resubmit_blocker", {
    _id: input.id,
    _title: input.title,
    _description: input.description,
    _severity: input.severity as never,
    _audience: input.audience as never,
  });
  if (error) throw error;
  return data as string;
}

/** Abandon définitif par l'auteur d'un point « à modifier » (D85) : pas de réouverture possible. */
export async function abandonBlocker(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("abandon_blocker", { _id: id });
  if (error) throw error;
  return data as string;
}

export type WithdrawnByMeRecord = {
  content_id: string;
  title: string;
  department: string;
  note: string | null;
  changed_at: string;
  current_status: string;
};

export type WithdrawHistoryRow = { content_id: string; note: string | null; changed_at: string };
export type BlockerSnapshot = { title: string; department: string; statut_publication: string | null };

// Un point retiré ne reste dans "Points retirés" que tant qu'il n'a pas été republié :
// l'historique dit QUI l'a retiré, mais seul l'état ACTUEL du point (via blockersById)
// décide s'il doit encore apparaître (D85).
const VISIBLE_WITHDRAWN_STATUSES = new Set(["a_modifier_manager", "abandonnée"]);

/** Logique pure (testable sans Supabase) de "Points retirés" : déduplique par point (garde
 * le retrait le plus récent) puis ne garde que les points encore à modifier ou abandonnés. */
export function selectCurrentlyWithdrawn(
  history: WithdrawHistoryRow[],
  blockersById: Map<string, BlockerSnapshot>,
): WithdrawnByMeRecord[] {
  const sorted = [...history].sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  const seen = new Set<string>();
  const result: WithdrawnByMeRecord[] = [];
  for (const h of sorted) {
    if (seen.has(h.content_id)) continue;
    seen.add(h.content_id);
    const b = blockersById.get(h.content_id);
    if (!b?.statut_publication || !VISIBLE_WITHDRAWN_STATUSES.has(b.statut_publication)) continue;
    result.push({
      content_id: h.content_id,
      title: b.title,
      department: b.department,
      note: h.note,
      changed_at: h.changed_at,
      current_status: b.statut_publication,
    });
  }
  return result;
}

/** Points que l'appelant (manager) a retirés, pour "Points retirés" (lecture seule, trace
 * historique) : lit public.publication_history (déjà accessible par RLS à son auteur du
 * changement), pas de nouvelle colonne/migration nécessaire. */
export async function fetchBlockersIWithdrew(email: string): Promise<WithdrawnByMeRecord[]> {
  const { data: history, error } = await supabase
    .from("publication_history")
    .select("content_id, note, changed_at")
    .eq("module", "point_bloquant")
    .eq("new_status", "a_modifier_manager")
    .ilike("changed_by_email", email)
    .order("changed_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  if (!history || history.length === 0) return [];

  const ids = [...new Set(history.map((h) => h.content_id))];
  const { data: blockers, error: bErr } = await supabase
    .from("blockers")
    .select("id, title, department, statut_publication")
    .in("id", ids);
  if (bErr) throw bErr;
  const byId = new Map((blockers ?? []).map((b) => [b.id, b]));

  return selectCurrentlyWithdrawn(history, byId).slice(0, 10);
}
