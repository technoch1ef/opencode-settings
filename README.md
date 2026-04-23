# @technoch1ef/opencode-village

An OpenCode plugin that adds a role-driven "Agentic Village" workflow backed by [Beads](https://github.com/Dicklesworthstone/beads_rust) for AI-native issue tracking. Agents claim, implement, review, and verify work through a structured handoff chain.

## Install

```bash
npm install @technoch1ef/opencode-village
npx @technoch1ef/opencode-village init --all
# Restart OpenCode
```

## Roles

| Role | Responsibility |
|------|---------------|
| **mayor** | Research, plan, create epics and child beads with `village_scaffold` |
| **worker** | Implement bead tasks, make local commits, hand off to inspector |
| **inspector** | Read-only judgment: AC coverage, scope check, regression sniff |
| **guard** | Run tests/linters/build, close beads on green or return to worker |
| **envoy** | Push, create PRs, handle releases (optional terminal step) |

**Handoff chain:** mayor &rarr; worker &rarr; inspector &rarr; guard &rarr; envoy (optional)

## Commands

| Command | Description |
|---------|-------------|
| `/village:work` | Trigger the work loop for the current agent's role |
| `/village:board` | Show a read-only at-a-glance view of village state |
| `/village:orphans` | Report and optionally fix unassigned beads |

## Tools

| Tool | Description |
|------|-------------|
| `village_claim` | Deterministically claim the next ready bead (single in_progress guard) |
| `village_handoff` | Atomically hand off a bead to another role with a standardized comment |
| `village_scaffold` | Create an epic + child beads with auto-detected skills and lint validation |
| `village_lint` | Validate an existing bead body for required sections and content |
| `village_board` | Read-only ASCII board showing village state (roles x statuses) |
| `village_detect_stack` | Auto-detect project stack (TypeScript, Solana, Rails) from filesystem signals |
| `village_ensure_branch` | Create or checkout an `epic/*` branch, fast-forward from base |
| `village_orphans` | Report orphan/suspect-assignee beads with optional auto-fix |
| `village_status` | List village sessions under the current root session |
| `village_worktrees` | Manage git worktrees for parallel village sessions |

## Stack auto-detection

`village_scaffold` and `village_detect_stack` automatically detect project stacks:

| Signal | Skill |
|--------|-------|
| `package.json` | `stack-typescript` |
| `Anchor.toml` or `programs/*/Cargo.toml` | `stack-solana` |
| `Gemfile` containing `rails` | `stack-ruby-on-rails` |

Detection walks up to the repo root (`.git`) and scans `packages/*` for monorepo support.

## Customization

### Private skills

Store per-project skills in `~/.config/opencode/skills-private/<name>/SKILL.md`. These are gitignored and loaded alongside public skills.

### Agent overrides

Agents are installed to `~/.config/opencode/agents/`. Edit any agent's markdown file to customize tools, permissions, or workflow instructions. Re-running `init` will prompt before overwriting.

## Smoke test

1. Start with a fresh `~/.config/opencode` (back up existing config if needed)
2. Run `npx @technoch1ef/opencode-village init --all`
3. Start OpenCode
4. Verify the mayor agent loads as the default agent
5. Run `/village:work` in a worker session to confirm the work loop starts

## License

MIT
