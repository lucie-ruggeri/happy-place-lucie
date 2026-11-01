import type { Blocker } from "@/lib/dashboard";
import { timeAgo } from "@/lib/dashboard";

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critique",
  warning: "Avertissement",
  info: "Info",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-error-container text-on-error-container",
  warning: "bg-secondary-fixed text-on-tertiary-fixed",
  info: "bg-surface-container text-on-surface-variant",
};

export function BlockerDuplicates({
  duplicates,
  followingId,
  onFollow,
  onBack,
  onCreateAnyway,
  creating,
}: {
  duplicates: Blocker[];
  followingId: string | null;
  onFollow: (id: string) => void;
  onBack: () => void;
  onCreateAnyway: () => void;
  creating: boolean;
}) {
  return (
    <div className="space-y-md">
      <div className="space-y-1">
        <p className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant">
          Détection de doublons
        </p>
        <h2 className="font-headline-md text-headline-md text-primary">
          Ce point ressemble à des points déjà ouverts
        </h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Vérifie si l'un de ces points correspond à ton problème avant de publier un nouveau signalement.
        </p>
      </div>

      <div className="space-y-sm">
        {duplicates.map((d) => (
          <div key={d.id} className="border border-outline-variant bg-card p-sm space-y-xs">
            <div className="flex flex-wrap items-center gap-xs">
              <span
                className={`inline-flex items-center rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide ${SEVERITY_STYLES[d.severity] ?? "bg-surface-container text-on-surface-variant"}`}
              >
                {SEVERITY_LABELS[d.severity] ?? d.severity}
              </span>
              <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">{d.department}</span>
              <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">{d.status}</span>
            </div>
            <p className="font-body-md text-primary wrap-anywhere">{d.title}</p>
            {d.description && (
              <p className="font-body-sm text-body-sm text-on-surface-variant wrap-anywhere">{d.description}</p>
            )}
            <p className="font-label-sm text-label-sm text-on-surface-variant">Mis à jour {timeAgo(d.updated_at)}</p>
            <button
              type="button"
              disabled={followingId === d.id}
              onClick={() => onFollow(d.id)}
              className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
            >
              {followingId === d.id ? "Ajout en cours…" : "Suivre ce point"}
            </button>
          </div>
        ))}
      </div>

      <div className="border border-outline-variant bg-surface-container-lowest p-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-sm">
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Ton incident n'est pas répertorié ? Tu peux publier ton propre signalement.
        </p>
        <div className="flex gap-sm shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
          >
            Revenir au formulaire
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={onCreateAnyway}
            className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
          >
            {creating ? "Publication…" : "Créer quand même"}
          </button>
        </div>
      </div>
    </div>
  );
}
