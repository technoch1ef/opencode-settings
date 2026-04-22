/**
 * `village_scaffold` tool — create an epic and child beads deterministically.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson, firstBrIssue } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";

/**
 * Detect if a body string already contains structured markdown sections
 * (e.g. `## Context`, `## Skills`). When true, the body should be used
 * directly as the bead description — no wrapping via `renderScaffoldDescription`.
 */
export function isStructuredBody(body: string | undefined): boolean {
  if (!body) return false;
  return /^## (Context|Skills)/m.test(body);
}

/**
 * Render a bead description with the standard section layout.
 */
export function renderScaffoldDescription(args: {
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

/**
 * Create the `village_scaffold` tool definition, bound to session helpers.
 */
export function createScaffoldTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Deterministically create an epic and child beads with correct assignees and parent/child linkage.",
    args: {
      epic_title: tool.schema.string(),
      epic_body: tool.schema.string().optional(),
      branch: tool.schema.string(),
      epic_priority: tool.schema.number().int().min(0).max(4).optional(),
      children: tool.schema
        .array(
          tool.schema.object({
            title: tool.schema.string(),
            type: tool.schema.enum([
              "task",
              "bug",
              "feature",
              "chore",
            ] as const),
            priority: tool.schema.number().int().min(0).max(4),
            assignee: tool.schema.enum(["worker", "overseer"] as const),
            body: tool.schema.string().optional(),
          }),
        )
        .optional(),
      dry_run: tool.schema.boolean().optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

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
            `Invalid child assignee: ${String(c.assignee)} (must be worker|overseer)`,
          );
        }
      }

      const planLines: string[] = [];
      planLines.push(
        `Epic: ${args.epic_title} (priority ${args.epic_priority ?? 2})`,
      );
      for (const c of children) {
        planLines.push(
          `Child: ${c.title} | type=${c.type} | priority=${c.priority} | assignee=${c.assignee}`,
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
          { cwd: directory, actor },
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
            { cwd: directory, actor },
          );
          const child = firstBrIssue(out);
          if (!child?.id)
            throw new Error(`br create child returned no id for: ${c.title}`);
          createdIDs.push(child.id);
          childRows.push(
            `${child.id} | ${c.title.replace(/\s+/g, " ").trim()} | ${c.assignee} | ${c.type} | ${c.priority}`,
          );
        }

        const lines: string[] = [];
        lines.push(
          `Created epic: ${epicID} | ${args.epic_title.replace(/\s+/g, " ").trim()}`,
        );
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
            String(err?.message ?? err),
        );
      }
    },
  });
}
