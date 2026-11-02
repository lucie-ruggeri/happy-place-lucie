import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/manage/crud-ui";
import { SEVERITY_OPTIONS } from "@/components/blocker-editor";
import { resubmitBlocker } from "@/lib/blocker-circuit";
import type { Blocker } from "@/lib/dashboard";

/** Flow 2-8 (R8) : l'auteur corrige et republie directement un point retiré par un
 * manager — pas d'étape de doublons (déjà publié une fois), pas de choix d'outil
 * (le pôle ne change pas, voir resubmit_blocker). */
export function BlockerResubmitForm({ blocker: b, onDone }: { blocker: Blocker; onDone: () => void }) {
  const [title, setTitle] = useState(b.title);
  const [description, setDescription] = useState(b.description ?? "");
  const [severity, setSeverity] = useState<"critical" | "warning" | "info">(
    (b.severity as "critical" | "warning" | "info") ?? "warning",
  );
  const [audience, setAudience] = useState(b.audience ?? "mon_equipe");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Erreur : le titre est obligatoire");
      return;
    }
    setTitleError(null);
    setPending(true);
    try {
      await resubmitBlocker({ id: b.id, title: trimmed, description: description.trim(), severity, audience });
      toast.success("Point corrigé et republié.");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-md" onSubmit={(e) => e.preventDefault()} noValidate>
      <Field label="Titre du blocage" error={titleError ?? undefined}>
        <input
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <Field label="Description détaillée (facultatif)">
        <textarea
          value={description}
          rows={4}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <fieldset className="space-y-xs">
        <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">Niveau de gravité</legend>
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
          {SEVERITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex flex-col gap-xs border p-sm cursor-pointer ${
                severity === opt.value ? "border-primary bg-surface-container" : "border-outline-variant"
              }`}
            >
              <input
                type="radio"
                name="severity"
                className="sr-only"
                checked={severity === opt.value}
                onChange={() => setSeverity(opt.value)}
              />
              <span className="font-label-md text-label-md uppercase text-primary">{opt.label}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{opt.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-xs">
        <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">Audience</legend>
        <div className="flex flex-col gap-xs sm:flex-row">
          {([
            { value: "mon_equipe", label: "Mon équipe" },
            { value: "tout_le_cabinet", label: "Plusieurs équipes / Tout le cabinet" },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className={`flex-1 cursor-pointer border p-sm ${
                audience === opt.value ? "border-primary bg-surface-container" : "border-outline-variant"
              }`}
            >
              <input
                type="radio"
                name="audience"
                className="mr-xs"
                checked={audience === opt.value}
                onChange={() => setAudience(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-sm pt-sm">
        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
        >
          {pending ? "Envoi…" : "Corriger et renvoyer"}
        </button>
      </div>
    </form>
  );
}
