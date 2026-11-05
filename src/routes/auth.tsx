import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BrandHeader } from "@/components/brand-header";
import { Button } from "@/components/ui/button";

// Deux entrées :
// 1. Connexion par code e-mail (OTP Supabase) : on saisit son adresse, on reçoit
//    un code à 6 chiffres, on le saisit. C'est la vraie authentification.
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

type Step = "checking" | "choix" | "email" | "code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;

function EntreePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("checking");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Une session existante renvoie directement au dashboard ; sinon on affiche
  // l'écran de connexion (e-mail ou accès démo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        navigate({ to: "/" });
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

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setEmailError(null);
    setCodeError(null);
    setInfo(null);
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
    const { error: err } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) {
      setEmailError(
        /rate limit|too many|seconds/i.test(err.message)
          ? "Trop de codes demandés : patiente quelques minutes avant de réessayer."
          : `Impossible d'envoyer le code : ${err.message}`,
      );
      return;
    }
    setEmail(clean);
    setCode("");
    setStep("code");
    setInfo(`Un code à ${OTP_LENGTH} chiffres vient d'être envoyé à ${clean}.`);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeError(null);
    const clean = code.replace(/\s/g, "");
    if (!clean) {
      setCodeError("Saisis le code reçu par e-mail.");
      return;
    }
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(clean)) {
      setCodeError(`Le code contient exactement ${OTP_LENGTH} chiffres.`);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: clean, type: "email" });
    if (err) {
      setBusy(false);
      setCodeError(
        /expired|invalid/i.test(err.message)
          ? "Code incorrect ou expiré. Vérifie-le ou demande un nouveau code."
          : `Connexion impossible : ${err.message}`,
      );
      return;
    }
    // « / » renvoie vers /choisir-role si le compte n'a pas encore de profil.
    navigate({ to: "/" });
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
                Tu reçois un code à {OTP_LENGTH} chiffres par e-mail, sans mot de passe.
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
            <form onSubmit={sendCode} className="mt-md space-y-md" noValidate>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Saisis ton adresse e-mail : on t'envoie un code à {OTP_LENGTH} chiffres.
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
                {busy ? "ENVOI…" : "RECEVOIR MON CODE"}
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

          {step === "code" && (
            <form onSubmit={verifyCode} className="mt-md space-y-md" noValidate>
              {info && (
                <p className="font-body-md text-body-md text-on-surface-variant" role="status">
                  {info}
                </p>
              )}
              <label className={labelCls}>
                Code reçu par e-mail
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={OTP_LENGTH + 2}
                  aria-invalid={codeError ? true : undefined}
                  className={`${inputCls} tracking-[0.4em]`}
                />
                {codeError && (
                  <span className={errCls} role="alert">
                    {codeError}
                  </span>
                )}
              </label>
              <Button type="submit" disabled={busy} className={`${btnCls} text-on-primary`}>
                {busy ? "VÉRIFICATION…" : "ME CONNECTER"}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-xs font-body-sm text-body-sm text-on-surface-variant">
                <button type="button" onClick={() => sendCode()} disabled={busy} className={linkBtnCls}>
                  Renvoyer le code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCodeError(null);
                    setInfo(null);
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
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
