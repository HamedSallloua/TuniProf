## Status: M0 done, waiting for the owner's "go" for M1 (updated 2026-10-25)

### Done

- [x] M0 Foundations (2026-10-25)

### Now

- [ ] M1 Database foundation and catalogues (not started, waiting for "go" and the délégations CSV)

### M0 results (2026-10-25)

- Git repository on `main`, pushed to https://github.com/HamedSallloua/TuniProf.git on 2026-10-25 (owner approved). The first GitHub Actions run on commit `25ffe3f` succeeded: install, lint, typecheck, format check, test database reset, tests, build, all green.
- Next.js 16 + TypeScript + Tailwind 4; `next-intl` with French unprefixed and Arabic under `/ar` (`dir="rtl"`); header, footer, language switcher, bilingual 404; design tokens; ESLint, Prettier, typecheck.
- PostgreSQL 18 locally: `tuniprof_dev` and `tuniprof_test` rebuilt with `npm run db:reset` and `npm run db:reset:test`; extensions pgcrypto, btree_gist, pg_trgm present.
- `/healthz` returns 200 with the database up.
- `npm test`: 12 passed, 0 skipped (messages, routing, migrations against the real test database).
- `npm run lint`, `typecheck`, `format:check`, `build`, `npm audit` (0 vulnerabilities): all pass.
- `/`, `/ar`, `/healthz`, `/favicon.ico` return 200; unknown URLs return 404.
- CI workflow (`.github/workflows/ci.yml`) verified on GitHub.

### Blockers waiting on owner

- M1: official list of délégations (CSV, about 264 rows).
- M4: the Arabic payment helper lines, word for word (not in `docs/SPEC.md`). Also beneficiary name, Flouci number, CCP number, D17 details, working hours.
- M2: platform WhatsApp number and Meta Cloud API credentials (dev stub is used until then).
- Review the Arabic strings in `docs/GLOSSARY.md`.

### Known bugs / tech debt

- The language switcher keeps the path but drops query strings (for example search filters). Revisit at M5.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md, 2026-10-25). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo.
- The header shows the brand as text only, until the logo arrives.
- Running `npm ci` fails on Windows while a dev server is running (it locks native files in `node_modules`). Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
