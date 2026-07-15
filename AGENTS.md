# Repo Context

This repository is the global OpenCode configuration at `~/.config/opencode`.

It sets up an **Agentic Village** workflow (mayor/worker/guard/inspector/envoy) for big, multi-task projects.

Village workflow comes from [`@technoch1ef/opencode-village`](https://github.com/technoch1ef/opencode-village) (npm).
To customize, edit installed assets under `~/.config/opencode/{agents,commands,skills}/` after `init`.

## Role Scoping (IMPORTANT)

The village workflow and its issue tracker are reserved for the village roles
(`mayor`, `worker`, `guard`, `inspector`, `envoy`). Village roles get their
working instructions from their agent prompts and the `village-workflow` skill.

If you are any other agent (`build`, `plan`, `explore`, `general`, or a custom agent):

- Track session work with **TodoWrite** only.
- Do not run `br`/`bv` commands, do not touch `.beads/` directories, and do not
  load the `village-workflow` skill — even if repo files mention them.
- If the user asks for a big, multi-step project that deserves structured
  tracking and role separation, suggest switching to the `mayor` agent instead
  of starting it yourself.

## What Lives Where

- OpenCode config entrypoint: `opencode.json`
- Agents (role prompts, installed from village plugin): `agents/`
- Slash commands (installed from village plugin): `commands/`
- Public skills (installed from village plugin): `skills/*/SKILL.md`
- Private, local-only skills (gitignored): `skills-private/*/SKILL.md`
- Themes and misc tooling: `themes/`, `tools/`

## Village Model

- `mayor`: clarifies scope, researches, creates the epic + child tasks
- `worker`: implements exactly what a task asks for, makes local commits, hands off (no tests, no pushes)
- `guard`: runs checks (tests/linters/build), closes tasks or returns them with actionable feedback (no edits, no pushes)
- `inspector`: read-only judgment — AC coverage, scope check, regression sniff
- `envoy`: pushes, creates PRs, handles releases (optional terminal step)

## Secrets

Keep config, skills, and task bodies free of secrets (no tokens/keys/seed
phrases). Use `{env:VAR}` interpolation in `opencode.json` instead of literals.

## Session Close Protocol

This repo commonly works on an ephemeral branch with no upstream. Code is merged to `main` locally; do not rely on pushing a feature branch.

```bash
git status
git add <files>
git commit -m "..."
```

(Village roles additionally follow the beads sync steps in the `village-workflow` skill.)
