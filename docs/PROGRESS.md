## Status: M1 code finished, waiting for the délégations CSV (updated 2026-10-25)

### Done

- [x] M0 Foundations (2026-10-25). First GitHub CI run green.

### Now: M1 Database foundation and catalogues

- [x] Migrations: `updated_at` trigger function, catalogue tables `governorates`, `delegations`, `levels`, `subjects`, `plans` (uuid keys, slugs, FR/AR names, database checks)
- [x] Seed (as migrations): 24 governorates, 16 levels, 17 subjects, 4 plans (prices in millimes, semestriel 72.000)
- [x] Import script for délégations from CSV (`npm run db:import:delegations`), also run by `db:reset` when `db/data/delegations.csv` exists; format in `db/data/README.md`
- [x] Drizzle schema for the five tables, with a test that fails if it drifts from the database
- [x] `npm run db:reset` rebuilds everything (dev and test), 7 migrations
- [x] SQL tests: seed counts and values, database refuses bad data (negative price, bundle cheaper than visibility, duplicate slug, orphan délégation, deleting a governorate in use), `updated_at` moves
- [ ] **Délégations loaded (about 264)**: waiting for the owner's CSV. Then the skipped test "has every délégation of db/data/delegations.csv" runs and checks the count.
- [ ] Pushed to GitHub (local commits only, owner decides when)

### Test results (2026-10-25)

- `npm test`: 47 passed, 1 skipped (the délégations count test, skipped because the CSV does not exist yet).
- `npm run lint`, `typecheck`, `format:check`: pass.
- Import command tried by hand on a throwaway CSV (`;` separator, quotes, accents): works; a bad file lists all errors and imports nothing. The test database was rebuilt afterwards, so no fake rows remain.

### Blockers waiting on owner

- M1: official list of délégations as `db/data/delegations.csv` (format in `db/data/README.md`). Without it, the délégation dropdown in the profile form (M3) has nothing to show.
- Review the Arabic names of governorates, levels, subjects and plans (`docs/GLOSSARY.md`). They are a draft.
- M4: the Arabic payment helper lines, word for word (not in `docs/SPEC.md`). Also beneficiary name, Flouci number, CCP number, D17 details, working hours.
- M2: platform WhatsApp number and Meta Cloud API credentials (dev stub is used until then).

### Known bugs / tech debt

- The language switcher keeps the path but drops query strings (for example search filters). Revisit at M5.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo.
- The header shows the brand as text only, until the logo arrives.
- Running `npm ci` fails on Windows while a dev server is running. Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
- The délégation import overwrites names on re-run (meant for the first load only).
- Production: after the first deploy, run `npm run db:migrate`, then `npm run db:import:delegations` once (M12 checklist).
