import { createFileRoute, Link } from "@tanstack/react-router";
import { signOut } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorSummary, Field, FormActions, Modal, TextArea, TextInput } from "@/components/manage/crud-ui";
import { rejectionSchema, submissionSchema, validate, type FieldErrors } from "@/lib/manage-schemas";
import { BrandHeader } from "@/components/brand-header";
import { AttachmentLink } from "@/components/attachment-link";
import { CharCounter, SubmissionPreview, rejectionErrorMessage } from "@/components/expandable-card";
import { Linkify } from "@/components/linkify";
import { SubmissionReader } from "@/components/submission-reader";
import { NewsReader } from "@/components/news-reader";
import { NewsEditor } from "@/components/news-editor";
import { DepartureNotices } from "@/components/departure-notices";
import { NewsImage, NewsLinks } from "@/components/news-media";
import { BlockerArchive, ValidatedSubmissions } from "@/components/dashboard-extras";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { AudienceBadge } from "@/components/audience-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  fetchBlockers,
  fetchMetrics,
  deltaText,
  fetchNews,
  fetchSubmissions,
  fetchMySubmissions,
  exportMyRecentSubmissions,
  REJECTION_CATEGORIES,
  type News,
  type Submission,
  reviewSubmission,
  submitIdea,
  timeAgo,
  updateBlockerStatus,
  updateMetric,
  TREND_LABELS,
  type Metric,
  type SubmissionInput,
} from "@/lib/dashboard";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Happy Place — Actualités et vue d'ensemble" },
      {
        name: "description",
        content:
          "Pilotez les missions de recrutement IT et digital, les propositions des équipes, les alertes opérationnelles et les indicateurs du cabinet.",
      },
      { property: "og:title", content: "Happy Place — Vue d'ensemble" },
      {
        property: "og:description",
        content:
          "Suivez l'activité du cabinet, les missions de recrutement, les alertes et les indicateurs clés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ManagerSpace,
});

const PERF_IMAGE =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAz-Y4URSqOCzUaVC6vomdu54tTiFPC_bF9A_h0SjxJ1mq2OlNfOyeKTNkPIgtPRloYwE5JrWFm2FHBNUq0GScs0ALDVMiq16FLu95dHNGPjmybEoIb2uyz1OGozRn0XkudSMukcPY4gKfeOJMR_KAnhYbkZifswTCbpCs_aHZyMuoZRz_oc4KsWtWiryTdwVD0EKyvxScj3palbDIM2wMlnH0njPGj912mRwhMmTo3Yu07l6xfVv2Zuw";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>
      {name}
    </span>
  );
}

function trendText(m: Metric | undefined) {
  return m ? TREND_LABELS[m.trend] : "";
}

function metricOf(metrics: Metric[] | undefined, key: string) {
  return metrics?.find((m) => m.key === key);
}

function formatMetric(m: Metric | undefined, fallback: string) {
  if (!m) return fallback;
  const v = Number(m.value);
  const formatted = m.unit === "%" ? v.toFixed(1) : v.toLocaleString("fr-FR");
  return `${formatted}${m.unit ?? ""}`;
}

function metricLabel(metric: Metric | undefined, fallback: string) {
  if (!metric) return fallback;
  if (metric.key === "training_kpi") return "Taux de placement";
  if (metric.key === "active_users") return "Missions actives";
  return metric.label;
}

