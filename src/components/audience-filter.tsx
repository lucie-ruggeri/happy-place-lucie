export type AudienceFilterValue = "all" | "mon_equipe" | "tout_le_cabinet";

const OPTIONS: ReadonlyArray<readonly [AudienceFilterValue, string]> = [
  ["all", "Tous"],
  ["mon_equipe", "Mon équipe"],
  ["tout_le_cabinet", "Plusieurs équipes / Tout le cabinet"],
];

/** Filtre d'affichage par audience (valeurs base : « tout_le_cabinet » reste le nom en base). */
export function matchesAudience(audience: string | null | undefined, filter: AudienceFilterValue): boolean {
  return filter === "all" || (audience ?? "tout_le_cabinet") === filter;
}

export function AudienceFilter({
  value,
  onChange,
  className = "",
}: {
  value: AudienceFilterValue;
  onChange: (v: AudienceFilterValue) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Filtrer par audience" className={`flex items-center gap-xs flex-wrap ${className}`}>
      {OPTIONS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`px-sm py-1 rounded-sm border font-label-sm text-label-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            value === v
              ? "bg-primary text-on-primary border-primary"
              : "border-outline-variant text-on-surface-variant"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
