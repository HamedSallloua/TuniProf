## Status: M1 done, waiting for the owner's "go" for M2 (updated 2026-10-25)

### Done

- [x] M0 Foundations (2026-10-25). First GitHub CI run green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded in the development and test databases.

### M1 details

- [x] Migrations: `updated_at` trigger function, catalogue tables `governorates`, `delegations`, `levels`, `subjects`, `plans` (uuid keys, slugs, FR/AR names, database checks)
- [x] Seed (as migrations): 24 governorates, 16 levels, 17 subjects, 4 plans (prices in millimes, semestriel 72.000)
- [x] Import script for délégations from CSV (`npm run db:import:delegations`), also run by `db:reset` when `db/data/delegations.csv` exists; format in `db/data/README.md`
- [x] Drizzle schema for the five tables, with a test that fails if it drifts from the database
- [x] `npm run db:reset` rebuilds everything (dev and test), 7 migrations
- [x] SQL tests: seed counts and values, database refuses bad data (negative price, bundle cheaper than visibility, duplicate slug, orphan délégation, deleting a governorate in use), `updated_at` moves
- [x] **Délégations loaded: 279** from the owner's `db/data/delegations.csv` (see DECISIONS.md for the 4 edits made with the owner's approval and why it is 279, not 264)
- [ ] Pushed to GitHub (4 local commits are not pushed, owner decides when)

### Test results (2026-10-25)

- `npm run db:import:delegations` into the development database (no reset): 279 rows, run twice, same result. Same for the test database. Direct count in both: 279 délégations, every governorate has at least 1, 0 without an Arabic name.
- Per governorate: Tunis 21, Ariana 7, Ben Arous 12, Manouba 8, Nabeul 16, Zaghouan 6, Bizerte 14, Béja 9, Jendouba 9, Le Kef 12, Siliana 11, Sousse 16, Monastir 13, Mahdia 13, Sfax 16, Kairouan 13, Kasserine 13, Sidi Bouzid 14, Gabès 13, Médenine 9, Tataouine 8, Gafsa 13, Tozeur 6, Kébili 7.
- `npm test`: 49 passed, 0 skipped (including "has every délégation of db/data/delegations.csv"), also after `npm run db:reset:test` (the path CI takes).
- `npm run lint`, `typecheck`, `format:check`: pass.

### Blockers waiting on owner

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
- Délégation spelling variants kept as in the owner's file (reference sources differ): Ettadhamen, Mdhilla, Sayada-Lamta-Bou Hajar, Beni Mhira, Tameghza. They only affect slugs, which are not used in public URLs.
- Owner to confirm the Arabic "الحبيب ثامر بوعطوش" for Habib Thameur Bouatouch (Gabès).
- Production: after the first deploy, run `npm run db:migrate`, then `npm run db:import:delegations` once (M12 checklist).
