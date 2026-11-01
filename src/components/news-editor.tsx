import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { Field } from "@/components/manage/crud-ui";
import { NewsMediaEditor } from "@/components/news-media";
import { CircuitStepper, type CircuitStep } from "@/components/circuit-stepper";
import { getCircuit, type CircuitAudience, type CircuitKind } from "@/lib/circuit";
import { emptyMedia, linkErrors, mediaFromNews, toNewsLinks, type MediaDraft } from "@/lib/news-media";
import { formatActuWithAI, type AiMode } from "@/lib/ai";
import {
  createNewsDraft,
  fetchMyManagedTeams,
  fetchMyManagerName,
  setAudienceTeam,
  submitNews,
  updateNewsDraft,
} from "@/lib/news-circuit";
import type { News } from "@/lib/dashboard";

// La Web Speech API n'est pas dans les typings DOM standard de TypeScript :
// on déclare juste ce dont on se sert, sans "any".
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const UNSUPPORTED_MSG = "Dictée indisponible sur ce navigateur, utilise Chrome ou colle tes notes.";
const MIC_DENIED_MSG = "Micro refusé : autorise l'accès au micro ou utilise la dictée simulée ci-dessous.";
const NO_SPEECH_MSG = "Aucune parole détectée. Réessaie ou parle plus près du micro.";

const FAKE_DICTATION =
  "Nous signons un nouveau partenariat avec une école de code pour accueillir des alternants " +
  "Data dès janvier. Trois postes sont concernés sur le pôle Data et IA, avec un démarrage prévu " +
  "au premier trimestre.";

const MODE_LABELS: Record<AiMode, string> = { dictee: "Dicter", notes: "Coller des notes", ecrit: "Écrire" };

function buildCircuitSteps(kind: CircuitKind, managerName: string | null): CircuitStep[] {
  const manager = managerName ?? "Ton manager";
  switch (kind) {
    case "aucun":
      return [{ label: "Toi", state: "current" }, { label: "Publié", state: "todo" }];
    case "manager":
      return [
        { label: "Toi", state: "done" },
        { label: manager, state: "current" },
        { label: "Publié", state: "todo" },
      ];
    case "relecteur_comm":
      return [
        { label: "Toi", state: "done" },
        { label: "Relecteur Comm", state: "current" },
        { label: "Publié", state: "todo" },
      ];
    case "manager_puis_relecteur_comm":
      return [
        { label: "Toi", state: "done" },
        { label: manager, state: "todo" },
        { label: "Relecteur Comm", state: "todo" },
        { label: "Publié", state: "todo" },
      ];
  }
}

