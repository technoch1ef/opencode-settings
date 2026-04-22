/**
 * `village_claim` tool — deterministic bead claiming with single in_progress guard.
 *
 * After a successful claim, if the bead body contains a `## Branch` section
 * referencing an `epic/*` branch, `village_ensure_branch` is called automatically
 * to create / checkout / fast-forward the branch.
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
import {
  checkWorktreeConflict,
  postWorktreeComment,
  resolveWorktreePath,
} from "../lib/worktree";
import { ensureBranch, type EnsureBranchResult } from "./ensure-branch";

/**
 * Parse the `## Branch` section from a bead body.
 *
 * Supports both fenced (`` `epic/foo` ``) and plain (`epic/foo`) formats.
 * Returns `undefined` if no branch section is found.
 */
export function parseBranchFromBody(
  body: string | undefined | null,
): string | undefined {
  if (!body) return undefined;

  // Match `## Branch` header followed by a line containing the branch name.
  const match = body.match(
    /##\s+Branch\s*\n+\s*(?:`([^`]+)`|(\S+))/i,
  );
  if (!match) return undefined;
  return (match[1] ?? match[2])?.trim() || undefined;
}

/**
 * Format the branch-ensure result as a human-readable suffix for the claim message.
 */
function formatBranchResult(result: EnsureBranchResult): string {
  const parts = [
    `branch: ${result.branch}`,
    `base: ${result.base}`,
    `action: ${result.action}`,
  ];
  if (result.warnings.length) {
    parts.push(`warnings: ${result.warnings.join("; ")}`);
  }
  return parts.join(" | ");
}

/**
 * Attempt to ensure the epic branch for a claimed bead.
 *
 * Only triggers for branches matching `^epic/`. Returns `undefined` for
 * non-epic branches or beads without a `## Branch` section.
 */
async function maybeEnsureBranch(
  issue: BrIssue,
  directory: string,
): Promise<string | undefined> {
  const branch = parseBranchFromBody(issue.description);
  if (!branch) return undefined;
  if (!/^epic\//.test(branch)) return undefined;

  try {
    const result = await ensureBranch({ branch, directory });
    return formatBranchResult(result);
  } catch (err: any) {
    return `branch-ensure failed: ${String(err?.message ?? err)}`;
  }
}

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

      // Resolve worktree path for conflict detection.
      const worktreePath = await resolveWorktreePath(directory);

      const inProgress = (await execBrJson<BrIssue[]>(
        ["list", "--status", "in_progress", "--assignee", assignee, "--json"],
        { cwd: directory, actor: assignee },
      )) as BrIssue[];

      const guard = guardSingleInProgress(inProgress);
      if (guard.kind === "existing") {
        // For existing in_progress, also ensure the branch (if worker).
        let branchInfo: string | undefined;
        if (assignee === "worker") {
          // guard.issue may lack .description; fetch full bead if needed.
          let issue = guard.issue;
          if (!issue.description) {
            try {
              const full = await execBrJson<BrIssue[]>(
                ["show", issue.id, "--json"],
                { cwd: directory, actor: assignee },
              );
              issue = (Array.isArray(full) ? full[0] : undefined) ?? issue;
            } catch {
              // Best-effort; proceed without description.
            }
          }
          branchInfo = await maybeEnsureBranch(issue, directory);
        }
        const line = `existing in_progress: ${formatIssueLine(guard.issue)}`;
        return branchInfo ? `${line}\n${branchInfo}` : line;
      }

      if (guard.kind === "multiple") {
        const lines = guard.issues.map((i) => `- ${formatIssueLine(i)}`);
        throw new Error(
          `Multiple in_progress beads for ${assignee}; refusing to claim a new one.\n` +
            lines.join("\n"),
        );
      }

      // Check for worktree conflicts before claiming.
      const conflict = await checkWorktreeConflict(worktreePath, assignee, {
        cwd: directory,
        actor: assignee,
      });
      if (conflict) {
        return (
          `worktree_conflict: ${conflict.beadId} held by ${conflict.assignee} in ${conflict.worktreePath}`
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
        // Post worktree comment after successful claim.
        await safePostWorktreeComment(claimed.id, worktreePath, {
          cwd: directory,
          actor: assignee,
        });
        // Ensure epic branch for worker claims.
        let branchInfo: string | undefined;
        if (assignee === "worker") {
          branchInfo = await maybeEnsureBranch(claimed, directory);
        }
        const line = `claimed: ${formatIssueLine(claimed)}`;
        return branchInfo ? `${line}\n${branchInfo}` : line;
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
      // Post worktree comment after successful claim.
      await safePostWorktreeComment(claimed.id, worktreePath, {
        cwd: directory,
        actor: assignee,
      });
      // Ensure epic branch for worker claims.
      let branchInfo: string | undefined;
      if (assignee === "worker") {
        branchInfo = await maybeEnsureBranch(claimed, directory);
      }
      const line = `claimed: ${formatIssueLine(claimed)}`;
      return branchInfo ? `${line}\n${branchInfo}` : line;
    },
  });
}

/**
 * Best-effort worktree comment posting. Does not throw on failure.
 */
async function safePostWorktreeComment(
  beadId: string,
  worktreePath: string,
  options: { cwd?: string; actor?: string },
): Promise<void> {
  try {
    await postWorktreeComment(beadId, worktreePath, options);
  } catch {
    // Non-critical — claim still succeeds without the comment.
  }
}