function ManagerSpace() {
  const qc = useQueryClient();
  const { role, email, firstName, team, isReviewer } = Route.useRouteContext();
  const isAdmin = role === "admin";
  const canReview = role === "admin" || role === "manager";
  const myEmail = (email ?? "").toLowerCase();
  const [nps, setNps] = useState<string>("");
  const [submissionForm, setSubmissionForm] = useState<SubmissionInput | null>(null);
  const [submissionErrors, setSubmissionErrors] = useState<FieldErrors>({});
  const myTeams = useQuery({
    queryKey: ["manager_teams", "mine", email],
    enabled: role === "manager" && !!email,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_teams")
        .select("team, allowed_users!inner(email)")
        .eq("allowed_users.email", (email ?? "").toLowerCase());
      if (error) throw error;
      return (data ?? []).map((t) => t.team).sort();
    },
  });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [rejecting, setRejecting] = useState<Submission | null>(null);
  const [reading, setReading] = useState<Submission | null>(null);
  const [readingNews, setReadingNews] = useState<News | null>(null);
  const [editingNews, setEditingNews] = useState<News | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectForm, setRejectForm] = useState({ rejection_category: "", rejection_note: "" });
  const [rejectErrors, setRejectErrors] = useState<FieldErrors>({});

  const news = useQuery({ queryKey: ["news"], queryFn: fetchNews, retry: false });
  const submissions = useQuery({
    queryKey: ["submissions"],
    queryFn: fetchSubmissions,
    retry: false,
  });
  const mine = useQuery({
    queryKey: ["submissions", "mine", email],
    queryFn: () => fetchMySubmissions(email ?? ""),
    enabled: !!email,
    retry: false,
  });
  const blockers = useQuery({ queryKey: ["blockers"], queryFn: fetchBlockers, retry: false });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics, retry: false });
  const onError = (e: unknown) => toast.error((e as Error).message);

  const exportReport = useMutation({
    mutationFn: () => {
      if (!email) throw new Error("Votre adresse e-mail est indisponible.");
      return exportMyRecentSubmissions(email);
    },
    onSuccess: (count) => {
      if (count === 0) {
        toast.info("Aucune soumission en attente ou validée sur les 30 derniers jours.");
        return;
      }
      toast.success(`${count} soumission${count > 1 ? "s" : ""} exportée${count > 1 ? "s" : ""} au format CSV.`);
    },
    onError,
  });

  const review = useMutation({
    mutationFn: reviewSubmission,
    onSuccess: (_d, vars) => {
      if (vars.status === "refusée") {
        setRejecting(null);
        toast.success("Soumission refusée");
      } else {
        setReading((r) => (r?.id === vars.id ? null : r));
      }
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e: unknown) => toast.error(rejectionErrorMessage(e)),
  });

  function startReject(s: Submission) {
    setReading(null);
    setRejecting(s);
    setRejectErrors({});
    setRejectForm({ rejection_category: "", rejection_note: "" });
  }

  const submit = useMutation({
    mutationFn: (input: SubmissionInput) => submitIdea({
      author_name: input.author_name,
      team: input.team,
      content: input.content,
    }, attachment),
    onSuccess: () => {
      setSubmissionForm(null);
      setAttachment(null);
      setSubmissionErrors({});
      toast.success("Soumission envoyée");
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e: unknown) => toast.error(rejectionErrorMessage(e)),
  });

  const setBlocker = useMutation({
    mutationFn: updateBlockerStatus,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blockers"] }),
    onError,
  });

  const saveMetric = useMutation({
    mutationFn: updateMetric,
    onSuccess: () => {
      toast.success("KPI mis à jour");
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
    onError,
  });

  const published = news.data?.filter((n) => n.status === "publiée") ?? [];
  const myNews = news.data?.filter((n) => (n.author_email ?? "").toLowerCase() === myEmail) ?? [];
  const npsMetric = metricOf(metrics.data, "nps");
  const roleLabel = role === "admin" ? "ADMIN" : role === "manager" ? "MANAGER" : "COLLABORATEUR";

  function sendSubmission(e: React.FormEvent) {
    e.preventDefault();
    if (!submissionForm) return;
    // Collaborators: team is set server-side from their account
    // Admin: always the « Admin » team (set server-side); manager: one of their teams
    const team = role === "collaborateur" ? "auto" : role === "admin" ? "Admin" : submissionForm.team;
    const result = validate(submissionSchema, { ...submissionForm, team, status: "en attente" });
    if (!result.ok) {
      setSubmissionErrors(result.errors);
      return;
    }
    setSubmissionErrors({});
    submit.mutate(result.data);
  }

  return (
    <div className="bg-background text-on-surface font-body-md min-h-screen flex flex-col">
      <BrandHeader profile={{ firstName, role, team }} />
      <main className="flex-grow w-full max-w-interface mx-auto p-sm md:p-md space-y-md">
        {email && <DepartureNotices email={email} />}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-sm mb-lg">
          <div className="space-y-sm">
            <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">
              Vue d'ensemble
            </p>
            <h1 className="font-headline-lg text-headline-lg text-primary">Happy Place</h1>
          </div>
          <div className="flex flex-wrap gap-xs items-center md:items-end md:justify-end">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {email} · {roleLabel}
            </span>
            {!isAdmin && (
              <span className="flex items-center gap-xs px-md py-xs border border-primary bg-surface text-primary font-label-md text-label-md">
                <Icon name="folder" /> MES CONTENUS
              </span>
            )}
            {isReviewer && (
              <Link
                to="/relecture"
                className="flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md hover:bg-surface-container"
              >
                <Icon name="fact_check" /> RELECTURE
              </Link>
            )}
            <button
              onClick={() => signOut()}
              className="flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md hover:bg-surface-container"
            >
              <Icon name="logout" /> DÉCONNEXION
            </button>
            {isAdmin && (<Link
              to="/manage/news"
              className="flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md hover:bg-surface-container transition-all"
            >
              <Icon name="database" /> GÉRER LES DONNÉES
            </Link>)}
            {isAdmin && (<Link
              to="/parametres"
              className="flex items-center gap-xs px-md py-xs border border-outline bg-surface text-primary font-label-md text-label-md hover:bg-surface-container transition-all"
            >
              <Icon name="settings" /> PARAMÈTRES
            </Link>)}
            <Button
              type="button"
              variant="outline"
              disabled={exportReport.isPending}
              onClick={() => exportReport.mutate()}
              className="h-auto rounded-none border-outline bg-surface px-md py-xs font-label-md text-label-md text-primary shadow-none hover:bg-surface-container"
            >
              <Icon name="file_download" /> {exportReport.isPending ? "EXPORT EN COURS…" : "EXPORTER LE RAPPORT"}
            </Button>
          </div>
        </div>

        <div className="bento-grid">
          {/* Les 4 modules : Actus actif, les autres bientôt disponibles */}
          <section className="col-span-12 grid grid-cols-2 gap-sm sm:grid-cols-4">
            <Link
              to="/nouvelle-actu"
              className="flex flex-col gap-xs border-2 border-primary bg-surface-container-lowest p-sm hover:bg-surface-container"
            >
              <Icon name="article" className="text-primary" />
              <span className="font-headline-sm text-headline-sm text-primary">Actus</span>
              <span className="font-label-sm text-label-sm uppercase text-primary">+ Nouvelle actu</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setSubmissionErrors({});
                const only = role === "manager" && myTeams.data?.length === 1 ? myTeams.data[0] : "";
                setSubmissionForm({ author_name: "", team: only, content: "", status: "en attente" });
              }}
              className="flex flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm text-left hover:border-primary"
            >
              <Icon name="lightbulb" className="text-on-surface-variant" />
              <span className="font-headline-sm text-headline-sm text-primary">Idées</span>
              <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Idée</span>
            </button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                    <Icon name="report" className="text-on-surface-variant" />
                    <span className="font-headline-sm text-headline-sm text-primary">Points bloquants</span>
                    <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Point bloquant</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Bientôt disponible</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                    <Icon name="bar_chart" className="text-on-surface-variant" />
                    <span className="font-headline-sm text-headline-sm text-primary">Indicateurs</span>
                    <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Indicateur</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Bientôt disponible</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </section>

          {/* Actualités du cabinet / Mes actus */}
          <section className="col-span-12 lg:col-span-6 min-w-0 bg-surface-container-lowest border border-outline-variant p-md flex flex-col gap-sm">
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Actualités du cabinet
              </h2>
            </div>
            <div className="space-y-xs">
              {news.isLoading && (
                <p className="text-body-sm text-on-surface-variant">Chargement…</p>
              )}
              {news.isError && (
                <p className="text-body-sm text-error">
                  Les actualités sont indisponibles.
                </p>
              )}
              {!news.isLoading && published.length === 0 && (
                <p className="text-body-sm italic text-on-surface-variant">
                  Aucune actualité publiée pour l'instant.
                </p>
              )}
              {published.slice(0, 6).map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => setReadingNews(n)}
                  aria-haspopup="dialog"
                  className="w-full text-left p-sm bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer group min-w-0 overflow-hidden space-y-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {n.image_path && <NewsImage path={n.image_path} alt={n.title} />}
                  <div className="flex items-center justify-between gap-sm min-w-0">
                    <div className="flex items-center gap-md min-w-0">
                      <Icon name="article" className="text-on-surface-variant" />
                      <div className="min-w-0">
                        <p className="font-body-md text-primary group-hover:underline wrap-anywhere">{n.title}</p>
                        <p className="text-xs text-on-surface-variant uppercase font-label-sm">
                          Publiée {timeAgo(n.created_at)} • Par {n.author}
                        </p>
                      </div>
                    </div>
                    <AudienceBadge audience={n.audience ?? "tout_le_cabinet"} className="shrink-0" />
                  </div>
                  <NewsLinks links={n.links} />
                </button>
              ))}
            </div>
          </section>

          <section className="col-span-12 lg:col-span-6 min-w-0 bg-surface-container-lowest border border-outline-variant p-md flex flex-col gap-sm">
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
              <h2 className="font-headline-sm text-headline-sm text-primary">Mes actus</h2>
            </div>
            <div className="space-y-xs">
              {myNews.length === 0 && (
                <p className="text-body-sm italic text-on-surface-variant">
                  Tu n'as pas encore écrit d'actu.{" "}
                  <Link to="/nouvelle-actu" className="text-primary underline">
                    Commence ici
                  </Link>
                  .
                </p>
              )}
              {myNews.slice(0, 6).map((n) => {
                const needsFix = n.status === "a_modifier_manager" || n.status === "a_modifier_comm";
                const isDraft = n.status === "brouillon";
                const isRefused = n.status === "refusée";
                return (
                  <div key={n.id} className="bg-surface-container p-sm space-y-xs min-w-0 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setReadingNews(n)}
                      aria-haspopup="dialog"
                      className="w-full text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-center justify-between gap-sm min-w-0">
                        <div className="flex items-center gap-md min-w-0">
                          <Icon name="draft" className="text-on-surface-variant" />
                          <div className="min-w-0">
                            <p className="font-body-md text-primary group-hover:underline wrap-anywhere">{n.title}</p>
                            <p className="text-xs text-on-surface-variant uppercase font-label-sm">
                              {timeAgo(n.created_at)}
                            </p>
                          </div>
                        </div>
                        <StatusBadge status={n.status} className="shrink-0" />
                      </div>
                    </button>
                    {isDraft && n.draft_reminder_at && (
                      <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">
                        Brouillon en attente depuis hier
                      </p>
                    )}
                    {(needsFix || isRefused) && n.review_note && (
                      <div className="p-xs bg-error-container text-on-error-container text-body-sm wrap-anywhere">
                        {n.review_category && <p className="font-bold">Motif : {n.review_category}</p>}
                        <p className="whitespace-pre-line">{n.review_note}</p>
                        {isRefused && <p className="mt-xs font-label-sm text-label-sm uppercase">Refus définitif</p>}
                      </div>
                    )}
                    {(needsFix || isDraft) && (
                      <button
                        type="button"
                        onClick={() => setEditingNews(n)}
                        className="font-label-sm text-label-sm uppercase text-primary underline"
                      >
                        {needsFix ? "Corriger et renvoyer" : "Reprendre"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Pending Submissions */}
          <section className="col-span-12 lg:col-span-4 min-w-0 bg-surface-container-lowest border border-outline-variant p-md flex flex-col">
            <div className="flex items-center justify-between border-b border-outline-variant pb-sm mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary">
                Soumissions en attente
              </h2>
              <div className="bg-tertiary-fixed text-on-tertiary-fixed px-xs py-1 rounded-full font-label-sm text-label-sm">
                {submissions.data?.length ?? 0} NOUVELLES
              </div>
            </div>
            <div className="space-y-sm flex-grow min-w-0">
              {submissions.isError && (
                <p className="text-body-sm text-error">
                  Les soumissions sont indisponibles.
                </p>
              )}
              {submissions.data?.length === 0 && (
                <p className="text-body-sm text-on-surface-variant italic">
                  Aucune soumission en attente.
                </p>
              )}
              {submissions.data?.map((s) => (
                <div
                  key={s.id}
                  className="p-sm border border-outline-variant bg-card space-y-sm min-w-0 overflow-hidden"
                >
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-full bg-secondary-fixed flex items-center justify-center">
                      <Icon name="person" className="text-sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-body-sm text-primary font-bold wrap-anywhere">{s.author_name}</p>
                      <p className="text-[10px] text-on-surface-variant font-label-sm wrap-anywhere">{s.team}</p>
                    </div>
                    <span className="text-[10px] text-on-surface-variant font-label-sm whitespace-nowrap">
                      {timeAgo(s.created_at)}
                    </span>
                  </div>
                  <SubmissionPreview content={s.content} onOpen={() => setReading(s)} />
                  <AttachmentLink path={s.attachment_path} name={s.attachment_name} />
                  {canReview && <div className="flex gap-xs pt-xs">
                    <button
                      onClick={() => startReject(s)}
                      className="flex-1 py-1 border border-outline text-primary font-label-sm text-label-sm hover:bg-surface-container transition-colors"
                    >
                      REFUSER
                    </button>
                    <button
                      onClick={() => review.mutate({ id: s.id, status: "validée" })}
                      className="flex-1 py-1 bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-colors"
                    >
                      VALIDER
                    </button>
                  </div>}
                </div>
              ))}
            </div>
          </section>

          {/* Mes soumissions */}
          {mine.data && mine.data.length > 0 && (
            <section className="col-span-12 min-w-0 bg-surface-container-lowest border border-outline-variant p-md">
              <h2 className="font-headline-sm text-headline-sm text-primary border-b border-outline-variant pb-sm mb-md">
                Mes soumissions
              </h2>
              <div className="space-y-xs">
                {mine.data.map((s) => (
                  <div key={s.id} className="p-sm border border-outline-variant bg-card min-w-0 overflow-hidden">
                    <SubmissionPreview content={s.content} onOpen={() => setReading(s)} />
                    <AttachmentLink path={s.attachment_path} name={s.attachment_name} />
                    <p className="text-[11px] font-label-sm text-on-surface-variant uppercase mt-xs">
                      {s.status} • {s.team} • {timeAgo(s.created_at)}
                    </p>
                    {s.status === "refusée" && s.rejection_category && (
                      <div className="mt-xs p-xs bg-error-container text-on-error-container text-body-sm wrap-anywhere">
                        <p className="font-bold">Motif : {s.rejection_category}</p>
                        <p className="whitespace-pre-line">Raison : <Linkify text={s.rejection_note ?? ""} /></p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <ValidatedSubmissions
            role={role}
            email={myEmail}
            managerTeams={myTeams.data ?? []}
            onRead={setReading}
          />

          {/* Points Bloquants */}
          <section className="col-span-12 md:col-span-7 bg-surface-container-lowest border border-outline-variant p-md">
            <div className="flex items-center justify-between mb-md">
              <div className="flex items-center gap-sm">
                <h2 className="font-headline-sm text-headline-sm text-primary">Points Bloquants</h2>
                <span className="text-xs bg-error-container text-on-error-container px-xs py-1 font-label-sm">
                  PRIORITÉ HAUTE
                </span>
              </div>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setArchiveOpen(true)}
                className="text-primary font-label-sm text-label-sm underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                 VOIR L'ARCHIVE
              </button>
            </div>
            <div className="space-y-sm">
              {blockers.isError && (
                <p className="text-body-sm text-error">
                  Les points bloquants sont indisponibles.
                </p>
              )}
              {blockers.data?.length === 0 && (
                <p className="text-body-sm text-on-surface-variant italic">
                  Aucun point bloquant en cours.
                </p>
              )}
              {blockers.data?.map((b) => {
                const critical = b.severity === "critical";
                return (
                  <div
                    key={b.id}
                    className={`${critical ? "accent-bar " : ""}bg-card border border-outline-variant p-sm flex items-start justify-between`}
                  >
                    <div className="flex gap-md">
                      <Icon
                        name={critical ? "error" : "warning"}
                        className={
                          critical
                            ? "text-error mt-1 [font-variation-settings:'FILL'_1]"
                            : "text-secondary mt-1"
                        }
                      />
                      <div>
                        <p className="font-body-md text-primary font-bold">{b.title}</p>
                        <p className="text-body-sm text-on-surface-variant">{b.description}</p>
                        <div className="flex items-center gap-sm mt-xs">
                          <span className="text-[11px] font-label-sm bg-surface-container-highest px-xs py-0.5">
                            {b.department}
                          </span>
                          <span className="text-[11px] font-label-sm text-on-surface-variant">
                            Mis à jour {timeAgo(b.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <select
                      aria-label={`Statut de ${b.title}`}
                      value={b.status}
                      disabled={!isAdmin}
                      onChange={(e) => setBlocker.mutate({ id: b.id, status: e.target.value })}
                      className={`bg-transparent border-none text-xs font-label-sm focus:outline-none cursor-pointer ${critical ? "text-error" : "text-on-surface-variant"}`}
                    >
                      <option>OUVERT</option>
                      <option>EN COURS</option>
                      <option>SURVEILLANCE</option>
                      <option
                        disabled={b.status === "OUVERT"}
                        title={b.status === "OUVERT" ? "Passe d'abord par EN COURS" : undefined}
                      >
                        RÉSOLU
                      </option>
                    </select>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Performance Hub */}
          <section className="col-span-12 md:col-span-5 bg-surface-container-lowest border border-outline-variant p-md flex flex-col">
            <div className="flex items-center justify-between mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary">Indicateurs</h2>
              {isAdmin && <Icon name="settings" className="text-on-surface-variant cursor-pointer" />}
            </div>
            <div className="grid grid-cols-2 gap-sm mb-md">
              <div className="p-sm bg-card border border-outline-variant text-center">
                <p className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                  {metricLabel(metricOf(metrics.data, "training_kpi"), "Taux de placement")}
                </p>
                <p className="font-display text-[32px] text-primary">
                  {formatMetric(metricOf(metrics.data, "training_kpi"), "—")}
                </p>
                <p className="text-[10px] text-on-surface-variant font-label-sm">
                  {trendText(metricOf(metrics.data, "training_kpi"))}
                  {deltaText(metricOf(metrics.data, "training_kpi")) &&
                    ` · ${deltaText(metricOf(metrics.data, "training_kpi"))}`}
                </p>
              </div>
              <div className="p-sm bg-card border border-outline-variant text-center">
                <p className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                  {metricLabel(metricOf(metrics.data, "active_users"), "Missions actives")}
                </p>
                <p className="font-display text-[32px] text-primary">
                  {formatMetric(metricOf(metrics.data, "active_users"), "—")}
                </p>
                <p className="text-[10px] text-on-surface-variant font-label-sm">
                  {trendText(metricOf(metrics.data, "active_users"))}
                  {deltaText(metricOf(metrics.data, "active_users")) &&
                    ` · ${deltaText(metricOf(metrics.data, "active_users"))}`}
                </p>
              </div>
            </div>
            {isAdmin && <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant block">
                MODIFIER LE NPS CANDIDATS
              </label>
              <div className="flex gap-xs">
                <input
                  className="flex-grow bg-card border border-outline-variant p-xs font-label-md focus:outline-none focus:border-primary"
                  type="number"
                  value={nps !== "" ? nps : (npsMetric?.value ?? "")}
                  onChange={(e) => setNps(e.target.value)}
                />
                <button
                  onClick={() =>
                    saveMetric.mutate({
                      key: "nps",
                      value: Number(nps !== "" ? nps : (npsMetric?.value ?? 0)),
                    })
                  }
                  disabled={saveMetric.isPending}
                  className="bg-primary text-on-primary px-sm font-label-md text-label-md disabled:opacity-50"
                >
                  METTRE À JOUR
                </button>
              </div>
              <p className="text-[10px] text-on-surface-variant italic">
                {npsMetric
                  ? `Tendance : ${trendText(npsMetric)}${
                      deltaText(npsMetric) ? ` · ${deltaText(npsMetric)}` : ""
                    }`
                  : "Mis à jour à partir des retours candidats."}
              </p>
            </div>}
            <div className="mt-auto pt-md">
              <img
                src={PERF_IMAGE}
                 alt="Graphiques minimalistes à barres et à lignes dans un tableau de bord anthracite et blanc"
                loading="lazy"
                className="w-full h-24 object-cover border border-outline-variant"
              />
            </div>
          </section>
        </div>
      </main>
      <BlockerArchive open={archiveOpen} onClose={() => setArchiveOpen(false)} />
      <NewsReader news={readingNews} onClose={() => setReadingNews(null)} />
      {editingNews && (
        <Modal
          title={editingNews.status === "brouillon" ? "Reprendre le brouillon" : "Corriger et renvoyer"}
          onClose={() => setEditingNews(null)}
        >
          <NewsEditor
            news={editingNews}
            onDone={() => {
              setEditingNews(null);
              qc.invalidateQueries({ queryKey: ["news"] });
            }}
          />
        </Modal>
      )}
      <SubmissionReader
        submission={reading}
        onClose={() => setReading(null)}
        onReject={reading && canReview && reading.status === "en attente" ? () => startReject(reading) : undefined}
        onApprove={
          reading && canReview && reading.status === "en attente"
            ? () => review.mutate({ id: reading.id, status: "validée" })
            : undefined
        }
        approving={review.isPending}
      />
      {rejecting && (
        <Modal title="Refuser la soumission" onClose={() => setRejecting(null)}>
          <form
            noValidate
            className="space-y-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const res = validate(rejectionSchema, rejectForm);
              if (!res.ok) return setRejectErrors(res.errors);
              setRejectErrors({});
              review.mutate({ id: rejecting.id, status: "refusée", ...res.data });
            }}
          >
            <p className="max-h-48 overflow-y-auto border border-outline-variant bg-surface-container-low p-xs text-body-sm italic text-on-surface-variant whitespace-pre-line wrap-anywhere">“{rejecting.content}”</p>
            <ErrorSummary errors={rejectErrors} />
            <Field label="Motif du refus" error={rejectErrors.rejection_category}>
              <select
                className="w-full border border-outline-variant bg-card p-xs text-body-sm"
                value={rejectForm.rejection_category}
                onChange={(e) => setRejectForm({ ...rejectForm, rejection_category: e.target.value })}
              >
                <option value="">— Choisir un motif —</option>
                {REJECTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Raison du refus (obligatoire)" error={rejectErrors.rejection_note}>
              <TextArea
                rows={4}
                value={rejectForm.rejection_note}
                placeholder="Explique au collaborateur pourquoi sa soumission est refusée…"
                onChange={(e) => setRejectForm({ ...rejectForm, rejection_note: e.target.value })}
              />
              <CharCounter value={rejectForm.rejection_note} max={500} />
            </Field>
            <FormActions pending={review.isPending} onCancel={() => setRejecting(null)} />
          </form>
        </Modal>
      )}
      {submissionForm && (
        <Modal title="Soumettre une proposition" onClose={() => setSubmissionForm(null)}>
          <form onSubmit={sendSubmission} className="space-y-sm" noValidate>
            <ErrorSummary errors={submissionErrors} />
            <Field label="Nom" error={submissionErrors.author_name}>
              <TextInput
                value={submissionForm.author_name}
                maxLength={80}
                placeholder="Ton nom"
                onChange={(e) => setSubmissionForm({ ...submissionForm, author_name: e.target.value })}
              />
            </Field>
            {role === "manager" && (
              <Field label="Équipe" error={submissionErrors.team}>
                <select
                  required
                  value={submissionForm.team}
                  onChange={(e) => setSubmissionForm({ ...submissionForm, team: e.target.value })}
                  className="w-full border border-outline-variant bg-surface px-sm py-xs font-body-md"
                >
                  <option value="">Choisis une de tes équipes</option>
                  {myTeams.data?.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            )}
            {role === "admin" && (
              <p className="text-body-sm text-on-surface-variant">Équipe : Admin</p>
            )}
            <Field label="Proposition" error={submissionErrors.content}>
              <TextArea
                rows={5}
                value={submissionForm.content}
                placeholder="Décris l'amélioration proposée pour le cabinet…"
                onChange={(e) => setSubmissionForm({ ...submissionForm, content: e.target.value })}
              />
              <CharCounter value={submissionForm.content} max={2000} min={5} />
            </Field>
            <Field label="Document PDF (optionnel, 20 Mo max)" error={submissionErrors.attachment}>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="block w-full text-body-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.type !== "application/pdf") {
                    setSubmissionErrors({ ...submissionErrors, attachment: "Seuls les fichiers PDF sont acceptés." });
                    e.target.value = ""; setAttachment(null); return;
                  }
                  if (f && f.size > 20 * 1024 * 1024) {
                    setSubmissionErrors({ ...submissionErrors, attachment: "Le fichier dépasse 20 Mo." });
                    e.target.value = ""; setAttachment(null); return;
                  }
                  const { attachment: _a, ...rest } = submissionErrors;
                  setSubmissionErrors(rest);
                  setAttachment(f);
                }}
              />
            </Field>
            <FormActions
              pending={submit.isPending}
              submitLabel="ENVOYER"
              onCancel={() => setSubmissionForm(null)}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
