import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { BrandHeader } from "@/components/brand-header";
import { BackLink } from "@/components/back-link";
import { BlockerEditor } from "@/components/blocker-editor";

export const Route = createFileRoute("/_authenticated/nouveau-point-bloquant")({
  head: () => ({ meta: [{ title: "Signaler un point bloquant — Happy Place" }] }),
  beforeLoad: ({ context }) => {
    // Seuls collaborateurs et managers signalent (policy blockers_insert) : l'admin n'a pas ce droit.
    if (context.role === "admin") throw redirect({ to: "/" });
  },
  component: NouveauPointBloquantPage,
});

function NouveauPointBloquantPage() {
  const navigate = useNavigate();

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen">
      <BrandHeader profile={Route.useRouteContext()} />
      <main className="w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        <BackLink to="/" />
        <div className="space-y-1">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">
            Points bloquants
          </p>
          <h1 className="font-headline-lg text-headline-lg text-primary">Signaler un point bloquant</h1>
        </div>
        <section className="border border-outline-variant bg-surface-container-lowest p-lg">
          <BlockerEditor onDone={() => navigate({ to: "/" })} />
        </section>
      </main>
    </div>
  );
}