export function NewsEditor({ news, onDone }: { news?: News | null; onDone: () => void }) {
  const { role, email } = useRouteContext({ from: "/_authenticated" });
  const roleAuteur = role === "manager" ? "manager" : "collaborateur";

  const [mode, setMode] = useState<AiMode>((news?.input_mode as AiMode) ?? "notes");
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [useFallbackDictation, setUseFallbackDictation] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [title, setTitle] = useState(news?.title ?? "");
  const [body, setBody] = useState(news?.body ?? "");
  const [audience, setAudience] = useState(news?.audience ?? "mon_equipe");
  const [media, setMedia] = useState<MediaDraft>(() => (news ? mediaFromNews(news) : emptyMedia()));
  const [showLinkErrs, setShowLinkErrs] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const managerName = useQuery({
    queryKey: ["my-manager-name"],
    queryFn: fetchMyManagerName,
    enabled: roleAuteur === "collaborateur",
    staleTime: 5 * 60 * 1000,
  });

  const managedTeams = useQuery({
    queryKey: ["manager_teams", "mine", email],
    queryFn: () => fetchMyManagedTeams(email ?? ""),
    enabled: roleAuteur === "manager" && !!email,
    staleTime: 5 * 60 * 1000,
  });

  // Choix de "l'équipe émettrice" : requis par submit_news seulement quand un
  // manager gérant plusieurs équipes vise "Mon équipe" (sinon la base ne sait
  // pas laquelle de ses équipes est concernée). Pour "Plusieurs équipes", il
  // n'y a pas de notion d'équipe ciblée (audience = tout le cabinet).
  const needsTeamChoice = roleAuteur === "manager" && audience === "mon_equipe" && (managedTeams.data?.length ?? 0) > 1;
  const [emittingTeam, setEmittingTeam] = useState("");
  if (needsTeamChoice && !emittingTeam && managedTeams.data?.[0]) {
    setEmittingTeam(managedTeams.data[0]);
  }

  const circuitAudience: CircuitAudience = audience === "tout_le_cabinet" ? "plusieurs_equipes" : "mon_equipe";
  const circuit = getCircuit("actu", circuitAudience, roleAuteur);
  const steps = buildCircuitSteps(circuit.kind, managerName.data ?? null);

  async function runAI() {
    if (!notes.trim()) return;
    setAiLoading(true);
    const result = await formatActuWithAI(notes.trim(), mode);
    setAiLoading(false);
    if (!result) {
      toast.error("L'assistant IA est indisponible, continue en écrivant toi-même.");
      setBody((b) => b || notes.trim());
      return;
    }
    setTitle(result.title);
    setBody(result.body);
    toast.success("Texte proposé par l'IA — relis-le avant d'envoyer.");
  }

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function startDictation() {
    setDictationError(null);
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setDictationError(UNSUPPORTED_MSG);
      setUseFallbackDictation(true);
      setRecording(true);
      return;
    }
    setUseFallbackDictation(false);
    const recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript + " ";
        else interim += result[0].transcript;
      }
      setNotes((finalTranscript + interim).trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "permission-denied" || event.error === "service-not-allowed") {
        setDictationError(MIC_DENIED_MSG);
        setUseFallbackDictation(true);
      } else if (event.error === "no-speech") {
        setDictationError(NO_SPEECH_MSG);
      } else {
        setDictationError(UNSUPPORTED_MSG);
        setUseFallbackDictation(true);
      }
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setRecording(true);
    } catch {
      setDictationError(UNSUPPORTED_MSG);
      setUseFallbackDictation(true);
    }
  }

  function stopDictation() {
    setRecording(false);
    if (useFallbackDictation) {
      setNotes(FAKE_DICTATION);
      return;
    }
    recognitionRef.current?.stop();
  }

  async function handleSubmit(action: "draft" | "submit") {
    const tErr = !title.trim() ? "Erreur : le titre est obligatoire" : null;
    const bErr = !body.trim() ? "Erreur : le texte est obligatoire" : null;
    setTitleError(tErr);
    setBodyError(bErr);
    if (tErr || bErr) return;

    setShowLinkErrs(true);
    if (Object.keys(linkErrors(media.links)).length) {
      toast.error("Corrige les liens invalides avant d'enregistrer.");
      return;
    }

    setPending(true);
    try {
      const input = {
        title: title.trim(),
        body: body.trim(),
        audience,
        input_mode: mode,
        links: toNewsLinks(media.links),
        media,
      };
      const saved = news?.id ? await updateNewsDraft(news.id, input) : await createNewsDraft(input);
      if (action === "draft") {
        toast.success(
          roleAuteur === "manager" && circuit.kind === "aucun"
            ? "Brouillon enregistré. Tu recevras un rappel demain si elle n'est pas publiée."
            : "Brouillon enregistré.",
        );
        onDone();
        return;
      }
      if (needsTeamChoice) {
        await setAudienceTeam(saved.id, emittingTeam);
      }
      await submitNews(saved.id);
      toast.success(circuit.announcement);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-md" onSubmit={(e) => e.preventDefault()} noValidate>
      <fieldset className="space-y-xs">
        <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">Mode de saisie</legend>
        <div className="flex flex-wrap gap-xs">
          {(["dictee", "notes", "ecrit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "px-md py-xs bg-primary text-on-primary font-label-md text-label-md"
                  : "px-md py-xs border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container"
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </fieldset>

      {mode !== "ecrit" && (
        <div className="space-y-sm border border-outline-variant bg-surface-container p-sm">
          {mode === "dictee" ? (
            <div className="space-y-xs">
              {dictationError && (
                <p role="alert" className="text-body-sm text-error">
                  {dictationError}
                </p>
              )}
              {!recording ? (
                <button
                  type="button"
                  onClick={startDictation}
                  className="flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md hover:bg-surface-container"
                >
                  <span aria-hidden="true" className="material-symbols-outlined">mic</span> {notes ? "Redicter" : "Dicter"}
                </button>
              ) : (
                <div className="flex items-center gap-sm">
                  <span className="flex items-center gap-xs font-label-sm text-label-sm text-error">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-error" aria-hidden="true" /> Enregistrement…
                  </span>
                  <button
                    type="button"
                    onClick={stopDictation}
                    className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
                  >
                    Stop
                  </button>
                </div>
              )}
              {notes && (
                <p className="font-body-sm text-body-sm italic text-on-surface-variant">« {notes} »</p>
              )}
            </div>
          ) : (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Colle tes notes en vrac, l'IA s'occupe de la mise en forme…"
              className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
            />
          )}
          <button
            type="button"
            disabled={!notes.trim() || aiLoading}
            onClick={runAI}
            className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
          >
            {aiLoading ? "Mise en forme…" : "Mettre en forme avec l'IA"}
          </button>
        </div>
      )}

      <Field label="Titre" error={titleError ?? undefined}>
        <input
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <Field label="Texte" error={bodyError ?? undefined}>
        <textarea
          value={body}
          rows={6}
          onChange={(e) => setBody(e.target.value)}
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <Field label="Visuel (facultatif)">
        <NewsMediaEditor
          value={media}
          onChange={setMedia}
          linkErrs={showLinkErrs ? linkErrors(media.links) : {}}
          disabled={pending}
          title={title}
        />
      </Field>

      <fieldset className="space-y-xs">
        <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">Audience</legend>
        <div className="flex flex-col gap-xs sm:flex-row">
          {([
            { value: "mon_equipe", label: "Mon équipe" },
            { value: "tout_le_cabinet", label: "Plusieurs équipes / Tout le cabinet" },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className={`flex-1 cursor-pointer border p-sm ${
                audience === opt.value ? "border-primary bg-surface-container" : "border-outline-variant"
              }`}
            >
              <input
                type="radio"
                name="audience"
                className="mr-xs"
                checked={audience === opt.value}
                onChange={() => setAudience(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsTeamChoice && (
        <Field label="Équipe émettrice">
          <select
            value={emittingTeam}
            onChange={(e) => setEmittingTeam(e.target.value)}
            className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
          >
            {managedTeams.data?.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="space-y-xs border border-outline-variant bg-surface-container-lowest p-sm">
        <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Ce qui va se passer</p>
        <CircuitStepper steps={steps} />
        <p className="font-body-sm text-body-sm text-on-surface-variant">{circuit.announcement}</p>
      </div>

      <div className="flex flex-wrap gap-sm pt-sm">
        {roleAuteur === "manager" ? (
          circuit.kind === "aucun" ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleSubmit("submit")}
                className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
              >
                Publier maintenant
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleSubmit("draft")}
                className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
              >
                Plus tard (rappel demain)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleSubmit("submit")}
                className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
              >
                Envoyer à la relecture Comm
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleSubmit("draft")}
                className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
              >
                Enregistrer en brouillon
              </button>
            </>
          )
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleSubmit("draft")}
              className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
            >
              Enregistrer en brouillon
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleSubmit("submit")}
              className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
            >
              Envoyer pour validation
            </button>
          </>
        )}
      </div>
    </form>
  );
}
