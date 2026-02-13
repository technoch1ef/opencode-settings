/**
 * OpenCode Village Plugin
 *
 * Enables a lightweight "Agentic Village" workflow.
 *
 * Features:
 * - Injects BD_ACTOR environment variable based on current agent
 * - Auto-submits work loop prompt when VILLAGE_AUTORUN=1 is set
 * - Provides tools to spawn and wake worker/overseer sessions
 */

import { tool, type Plugin } from "@opencode-ai/plugin";

import { execFile } from "node:child_process";

// Agent name to BD_ACTOR mapping
const AGENT_TO_ACTOR: Record<string, string> = {
  mayor: "mayor",
  worker: "worker",
  overseer: "overseer",
};

const SHELL_SNIPPET_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

type BdIssue = {
  id: string;
  title?: string;
  status?: string;
  priority?: number;
  created_at?: string;
  assignee?: string;
  issue_type?: string;
  description?: string;
  notes?: string;
};

function compareBdIssuesDeterministic(a: BdIssue, b: BdIssue): number {
  const ap = typeof a.priority === "number" ? a.priority : Number.POSITIVE_INFINITY;
  const bp = typeof b.priority === "number" ? b.priority : Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;

  const atRaw = typeof a.created_at === "string" ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
  const btRaw = typeof b.created_at === "string" ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
  const at = Number.isFinite(atRaw) ? atRaw : Number.POSITIVE_INFINITY;
  const bt = Number.isFinite(btRaw) ? btRaw : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;

  const aid = typeof a.id === "string" ? a.id : "";
  const bid = typeof b.id === "string" ? b.id : "";
  return aid.localeCompare(bid);
}

function formatIssueLine(issue: BdIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim();
  const status = (issue.status ?? "").trim();
  return `${id} | ${title || "(no title)"} | ${status || "(no status)"}`;
}

function formatOrphansRow(issue: BdIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim() || "(no title)";
  const status = (issue.status ?? "").trim() || "(no status)";
  const assignee = (issue.assignee ?? "").trim() || "(unassigned)";
  return `${id} | ${title} | ${status} | ${assignee}`;
}

