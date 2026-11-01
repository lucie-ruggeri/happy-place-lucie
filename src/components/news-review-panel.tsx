import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import { Linkify } from "@/components/linkify";
import { CharCounter, formatExactDate } from "@/components/expandable-card";
import { NewsImage, NewsLinks } from "@/components/news-media";
import { AudienceBadge } from "@/components/audience-badge";
import { REJECTION_CATEGORIES, type News } from "@/lib/dashboard";

export type ReviewDecision = "valider" | "modifier" | "refuser";

/**
 * Fiche de validation réutilisée par Marc (flow 2-5) et la relecture Comm
 * (flow 1-5) : même 3 actions, même blocage d'auto-validation. Le message
 * affiché sur sa propre actu reprend mot pour mot celui que review_news
 * renverrait (voir supabase/migrations/20261030120100_..._rls.sql).
 */
export function NewsReviewPanel({
  news: n,
  circuitLabel,
  isSelfAuthor,
  pending,
  banner,
  onReview,
  onClose,
}: {
  news: News | null;
  circuitLabel: string;
  isSelfAuthor: boolean;
  pending: boolean;
  banner?: string;
  onReview: (decision: ReviewDecision, category?: string, note?: string) => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"none" | "modifier" | "refuser">("none");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  function resetPanel() {
    setPanel("none");
    setNote("");
    setCategory("");
    setNoteError(null);
    setCategoryError(null);
  }

  function close() {
    resetPanel();
    onClose();
  }

  function submitModifier() {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError("Erreur : le commentaire est obligatoire");
      return;
    }
    if (trimmed.length > 500) {
      setNoteError("Erreur : commentaire vide ou trop long");
      return;
    }
    setNoteError(null);
    onReview("modifier", undefined, trimmed);
  }

  function submitRefuser() {
    let ok = true;
    if (!category) {
      setCategoryError("Erreur : choisis un motif");
      ok = false;
    } else {
      setCategoryError(null);
    }
    const trimmed = note.trim();
    if (!trimmed || trimmed.length > 500) {
      setNoteError("Erreur : commentaire vide ou trop long");
      ok = false;
    } else {
      setNoteError(null);
    }
    if (!ok) return;
    onReview("refuser", category, trimmed);
  }

  return (
    <DialogPrimitive.Root open={!!n} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {n && (
          <DialogPrimitive.Content className="fixed z-50 inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:w-[min(56rem,calc(100vw-2rem))] h-dvh md:h-auto md:max-h-[85vh] flex flex-col bg-surface-container-lowest border border-outline shadow-lg focus:outline-none">
            <div className="flex items-start justify-between gap-sm border-b border-outline-variant p-md">
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-headline-sm text-headline-sm text-primary wrap-anywhere">
                  {n.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="font-label-sm text-label-sm text-on-surface-variant">
                  {n.author} • Envoyée le {formatExactDate(n.submitted_at ?? n.created_at)}
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
              <AudienceBadge audience={n.audience ?? "tout_le_cabinet"} />
              {banner && (
                <p className="p-sm bg-surface-container text-body-sm text-on-surface-variant italic">{banner}</p>
              )}
              {n.image_path && <NewsImage path={n.image_path} alt={n.title} />}
              <p className="font-body-md text-body-md text-on-surface whitespace-pre-line wrap-anywhere">
                <Linkify text={n.body ?? ""} />
              </p>
              <NewsLinks links={n.links} />

              {isSelfAuthor ? (
                <p role="alert" className="p-sm bg-error-container text-on-error-container text-body-sm">
                  Un autre relecteur doit valider : tu ne peux pas valider ton propre contenu.
                </p>
              ) : panel === "none" ? (
                <div className="flex flex-wrap gap-sm pt-sm">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onReview("valider")}
                    className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                  >
                    {circuitLabel}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setPanel("modifier")}
                    className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
                  >
                    Demander une modification
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setPanel("refuser")}
                    className="px-md py-xs font-label-md text-label-md text-error underline disabled:opacity-50"
                  >
                    Refuser la publication
                  </button>
                </div>
              ) : panel === "modifier" ? (
                <div className="space-y-xs border border-outline-variant bg-surface-container p-sm">
                  <label className="font-label-sm text-label-sm uppercase text-on-surface-variant block">
                    Commentaire (obligatoire)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Explique ce qui doit être modifié…"
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
                      onClick={resetPanel}
                      className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={submitModifier}
                      className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                    >
                      Envoyer la demande
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-xs border border-error/40 bg-error-container/20 p-sm">
                  <p className="font-body-sm text-body-sm font-bold text-error">
                    Un refus est définitif. L'actu ne pourra pas être modifiée et sera archivée comme rejetée.
                  </p>
                  <fieldset className="space-y-xs">
                    <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">
                      Motif du refus
                    </legend>
                    {REJECTION_CATEGORIES.map((c) => (
                      <label key={c} className="flex items-center gap-xs">
                        <input type="radio" name="refus-motif" checked={category === c} onChange={() => setCategory(c)} />
                        {c}
                      </label>
                    ))}
                  </fieldset>
                  {categoryError && (
                    <p role="alert" className="text-body-sm text-error">
                      {categoryError}
                    </p>
                  )}
                  <label className="font-label-sm text-label-sm uppercase text-on-surface-variant block">
                    Commentaire
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
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
                      onClick={resetPanel}
                      className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={submitRefuser}
                      className="px-md py-xs bg-error text-on-error font-label-md text-label-md disabled:opacity-50"
                    >
                      Confirmer le refus définitif
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
