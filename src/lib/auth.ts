import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "manager" | "collaborateur";

export type AppProfile = {
  role: AppRole;
  firstName: string | null;
  /** Équipe affichée : celle du collaborateur, ou la première équipe gérée pour un manager.
   *  Null pour un admin (pas de notion d'équipe personnelle dans le modèle actuel). */
  team: string | null;
  isReviewer: boolean;
};

/** Returns the signed-in user's whitelist role, or null if not whitelisted. RLS only exposes the user's own row. */
export async function fetchOwnRole(email: string): Promise<AppRole | null> {
  const { data: allowedUser, error: userError } = await supabase
    .from("allowed_users")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (userError) throw userError;
  if (!allowedUser) return null;

  const { data: roleRow, error: roleError } = await supabase
    .from("allowed_user_roles")
    .select("role")
    .eq("allowed_user_id", allowedUser.id)
    .maybeSingle();
  if (roleError) throw roleError;
  return (roleRow?.role as AppRole | undefined) ?? null;
}

/** Comme fetchOwnRole, mais renvoie le profil complet (prénom, équipe, case Relecteur Comm)
 *  utilisé par le sélecteur de persona et la navigation conditionnelle par rôle. */
export async function fetchOwnProfile(email: string): Promise<AppProfile | null> {
  const { data: allowedUser, error: userError } = await supabase
    .from("allowed_users")
    .select("id, first_name, team, is_reviewer")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (userError) throw userError;
  if (!allowedUser) return null;

  const { data: roleRow, error: roleError } = await supabase
    .from("allowed_user_roles")
    .select("role")
    .eq("allowed_user_id", allowedUser.id)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!roleRow) return null;

  const role = roleRow.role as AppRole;
  let team = allowedUser.team;
  if (role === "manager") {
    const { data: mt, error: mtError } = await supabase
      .from("manager_teams")
      .select("team")
      .eq("allowed_user_id", allowedUser.id)
      .limit(1);
    if (mtError) throw mtError;
    team = mt?.[0]?.team ?? null;
  }

  return {
    role,
    firstName: allowedUser.first_name,
    team,
    isReviewer: allowedUser.is_reviewer,
  };
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace("/auth");
}
