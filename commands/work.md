---
description: "Trigger the village work loop - claim and work on ready beads"
---

Check for ready beads assigned to me and start working on the first available one.

**IMPORTANT:** If you are the api-dev agent working in bakesy-api directory, use `--db ../bakesy-apps/.beads/beads.db` on all bd commands.

Use this workflow:
1. Determine the correct database path:
   - If in `bakesy-apps/`: use `bd` commands without --db flag
   - If in `bakesy-api/`: use `--db ../bakesy-apps/.beads/beads.db` on all bd commands
2. Run `bd list --status ready --assignee <my-assignee>` to find work (use your agent name: app-dev, api-dev, or overseer)
3. If a bead is found, claim it: `bd update <id> --claim --status in_progress`
4. Read the bead details and handoff packet
5. Implement the required changes
6. Update the bead with progress and mark complete when done
7. Check for more ready beads and repeat

If no ready beads are found, report that and wait for new work.

