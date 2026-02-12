---
name: beads-workflow
description: Beads-based epic/task workflow with skill-driven workers and overseer reviews.
---

## Bead body template (recommended)

Include these sections in every implementation bead:

```md
## Context

## Skills
- beads-workflow
- stack-<...>

## Branch
`epic/<name>`

## Acceptance Criteria
- [ ] ...

## Notes
```

## Roles
- Mayor: research, ask clarifying questions, draft epic + child beads, include `## Skills`, create beads with `bd`, spawn workers; no code changes
- Worker: implement bead only; may create local commits; no pushes; no test runs
- Overseer: run linters/tests/build; approve or send back; close beads

## Status + assignee flow (recommended)
- Mayor creates child beads assigned to `worker` (status defaults to `open`)
- Worker:
  - Start work: `bd update <id> --assignee worker --status in_progress`
  - Handoff: `bd update <id> --assignee overseer --status open`
- Overseer:
  - Start review: `bd update <id> --assignee overseer --status in_progress`
  - Approve: `bd close <id> --reason "Approved"`
  - Request changes: `bd update <id> --assignee worker --status open`
- Use `blocked` when genuinely blocked, not for "in review".

## Private skills (centralized)
- Store private, per-project skills in: `~/.config/opencode/skills-private/<name>/SKILL.md`
- Keep private skills free of secret values (no private keys, tokens, seed phrases)
