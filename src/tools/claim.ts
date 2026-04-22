/**
 * `village_claim` tool — deterministic bead claiming with single in_progress guard.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson, formatIssueLine } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import {
  guardSingleInProgress,
  selectDeterministicReady,
  type BrIssue,
} from "../lib/shared";

/**
 * Create the `village_claim` tool definition, bound to session helpers.
 */
export function createClaimTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Deterministically claim the next ready bead for worker/overseer, enforcing a single in_progress bead per assignee.",
    args: {
      assignee: tool.schema.enum(["worker", "overseer"] as const).optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;

      const session = await helpers.getSession(context.sessionID);
      const sessionAgent = (session as any)?.agent as string | undefined;

      const assignee =
        args.assignee ??
        (sessionAgent === "worker" || sessionAgent === "overseer"
          ? sessionAgent
          : undefined);
      if (assignee !== "worker" && assignee !== "overseer") {
        throw new Error(
          `village_claim requires assignee=worker|overseer (session agent: ${sessionAgent ?? "unknown"})`,
        );
      }

      const inProgress = (await execBrJson<BrIssue[]>(
        ["list", "--status", "in_progress", "--assignee", assignee, "--json"],
        { cwd: directory, actor: assignee },
      )) as BrIssue[];

      const guard = guardSingleInProgress(inProgress);
      if (guard.kind === "existing") {
        return `existing in_progress: ${formatIssueLine(guard.issue)}`;
      }

      if (guard.kind === "multiple") {
        const lines = guard.issues.map((i) => `- ${formatIssueLine(i)}`);
        throw new Error(
          `Multiple in_progress beads for ${assignee}; refusing to claim a new one.\n` +
            lines.join("\n"),
        );
      }

      const ready = (await execBrJson<BrIssue[]>(
        ["ready", "--assignee", assignee, "--json"],
        { cwd: directory, actor: assignee },
      )) as BrIssue[];

      const selected = selectDeterministicReady(ready);
      if (!selected) return `no ready beads for ${assignee}`;
      if (!selected.id) throw new Error("br ready returned an item without an id");

      const selectedAssignee = (selected.assignee ?? "").trim();
      if (selectedAssignee) {
        if (selectedAssignee !== assignee) {
          throw new Error(
            `br ready returned ${selected.id} assigned to ${selectedAssignee}; expected ${assignee}`,
          );
        }

        const out = await execBrJson<BrIssue[]>(
          [
            "update",
            selected.id,
            "--assignee",
            assignee,
            "--status",
            "in_progress",
            "--json",
          ],
          { cwd: directory, actor: assignee },
        );
        const updated = Array.isArray(out) ? out[0] : undefined;
        const claimed = updated ?? {
          ...selected,
          status: "in_progress",
          assignee,
        };
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

        if (
          text.includes("--claim") &&
          (text.includes("unknown") || text.includes("flag"))
        ) {
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
            { cwd: directory, actor: assignee },
          );
          updated = Array.isArray(fallback) ? fallback[0] : undefined;
        } else if (text.includes("already claimed")) {
          const shown = await execBrJson<BrIssue[]>(
            ["show", selected.id, "--json"],
            { cwd: directory, actor: assignee },
          );
          const current = Array.isArray(shown) ? shown[0] : undefined;
          const currentAssignee = (current?.assignee ?? "").trim();
          if (currentAssignee && currentAssignee !== assignee) {
            throw new Error(
              `br update --claim failed: ${selected.id} already claimed by ${currentAssignee}`,
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
            { cwd: directory, actor: assignee },
          );
          updated = Array.isArray(fallback) ? fallback[0] : undefined;
        } else {
          throw err;
        }
      }

      const claimed = updated ?? {
        ...selected,
        status: "in_progress",
        assignee,
      };
      return `claimed: ${formatIssueLine(claimed)}`;
    },
  });
}
