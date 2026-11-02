import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface PersonaSwitcherProfile {
  firstName: string | null;
  role: AppRole;
  team: string | null;
}

// Les 6 personas de démonstration (prompt-fondations) : clé envoyée à la fonction
// SQL choisir_persona, qui porte seule la vérité sur rôle/équipe/case Relecteur Comm.
// Les libellés ci-dessous ne sont qu'un affichage ; aucune valeur n'est renvoyée au serveur.
const PERSONAS = [
  { key: "ines", label: "Inès", roleLabel: "Collaboratrice", team: "Direction Commerciale", note: null },
  { key: "marc", label: "Marc", roleLabel: "Manager", team: "Direction Commerciale", note: null },
  { key: "camille", label: "Camille", roleLabel: "Collaboratrice · Relectrice Comm", team: "Communication", note: null },
  { key: "julien", label: "Julien", roleLabel: "Collaborateur · Relecteur Comm", team: "Communication", note: null },
  { key: "sophie", label: "Sophie", roleLabel: "Manager", team: "Communication", note: null },
  {
    key: "karim",
    label: "Karim",
    roleLabel: "Compte admin",
    team: "IT",
    // D26, flow 3-5 : Karim a aussi un compte contributeur IT (option A, pas encore
    // dans la démo) — cette phrase évite de laisser croire que ce compte publie.
    note: "Paramétrage uniquement, aucun bouton de publication. Karim a aussi un compte contributeur IT, non inclus dans la démo.",
  },
] as const;

const GENERIC_ROLE_LABEL: Record<AppRole, string> = {
  collaborateur: "Collaborateur",
  manager: "Manager",
  admin: "Admin",
};

function currentLabel(profile: PersonaSwitcherProfile) {
  const match = PERSONAS.find((p) => p.label.toLowerCase() === (profile.firstName ?? "").toLowerCase());
  if (match) return `${match.label} · ${match.roleLabel} · ${match.team}`;
  const parts = [profile.firstName ?? "Mon profil", GENERIC_ROLE_LABEL[profile.role]];
  if (profile.team) parts.push(profile.team);
  return parts.join(" · ");
}

export function PersonaSwitcher({ profile }: { profile: PersonaSwitcherProfile }) {
  const [busy, setBusy] = useState(false);

  async function choose(key: string) {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("choisir_persona", { _persona: key });
    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.refreshSession();
    // Rechargement complet, comme /choisir-role : le dashboard relit le profil à l'ouverture.
    window.location.replace("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className="font-label-sm text-label-sm uppercase text-primary underline-offset-2 hover:underline disabled:opacity-50"
      >
        {busy ? "CHANGEMENT…" : currentLabel(profile)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-label-sm text-label-sm uppercase text-on-surface-variant">
          Personas de démonstration
        </DropdownMenuLabel>
        {PERSONAS.map((p) => (
          <DropdownMenuItem key={p.key} onSelect={() => choose(p.key)} className="font-body-sm flex-col items-start">
            <span className="font-body-md text-primary">
              {p.label} · {p.roleLabel}
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">{p.team}</span>
            {p.note && (
              <span className="font-body-sm text-body-sm italic text-on-surface-variant whitespace-normal">
                {p.note}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/choisir-role" className="font-label-sm text-label-sm uppercase text-on-surface-variant">
            Profil personnalisé…
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
