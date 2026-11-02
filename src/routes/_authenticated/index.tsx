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
import { NewsReviewPanel } from "@/components/news-review-panel";
import { reviewNews } from "@/lib/news-circuit";
import { DepartureNotices } from "@/components/departure-notices";
import { NewsImage, NewsLinks } from "@/components/news-media";
import { BlockerArchive, ValidatedSubmissions } from "@/components/dashboard-extras";
import { Button } from "@/components/ui/button";
import { StatusBadge, BlockerStatusBadge } from "@/components/status-badge";
import { SEVERITY_LABELS } from "@/components/blocker-duplicates";
import { AudienceBadge } from "@/components/audience-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  setBlockerStatus,
  fetchMyBlockers,
  withdrawBlocker,
  abandonBlocker,
  fetchBlockersIWithdrew,
} from "@/lib/blocker-circuit";
import { BlockerReviewPanel } from "@/components/blocker-review-panel";
import { BlockerResubmitForm } from "@/components/blocker-resubmit-form";
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
  type Blocker,
  reviewSubmission,
  submitIdea,
  timeAgo,
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
          "Pilotez les missions de recrutement IT et digital, les idées des équipes, les alertes opérationnelles et les indicateurs du cabinet.",
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
  // D26 : l'admin ne valide ni ne refuse rien (seuls les managers relisent les soumissions).
  const canReview = role === "manager";
  const myEmail = (email ?? "").toLowerCase();
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
  const [reviewingNews, setReviewingNews] = useState<News | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectForm, setRejectForm] = useState({ rejection_category: "", rejection_note: "" });
  const [rejectErrors, setRejectErrors] = useState<FieldErrors>({});
  const [withdrawingBlocker, setWithdrawingBlocker] = useState<Blocker | null>(null);
  const [editingBlocker, setEditingBlocker] = useState<Blocker | null>(null);
  const [abandoningId, setAbandoningId] = useState<string | null>(null);

  const news = useQuery({ queryKey: ["news"], queryFn: fetchNews, retry: false });
  // Flow 2-7 : seul le manager traite les idées en attente (RLS can_review_team les
  // limite déjà à ses propres équipes) ; inutile d'interroger pour les autres rôles.
  const submissions = useQuery({
    queryKey: ["submissions"],
    queryFn: fetchSubmissions,
    enabled: role === "manager",
    retry: false,
  });
  const mine = useQuery({
    queryKey: ["submissions", "mine", email],
    queryFn: () => fetchMySubmissions(email ?? ""),
    enabled: !!email && !isAdmin,
    retry: false,
  });
  const blockers = useQuery({ queryKey: ["blockers"], queryFn: fetchBlockers, retry: false });
  // Mes points bloquants : l'admin n'a aucun contenu à lui (D26), voir "Mes actus"/"Mes idées".
  const myBlockers = useQuery({
    queryKey: ["blockers", "mine", email],
    queryFn: () => fetchMyBlockers(email ?? ""),
    enabled: !!email && !isAdmin,
    retry: false,
  });
  // "Points retirés" (D85) : trace en lecture seule, pour le manager qui a retiré.
  const withdrawnByMe = useQuery({
    queryKey: ["blockers", "withdrawn-by-me", email],
    queryFn: () => fetchBlockersIWithdrew(email ?? ""),
    enabled: role === "manager" && !!email,
    retry: false,
  });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics, retry: false });
  // Noms d'équipe existants : permet de reproduire côté UI la règle de set_blocker_status
  // ("l'admin agit seulement si le pôle du point ne correspond à aucune équipe").
  const teamNames = useQuery({
    queryKey: ["teams", "names"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("name");
      if (error) throw error;
      return (data ?? []).map((t) => t.name.toLowerCase());
    },
  });
  const onError = (e: unknown) => toast.error((e as Error).message);

  function canAdvanceBlocker(department: string) {
    const dept = department.trim().toLowerCase();
    if (role === "manager") return (myTeams.data ?? []).some((t) => t.toLowerCase() === dept);
    if (isAdmin) return !(teamNames.data ?? []).includes(dept);
    return false;
  }

  // Flow 2-8 (R8) : contrôle après coup, réservé au manager de l'équipe de
  // l'AUTEUR (team), pas du pôle responsable (department) — withdraw_blocker
  // refuse de toute façon si l'auteur n'est pas un collaborateur ou si le point
  // n'est pas publié, voir le message d'erreur renvoyé par la base.
  function canWithdrawBlocker(b: Blocker) {
    return (
      role === "manager" &&
      !!b.team &&
      (myTeams.data ?? []).some((t) => t.toLowerCase() === (b.team ?? "").toLowerCase()) &&
      (b.statut_publication ?? "publiée") === "publiée"
    );
  }

  const exportReport = useMutation({
    mutationFn: () => {
      if (!email) throw new Error("Votre adresse e-mail est indisponible.");
      return exportMyRecentSubmissions(email);
    },
    onSuccess: (count) => {
      if (count === 0) {
        toast.info("Aucune idée en attente ou validée sur les 30 derniers jours.");
        return;
      }
      toast.success(`${count} idée${count > 1 ? "s" : ""} exportée${count > 1 ? "s" : ""} au format CSV.`);
    },
    onError,
  });

  const review = useMutation({
    mutationFn: reviewSubmission,
    onSuccess: (_d, vars) => {
      if (vars.status === "refusée") {
        setRejecting(null);
        toast.success("Idée refusée");
      } else {
        setReading((r) => (r?.id === vars.id ? null : r));
      }
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e: unknown) => toast.error(rejectionErrorMessage(e)),
  });

  const reviewNewsMutation = useMutation({
    mutationFn: reviewNews,
    onSuccess: () => {
      setReviewingNews(null);
      qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
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
      toast.success("Idée envoyée");
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e: unknown) => toast.error(rejectionErrorMessage(e)),
  });

  const setBlocker = useMutation({
    mutationFn: setBlockerStatus,
    onSuccess: () => {
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["blockers"] });
    },
    onError,
  });

  const withdraw = useMutation({
    mutationFn: withdrawBlocker,
    onSuccess: () => {
      toast.success("Point retiré, l'auteur est notifié.");
      setWithdrawingBlocker(null);
      qc.invalidateQueries({ queryKey: ["blockers"] });
    },
    onError,
  });

  const abandon = useMutation({
    mutationFn: abandonBlocker,
    onSuccess: () => {
      toast.success("Point abandonné.");
      setAbandoningId(null);
      qc.invalidateQueries({ queryKey: ["blockers"] });
    },
    onError,
  });

  const published = news.data?.filter((n) => n.status === "publiée") ?? [];
  const myNews = news.data?.filter((n) => (n.author_email ?? "").toLowerCase() === myEmail) ?? [];
  // "a_modifier_manager" n'est pas dans cette file : c'est à l'auteur de corriger, pas à Marc de redécider.
  const managerQueue = role === "manager" ? news.data?.filter((n) => n.status === "a_valider_manager") ?? [] : [];
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
          {/* ============================= ACTUS ============================= */}
          <div className="col-span-12 flex flex-wrap items-center justify-between gap-sm">
            <h2 className="font-headline-lg text-headline-lg text-primary">Actus</h2>
            {isAdmin ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex w-56 shrink-0 cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                      <Icon name="article" className="text-on-surface-variant" />
                      <span className="font-headline-sm text-headline-sm text-primary">Actus</span>
                      <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Nouvelle actu</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Le compte admin ne publie pas d'actu.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Link
                to="/nouvelle-actu"
                className="flex w-56 shrink-0 flex-col gap-xs border-2 border-primary bg-surface-container-lowest p-sm hover:bg-surface-container"
              >
                <Icon name="article" className="text-primary" />
                <span className="font-headline-sm text-headline-sm text-primary">Actus</span>
                <span className="font-label-sm text-label-sm uppercase text-primary">+ Nouvelle actu</span>
              </Link>
            )}
          </div>

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

          {/* Mes actus : l'admin n'a aucun contenu à lui (D26) */}
          {!isAdmin && (
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
          )}

          {/* ========================= BOÎTE À IDÉES ========================= */}
          <div className="col-span-12 flex flex-wrap items-center justify-between gap-sm">
            <h2 className="font-headline-lg text-headline-lg text-primary">Boîte à idées</h2>
            {isAdmin ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex w-56 shrink-0 cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                      <Icon name="lightbulb" className="text-on-surface-variant" />
                      <span className="font-headline-sm text-headline-sm text-primary">Boîte à idées</span>
                      <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Proposer une idée</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Le compte admin ne publie pas d'idée.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSubmissionErrors({});
                  const only = role === "manager" && myTeams.data?.length === 1 ? myTeams.data[0] : "";
                  setSubmissionForm({ author_name: "", team: only, content: "", status: "en attente" });
                }}
                className="flex w-56 shrink-0 flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm text-left hover:border-primary"
              >
                <Icon name="lightbulb" className="text-on-surface-variant" />
                <span className="font-headline-sm text-headline-sm text-primary">Boîte à idées</span>
                <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Proposer une idée</span>
              </button>
            )}
          </div>

          {/* Idées de mon équipe à traiter (flow 2-7 : seul le manager de l'équipe traite) */}
          {role === "manager" && (
          <section className="col-span-12 lg:col-span-6 min-w-0 bg-surface-container-lowest border border-outline-variant p-md flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-xs border-b border-outline-variant pb-sm mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary min-w-0">
                Idées de mon équipe à traiter
              </h2>
              <div className="shrink-0 bg-tertiary-fixed text-on-tertiary-fixed px-xs py-1 rounded-full font-label-sm text-label-sm uppercase">
                {submissions.data?.length ?? 0} nouvelle{(submissions.data?.length ?? 0) === 1 ? "" : "s"}
              </div>
            </div>
            <div className="space-y-sm flex-grow min-w-0">
              {managerQueue.length > 0 && (
                <div className="space-y-xs border-b border-outline-variant pb-sm mb-xs">
                  <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Actus à valider</p>
                  {managerQueue.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setReviewingNews(n)}
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
              )}
              {submissions.isError && (
                <p className="text-body-sm text-error">
                  Les idées sont indisponibles.
                </p>
              )}
              {submissions.data?.length === 0 && (
                <p className="text-body-sm text-on-surface-variant italic">
                  Aucune idée en attente.
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
          )}

          {/* Idées validées, côte à côte avec la file à traiter pour le manager seulement */}
          {role === "manager" && (
            <ValidatedSubmissions
              role={role}
              email={myEmail}
              managerTeams={myTeams.data ?? []}
              onRead={setReading}
              className="col-span-12 lg:col-span-6"
            />
          )}

          {/* Mes idées : l'admin n'a aucun contenu à lui (D26) */}
          {!isAdmin && mine.data && mine.data.length > 0 && (
            <section className="col-span-12 min-w-0 bg-surface-container-lowest border border-outline-variant p-md">
              <h2 className="font-headline-sm text-headline-sm text-primary border-b border-outline-variant pb-sm mb-md">
                Mes idées
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

          {/* Idées validées : dernier bloc du module Boîte à idées (déjà affichée plus haut,
              côte à côte, pour le manager : voir juste après "Idées de mon équipe à traiter") */}
          {role !== "manager" && (
            <ValidatedSubmissions
              role={role}
              email={myEmail}
              managerTeams={myTeams.data ?? []}
              onRead={setReading}
            />
          )}

          {/* ======================= POINTS BLOQUANTS ======================= */}
          <div className="col-span-12 flex flex-wrap items-center justify-between gap-sm">
            <h2 className="font-headline-lg text-headline-lg text-primary">Points bloquants</h2>
            {isAdmin ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex w-56 shrink-0 cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                      <Icon name="report" className="text-on-surface-variant" />
                      <span className="font-headline-sm text-headline-sm text-primary">Points bloquants</span>
                      <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Point bloquant</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Les admins ne signalent pas de point bloquant.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Link
                to="/nouveau-point-bloquant"
                className="flex w-56 shrink-0 flex-col gap-xs border-2 border-primary bg-surface-container-lowest p-sm hover:bg-surface-container"
              >
                <Icon name="report" className="text-primary" />
                <span className="font-headline-sm text-headline-sm text-primary">Points bloquants</span>
                <span className="font-label-sm text-label-sm uppercase text-primary">+ Point bloquant</span>
              </Link>
            )}
          </div>

          {/* Points Bloquants (liste principale) */}
          <section className="col-span-12 bg-surface-container-lowest border border-outline-variant p-md">
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
                const canAdvance = canAdvanceBlocker(b.department);
                return (
                  <div
                    key={b.id}
                    className={`${critical ? "accent-bar " : ""}bg-card border border-outline-variant p-sm grid grid-cols-[minmax(0,1fr)_200px_100px] gap-md items-start`}
                  >
                    {/* Colonne 1 (flexible) : titre, description, pôle, gravité, date */}
                    <div className="flex gap-md min-w-0">
                      <Icon
                        name={critical ? "error" : "warning"}
                        className={
                          critical
                            ? "text-error mt-1 [font-variation-settings:'FILL'_1]"
                            : "text-secondary mt-1"
                        }
                      />
                      <div className="min-w-0">
                        <p className="font-body-md text-primary font-bold wrap-anywhere">{b.title}</p>
                        <p className="text-body-sm text-on-surface-variant wrap-anywhere">{b.description}</p>
                        <div className="flex items-center gap-sm mt-xs flex-wrap">
                          <span className="text-[11px] font-label-sm bg-surface-container-highest px-xs py-0.5">
                            {b.department}
                          </span>
                          <span className="text-[11px] font-label-sm text-on-surface-variant">
                            {SEVERITY_LABELS[b.severity] ?? b.severity}
                          </span>
                          <span className="text-[11px] font-label-sm text-on-surface-variant">
                            Mis à jour {timeAgo(b.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Colonne 2 (largeur fixe, alignée à gauche) : statut de traitement */}
                    <div className="flex flex-col items-start gap-1 min-w-0">
                      {canAdvance ? (
                        <select
                          aria-label={`Statut de ${b.title}`}
                          value={b.status}
                          disabled={setBlocker.isPending}
                          onChange={(e) => setBlocker.mutate({ id: b.id, status: e.target.value })}
                          className={`bg-transparent border-none text-xs font-label-sm focus:outline-none cursor-pointer disabled:opacity-50 ${critical ? "text-error" : "text-on-surface-variant"}`}
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
                      ) : (
                        <>
                          <BlockerStatusBadge status={b.status} />
                          <p className="font-label-sm text-label-sm text-on-surface-variant">
                            Seuls les managers du pôle responsable font avancer ce point.
                          </p>
                        </>
                      )}
                    </div>
                    {/* Colonne 3 (largeur fixe, alignée à droite) : action, ou cellule vide */}
                    <div className="flex justify-end">
                      {canWithdrawBlocker(b) && (
                        <button
                          type="button"
                          onClick={() => setWithdrawingBlocker(b)}
                          className="shrink-0 font-label-sm text-label-sm text-error underline"
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Mes points bloquants : l'admin n'a aucun contenu à lui (D26) */}
          {!isAdmin && myBlockers.data && myBlockers.data.length > 0 && (
            <section className="col-span-12 min-w-0 bg-surface-container-lowest border border-outline-variant p-md">
              <h2 className="font-headline-sm text-headline-sm text-primary border-b border-outline-variant pb-sm mb-md">
                Mes points bloquants
              </h2>
              <div className="space-y-xs">
                {myBlockers.data.map((b) => {
                  const needsFix = b.statut_publication === "a_modifier_manager";
                  return (
                    <div key={b.id} className="p-sm border border-outline-variant bg-card min-w-0 overflow-hidden space-y-xs">
                      <div className="flex items-center justify-between gap-sm min-w-0">
                        <p className="font-body-md text-primary wrap-anywhere">{b.title}</p>
                        <StatusBadge status={b.statut_publication ?? "publiée"} className="shrink-0" />
                      </div>
                      <p className="text-[11px] font-label-sm text-on-surface-variant uppercase">
                        {b.department} • {timeAgo(b.updated_at)}
                      </p>
                      {needsFix && b.pub_review_note && (
                        <div className="p-xs bg-error-container text-on-error-container text-body-sm wrap-anywhere">
                          <p className="whitespace-pre-line">{b.pub_review_note}</p>
                        </div>
                      )}
                      {needsFix && b.withdraw_reminder_at && (
                        <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">
                          Rappel envoyé {timeAgo(b.withdraw_reminder_at)}
                        </p>
                      )}
                      {needsFix && abandoningId !== b.id && (
                        <div className="flex gap-sm">
                          <button
                            type="button"
                            onClick={() => setEditingBlocker(b)}
                            className="font-label-sm text-label-sm uppercase text-primary underline"
                          >
                            Corriger et renvoyer
                          </button>
                          <button
                            type="button"
                            onClick={() => setAbandoningId(b.id)}
                            className="font-label-sm text-label-sm uppercase text-error underline"
                          >
                            Abandonner le point
                          </button>
                        </div>
                      )}
                      {needsFix && abandoningId === b.id && (
                        <div className="space-y-xs border border-error/40 bg-error-container/20 p-sm">
                          <p className="font-body-sm text-body-sm font-bold text-error">
                            Cette action est définitive. Le point sera clôturé et ne pourra pas être rouvert.
                          </p>
                          <div className="flex gap-xs">
                            <button
                              type="button"
                              onClick={() => setAbandoningId(null)}
                              className="px-md py-xs border border-outline text-primary font-label-md text-label-md hover:bg-surface-container"
                            >
                              Annuler
                            </button>
                            <button
                              type="button"
                              disabled={abandon.isPending}
                              onClick={() => abandon.mutate(b.id)}
                              className="px-md py-xs bg-error text-on-error font-label-md text-label-md disabled:opacity-50"
                            >
                              Confirmer l'abandon
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Points retirés (D85) : trace en lecture seule pour le manager qui a retiré. */}
          {role === "manager" && withdrawnByMe.data && withdrawnByMe.data.length > 0 && (
            <section className="col-span-12 min-w-0 bg-surface-container-lowest border border-outline-variant p-md">
              <h2 className="font-headline-sm text-headline-sm text-primary border-b border-outline-variant pb-sm mb-md">
                Points retirés
              </h2>
              <div className="space-y-xs">
                {withdrawnByMe.data.map((r) => (
                  <div key={r.content_id} className="p-sm border border-outline-variant bg-card min-w-0 overflow-hidden space-y-xs">
                    <div className="flex items-center justify-between gap-sm min-w-0">
                      <p className="font-body-md text-primary wrap-anywhere">{r.title}</p>
                      {r.current_status === "abandonnée" ? (
                        <span className="inline-flex items-center rounded-sm px-xs py-0.5 font-label-sm text-label-sm uppercase tracking-wide bg-surface-container-high text-on-surface-variant shrink-0">
                          Abandonné par l'auteur
                        </span>
                      ) : (
                        <StatusBadge status={r.current_status} className="shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] font-label-sm text-on-surface-variant uppercase">
                      {r.department} • Retiré {timeAgo(r.changed_at)}
                    </p>
                    {r.note && (
                      <p className="text-body-sm text-on-surface-variant italic wrap-anywhere">« {r.note} »</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ========================== INDICATEURS ========================== */}
          <div className="col-span-12 flex flex-wrap items-center justify-between gap-sm">
            <h2 className="font-headline-lg text-headline-lg text-primary">Indicateurs</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex w-56 shrink-0 cursor-not-allowed flex-col gap-xs border border-outline-variant bg-surface-container-lowest p-sm opacity-50">
                    <Icon name="bar_chart" className="text-on-surface-variant" />
                    <span className="font-headline-sm text-headline-sm text-primary">Indicateurs</span>
                    <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">+ Indicateur</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Bientôt disponible</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Performance Hub */}
          <section className="col-span-12 bg-surface-container-lowest border border-outline-variant p-md flex flex-col">
            <div className="flex items-center justify-between mb-md">
              <h2 className="font-headline-sm text-headline-sm text-primary">Indicateurs</h2>
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
            {isAdmin && (
              <div className="space-y-xs">
                <p className="font-label-sm text-label-sm text-on-surface-variant block">NPS CANDIDATS</p>
                <p className="font-display text-[28px] text-primary">{formatMetric(npsMetric, "—")}</p>
                <p className="text-[10px] text-on-surface-variant italic">
                  {npsMetric
                    ? `Tendance : ${trendText(npsMetric)}${
                        deltaText(npsMetric) ? ` · ${deltaText(npsMetric)}` : ""
                      }`
                    : "Mis à jour à partir des retours candidats."}
                </p>
              </div>
            )}
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
      <NewsReviewPanel
        news={reviewingNews}
        circuitLabel={reviewingNews?.audience === "tout_le_cabinet" ? "Valider et transmettre à la Comm" : "Valider et publier"}
        isSelfAuthor={(reviewingNews?.author_email ?? "").toLowerCase() === myEmail}
        pending={reviewNewsMutation.isPending}
        onReview={(decision, category, note) =>
          reviewingNews && reviewNewsMutation.mutate({ id: reviewingNews.id, decision, category, note })
        }
        onClose={() => setReviewingNews(null)}
      />
      <BlockerReviewPanel
        blocker={withdrawingBlocker}
        pending={withdraw.isPending}
        onWithdraw={(note) => withdrawingBlocker && withdraw.mutate({ id: withdrawingBlocker.id, note })}
        onClose={() => setWithdrawingBlocker(null)}
      />
      {editingBlocker && (
        <Modal title="Corriger et renvoyer" onClose={() => setEditingBlocker(null)}>
          <BlockerResubmitForm
            blocker={editingBlocker}
            onDone={() => {
              setEditingBlocker(null);
              qc.invalidateQueries({ queryKey: ["blockers"] });
            }}
          />
        </Modal>
      )}
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
        <Modal title="Refuser l'idée" onClose={() => setRejecting(null)}>
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
                placeholder="Explique au collaborateur pourquoi son idée est refusée…"
                onChange={(e) => setRejectForm({ ...rejectForm, rejection_note: e.target.value })}
              />
              <CharCounter value={rejectForm.rejection_note} max={500} />
            </Field>
            <FormActions pending={review.isPending} onCancel={() => setRejecting(null)} />
          </form>
        </Modal>
      )}
      {submissionForm && (
        <Modal title="Proposer une idée" onClose={() => setSubmissionForm(null)}>
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
            <Field label="Idée" error={submissionErrors.content}>
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
