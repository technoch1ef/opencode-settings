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
2. Mayor clarifies scope, drafts an epic + child beads, and creates them with `bd create`.
3. Mayor delegates by calling `village_spawn`.
4. Spawned sessions are idle by default. Open each worker/overseer session and run `/work` to start.
5. Optional immediate start: use `village_spawn { kick: true }` or later `village_wake`.
6. Worker implements, commits locally, then reassigns bead to overseer.
7. Overseer runs checks and either closes the bead or returns it to worker.

Notes

- Mayor never makes code/config/doc changes; it only creates beads and delegates work.
- Spawning multiple workers in the same git working directory can cause conflicts.
- `village_wake` is the explicit way to re-send the work-loop prompt to existing sessions.
