## Status: M0 in progress, waiting on the owner for the local database (updated 2026-10-25)

### Done

- [ ] M0 Foundations (code finished, not ticked until the database steps below are verified)

### Now: M0 checklist

- [x] Git repository (branch `main`), remote `origin` set to https://github.com/HamedSallloua/TuniProf.git (nothing pushed yet)
- [x] Next.js 16 + TypeScript + Tailwind 4 at the repo root
- [x] `next-intl`: French default without URL prefix, Arabic under `/ar`, `dir="rtl"` on Arabic pages
- [x] Layout: header, footer, language switcher, skip link, bilingual 404 page
- [x] Design tokens (brand colours `#003801`, `#fce3c5`, `#633601`), Inter + Noto Sans Arabic loaded locally
- [x] ESLint + Prettier + `npm run typecheck`
- [x] `.env.example`, `BRAND_NAME` constant
- [x] PostgreSQL connection (Drizzle + `pg`), ordered SQL migrations in `db/migrations/`, `db:migrate` and `db:reset` (dev and test)
- [x] `/healthz`
- [x] Vitest: messages, routing, migrations tests
- [x] GitHub Actions CI (lint, typecheck, format, db reset, tests, build)
- [x] `docs/` memory files
- [ ] Owner creates the local databases (`db/setup-local.sql`) and `.env.local`
- [ ] `npm run db:reset` verified on the real database; the 3 database tests run instead of being skipped
- [ ] First push to GitHub and green CI run (needs the owner's go to push)

### Test results (2026-10-25)

- `npm run lint`: pass. `npm run typecheck`: pass. `npm run build`: pass.
- `npm test`: 9 passed, 3 skipped (the 3 database tests, skipped because no test database exists yet on this machine).
- Checked in the browser on the production build: `/` French left-to-right, `/ar` Arabic right-to-left, language switch works both ways, unknown URLs return a real 404.

### Blockers waiting on owner

- Run the database setup (commands given at the end of the M0 report), then create `.env.local`.
- Say "push" so I can push `main` to GitHub and check that CI is green.
- M1: official list of délégations (CSV).
- M4: the Arabic payment helper lines, word for word. They are not in `docs/SPEC.md`, so I cannot translate or invent them. Also: beneficiary name, Flouci number, CCP number, D17 details, working hours.
- M2: platform WhatsApp number and Meta Cloud API credentials (dev stub is used until then).

### Known bugs / tech debt

- The language switcher keeps the path but drops query strings (for example search filters). Revisit at M5.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md, 2026-10-25). Re-check after Next.js upgrades.
- The tab icon `app/icon.svg` is a plain placeholder until the owner sends the logo.
- The header shows the brand as text only, until the logo arrives.
