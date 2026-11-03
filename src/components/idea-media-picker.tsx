import { useRef } from "react";

/** Zone « Ajouter un média » d'une idée : même bouton que les formulaires d'actu, mais pour un PDF. */
export function IdeaMediaPicker({
  file,
  onPick,
  error,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-xs min-w-0">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="idea-media-input"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          onPick(f);
        }}
      />
      <div className="flex flex-wrap gap-sm items-center">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-on-surface-variant flex items-center gap-xs hover:text-primary transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            image
          </span>
          <span className="font-label-sm text-label-sm">
            {file ? "CHANGER LE MÉDIA" : "AJOUTER UN MÉDIA"}
          </span>
        </button>
        {file && (
          <>
            <span className="font-body-sm text-body-sm text-on-surface wrap-anywhere">
              {file.name}
            </span>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="font-label-sm text-label-sm text-error underline"
            >
              Retirer
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
