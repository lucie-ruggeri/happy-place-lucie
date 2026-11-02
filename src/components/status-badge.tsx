import type { Database } from "@/integrations/supabase/types";

type NewsStatus = Database["public"]["Enums"]["news_status"];

// Les 7 statuts (CLAUDE.md) : « brouillon » = En rédaction en base.
export const NEWS_STATUS_LABELS: Record<NewsStatus, string> = {
  brouillon: "En rédaction",
  a_valider_manager: "À valider (manager)",
  a_valider_comm: "À valider (Comm)",
  a_modifier_manager: "À modifier (manager)",
  a_modifier_comm: "À modifier (Comm)",
  publiée: "Publié",
  refusée: "Refusé",
};

const STATUS_STYLES: Record<NewsStatus, string> = {
  brouillon: "bg-surface-container-high text-on-surface-variant",
  a_valider_manager: "bg-secondary-fixed text-on-tertiary-fixed",
  a_valider_comm: "bg-secondary-fixed text-on-tertiary-fixed",
  a_modifier_manager: "bg-tertiary-fixed text-on-tertiary-fixed",
  a_modifier_comm: "bg-tertiary-fixed text-on-tertiary-fixed",
  publiée: "bg-success-container text-on-success-container",
  refusée: "bg-error-container text-on-error-container",
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const known = status in NEWS_STATUS_LABELS ? (status as NewsStatus) : null;
  const label = known ? NEWS_STATUS_LABELS[known] : status;
  const style = known ? STATUS_STYLES[known] : "bg-surface-container-high text-on-surface-variant";
  return (
    <span
      className={`inline-flex items-center rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide ${style} ${className}`}
    >
      {label}
    </span>
  );
}

type BlockerStatus = Database["public"]["Enums"]["blocker_status"];

// Statut de TRAITEMENT d'un point bloquant (OUVERT → RÉSOLU), distinct du statut
// de PUBLICATION (StatusBadge ci-dessus, 7 valeurs partagées avec les actus).
export const BLOCKER_STATUS_LABELS: Record<BlockerStatus, string> = {
  OUVERT: "Ouvert",
  "EN COURS": "En cours",
  SURVEILLANCE: "Surveillance",
  RÉSOLU: "Résolu",
};

const BLOCKER_STATUS_STYLES: Record<BlockerStatus, string> = {
  OUVERT: "bg-error-container text-on-error-container",
  "EN COURS": "bg-secondary-fixed text-on-tertiary-fixed",
  SURVEILLANCE: "bg-tertiary-fixed text-on-tertiary-fixed",
  RÉSOLU: "bg-success-container text-on-success-container",
};

export function BlockerStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const known = status in BLOCKER_STATUS_LABELS ? (status as BlockerStatus) : null;
  const label = known ? BLOCKER_STATUS_LABELS[known] : status;
  const style = known ? BLOCKER_STATUS_STYLES[known] : "bg-surface-container-high text-on-surface-variant";
  return (
    <span
      className={`inline-flex items-center rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide ${style} ${className}`}
    >
      {label}
    </span>
  );
}
