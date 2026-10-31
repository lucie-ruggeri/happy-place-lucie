export type CircuitStepState = "done" | "current" | "todo";

export interface CircuitStep {
  label: string;
  state: CircuitStepState;
}

// Frise de circuit (ex. « Toi → Marc → Publié ») : étapes terminées cochées,
// étape en cours en rose poudré. Labels fournis par l'appelant (pas par
// getCircuit, voir src/lib/circuit.ts) car les maquettes affichent des noms
// de personnes, pas seulement des rôles.
export function CircuitStepper({ steps }: { steps: CircuitStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-xs">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="flex items-center gap-xs">
          <span
            className={`inline-flex items-center gap-1 rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide ${
              step.state === "done"
                ? "bg-success-container text-on-success-container"
                : step.state === "current"
                  ? "bg-secondary-fixed text-on-tertiary-fixed"
                  : "bg-surface-container text-on-surface-variant"
            }`}
          >
            {step.state === "done" && <span aria-hidden="true">✓</span>}
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="text-on-surface-variant">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
