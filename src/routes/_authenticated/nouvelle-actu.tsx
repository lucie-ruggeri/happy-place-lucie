import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandHeader } from "@/components/brand-header";

// Formulaire de publication réel hors périmètre de cette étape (flow 1-1,
// roadmap) : stub pour que le bouton « + Nouvelle actu » mène quelque part.
export const Route = createFileRoute("/_authenticated/nouvelle-actu")({
  head: () => ({ meta: [{ title: "Nouvelle actu — Happy Place" }] }),
  component: NouvelleActuPage,
});

function NouvelleActuPage() {
  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen">
      <BrandHeader profile={Route.useRouteContext()} />
      <main className="w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <div className="space-y-1">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">Actus</p>
          <h1 className="font-headline-lg text-headline-lg text-primary">Nouvelle actu</h1>
        </div>
        <section className="border border-outline-variant bg-surface-container-lowest p-lg">
          <p className="font-body-md text-on-surface-variant">
            Le formulaire de publication express (avec circuit de validation automatique selon
            ton rôle et l'audience choisie) arrive à l'étape suivante.
          </p>
          <Link to="/" className="mt-md inline-block font-label-md text-label-md uppercase text-primary underline">
            ← Retour au tableau de bord
          </Link>
        </section>
      </main>
    </div>
  );
}
