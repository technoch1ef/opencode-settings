/**
 * OpenCode Village Plugin
 *
 * Enables a lightweight "Agentic Village" workflow.
 *
 * Features:
 * - Injects BD_ACTOR environment variable based on current agent
 * - Provides tools: village_claim, village_scaffold, village_orphans, village_status
 * - Monitors village session errors and status transitions
 */

import { tool, type Plugin } from "@opencode-ai/plugin";

import { execFile } from "node:child_process";

import {
  compareBrIssuesDeterministic,
  fixShellSnippetNewlines,
  guardSingleInProgress,
  inferAssigneeFromText,
  selectDeterministicReady,
  type BrIssue,
} from "./lib/shared";

// Agent name to BD_ACTOR mapping
const AGENT_TO_ACTOR: Record<string, string> = {
  mayor: "mayor",
  worker: "worker",
  overseer: "overseer",
};


function formatIssueLine(issue: BrIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim();
  const status = (issue.status ?? "").trim();
  return `${id} | ${title || "(no title)"} | ${status || "(no status)"}`;
}

function formatOrphansRow(issue: BrIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim() || "(no title)";
  const status = (issue.status ?? "").trim() || "(no status)";
  const assignee = (issue.assignee ?? "").trim() || "(unassigned)";
  return `${id} | ${title} | ${status} | ${assignee}`;
}

async function execFileText(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 5 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            `Command failed: ${[file, ...args].join(" ")}\n${String(stderr || stdout).slice(0, 2000)}`
          );
          (e as any).cause = err;
          (e as any).stdout = stdout;
          (e as any).stderr = stderr;
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