function inferAssigneeFromText(text: string): "worker" | "overseer" {
  const t = text.toLowerCase();
  const keywords = ["review", "verify", "verification", "check", "checks", "overseer", "approve"];
  return keywords.some((k) => t.includes(k)) ? "overseer" : "worker";
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

async function execBdJson<T>(
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

  const { stdout } = await execFileText("bd", args, { cwd: options.cwd, env });

  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from: bd ${args.join(" ")}\n` +
        `Output: ${stdout.slice(0, 2000)}`
    );
  }
}

function renderScaffoldDescription(args: {
  context?: string;
  branch: string;
  skills?: string[];
  acceptance?: string;
  notes?: string;
}): string {
  const skills = (args.skills ?? []).filter(Boolean);

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

export function fixShellSnippetNewlines(text: unknown): unknown {
  if (typeof text !== "string") return text;

  // `; \nbd ...` is copy/paste-unsafe in shells (\n becomes `n`, e.g. `\nbd` => `nbd`).
  // This normalizes *shell* code fences only, turning the literal `\n` token into
  // a real newline when it is used as a command separator (e.g. `; \n`, `&& \n`).
  if (!text.includes("\\n")) return text;

  const codeFenceRegex = /```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;

  return text.replace(codeFenceRegex, (full, lang, body) => {
    const tag = (typeof lang === "string" ? lang : "").toLowerCase();
    if (!SHELL_SNIPPET_LANGS.has(tag)) return full;

    const fixedBody = String(body)
      .replace(/([;]|&&|\|\|)[ \t]*\\n[ \t]*/g, "$1\n")
      .replace(/^\\n[ \t]*/g, "\n");

    const opening = lang ? `\`\`\`${lang}\n` : "```\n";
    const bodyWithTrailingNewline = fixedBody.endsWith("\n") ? fixedBody : `${fixedBody}\n`;
    return `${opening}${bodyWithTrailingNewline}` + "```";
  });
}

const WORKER_WORK_LOOP_PROMPT = `Check for ready beads assigned to worker and start working on the first available one.

Use this workflow:
1. Run \`bd ready --assignee worker\` to find work
2. If a bead is found, move it to in_progress: \`bd update <id> --assignee worker --status in_progress\`
3. Read the bead details and handoff packet
4. Load the bead's listed skills
5. Implement the required changes
6. Commit locally (no push)
7. Hand off to overseer:
   - \`bd comments add <id> "Implementation complete. Ready for review."\`
   - \`bd update <id> --assignee overseer --status open\`
8. Wake overseer using \`village_wake\`
9. Check for more ready beads and repeat

If no ready beads are found, report that and wait for new work.`;

const OVERSEER_WORK_LOOP_PROMPT = `Check for ready beads assigned to overseer and start reviewing the first available one.

Use this workflow:
1. Run \`bd ready --assignee overseer\` to find work
2. If a bead is found, move it to in_progress: \`bd update <id> --assignee overseer --status in_progress\`
3. Read the bead details
4. Load the bead's listed skills and run the appropriate checks (tests/linters/build)
5. If approved:
   - \`bd comments add <id> "Approved. Checks: <...>"\`
   - \`bd close <id> --reason "Approved"\`
   - post-close parent epic check:
     - \`PARENT_ID=$(bd show <id> --json | jq -r '.[0].parent // empty')\`
     - \`if [ -n "$PARENT_ID" ]; then bd children "$PARENT_ID" --json; fi\`
     - \`if [ -n "$PARENT_ID" ]; then OPEN_CHILD_COUNT=$(bd children "$PARENT_ID" --json | jq '[.[] | select(.status != "closed")] | length'); fi\`
     - \`if [ -n "$PARENT_ID" ] && [ "$OPEN_CHILD_COUNT" -eq 0 ]; then bd close "$PARENT_ID" --reason "All child beads closed"; fi\`
6. If changes needed:
   - \`bd comments add <id> "Changes requested: <actionable bullets>"\`
   - \`bd update <id> --assignee worker --status open\`
   - wake worker using \`village_wake\`

If no ready beads are found, report that and wait for new work.`;

type SpawnRegistryEntry = {
  workers: string[];
  overseers: string[];
};

type SessionSummary = {
  id: string;
  title: string;
};

function withOptionalNote(prompt: string, note?: string) {
  if (!note) return prompt;
  return `${prompt}\n\nNote: ${note}`;
}

function isVillageSessionTitle(title: unknown): title is string {
  return (
    typeof title === "string" &&
    (title.startsWith("village-worker-") || title.startsWith("village-overseer"))
  );
}

export const VillagePlugin: Plugin = async ({ client }) => {
  // Track sessions where we've already auto-submitted
  const autoSubmittedSessions = new Set<string>();
  // Track spawned village sessions by mayor/root session
  const registry = new Map<string, SpawnRegistryEntry>();
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

  async function loadRegistryFromChildren(rootID: string): Promise<SpawnRegistryEntry> {
    const childrenRes = await client.session.children({ path: { id: rootID } });
    const children = (childrenRes.data || []) as any[];

    const workers = children
      .filter((s) => typeof s?.title === "string" && s.title.startsWith("village-worker-"))
      .map((s) => s.id)
      .filter(Boolean);

    const overseers = children
      .filter((s) => typeof s?.title === "string" && s.title.startsWith("village-overseer"))
      .map((s) => s.id)
      .filter(Boolean);

    const entry = { workers, overseers };
    registry.set(rootID, entry);
    return entry;
  }

  async function resolveRegistry(rootID: string): Promise<SpawnRegistryEntry> {
    const existing = registry.get(rootID);
    if (existing) return existing;
    return loadRegistryFromChildren(rootID);
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

  async function kickSession(args: {
    sessionID: string;
    directory: string;
    agent: "worker" | "overseer";
    prompt: string;
    note?: string;
  }) {
    await client.session.promptAsync({
      path: { id: args.sessionID },
      query: { directory: args.directory },
      body: {
        agent: args.agent,
        parts: [{ type: "text", text: withOptionalNote(args.prompt, args.note) }],
      },
    });
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

          const inProgress = (await execBdJson<BdIssue[]>(
            ["list", "--status", "in_progress", "--assignee", assignee, "--json"],
            { cwd: directory, actor: assignee }
          )) as BdIssue[];

          if (inProgress.length === 1) {
            const issue = inProgress[0];
            return `existing in_progress: ${formatIssueLine(issue)}`;
          }

          if (inProgress.length > 1) {
            const lines = inProgress
              .slice()
              .sort(compareBdIssuesDeterministic)
              .map((i) => `- ${formatIssueLine(i)}`);
            throw new Error(
              `Multiple in_progress beads for ${assignee}; refusing to claim a new one.\n` +
                lines.join("\n")
            );
          }

          const ready = (await execBdJson<BdIssue[]>(
            ["ready", "--assignee", assignee, "--json"],
            { cwd: directory, actor: assignee }
          )) as BdIssue[];

          if (!ready.length) {
            return `no ready beads for ${assignee}`;
          }

          const selected = ready.slice().sort(compareBdIssuesDeterministic)[0];
          if (!selected?.id) throw new Error("bd ready returned an item without an id");

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

          let updated: BdIssue | undefined;
          try {
            const out = await execBdJson<BdIssue[]>(updateArgsWithClaim, {
              cwd: directory,
              actor: assignee,
            });
            updated = Array.isArray(out) ? out[0] : undefined;
          } catch (err: any) {
            const stderr = String((err as any)?.stderr ?? "");
            const stdout = String((err as any)?.stdout ?? "");
            const text = `${stderr}\n${stdout}`.toLowerCase();

            // Back-compat: older bd may not support --claim.
            if (text.includes("--claim") && (text.includes("unknown") || text.includes("flag"))) {
              const fallback = await execBdJson<BdIssue[]>(
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

          const epicDescription = renderScaffoldDescription({
            context: args.epic_body,
            branch,
            skills: ["beads-workflow", "stack-typescript"],
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
            const epicOut = await execBdJson<BdIssue[]>(
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

            const epic = Array.isArray(epicOut) ? epicOut[0] : undefined;
            epicID = epic?.id;
            if (!epicID) throw new Error("bd create epic returned no id");
            createdIDs.push(epicID);

            const childRows: string[] = [];
            for (const c of children) {
              const childDescription = renderScaffoldDescription({
                context: c.body,
                branch,
                skills: ["beads-workflow", "stack-typescript"],
              });

              const out = await execBdJson<BdIssue[]>(
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
              const child = Array.isArray(out) ? out[0] : undefined;
              if (!child?.id) throw new Error(`bd create child returned no id for: ${c.title}`);
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

          let openIssues: BdIssue[] = [];
          let inProgressIssues: BdIssue[] = [];
          try {
            openIssues = await execBdJson<BdIssue[]>(["list", "--status", "open", "--json"], {
              cwd: directory,
              actor,
            });
            inProgressIssues = await execBdJson<BdIssue[]>(
              ["list", "--status", "in_progress", "--json"],
              { cwd: directory, actor }
            );
          } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.toLowerCase().includes("enoent") && msg.toLowerCase().includes("bd")) {
              return "bd not available; cannot inspect beads.";
            }
            if (msg.includes(".beads") && msg.toLowerCase().includes("missing")) {
              return "No .beads database found; nothing to inspect.";
            }
            throw err;
          }

          const combined = new Map<string, BdIssue>();
          for (const i of [...openIssues, ...inProgressIssues]) {
            if (i?.id) combined.set(i.id, i);
          }

          const all = [...combined.values()].sort(compareBdIssuesDeterministic);

          const ignoredEpics: BdIssue[] = [];
          const scannedNonEpic: BdIssue[] = [];
          for (const issue of all) {
            if (issue.issue_type === "epic") ignoredEpics.push(issue);
            else scannedNonEpic.push(issue);
          }

          const orphans: BdIssue[] = [];
          const suspect: BdIssue[] = [];
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
            .sort(compareBdIssuesDeterministic)
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

          const ignoredAttention = new Map<string, { issue: BdIssue; reason: string }>();
          for (const i of ignoredEpicsUnassigned) ignoredAttention.set(i.id, { issue: i, reason: "unassigned" });
          for (const i of ignoredEpicsSuspect)
            ignoredAttention.set(i.id, { issue: i, reason: "suspect assignee" });

          if (ignoredAttention.size) {
            lines.push("Ignored epics:");
            const epicRows = [...ignoredAttention.values()]
              .map((v) => v)
              .sort((a, b) => compareBdIssuesDeterministic(a.issue, b.issue))
              .slice(0, 5)
              .map(({ issue, reason }) => {
                const base = formatOrphansRow(issue);
                return `${base} | ${reason}`;
              });
            for (const r of epicRows) lines.push(r);
          }

          if (!args.fix) return lines.join("\n");

          const changed: string[] = [];
          const toFix = orphans.slice().sort(compareBdIssuesDeterministic);
          for (const issue of toFix) {
            const text = `${issue.title ?? ""}\n${issue.description ?? ""}\n${issue.notes ?? ""}`;
            const target = inferAssigneeFromText(text);
            await execBdJson<BdIssue[]>(
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

      village_spawn: tool({
        description:
          "Spawn village worker/overseer sessions under the current mayor session. Sessions stay idle unless kick=true.",
        args: {
          workers: tool.schema.number().int().min(1).max(8).optional(),
          overseer: tool.schema.boolean().optional(),
          kick: tool.schema.boolean().optional(),
          directory: tool.schema.string().optional(),
          note: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const rootID = await getRootSessionID(context.sessionID);
          const desiredWorkers = args.workers ?? 1;
          const desiredOverseer = args.overseer ?? true;
          const shouldKick = args.kick ?? false;

          if (desiredWorkers > 1) {
            await client.tui.showToast({
              query: { directory },
              body: {
                title: "Village",
                message:
                  "Spawning multiple workers in the same directory can cause git conflicts.",
                variant: "warning",
                duration: 5000,
              },
            });
          }

          const entry = await resolveRegistry(rootID);
          const createdWorkers: string[] = [];
          while (entry.workers.length < desiredWorkers) {
            const idx = entry.workers.length + 1;
            const created = await client.session.create({
              query: { directory },
              body: {
                parentID: rootID,
                title: `village-worker-${idx}`,
              },
            });
            entry.workers.push(created.data.id);
            createdWorkers.push(created.data.id);
          }

          const createdOverseers: string[] = [];
          if (desiredOverseer && entry.overseers.length < 1) {
            const created = await client.session.create({
              query: { directory },
              body: {
                parentID: rootID,
                title: "village-overseer",
              },
            });
            entry.overseers.push(created.data.id);
            createdOverseers.push(created.data.id);
          }

          if (shouldKick) {
            await Promise.all([
              ...entry.workers.map((id) =>
                kickSession({
                  sessionID: id,
                  directory,
                  agent: "worker",
                  prompt: WORKER_WORK_LOOP_PROMPT,
                  note: args.note,
                })
              ),
              ...entry.overseers.map((id) =>
                kickSession({
                  sessionID: id,
                  directory,
                  agent: "overseer",
                  prompt: OVERSEER_WORK_LOOP_PROMPT,
                  note: args.note,
                })
              ),
            ]);
          }

          registry.set(rootID, entry);

          await client.tui.showToast({
            query: { directory },
            body: {
              title: "Village",
              message: `Spawned ${entry.workers.length} worker(s)${
                desiredOverseer ? " + overseer" : ""
              }${
                shouldKick
                  ? " and kicked them. Navigate: ctrl+x right/left (cycle children), ctrl+x up (back to parent)."
                  : ". Sessions are idle; navigate to them (ctrl+x right/left) and run /village:work to start."
              }`,
              variant: "success",
              duration: 4000,
            },
          });

          const sessions = await listVillageSessions(rootID);

          const lines = [
            `Root session: ${rootID}`,
            formatSessionList("Workers", sessions.workers),
            formatSessionList("Overseers", sessions.overseers),
            shouldKick
              ? "Kicked: yes (work loop prompt sent)"
              : "Kicked: no (sessions are idle; run /village:work manually or use village_wake)",
          ];

          if (createdWorkers.length || createdOverseers.length) {
            lines.push(
              `Created: ${[
                ...createdWorkers.map((id) => `worker:${id}`),
                ...createdOverseers.map((id) => `overseer:${id}`),
              ].join(", ")}`
            );
          }

          return lines.join("\n");
        },
      }),

      village_wake: tool({
        description:
          "Wake existing village worker/overseer sessions by re-sending their work loop prompt.",
        args: {
          target: tool.schema.enum(["worker", "overseer", "all"] as const).optional(),
          note: tool.schema.string().optional(),
          directory: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const rootID = await getRootSessionID(context.sessionID);
          const entry = await resolveRegistry(rootID);

          const target = args.target ?? "all";
          const workerIDs = target === "overseer" ? [] : entry.workers;
          const overseerIDs = target === "worker" ? [] : entry.overseers;

          await Promise.all([
            ...workerIDs.map((id) =>
              kickSession({
                sessionID: id,
                directory,
                agent: "worker",
                prompt: WORKER_WORK_LOOP_PROMPT,
                note: args.note,
              })
            ),
            ...overseerIDs.map((id) =>
              kickSession({
                sessionID: id,
                directory,
                agent: "overseer",
                prompt: OVERSEER_WORK_LOOP_PROMPT,
                note: args.note,
              })
            ),
          ]);

          await client.tui.showToast({
            query: { directory },
            body: {
              title: "Village",
              message: `Woke ${workerIDs.length} worker(s) and ${overseerIDs.length} overseer(s). Navigate: ctrl+x right/left (cycle children), ctrl+x up (back to parent).`,
              variant: "info",
              duration: 2500,
            },
          });

          const sessions = await listVillageSessions(rootID);

          return [
            `Root session: ${rootID}`,
            `Woke workers: ${workerIDs.join(", ") || "(none)"}`,
            `Woke overseers: ${overseerIDs.join(", ") || "(none)"}`,
            formatSessionList("Workers", sessions.workers),
            formatSessionList("Overseers", sessions.overseers),
          ].join("\n");
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

    // Auto-submit work loop when VILLAGE_AUTORUN=1
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

      // Only trigger on server connected (startup)
      if (event.type !== "server.connected") return;

      // Check if autorun is enabled
      if (process.env.VILLAGE_AUTORUN !== "1") return;

      // Get current session info
      const sessionID = properties?.sessionID;
      if (!sessionID) return;

      // Don't auto-submit twice for same session
      if (autoSubmittedSessions.has(sessionID)) return;
      autoSubmittedSessions.add(sessionID);

      // Get session to check agent
      try {
        const session = await client.session.get({ path: { id: sessionID } });
        const agent = (session.data as any)?.agent as string | undefined;

        // Only auto-run for worker/overseer agents, not mayor
        if (!agent || agent === "mayor") return;
        if (!AGENT_TO_ACTOR[agent]) return;

        const prompt = agent === "overseer" ? OVERSEER_WORK_LOOP_PROMPT : WORKER_WORK_LOOP_PROMPT;

        // Auto-submit the work loop prompt
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            agent,
            parts: [{ type: "text", text: prompt }],
          },
        });
      } catch (err) {
        // Silent fail - autorun is a convenience, not critical
        console.error("[village] Auto-run failed:", err);
      }
    },
  };
};
