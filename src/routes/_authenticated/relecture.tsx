import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BrandHeader } from "@/components/brand-header";
import { AudienceBadge } from "@/components/audience-badge";
import { NewsReviewPanel } from "@/components/news-review-panel";
import { reviewNews } from "@/lib/news-circuit";
import { fetchNews, timeAgo, type News } from "@/lib/dashboard";

// Vue Relecture : visible pour les comptes « Relecteur Comm » (case is_reviewer),
// ex. Camille et Julien. File des actus "À valider (Comm)" ; la RLS restreint
// déjà fetchNews à ce que ce compte peut voir (news_select, hp_is_reviewer()).
export const Route = createFileRoute("/_authenticated/relecture")({
  head: () => ({ meta: [{ title: "Relecture — Happy Place" }] }),
  beforeLoad: ({ context }) => {
    if (!context.isReviewer) throw redirect({ to: "/" });
  },
  component: RelecturePage,
});

function RelecturePage() {
  const { firstName, email } = Route.useRouteContext();
  const qc = useQueryClient();
  const myEmail = (email ?? "").toLowerCase();
  const [reviewing, setReviewing] = useState<News | null>(null);

  const news = useQuery({ queryKey: ["news"], queryFn: fetchNews, retry: false });
  const queue = news.data?.filter((n) => n.status === "a_valider_comm") ?? [];

  const review = useMutation({
    mutationFn: reviewNews,
    onSuccess: () => {
      setReviewing(null);
      qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // Circuit C (auteur manager, tout_le_cabinet) : submit_news envoie direct à
  // a_valider_comm sans jamais poser manager_validated_by_email. Circuit D
  // (auteur collaborateur) : l'a posé au moment où son manager a validé.
  // Dans cette file (status = a_valider_comm uniquement), la colonne suffit
  // à distinguer les deux sans requête supplémentaire.
  const banner =
    reviewing && !reviewing.manager_validated_by_email
      ? "Actu d'un manager : aucune validation avant la relecture Comm."
      : undefined;

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen">
      <BrandHeader profile={Route.useRouteContext()} />
      <main className="w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <div className="space-y-1">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">
            Relecture Comm
          </p>
          <h1 className="font-headline-lg text-headline-lg text-primary">
            Bonjour {firstName ?? "relecteur·rice"}
          </h1>
        </div>

        <section className="border border-outline-variant bg-surface-container-lowest p-md">
          <div className="flex items-center justify-between border-b border-outline-variant pb-sm mb-md">
            <h2 className="font-headline-sm text-headline-sm text-primary">File de relecture</h2>
            <span className="font-label-sm text-label-sm text-on-surface-variant">{queue.length} en attente</span>
          </div>
          {news.isError && <p className="text-body-sm text-error">La file est indisponible.</p>}
          {queue.length === 0 && !news.isError && (
            <p className="text-body-sm italic text-on-surface-variant">Aucune actu à relire pour l'instant.</p>
          )}
          <div className="space-y-xs">
            {queue.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setReviewing(n)}
                aria-haspopup="dialog"
                className="w-full text-left p-sm bg-card border border-outline-variant hover:bg-surface-container transition-colors min-w-0 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-sm min-w-0">
                  <div className="min-w-0">
                    <p className="font-body-md text-primary wrap-anywhere">{n.title}</p>
                    <p className="text-xs text-on-surface-variant uppercase font-label-sm">
                      {n.author} • {timeAgo(n.submitted_at ?? n.created_at)}
                    </p>
                  </div>
                  <AudienceBadge audience={n.audience ?? "tout_le_cabinet"} className="shrink-0" />
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      <NewsReviewPanel
        news={reviewing}
        circuitLabel="Valider et publier"
        isSelfAuthor={(reviewing?.author_email ?? "").toLowerCase() === myEmail}
        banner={banner}
        pending={review.isPending}
        onReview={(decision, category, note) =>
          reviewing && review.mutate({ id: reviewing.id, decision, category, note })
        }
        onClose={() => setReviewing(null)}
      />
    </div>
  );
}
