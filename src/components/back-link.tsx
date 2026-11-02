import { Link, type LinkProps } from "@tanstack/react-router";

/** Lien de retour partagé, même style partout (repris de l'original "Gestion des données"). */
export function BackLink({
  to,
  label = "Retour à la vue d'ensemble",
  className = "",
}: {
  to: LinkProps["to"];
  label?: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md uppercase hover:bg-surface-container ${className}`}
    >
      ← {label}
    </Link>
  );
}
