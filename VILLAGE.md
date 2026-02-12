Agentic Village (Global)

This config repo defines a 3-agent village:
- `mayor`
- `worker`
- `overseer`

Key pieces

- Agents: `agents/mayor.md`, `agents/worker.md`, `agents/overseer.md`
- Plugin: `plugins/village.ts`
  - Injects `BD_ACTOR`
  - Adds tools: `village_spawn`, `village_wake`
- Public skills: `skills/*/SKILL.md`
- Private skills (local-only): `skills-private/*/SKILL.md` (gitignored)

Private skills

1. Create a private skill folder:
   - `~/.config/opencode/skills-private/project-myrepo/SKILL.md`
2. Keep private skills free of secret values (no private keys, tokens, seed phrases).

Running the workflow

1. Start OpenCode in your project repo and use `mayor`.
2. Mayor drafts epic + child beads (each bead includes `## Skills`).
3. After human approval, mayor creates beads with `bd create`.
4. Mayor activates the village by calling `village_spawn`.
5. Worker implements, commits locally, then reassigns bead to overseer.
6. Overseer runs checks and either closes the bead or returns it to worker.

Notes

- Spawning multiple workers in the same git working directory can cause conflicts.
