---
name: stack-ruby-on-rails
description: Ruby on Rails conventions, checks, and review commands (API or monolith).
---

## Detection
- `Gemfile` exists and includes `rails`

## Worker rules
- Do not run the full test suite (leave for overseer)
- Local formatting/autocorrect is OK when repo uses it (e.g. RuboCop)
- Avoid touching production config unless explicitly required

## Overseer verification
- Prefer repo scripts (bin/rails, bin/rubocop, etc.) if present
- Typical commands:
  - `bundle exec rubocop`
  - `bundle exec rspec`
  - `bundle exec brakeman`
  - `rails db:migrate:status`

## Check Matrix

Guard runs these commands in order. Prefer repo scripts (`bin/rails`, `bin/rubocop`, etc.) when present.

| Check | Command | Notes |
|-------|---------|-------|
| Lint | `bundle exec rubocop` | Skip if rubocop not in Gemfile |
| Security | `bundle exec brakeman --no-pager -q` | Skip if brakeman not in Gemfile |
| Test | `bundle exec rspec` or `rails test` | Prefer rspec if `.rspec` exists; else rails test |
| Migrations | `rails db:migrate:status` | Informational; check for pending migrations |

Run ALL checks even if one fails early — report the full matrix.

## Review checklist
- Migrations reversible and safe
- No N+1 queries introduced
- Strong params / auth checks correct
- Background jobs idempotent
