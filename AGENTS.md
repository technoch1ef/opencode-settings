# Repo Context

This repository is the global OpenCode configuration at `~/.config/opencode`.

It sets up an **Agentic Village** workflow (mayor/worker/guard/inspector/envoy) backed by **Beads** (`.beads/`) for AI-native issue tracking.

Village workflow comes from [`@technoch1ef/opencode-village`](https://github.com/technoch1ef/opencode-village) (npm).
To customize, edit installed assets under `~/.config/opencode/{agents,commands,skills}/` after `init`.

If you were dropped into a new/compacted session, run `br prime` to recover Beads context.

## What Lives Where

- OpenCode config entrypoint: `opencode.json`
- Agents (role prompts, installed from village plugin): `agents/`
- Slash commands (installed from village plugin): `commands/`
- Public skills (installed from village plugin): `skills/*/SKILL.md`
- Private, local-only skills (gitignored): `skills-private/*/SKILL.md`
- Themes and misc tooling: `themes/`, `tools/`

## Village Model

- `mayor`: clarifies scope, researches, creates beads (epic + child tasks)
- `worker`: implements exactly what a bead asks for, makes local commits, hands off to inspector (no tests, no pushes)
- `guard`: runs checks (tests/linters/build), closes beads or returns them with actionable feedback (no edits, no pushes)
- `inspector`: read-only judgment — AC coverage, scope check, regression sniff
- `envoy`: pushes, creates PRs, handles releases (optional terminal step)

## Beads Rules 

**Note:** `br` is non-invasive and never executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

- Use Beads for all work tracking (`br create`, `br update`, `br close`)
- Do not use markdown files (or TodoWrite/TaskCreate) as a task tracker
- Keep skills/beads free of secrets (no tokens/keys/seed phrases)

## Quick Reference

```bash
br ready
br list --status open
br show <id>
br update <id> --status in_progress
br close <id> --reason "..."
```

## Shell Snippets (Copy/Paste Safe)

- Avoid literal `\n` tokens between commands (e.g. `br create ...; \nbr update ...`); in zsh/bash, `\nbr` is parsed as `nbr`.
- Prefer fenced code blocks with real newlines:

```bash
br create "..."
br update <id> --status in_progress
```

- If a single line is required, prefer `&&` or `;` separators:

```bash
br create "..." && br update <id> --status in_progress
```

## Session Close Protocol

This repo commonly works on an ephemeral branch with no upstream. Code is merged to `main` locally; do not rely on pushing a feature branch.

```bash
git status
git add <files>
br sync --flush-only
git add .beads/
git commit -m "..."
```

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Note:** `br` is non-invasive and never executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
br ready
br list --status=open
br show <id>
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>
br sync --flush-only
git add .beads/
git commit -m "sync beads"
```

### Workflow Pattern

1. Start: Run `br ready` to find actionable work
2. Claim: Use `br update <id> --status=in_progress`
3. Work: Implement the task for your role
4. Complete: Use `br close <id>`
5. Sync and commit:
   ```bash
   br sync --flush-only
   git add .beads/
   git commit -m "sync beads"
   ```

### Key Concepts

- Dependencies: Issues can block other issues. `br ready` shows only unblocked work.
- Priority: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- Types: task, bug, feature, epic, question, docs

### Session Protocol

Before ending any session:

```bash
git status
git add <files>
br sync --flush-only
git add .beads/
git commit -m "..."
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress -> closed)
- Create new issues with `br create` when you discover follow-ups
- Always run `br sync --flush-only` followed by `git add .beads/ && git commit` before ending a session

<!-- end-bv-agent-instructions -->