async function execBrJson<T>(
  args: string[],
  options: {
    cwd?: string;
    actor?: string;
  }
): Promise<T> {
  const env = {
    ...process.env,
    ...(options.actor ? { BD_ACTOR: options.actor } : {}),
  } as Record<string, string | undefined>;

  const { stdout } = await execFileText("br", args, { cwd: options.cwd, env });

  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from: br ${args.join(" ")}\n` +
        `Output: ${stdout.slice(0, 2000)}`
    );
  }
}

function firstBrIssue(value: unknown): BrIssue | undefined {
  if (Array.isArray(value)) return value.length ? firstBrIssue(value[0]) : undefined;
  if (!value || typeof value !== "object") return undefined;
  const v = value as any;
  if (typeof v.id !== "string") return undefined;
  return v as BrIssue;
}

/**
 * Detect if a body string already contains structured markdown sections
 * (e.g. `## Context`, `## Skills`). When true, the body should be used
 * directly as the bead description — no wrapping via renderScaffoldDescription.
 */
function isStructuredBody(body: string | undefined): boolean {
  if (!body) return false;
  return /^## (Context|Skills)/m.test(body);
}

function renderScaffoldDescription(args: {
  context?: string;
  branch: string;
  skills: string[];
  acceptance?: string;
  notes?: string;
}): string {
  const skills = args.skills.filter(Boolean);

  const lines: string[] = [];
  lines.push("## Context", "", (args.context ?? "").trim() || "(fill in)", "");
  lines.push("## Skills", "");
  if (skills.length) {
    for (const s of skills) lines.push(`- ${s}`);
  } else {
    lines.push("- (fill in)");
  }
  lines.push("");

  lines.push("## Branch", "", `\`${args.branch}\``, "");

  lines.push("## Acceptance Criteria", "");
  const acceptance = (args.acceptance ?? "").trim();
  if (acceptance) {
    lines.push(acceptance);
  } else {
    lines.push("- [ ] (fill in)");
  }
  lines.push("");

  lines.push("## Notes", "", (args.notes ?? "").trim() || "(none)");

  return lines.join("\n");
}

type SessionSummary = {
  id: string;
  title: string;
};

function isVillageSessionTitle(title: unknown): title is string {
  return (
    typeof title === "string" &&
    (title.startsWith("village-worker-") || title.startsWith("village-overseer"))
  );
}

const VillagePlugin: Plugin = async ({ client }) => {
  // Track dedupe keys for village session notifications
  const seenErrorKeys = new Set<string>();
  const lastVillageStatus = new Map<string, string>();

  async function getSession(id: string) {
    const res = await client.session.get({ path: { id } });
    return res.data as any;
  }

  async function getVillageSessionSummary(sessionID: string): Promise<SessionSummary | null> {
    try {
      const session = await getSession(sessionID);
      if (!isVillageSessionTitle(session?.title)) return null;
      return { id: sessionID, title: session.title };
    } catch {
      return null;
    }
  }

  async function showVillageToast(args: {
    sessionID: string;
    title: string;
    message: string;
    variant: "info" | "warning" | "success" | "error";
    duration: number;
  }) {
    try {
      const session = await getSession(args.sessionID);
      const directory =
        typeof session?.directory === "string"
          ? session.directory
          : typeof session?.cwd === "string"
            ? session.cwd
            : undefined;
      if (!directory) return;
      await client.tui.showToast({
        query: { directory },
        body: {
          title: args.title,
          message: args.message,
          variant: args.variant,
          duration: args.duration,
        },
      });
    } catch {
      // Non-critical UX signal.
    }
  }

  async function getRootSessionID(sessionID: string) {
    let cur = sessionID;
    for (let i = 0; i < 25; i++) {
      const session = await getSession(cur);
      const parentID = session?.parentID as string | undefined;
      if (!parentID) return cur;
      cur = parentID;
    }
    return cur;
  }

  async function listVillageSessions(rootID: string): Promise<{
    workers: SessionSummary[];
    overseers: SessionSummary[];
  }> {
    const childrenRes = await client.session.children({ path: { id: rootID } });
    const children = (childrenRes.data || []) as any[];

    const workers = children
      .filter((s) => typeof s?.title === "string" && s.title.startsWith("village-worker-"))
      .map((s) => ({ id: String(s.id), title: String(s.title) }))
      .filter((s) => s.id);

    const overseers = children
      .filter((s) => typeof s?.title === "string" && s.title.startsWith("village-overseer"))
      .map((s) => ({ id: String(s.id), title: String(s.title) }))
      .filter((s) => s.id);

    return { workers, overseers };
  }

  function formatSessionList(label: string, sessions: SessionSummary[]): string {
    if (!sessions.length) return `${label}: (none)`;
    return `${label}: ${sessions.map((s) => `${s.title} (${s.id})`).join(", ")}`;
  }

  return {
    // Inject BD_ACTOR based on current agent
    "shell.env": async (input, output) => {
      // The agent name comes from the current session's agent setting
      const agent = (input as any).agent;
      if (agent && AGENT_TO_ACTOR[agent]) {
        output.env.BD_ACTOR = AGENT_TO_ACTOR[agent];
      }
    },

    "experimental.text.complete": async (_input, output) => {
      const fixed = fixShellSnippetNewlines(output.text);
      if (typeof fixed === "string") output.text = fixed;
    },

    tool: {
      village_claim: tool({
        description:
          "Deterministically claim the next ready bead for worker/overseer, enforcing a single in_progress bead per assignee.",
        args: {
          assignee: tool.schema.enum(["worker", "overseer"] as const).optional(),
          directory: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;

          const session = await getSession(context.sessionID);
          const sessionAgent = (session as any)?.agent as string | undefined;

          const assignee =
            args.assignee ??
            (sessionAgent === "worker" || sessionAgent === "overseer" ? sessionAgent : undefined);
          if (assignee !== "worker" && assignee !== "overseer") {
            throw new Error(
              `village_claim requires assignee=worker|overseer (session agent: ${sessionAgent ?? "unknown"})`
            );
          }

          const inProgress = (await execBrJson<BrIssue[]>(
            ["list", "--status", "in_progress", "--assignee", assignee, "--json"],
            { cwd: directory, actor: assignee }
          )) as BrIssue[];

          const guard = guardSingleInProgress(inProgress);
          if (guard.kind === "existing") {
            return `existing in_progress: ${formatIssueLine(guard.issue)}`;
          }

          if (guard.kind === "multiple") {
            const lines = guard.issues.map((i) => `- ${formatIssueLine(i)}`);
            throw new Error(
              `Multiple in_progress beads for ${assignee}; refusing to claim a new one.\n` +
                lines.join("\n")
            );
          }

          const ready = (await execBrJson<BrIssue[]>(
            ["ready", "--assignee", assignee, "--json"],
            { cwd: directory, actor: assignee }
          )) as BrIssue[];

          const selected = selectDeterministicReady(ready);
          if (!selected) return `no ready beads for ${assignee}`;
          if (!selected.id) throw new Error("br ready returned an item without an id");

          const selectedAssignee = (selected.assignee ?? "").trim();
          if (selectedAssignee) {
            // Most village beads are pre-assigned; `br update --claim` fails for already-assigned issues.
            if (selectedAssignee !== assignee) {
              throw new Error(
                `br ready returned ${selected.id} assigned to ${selectedAssignee}; expected ${assignee}`
              );
            }

            const out = await execBrJson<BrIssue[]>(
              ["update", selected.id, "--assignee", assignee, "--status", "in_progress", "--json"],
              { cwd: directory, actor: assignee }
            );
            const updated = Array.isArray(out) ? out[0] : undefined;
            const claimed = updated ?? { ...selected, status: "in_progress", assignee };
            return `claimed: ${formatIssueLine(claimed)}`;
          }

          const updateArgsWithClaim = [
            "update",
            selected.id,
            "--claim",
            "--assignee",
            assignee,
            "--status",
            "in_progress",
            "--json",
          ];

          let updated: BrIssue | undefined;
          try {
            const out = await execBrJson<BrIssue[]>(updateArgsWithClaim, {
              cwd: directory,
              actor: assignee,
            });
            updated = Array.isArray(out) ? out[0] : undefined;
          } catch (err: any) {
            const stderr = String((err as any)?.stderr ?? "");
            const stdout = String((err as any)?.stdout ?? "");
            const text = `${stderr}\n${stdout}`.toLowerCase();

            // Back-compat: older br may not support --claim.
            if (text.includes("--claim") && (text.includes("unknown") || text.includes("flag"))) {
              const fallback = await execBrJson<BrIssue[]>(
                [
                  "update",
                  selected.id,
                  "--assignee",
                  assignee,
                  "--status",
                  "in_progress",
                  "--json",
                ],
                { cwd: directory, actor: assignee }
              );
              updated = Array.isArray(fallback) ? fallback[0] : undefined;
            } else if (text.includes("already claimed")) {
              // Race-safe: if another session claimed it first, only proceed if it's claimed by our assignee.
              const shown = await execBrJson<BrIssue[]>(["show", selected.id, "--json"], {
                cwd: directory,
                actor: assignee,
              });
              const current = Array.isArray(shown) ? shown[0] : undefined;
              const currentAssignee = (current?.assignee ?? "").trim();
              if (currentAssignee && currentAssignee !== assignee) {
                throw new Error(
                  `br update --claim failed: ${selected.id} already claimed by ${currentAssignee}`
                );
              }

              const fallback = await execBrJson<BrIssue[]>(
                [
                  "update",
                  selected.id,
                  "--assignee",
                  assignee,
                  "--status",
                  "in_progress",
                  "--json",
                ],
                { cwd: directory, actor: assignee }
              );
              updated = Array.isArray(fallback) ? fallback[0] : undefined;
            } else {
              throw err;
            }
          }

          const claimed = updated ?? { ...selected, status: "in_progress", assignee };
          return `claimed: ${formatIssueLine(claimed)}`;
        },
      }),

      village_scaffold: tool({
        description:
          "Deterministically create an epic and child beads with correct assignees and parent/child linkage.",
        args: {
          epic_title: tool.schema.string(),
          epic_body: tool.schema.string().optional(),
          branch: tool.schema.string(),
          epic_priority: tool.schema.number().int().min(0).max(4).optional(),
          children: tool
            .schema
            .array(
              tool.schema.object({
                title: tool.schema.string(),
                type: tool.schema.enum(["task", "bug", "feature", "chore"] as const),
                priority: tool.schema.number().int().min(0).max(4),
                assignee: tool.schema.enum(["worker", "overseer"] as const),
                body: tool.schema.string().optional(),
              })
            )
            .optional(),
          dry_run: tool.schema.boolean().optional(),
          directory: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const session = await getSession(context.sessionID);
          const sessionAgent = (session as any)?.agent as string | undefined;
          const actor = sessionAgent && AGENT_TO_ACTOR[sessionAgent] ? AGENT_TO_ACTOR[sessionAgent] : undefined;

          const branch = args.branch.trim();
          if (!branch) throw new Error("branch is required");

          const epicDescription = isStructuredBody(args.epic_body)
            ? args.epic_body!.trim()
            : renderScaffoldDescription({
                context: args.epic_body,
                branch,
                skills: [],
              });

          const children = args.children ?? [];
          for (const c of children) {
            if (c.assignee !== "worker" && c.assignee !== "overseer") {
              throw new Error(
                `Invalid child assignee: ${String(c.assignee)} (must be worker|overseer)`
              );
            }
          }

          const planLines: string[] = [];
          planLines.push(`Epic: ${args.epic_title} (priority ${args.epic_priority ?? 2})`);
          for (const c of children) {
            planLines.push(
              `Child: ${c.title} | type=${c.type} | priority=${c.priority} | assignee=${c.assignee}`
            );
          }

          if (args.dry_run) {
            return ["dry_run: true", ...planLines].join("\n");
          }

          const createdIDs: string[] = [];
          let epicID: string | undefined;

          try {
            const epicOut = await execBrJson<BrIssue | BrIssue[]>(
              [
                "create",
                args.epic_title,
                "--type",
                "epic",
                "--priority",
                String(args.epic_priority ?? 2),
                "--description",
                epicDescription,
                "--json",
              ],
              { cwd: directory, actor }
            );

            const epic = firstBrIssue(epicOut);
            epicID = epic?.id;
            if (!epicID) throw new Error("br create epic returned no id");
            createdIDs.push(epicID);

            const childRows: string[] = [];
            for (const c of children) {
              const childDescription = isStructuredBody(c.body)
                ? c.body!.trim()
                : renderScaffoldDescription({
                    context: c.body,
                    branch,
                    skills: [],
                  });

              const out = await execBrJson<BrIssue | BrIssue[]>(
                [
                  "create",
                  c.title,
                  "--type",
                  c.type,
                  "--priority",
                  String(c.priority),
                  "--assignee",
                  c.assignee,
                  "--description",
                  childDescription,
                  "--parent",
                  epicID,
                  "--json",
                ],
                { cwd: directory, actor }
              );
              const child = firstBrIssue(out);
              if (!child?.id) throw new Error(`br create child returned no id for: ${c.title}`);
              createdIDs.push(child.id);
              childRows.push(
                `${child.id} | ${c.title.replace(/\s+/g, " ").trim()} | ${c.assignee} | ${c.type} | ${c.priority}`
              );
            }

            const lines: string[] = [];
            lines.push(`Created epic: ${epicID} | ${args.epic_title.replace(/\s+/g, " ").trim()}`);
            if (childRows.length) {
              lines.push("Created children:");
              for (const r of childRows) lines.push(`- ${r}`);
            } else {
              lines.push("Created children: (none)");
            }
            return lines.join("\n");
          } catch (err: any) {
            const created = createdIDs.length ? createdIDs.join(", ") : "(none)";
            throw new Error(
              `village_scaffold failed; partial creation possible. Created IDs: ${created}\n` +
                String(err?.message ?? err)
            );
          }
        },
      }),

      village_orphans: tool({
        description:
          "Report orphan/suspect-assignee beads (open + in_progress) and optionally fix unassigned non-epics.",
        args: {
          fix: tool.schema.boolean().optional(),
          limit: tool.schema.number().int().min(1).max(200).optional(),
          directory: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const session = await getSession(context.sessionID);
          const sessionAgent = (session as any)?.agent as string | undefined;
          const actor = sessionAgent && AGENT_TO_ACTOR[sessionAgent] ? AGENT_TO_ACTOR[sessionAgent] : undefined;

          let openIssues: BrIssue[] = [];
          let inProgressIssues: BrIssue[] = [];
          try {
            openIssues = await execBrJson<BrIssue[]>(["list", "--status", "open", "--json"], {
              cwd: directory,
              actor,
            });
            inProgressIssues = await execBrJson<BrIssue[]>(
              ["list", "--status", "in_progress", "--json"],
              { cwd: directory, actor }
            );
          } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.toLowerCase().includes("enoent") && msg.toLowerCase().includes("br")) {
              return "br not available; cannot inspect beads.";
            }
            if (msg.includes(".beads") && msg.toLowerCase().includes("missing")) {
              return "No .beads database found; nothing to inspect.";
            }
            throw err;
          }

          const combined = new Map<string, BrIssue>();
          for (const i of [...openIssues, ...inProgressIssues]) {
            if (i?.id) combined.set(i.id, i);
          }

          const all = [...combined.values()].sort(compareBrIssuesDeterministic);

          const ignoredEpics: BrIssue[] = [];
          const scannedNonEpic: BrIssue[] = [];
          for (const issue of all) {
            if (issue.issue_type === "epic") ignoredEpics.push(issue);
            else scannedNonEpic.push(issue);
          }

          const orphans: BrIssue[] = [];
          const suspect: BrIssue[] = [];
          for (const issue of scannedNonEpic) {
            const a = (issue.assignee ?? "").trim();
            if (!a) orphans.push(issue);
            else if (a !== "worker" && a !== "overseer") suspect.push(issue);
          }

          const ignoredEpicsUnassigned = ignoredEpics.filter((i) => !(i.assignee ?? "").trim());
          const ignoredEpicsSuspect = ignoredEpics.filter((i) => {
            const a = (i.assignee ?? "").trim();
            return a && a !== "worker" && a !== "overseer";
          });

          const limit = args.limit ?? 20;
          const rows = [...orphans, ...suspect]
            .slice()
            .sort(compareBrIssuesDeterministic)
            .slice(0, limit)
            .map(formatOrphansRow);

          const lines: string[] = [];
          lines.push(
            `Scanned (non-epic): ${scannedNonEpic.length} | Ignored epics: ${ignoredEpics.length} | Ignored epics (unassigned): ${ignoredEpicsUnassigned.length} | Orphans: ${orphans.length} | Suspect: ${suspect.length}`
          );

          if (rows.length) {
            lines.push("id | title | status | assignee");
            for (const r of rows) lines.push(r);
          } else {
            lines.push("No orphan/suspect non-epic beads found.");
          }

          const ignoredAttention = new Map<string, { issue: BrIssue; reason: string }>();
          for (const i of ignoredEpicsUnassigned) ignoredAttention.set(i.id, { issue: i, reason: "unassigned" });
          for (const i of ignoredEpicsSuspect)
            ignoredAttention.set(i.id, { issue: i, reason: "suspect assignee" });

          if (ignoredAttention.size) {
            lines.push("Ignored epics:");
            const epicRows = [...ignoredAttention.values()]
              .map((v) => v)
              .sort((a, b) => compareBrIssuesDeterministic(a.issue, b.issue))
              .slice(0, 5)
              .map(({ issue, reason }) => {
                const base = formatOrphansRow(issue);
                return `${base} | ${reason}`;
              });
            for (const r of epicRows) lines.push(r);
          }

          if (!args.fix) return lines.join("\n");

          const changed: string[] = [];
          const toFix = orphans.slice().sort(compareBrIssuesDeterministic);
          for (const issue of toFix) {
            const text = `${issue.title ?? ""}\n${issue.description ?? ""}\n${issue.notes ?? ""}`;
            const target = inferAssigneeFromText(text);
            await execBrJson<BrIssue[]>(
              ["update", issue.id, "--assignee", target, "--json"],
              { cwd: directory, actor }
            );
            changed.push(`${issue.id} -> ${target}`);
          }

          lines.push(`Fix mode: updated ${changed.length} orphan(s)`);
          if (changed.length) {
            for (const c of changed) lines.push(`- ${c}`);
          }
          return lines.join("\n");
        },
      }),

      village_status: tool({
        description:
          "List village sessions under the current root session (IDs and titles).",
        args: {},
        async execute(_args, context) {
          const rootID = await getRootSessionID(context.sessionID);
          const sessions = await listVillageSessions(rootID);

          return [
            `Root session: ${rootID}`,
            formatSessionList("Workers", sessions.workers),
            formatSessionList("Overseers", sessions.overseers),
          ].join("\n");
        },
      }),
    },

    // Monitor village session errors and status transitions
    event: async ({ event }) => {
      const properties = (event.properties ?? {}) as any;

      if (event.type === "session.error") {
        const sessionID =
          typeof properties.sessionID === "string"
            ? properties.sessionID
            : typeof properties.id === "string"
              ? properties.id
              : undefined;
        if (!sessionID) return;

        const session = await getVillageSessionSummary(sessionID);
        if (!session) return;

        const errorText =
          typeof properties.error === "string"
            ? properties.error
            : typeof properties.message === "string"
              ? properties.message
              : typeof properties.error?.message === "string"
                ? properties.error.message
                : "Unknown error";

        const dedupeKey = `${session.id}:${errorText}`;
        if (seenErrorKeys.has(dedupeKey)) return;
        seenErrorKeys.add(dedupeKey);

        await showVillageToast({
          sessionID,
          title: "Village session error",
          message: `${session.title} (${session.id}) failed: ${errorText}`,
          variant: "error",
          duration: 5000,
        });
        return;
      }

      if (event.type === "session.status") {
        const sessionID =
          typeof properties.sessionID === "string"
            ? properties.sessionID
            : typeof properties.id === "string"
              ? properties.id
              : undefined;
        if (!sessionID) return;

        const session = await getVillageSessionSummary(sessionID);
        if (!session) return;

        const status =
          typeof properties.status === "string"
            ? properties.status
            : typeof properties.next === "string"
              ? properties.next
              : undefined;
        if (!status) return;

        const previous = lastVillageStatus.get(sessionID);
        if (previous === status) return;
        lastVillageStatus.set(sessionID, status);

        // Keep this low-noise: only signal meaningful transitions.
        if (previous === "running" && status === "idle") {
          await showVillageToast({
            sessionID,
            title: "Village session idle",
            message: `${session.title} (${session.id}) is now idle`,
            variant: "info",
            duration: 2500,
          });
        }
        return;
      }
    },
  };
};

export default VillagePlugin;
