---
name: stack-solana
description: Solana (Anchor-first) Rust programs + TS client workflow, security notes, and verification commands.
---

## Detection
- Anchor project: `Anchor.toml` exists OR a program `Cargo.toml` depends on `anchor-lang`
- Native Solana program: depends on `solana-program` without `anchor-lang`
- TS client/tests: `package.json` uses `@coral-xyz/anchor` and/or `@solana/web3.js`

## Common layout
- `Anchor.toml`
- `programs/<program>/src/lib.rs`
- `tests/*.ts` (Anchor)
- `migrations/` (Anchor)

## Worker rules
- Do not run tests: avoid `anchor test` and `cargo test`
- Formatting is OK: `cargo fmt`
- Never include secrets in chat, commits, or logs: seed phrases, private keys, `id.json`, RPC tokens

## Overseer verification (run the repo's canonical scripts first)
- Prefer repo scripts (Makefile, package.json, justfile) if present
- Anchor:
  - `anchor build`
  - `anchor test`
- Rust:
  - `cargo fmt --all -- --check`
  - `cargo clippy --all-targets --all-features -D warnings`

## Solana security spot-check
- Authority checks: explicit `Signer`/owner/authority validation
- Anchor constraints: `#[account(...)]` has the right `has_one`, seeds, bumps, and ownership rules
- Math safety: checked math for amounts/fees; avoid unchecked casts
- CPI signer seeds: correct seeds/bump; no user-controlled seed injection
- Close/realloc/rent: funds go to expected recipient; no data corruption
- Logging: `msg!` does not print secrets

## Check Matrix

Guard runs these commands in order. Prefer repo scripts (Makefile, package.json, justfile) when present.

**Rust / Anchor program checks:**

| Check | Command | Notes |
|-------|---------|-------|
| Format | `cargo fmt --all -- --check` | Fail if unformatted code |
| Clippy | `cargo clippy --all-targets --all-features -D warnings` | Treat warnings as errors |
| Build | `anchor build` (Anchor) or `cargo build` (native) | Use anchor build if `Anchor.toml` exists |
| Test | `anchor test` (Anchor) or `cargo test` (native) | Use anchor test if `Anchor.toml` exists |

**TypeScript client checks (if `package.json` exists alongside programs):**

| Check | Command | Notes |
|-------|---------|-------|
| Lint | `<pm> run lint` | Skip if no `lint` script |
| Typecheck | `<pm> run typecheck` or `npx tsc --noEmit` | Prefer script; fall back to tsc |
| Test | `<pm> test` | Skip if no `test` script |

Where `<pm>` is the detected package manager (npm / pnpm / yarn / bun).

Run ALL checks even if one fails early — report the full matrix.

## Review Checklist
- Account validation constraints are present and correct (`has_one`, `seeds`, `bump`, `constraint`)
- No `unwrap()` on user-controlled data; use proper error handling
- Checked arithmetic for all token amounts and fees
- CPI calls use correct signer seeds with no user-controlled seed injection
- No hardcoded pubkeys or private keys in source
- IDL changes are backward-compatible (no removed fields/instructions without migration)
- Test coverage addresses the happy path and at least one error case
