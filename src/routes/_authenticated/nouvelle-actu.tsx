import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { BrandHeader } from "@/components/brand-header";
import { NewsEditor } from "@/components/news-editor";

export const Route = createFileRoute("/_authenticated/nouvelle-actu")({
  head: () => ({ meta: [{ title: "Nouvelle actu — Happy Place" }] }),
  beforeLoad: ({ context }) => {
    // Seuls collaborateurs et managers publient des actus (D26, policy news_insert) : l'admin n'a pas ce droit.
    if (context.role === "admin") throw redirect({ to: "/" });
  },
  component: NouvelleActuPage,
});

function NouvelleActuPage() {
  const navigate = useNavigate();

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen">
      <BrandHeader profile={Route.useRouteContext()} />
      <main className="w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <div className="space-y-1">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">Actus</p>
          <h1 className="font-headline-lg text-headline-lg text-primary">Nouvelle actu</h1>
        </div>
        <section className="border border-outline-variant bg-surface-container-lowest p-lg">
          <NewsEditor onDone={() => navigate({ to: "/" })} />
        </section>
      </main>
    </div>
  );
}
