import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { Field } from "@/components/manage/crud-ui";
import { CircuitStepper, type CircuitStep } from "@/components/circuit-stepper";
import { BlockerDuplicates } from "@/components/blocker-duplicates";
import { getCircuit, type CircuitAudience } from "@/lib/circuit";
import { fetchMyManagedTeams, fetchMyManagerName } from "@/lib/news-circuit";
import { blockerCreateSchema, validate, type FieldErrors } from "@/lib/manage-schemas";
import {
  createBlockerReport,
  fetchBlockerDuplicates,
  fetchBlockerFollowerCounts,
  fetchTools,
  followBlocker,
  followerCountLabel,
} from "@/lib/blocker-circuit";
import type { Blocker } from "@/lib/dashboard";

export const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critique", hint: "Bloque le travail d'une équipe ou un flux majeur" },
  { value: "warning", label: "Avertissement", hint: "Gêne le travail quotidien mais contournement possible" },
  { value: "info", label: "Info", hint: "Remarque mineure ou question de configuration" },
] as const;

function buildSteps(roleAuteur: "collaborateur" | "manager", managerName: string | null): CircuitStep[] {
  if (roleAuteur === "manager") {
    return [{ label: "Toi", state: "done" }, { label: "Publié", state: "current" }];
  }
  return [
    { label: "Toi", state: "done" },
    { label: "Publié", state: "current" },
    { label: managerName ?? "Manager", state: "todo" },
  ];
}

export function BlockerEditor({ onDone }: { onDone: () => void }) {
  const { role, email } = useRouteContext({ from: "/_authenticated" });
  const roleAuteur = role === "manager" ? "manager" : "collaborateur";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tool, setTool] = useState("");
  const [severity, setSeverity] = useState<"critical" | "warning" | "info" | "">("");
  const [audience, setAudience] = useState("mon_equipe");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const [view, setView] = useState<"form" | "duplicates">("form");
  const [duplicates, setDuplicates] = useState<Blocker[]>([]);
  const [followerCounts, setFollowerCounts] = useState<Map<string, number>>(new Map());
  const [pendingDepartment, setPendingDepartment] = useState<string | null>(null);
  const [followingId, setFollowingId] = useState<string | null>(null);

  const tools = useQuery({ queryKey: ["tools"], queryFn: fetchTools, staleTime: 5 * 60 * 1000 });

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

  const needsTeamChoice = roleAuteur === "manager" && audience === "mon_equipe" && (managedTeams.data?.length ?? 0) > 1;
  const [emittingTeam, setEmittingTeam] = useState("");
  if (needsTeamChoice && !emittingTeam && managedTeams.data?.[0]) {
    setEmittingTeam(managedTeams.data[0]);
  }

  const circuitAudience: CircuitAudience = audience === "tout_le_cabinet" ? "plusieurs_equipes" : "mon_equipe";
  const circuit = getCircuit("point_bloquant", circuitAudience, roleAuteur);
  const steps = buildSteps(roleAuteur, managerName.data ?? null);

  async function doCreate(department: string) {
    setPending(true);
    try {
      await createBlockerReport({
        title: title.trim(),
        description: description.trim(),
        department,
        severity: severity as "critical" | "warning" | "info",
        audience,
        ...(needsTeamChoice ? { team: emittingTeam } : {}),
      });
      toast.success(circuit.announcement);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function handleSignal() {
    const result = validate(blockerCreateSchema, {
      title,
      description,
      tool,
      severity: severity || undefined,
      audience,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const selected = tools.data?.find((t) => t.name === result.data.tool);
    const department = selected?.department ?? result.data.tool;

    setPending(true);
    try {
      const dups = await fetchBlockerDuplicates(department);
      if (dups.length > 0) {
        setDuplicates(dups);
        setFollowerCounts(await fetchBlockerFollowerCounts());
        setPendingDepartment(department);
        setView("duplicates");
        return;
      }
      await doCreate(department);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function handleFollow(id: string) {
    setFollowingId(id);
    try {
      const n = await followBlocker(id);
      toast.success(`Tu suis ce point · ${followerCountLabel(n)}.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFollowingId(null);
    }
  }

  if (view === "duplicates") {
    return (
      <BlockerDuplicates
        duplicates={duplicates}
        followerCounts={followerCounts}
        followingId={followingId}
        onFollow={handleFollow}
        onBack={() => setView("form")}
        creating={pending}
        onCreateAnyway={() => pendingDepartment && doCreate(pendingDepartment)}
      />
    );
  }

  return (
    <form className="space-y-md" onSubmit={(e) => e.preventDefault()} noValidate>
      <Field label="Titre du blocage" error={errors.title}>
        <input
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex. Le CRM ne synchronise plus les CV depuis ce matin"
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <Field label="Description détaillée (facultatif)" error={errors.description}>
        <textarea
          value={description}
          rows={4}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Décris l'impact concret sur ton activité…"
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        />
      </Field>

      <Field label="Outil ou pôle concerné" error={errors.tool}>
        <select
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          className="w-full bg-card border border-outline-variant p-sm font-body-md text-on-surface focus:outline-none focus:border-primary"
        >
          <option value="">Sélectionner un outil…</option>
          {tools.data?.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="space-y-xs">
        <legend className="font-label-sm text-label-sm uppercase text-on-surface-variant">Niveau de gravité</legend>
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
          {SEVERITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex flex-col gap-xs border p-sm cursor-pointer ${
                severity === opt.value ? "border-primary bg-surface-container" : "border-outline-variant"
              }`}
            >
              <input
                type="radio"
                name="severity"
                className="sr-only"
                checked={severity === opt.value}
                onChange={() => setSeverity(opt.value)}
              />
              <span className="font-label-md text-label-md uppercase text-primary">{opt.label}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{opt.hint}</span>
            </label>
          ))}
        </div>
        {errors.severity && (
          <p role="alert" className="text-body-sm text-error">
            {errors.severity}
          </p>
        )}
      </fieldset>

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
        <button
          type="button"
          disabled={pending}
          onClick={handleSignal}
          className="px-md py-xs bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
        >
          {pending ? "Envoi…" : "Signaler"}
        </button>
      </div>
    </form>
  );
}
