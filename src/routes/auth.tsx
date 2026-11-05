import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BrandHeader } from "@/components/brand-header";
import { Button } from "@/components/ui/button";

// Deux entrées :
// 1. Connexion par lien magique (Supabase) : on saisit son adresse e-mail, on reçoit
//    un lien, on clique dessus et on revient ici connecté. C'est la vraie authentification.
// 2. Accès démo : une session anonyme Supabase est ouverte, puis /choisir-role
//    permet de choisir un rôle ou l'une des 6 personas. Aucun e-mail requis.
// Dans les deux cas, le navigateur garde la session : on retrouve son rôle à la visite suivante.

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Happy Place" },
      { name: "description", content: "Happy Place, le dashboard interne de Bigger Boat." },
    ],
  }),
  component: EntreePage,
});

type Step = "checking" | "choix" | "email" | "envoye";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Un lien expiré ou déjà utilisé revient ici avec l'erreur dans l'adresse (#error_code=otp_expired…).
function linkErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = params.get("error_code");
  if (!code && !params.get("error")) return null;
  return code === "otp_expired"
    ? "Ce lien a expiré ou a déjà été utilisé. Demande un nouveau lien."
    : "Ce lien de connexion n'est pas valide. Demande un nouveau lien.";
}

function EntreePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("checking");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Une session existante (ou créée par le lien magique) renvoie directement au dashboard ;
  // sinon on affiche l'écran de connexion (e-mail ou accès démo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        navigate({ to: "/" });
        return;
      }
      const linkError = linkErrorFromUrl();
      if (linkError) {
        setEmailError(linkError);
        setStep("email");
        return;
      }
      setStep("choix");
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function enterDemo() {
    setDemoError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInAnonymously();
    if (err) {
      setBusy(false);
      setDemoError(
        /anonymous/i.test(err.message) && /disabled|not enabled/i.test(err.message)
          ? "Les connexions anonymes ne sont pas activées dans Supabase. Active « Allow anonymous sign-ins » (voir le README, étape 2), puis réessaie."
          : `Impossible d'ouvrir Happy Place : ${err.message}`,
      );
      return;
    }
    navigate({ to: "/choisir-role" });
  }

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault();
    setEmailError(null);
    const clean = email.trim().toLowerCase();
    if (!clean) {
      setEmailError("Renseigne ton adresse e-mail.");
      return;
    }
    if (!EMAIL_RE.test(clean)) {
      setEmailError("Cette adresse e-mail n'a pas un format valide (ex. prenom@entreprise.com).");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth` },
    });
    setBusy(false);
    if (err) {
      setEmailError(
        /rate limit|too many|seconds/i.test(err.message)
          ? "Trop de liens demandés : patiente quelques minutes avant de réessayer."
          : `Impossible d'envoyer le lien : ${err.message}`,
      );
      return;
    }
    setEmail(clean);
    setStep("envoye");
  }

  const inputCls =
    "mt-xs h-11 w-full border border-outline-variant bg-background px-sm font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary";
  const labelCls = "block font-label-sm text-label-sm uppercase text-on-surface-variant";
  const errCls = "mt-xs block font-body-sm text-body-sm text-error";
  const btnCls = "h-12 w-full rounded-none font-label-md text-xs uppercase";
  const linkBtnCls = "text-primary underline-offset-2 hover:underline";

  return (
    <div className="min-h-dvh w-full bg-background flex flex-col">
      <BrandHeader />
      <main className="flex flex-1 items-center justify-center px-md py-lg">
        <section className="w-[min(100%,28rem)] border border-outline-variant bg-surface-container-lowest p-lg shadow-sm">
          <h1 className="font-headline-lg text-headline-lg text-primary">Happy Place</h1>

          {step === "checking" && (
            <p className="mt-sm font-body-md text-body-md text-on-surface-variant" role="status">
              Vérification de ta session…
            </p>
          )}

          {step === "choix" && (
            <div className="mt-sm space-y-md">
              <p className="font-body-md text-body-md text-on-surface-variant">
                Le dashboard interne de Bigger Boat : actus, points bloquants, indicateurs et idées.
              </p>
              <Button onClick={() => setStep("email")} className={`${btnCls} text-on-primary`}>
                ME CONNECTER AVEC MON E-MAIL
              </Button>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Tu reçois un lien de connexion par e-mail, sans mot de passe.
              </p>
              <div className="space-y-xs border-t border-outline-variant pt-md">
                <Button variant="outline" onClick={enterDemo} disabled={busy} className={`${btnCls} text-primary`}>
                  {busy ? "CONNEXION…" : demoError ? "RÉESSAYER" : "SE CONNECTER (ACCÈS DÉMO)"}
                </Button>
                {demoError && (
                  <p className="border border-error bg-error-container p-sm font-body-sm text-on-error-container" role="alert">
                    {demoError}
                  </p>
                )}
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Accès de démonstration : une session sécurisée est ouverte sans e-mail, puis tu choisis un persona.
                </p>
              </div>
            </div>
          )}

          {step === "email" && (
            <form onSubmit={sendLink} className="mt-md space-y-md" noValidate>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Saisis ton adresse e-mail : on t'envoie un lien pour te connecter.
              </p>
              <label className={labelCls}>
                Adresse e-mail
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  maxLength={254}
                  aria-invalid={emailError ? true : undefined}
                  className={inputCls}
                />
                {emailError && (
                  <span className={errCls} role="alert">
                    {emailError}
                  </span>
                )}
              </label>
              <Button type="submit" disabled={busy} className={`${btnCls} text-on-primary`}>
                {busy ? "ENVOI…" : "RECEVOIR MON LIEN"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("choix");
                  setEmailError(null);
                }}
                className={`font-body-sm text-body-sm ${linkBtnCls}`}
              >
                Retour
              </button>
            </form>
          )}

          {step === "envoye" && (
            <div className="mt-md space-y-md">
              <p className="font-body-md text-body-md text-on-surface-variant" role="status">
                Un lien de connexion vient d'être envoyé à <strong className="text-on-surface">{email}</strong>. Ouvre ta boîte mail et clique sur
                « Sign in » : tu reviendras ici connecté(e). Pense à regarder tes courriers indésirables.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-xs font-body-sm text-body-sm text-on-surface-variant">
                <button type="button" onClick={() => sendLink()} disabled={busy} className={linkBtnCls}>
                  {busy ? "Envoi…" : "Renvoyer le lien"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setEmailError(null);
                  }}
                  className={linkBtnCls}
                >
                  Changer d'adresse
                </button>
              </div>
              {emailError && (
                <p className={errCls} role="alert">
                  {emailError}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
