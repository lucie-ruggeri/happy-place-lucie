import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import { CharCounter } from "@/components/expandable-card";
import { SEVERITY_LABELS, SEVERITY_STYLES } from "@/components/blocker-duplicates";
import type { Blocker } from "@/lib/dashboard";

/**
 * Contrôle après coup d'un manager sur un point publié par un collaborateur de
 * son équipe (flow 2-8, R8). Réduit à 2 actions (pas de « modifier » : le manager
 * commente et retire, l'auteur corrige lui-même et republie — voir
 * resubmit_blocker) : « Laisser en ligne » (ferme simplement) ou « Retirer le
 * point » (commentaire obligatoire, voir withdraw_blocker).
 */
export function BlockerReviewPanel({
  blocker: b,
  pending,
  onWithdraw,
  onClose,
}: {
  blocker: Blocker | null;
  pending: boolean;
  onWithdraw: (note: string) => void;
  onClose: () => void;
}) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function reset() {
    setWithdrawing(false);
    setNote("");
    setNoteError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function submitWithdraw() {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError("Le commentaire est obligatoire");
      return;
    }
    if (trimmed.length > 500) {
      setNoteError("Le commentaire fait 500 caractères maximum");
      return;
    }
    setNoteError(null);
    onWithdraw(trimmed);
  }

  return (
    <DialogPrimitive.Root open={!!b} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {b && (
          <DialogPrimitive.Content className="fixed z-50 inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:w-[min(48rem,calc(100vw-2rem))] h-dvh md:h-auto md:max-h-[85vh] flex flex-col bg-surface-container-lowest border border-outline shadow-lg focus:outline-none">
            <div className="flex items-start justify-between gap-sm border-b border-outline-variant p-md">
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-headline-sm text-headline-sm text-primary wrap-anywhere">
                  {b.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="font-label-sm text-label-sm text-on-surface-variant">
                  {b.department}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="Fermer"
                onClick={close}
                className="text-on-surface-variant hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true" className="material-symbols-outlined">close</span>
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto p-md space-y-md">
              <span
                className={`inline-flex items-center rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide ${SEVERITY_STYLES[b.severity] ?? "bg-surface-container text-on-surface-variant"}`}
              >
                {SEVERITY_LABELS[b.severity] ?? b.severity}
              </span>
              {b.description && (
                <p className="font-body-md text-body-md text-on-surface whitespace-pre-line wrap-anywhere">
                  {b.description}
                </p>
              )}

              {!withdrawing ? (
                <div className="flex flex-wrap gap-sm pt-sm">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={close}
                    className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
                  >
                    Laisser en ligne
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setWithdrawing(true)}
                    className="px-md py-xs font-label-md text-label-md text-error underline disabled:opacity-50"
                  >
                    Retirer le point
                  </button>
                </div>
              ) : (
                <div className="space-y-xs border border-error/40 bg-error-container/20 p-sm">
                  <label className="font-label-sm text-label-sm uppercase text-on-surface-variant block">
                    Commentaire (obligatoire)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Explique pourquoi ce point est retiré…"
                    className="w-full bg-card border border-outline-variant p-sm font-body-md focus:outline-none focus:border-primary"
                  />
                  <CharCounter value={note} max={500} />
                  {noteError && (
                    <p role="alert" className="text-body-sm text-error">
                      {noteError}
                    </p>
                  )}
                  <div className="flex gap-xs pt-xs">
                    <button
                      type="button"
                      onClick={() => setWithdrawing(false)}
                      className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={submitWithdraw}
                      className="px-md py-xs bg-error text-on-error font-label-md text-label-md disabled:opacity-50"
                    >
                      Confirmer le retrait
                    </button>
                  </div>
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
