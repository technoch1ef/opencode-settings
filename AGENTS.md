# Repo Context

This repository is the global OpenCode configuration at `~/.config/opencode`.

It sets up an **Agentic Village** workflow (mayor/worker/overseer) backed by **Beads** (`.beads/`) for AI-native issue tracking.

If you were dropped into a new/compacted session, run `bd prime` to recover Beads context.

## What Lives Where

- Agents (role prompts + constraints): `agents/mayor.md`, `agents/worker.md`, `agents/overseer.md`
- Village plugin (claim/scaffold tools + event handlers): `plugins/village.ts`
- OpenCode config entrypoint: `opencode.json`
- Slash commands (e.g. `/village:work`): `commands/`
- Public skills: `skills/*/SKILL.md`
- Private, local-only skills (gitignored): `skills-private/*/SKILL.md`
- Themes and misc tooling: `themes/`, `tools/`

## Village Model

- `mayor`: clarifies scope, researches, creates beads (epic + child tasks)
- `worker`: implements exactly what a bead asks for, makes local commits, hands off to overseer (no tests, no pushes)
- `overseer`: reviews, runs checks (tests/linters/build), closes beads or returns them with actionable feedback (no edits, no pushes)

Reference: `VILLAGE.md`.

## Beads Rules 

- Use Beads for all work tracking (`bd create`, `bd update`, `bd close`)
- Do not use markdown files (or TodoWrite/TaskCreate) as a task tracker
- Keep skills/beads free of secrets (no tokens/keys/seed phrases)

## Quick Reference

```bash
bd ready
bd list --status open
bd show <id>
bd update <id> --status in_progress
bd close <id> --reason "..."
```

## Shell Snippets (Copy/Paste Safe)

- Avoid literal `\n` tokens between commands (e.g. `bd create ...; \nbd update ...`); in zsh/bash, `\nbd` is parsed as `nbd`.
- Prefer fenced code blocks with real newlines:

```bash
bd create "..."
bd update <id> --status in_progress
```

- If a single line is required, prefer `&&` or `;` separators:

```bash
bd create "..." && bd update <id> --status in_progress
```

## Session Close Protocol

This repo commonly works on an ephemeral branch with no upstream. Code is merged to `main` locally; do not rely on pushing a feature branch.

```bash
git status
git add <files>
bd sync --from-main
git commit -m "..."
```

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
bd ready
bd list --status=open
bd show <id>
bd create --title="..." --type=task --priority=2
bd update <id> --status=in_progress
bd close <id> --reason="Completed"
bd close <id1> <id2>
bd sync
```

### Workflow Pattern

1. Start: Run `bd ready` to find actionable work
2. Claim: Use `bd update <id> --status=in_progress`
3. Work: Implement the task for your role
4. Complete: Use `bd close <id>`
5. Sync: Use `bd sync` to keep Beads/git consistent

### Key Concepts

- Dependencies: Issues can block other issues. `bd ready` shows only unblocked work.
- Priority: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- Types: task, bug, feature, epic, question, docs

### Session Protocol

Before ending any session:

```bash
git status
git add <files>
bd sync --from-main
git commit -m "..."
bd sync
```

### Best Practices

- Check `bd ready` at session start to find available work
- Update status as you work (in_progress -> closed)
- Create new issues with `bd create` when you discover follow-ups
- Always run `bd sync` before ending a session

<!-- end-bv-agent-instructions -->
