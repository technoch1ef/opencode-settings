---
description: "Trigger the village work loop - claim and work on ready beads"
---

Check for ready beads assigned to me and start working on the first available one.

Use this workflow:
1. Determine your assignee and list ready beads:
   - Worker: `bd ready --assignee worker`
   - Overseer: `bd ready --assignee overseer`
2. If a bead is found, move it to in_progress: `bd update <id> --status in_progress`
3. Read the bead details and handoff packet
4. Load skills listed under `## Skills`
5. Do the work for your role (worker: implement + local commit; overseer: run checks + approve/return)
6. Update the bead status and comments
7. Check for more ready beads and repeat

If no ready beads are found, report that and wait for new work.
