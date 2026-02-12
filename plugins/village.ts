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

// Agent name to BD_ACTOR mapping
const AGENT_TO_ACTOR: Record<string, string> = {
  mayor: "mayor",
  worker: "worker",
  overseer: "overseer",
};

const SHELL_SNIPPET_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

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
      village_spawn: tool({
        description:
          "Spawn village worker/overseer sessions under the current mayor session. Sessions stay idle unless kick=true.",
        args: {
          workers: tool.schema.number().int().min(1).max(8).optional(),
          overseer: tool.schema.boolean().optional(),
          kick: tool.schema.boolean().optional(),
          openSessions: tool.schema.boolean().optional(),
          directory: tool.schema.string().optional(),
          note: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const rootID = await getRootSessionID(context.sessionID);
          const desiredWorkers = args.workers ?? 1;
          const desiredOverseer = args.overseer ?? true;
          const shouldKick = args.kick ?? false;
          const shouldOpenSessions = args.openSessions ?? true;

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
                  ? " and kicked them. Use /sessions (ctrl+x l) to jump into each session."
                  : ". Sessions are idle; run /work after opening /sessions (ctrl+x l)."
              }`,
              variant: "success",
              duration: 4000,
            },
          });

          if (shouldOpenSessions) {
            await client.tui.openSessions();
          }

          const sessions = await listVillageSessions(rootID);

          const lines = [
            `Root session: ${rootID}`,
            formatSessionList("Workers", sessions.workers),
            formatSessionList("Overseers", sessions.overseers),
            shouldKick
              ? "Kicked: yes (work loop prompt sent)"
              : "Kicked: no (sessions are idle; run /work manually or use village_wake)",
            shouldOpenSessions
              ? "Session selector: opened"
              : "Session selector: skipped (run /sessions or press ctrl+x l)",
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
          openSessions: tool.schema.boolean().optional(),
          note: tool.schema.string().optional(),
          directory: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const directory = args.directory ?? context.directory;
          const rootID = await getRootSessionID(context.sessionID);
          const entry = await resolveRegistry(rootID);
          const shouldOpenSessions = args.openSessions ?? true;

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
              message: `Woke ${workerIDs.length} worker(s) and ${overseerIDs.length} overseer(s)`,
              variant: "info",
              duration: 2500,
            },
          });

          if (shouldOpenSessions) {
            await client.tui.openSessions();
          }

          const sessions = await listVillageSessions(rootID);

          return [
            `Root session: ${rootID}`,
            `Woke workers: ${workerIDs.join(", ") || "(none)"}`,
            `Woke overseers: ${overseerIDs.join(", ") || "(none)"}`,
            formatSessionList("Workers", sessions.workers),
            formatSessionList("Overseers", sessions.overseers),
            shouldOpenSessions
              ? "Session selector: opened"
              : "Session selector: skipped (run /sessions or press ctrl+x l)",
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
