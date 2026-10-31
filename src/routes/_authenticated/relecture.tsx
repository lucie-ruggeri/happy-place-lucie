import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BrandHeader } from "@/components/brand-header";

// Vue Relecture : visible pour les comptes « Relecteur Comm » (case is_reviewer),
// ex. Camille et Julien. Flow de relecture réel hors périmètre de cette étape
// (voir CLAUDE.md, flows 2-x de la roadmap) : stub d'atterrissage uniquement.
export const Route = createFileRoute("/_authenticated/relecture")({
  head: () => ({ meta: [{ title: "Relecture — Happy Place" }] }),
  beforeLoad: ({ context }) => {
    if (!context.isReviewer) throw redirect({ to: "/" });
  },
  component: RelecturePage,
});

function RelecturePage() {
  const { firstName } = Route.useRouteContext();

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
        <section className="border border-outline-variant bg-surface-container-lowest p-lg">
          <p className="font-body-md text-on-surface-variant">
            La file de relecture (actus « À valider (Comm) » et « À modifier (Comm) ») arrive à
            l'étape suivante. Pour l'instant, retrouve ces actus avec leur badge de statut dans le
            fil du tableau de bord.
          </p>
          <Link to="/" className="mt-md inline-block font-label-md text-label-md uppercase text-primary underline">
            ← Retour au tableau de bord
          </Link>
        </section>
      </main>
    </div>
  );
}
