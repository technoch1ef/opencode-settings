---
name: stack-typescript
description: TypeScript/Node repo conventions, common scripts, and verification commands.
---

## Detection
- `package.json` exists
- Package manager heuristics:
  - `pnpm-lock.yaml` => pnpm
  - `yarn.lock` => yarn
  - `package-lock.json` => npm
  - `bun.lockb` or `bun.lock` => bun

## Worker rules
- Do not run tests (leave for overseer)
- Prefer running formatters when available (e.g. `npm run format`)
- Keep changes minimal and aligned with existing patterns

## Overseer verification
- Use the repo's scripts first (inspect `package.json`)
- Typical commands (pick the ones that exist):
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`

## Common pitfalls
- Update types when changing runtime behavior
- Keep imports consistent with existing lint rules
- Avoid introducing new tooling unless requested

## Check Matrix

Guard runs these commands in order. Use the repo's `package.json` scripts when available;
fall back to the generic command if no script exists. Detect the package manager from lock files
(`pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `bun.lockb`/`bun.lock` -> bun, default -> npm).

| Check | Command | Notes |
|-------|---------|-------|
| Lint | `<pm> run lint` | Skip if no `lint` script in package.json |
| Typecheck | `<pm> run typecheck` or `npx tsc --noEmit` | Prefer script; fall back to tsc |
| Test | `<pm> test` or `<pm> run test` | Skip if no `test` script in package.json |
| Build | `<pm> run build` | Skip if no `build` script in package.json |

Where `<pm>` is the detected package manager (npm / pnpm / yarn / bun).

Run ALL checks even if one fails early — report the full matrix.

## Review Checklist
- Types match runtime behavior (no `any` casts or `as` escapes without justification)
- Imports are consistent with existing lint rules (no unused imports, correct ordering)
- No `console.log` / `console.debug` left in production code
- No hardcoded secrets, URLs, or environment-specific values
- Error handling is present (no silently swallowed errors)
- New exports are added to barrel files if the project uses them
