import type { Database } from "@/integrations/supabase/types";

type NewsAudience = Database["public"]["Enums"]["news_audience"];

// « tout_le_cabinet » reste le nom en base (voir CLAUDE.md) ; seul le libellé change.
export const AUDIENCE_LABELS: Record<NewsAudience, string> = {
  mon_equipe: "Mon équipe",
  tout_le_cabinet: "Plusieurs équipes / Tout le cabinet",
};

export function AudienceBadge({ audience, className = "" }: { audience: string; className?: string }) {
  const known = audience in AUDIENCE_LABELS ? (audience as NewsAudience) : null;
  const label = known ? AUDIENCE_LABELS[known] : audience;
  return (
    <span
      className={`inline-flex items-center rounded-sm border border-outline-variant bg-surface-container px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant ${className}`}
    >
      {label}
    </span>
  );
}
