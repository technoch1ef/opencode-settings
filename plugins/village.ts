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

export function fixShellSnippetNewlines(text: string): string {
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

function withOptionalNote(prompt: string, note?: string) {
  if (!note) return prompt;
  return `${prompt}\n\nNote: ${note}`;
}

export const VillagePlugin: Plugin = async ({ client }) => {
  // Track sessions where we've already auto-submitted
  const autoSubmittedSessions = new Set<string>();
  // Track spawned village sessions by mayor/root session
  const registry = new Map<string, SpawnRegistryEntry>();

  async function getSession(id: string) {
    const res = await client.session.get({ path: { id } });
    return res.data as any;
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
      output.text = fixShellSnippetNewlines(output.text);
    },

    tool: {
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
              }${shouldKick ? " and kicked them" : ". Run /work in each session to start."}`,
              variant: "success",
              duration: 4000,
            },
          });

          const lines = [
            `Root session: ${rootID}`,
            `Workers: ${entry.workers.join(", ") || "(none)"}`,
            `Overseers: ${entry.overseers.join(", ") || "(none)"}`,
            shouldKick
              ? "Kicked: yes (work loop prompt sent)"
              : "Kicked: no (sessions are idle; run /work manually or use village_wake)",
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
              message: `Woke ${workerIDs.length} worker(s) and ${overseerIDs.length} overseer(s)`,
              variant: "info",
              duration: 2500,
            },
          });

          return [
            `Root session: ${rootID}`,
            `Woke workers: ${workerIDs.join(", ") || "(none)"}`,
            `Woke overseers: ${overseerIDs.join(", ") || "(none)"}`,
          ].join("\n");
        },
      }),
    },

    // Auto-submit work loop when VILLAGE_AUTORUN=1
    event: async ({ event }) => {
      // Only trigger on server connected (startup)
      if (event.type !== "server.connected") return;

      // Check if autorun is enabled
      if (process.env.VILLAGE_AUTORUN !== "1") return;

      // Get current session info
      const sessionID = (event.properties as any)?.sessionID;
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
