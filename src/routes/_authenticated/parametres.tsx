import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BrandHeader } from "@/components/brand-header";

// Paramètres : menu admin (ex. Karim), distinct de « Gérer les données ».
// Contenu réel (gestion des relecteurs, relances…) hors périmètre de cette étape.
export const Route = createFileRoute("/_authenticated/parametres")({
  head: () => ({ meta: [{ title: "Paramètres — Happy Place" }] }),
  beforeLoad: ({ context }) => {
    if (context.role !== "admin") throw redirect({ to: "/" });
  },
  component: ParametresPage,
});

function ParametresPage() {
  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen">
      <BrandHeader profile={Route.useRouteContext()} />
      <main className="w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <div className="space-y-1">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">Admin</p>
          <h1 className="font-headline-lg text-headline-lg text-primary">Paramètres</h1>
        </div>
        <section className="border border-outline-variant bg-surface-container-lowest p-lg">
          <p className="font-body-md text-on-surface-variant">
            La gestion de la case « Relecteur Comm » et des relances depuis cet écran arrive à
            l'étape suivante.
          </p>
          <Link to="/" className="mt-md inline-block font-label-md text-label-md uppercase text-primary underline">
            ← Retour au tableau de bord
          </Link>
        </section>
      </main>
    </div>
  );
}
