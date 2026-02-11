/**
 * OpenCode Village Plugin
 *
 * Enables the "Agentic Village" pattern for BakesyDev repositories.
 *
 * Features:
 * - Injects BD_ACTOR environment variable based on current agent
 * - Auto-submits work loop prompt when VILLAGE_AUTORUN=1 is set
 */

import type { Plugin } from "@opencode-ai/plugin";

// Agent name to BD_ACTOR mapping
const AGENT_TO_ACTOR: Record<string, string> = {
  orchestrator: "orchestrator",
  "app-dev": "app-dev",
  "api-dev": "api-dev",
  overseer: "overseer",
};

// Work loop prompt for worker agents
const WORK_LOOP_PROMPT = `Check for ready beads assigned to me and start working on the first available one.

Use this workflow:
1. Run \`bd list --status ready --assignee <my-assignee>\` to find work
2. If a bead is found, claim it: \`bd update <id> --claim --status in_progress\`
3. Read the bead details and handoff packet
4. Implement the required changes
5. Update the bead with progress and mark complete when done
6. Check for more ready beads and repeat

If no ready beads are found, report that and wait for new work.`;

export const VillagePlugin: Plugin = async ({ client }) => {
  // Track sessions where we've already auto-submitted
  const autoSubmittedSessions = new Set<string>();

  return {
    // Inject BD_ACTOR based on current agent
    "shell.env": async (input, output) => {
      // Get agent from session context if available
      // The agent name comes from the current session's agent setting
      const agent = (input as any).agent;
      
      if (agent && AGENT_TO_ACTOR[agent]) {
        output.env.BD_ACTOR = AGENT_TO_ACTOR[agent];
      }
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
        const agent = (session.data as any)?.agent;

        // Only auto-run for worker agents, not orchestrator
        if (!agent || agent === "orchestrator") return;
        if (!AGENT_TO_ACTOR[agent]) return;

        // Auto-submit the work loop prompt
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: WORK_LOOP_PROMPT }],
          },
        });
      } catch (err) {
        // Silent fail - autorun is a convenience, not critical
        console.error("[village] Auto-run failed:", err);
      }
    },

    // Expose config for agents to see village status
    config: async (config) => {
      // Add a note about village mode in instructions
      const villageNote = `
## Village Mode

You are part of the BakesyDev Agentic Village. Your BD_ACTOR is automatically set based on your agent name.

Available agents:
- **orchestrator**: Plans work, creates beads, delegates to workers
- **app-dev**: React Web/Native development (bakesy-apps)
- **api-dev**: Rails backend development (bakesy-api)
- **overseer**: Read-only validation and code review

Use \`bd\` commands to interact with beads. When VILLAGE_AUTORUN=1 is set, worker agents automatically claim and work on ready beads.
`;

      if (!config.instructions) {
        config.instructions = [];
      }
      // Note: This adds to system prompt if instructions supports strings
    },
  };
};
