# Decisions log

Dated record of every choice not fixed by the spec. Newest at the bottom of each day.

## 2026-10-25 (M1)

- **Catalogue keys:** uuid primary key plus a unique `slug` on every catalogue (slug is used in URLs such as `/sfax/mathematiques` and by seed and import scripts). A database check forces slugs to be lowercase letters, digits and dashes.
- **Names:** `name_fr` and `name_ar` columns on every catalogue. Arabic is optional only for délégations (the owner's list may not have it); the others are required.
- **Levels:** French names follow the spec literally ("Primaire 1" ... "Université L3"), with `cycle` and `grade` columns so the profile form can offer group shortcuts (spec 4.2). 16 levels in total.
- **"Autre" subject:** not a row. `subjects.status` is `approved` or `pending`; a teacher's own subject is added as `pending` at M3 until an admin approves it (M11).
- **Plans:** columns `price_visibility_millimes` and `price_with_dashboard_millimes` (the bundle price, as in spec 2.1). The "add-on" price used for upgrades (spec 2.2) is derived (bundle minus visibility), never stored. Saving percentages are not stored either. Database check: bundle price is never below visibility-only.
- **Seeds are migrations** (0003 to 0006), so a new server gets the same data from `npm run db:migrate`. They use `ON CONFLICT DO NOTHING`, so later admin edits are never overwritten.
- **Délégations are not a migration**: they come from the owner's CSV through `npm run db:import:delegations`, as the spec asks. `db:reset` loads `db/data/delegations.csv` automatically when it exists. The import accepts `;` or `,` and finds the governorate by French name, slug or Arabic name.
- **Delete rules:** a governorate with délégations cannot be deleted (foreign key). Catalogue rows are meant to be switched off with `is_active`, not deleted.
- **Drizzle schema** (`lib/db/schema.ts`) mirrors the five tables; the SQL migrations stay the source of truth, and a test compares columns and nullability.
- **Database tests check SQLSTATE codes**, never message text: the owner's PostgreSQL answers in French, so text matching broke.
- **Catalogues have no row-level security** (public reference data). RLS comes with teacher data (M12).
- **Windows lesson:** editing UTF-8 files with PowerShell 5.1 `Get-Content` / `Set-Content` corrupts accents and adds a BOM. It happened once to a test file (caught by the tests) and added a BOM to four small files (fixed). From now on files are edited only with the editor tools, never with PowerShell text commands.
- **Arabic names** of governorates, levels, subjects and plans are a draft for the owner to review (GLOSSARY.md).

## 2026-10-25 (M0)

### Differences between SPEC.md and AGENT_CONTEXT.md, and the owner's rulings

| Topic                              | Difference                                                                    | Ruling                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Row-level security                 | Context: required at M12. Spec: "optional".                                   | Implement it at M12 (owner).                                                   |
| Password hashing                   | Spec 8.2: "by the auth service". Context and spec 8.1: custom auth, argon2id. | argon2id, the more explicit security requirement (owner).                      |
| Deletion warnings                  | Spec 2.5: email/WhatsApp. Spec section 9: email + on-site banner.             | Send all channels: email, WhatsApp copy-paste message, on-site banner (owner). |
| `payment_requests.transaction_ref` | In Context, not in the spec table. Spec 13.3 needs it.                        | Keep the column (owner).                                                       |

### Owner decisions

- **Reviewer accounts (affects M2 schema):** `users.password_hash` is nullable, `NULL` only for light reviewer (visitor) accounts. Reviewers must pass a fresh WhatsApp verification for each new session (code expires, single use, rate limited). Teachers and admins always have a password. Reviewer permissions are strictly limited to writing reviews. M2 schema must enforce this with a database check (role other than visitor requires a password hash).
- **Language URLs:** French has no prefix (`/recherche`), Arabic uses `/ar/recherche`.
- **Migrations:** Drizzle ORM for queries, hand-written SQL migrations in `db/migrations/`, run by our own small runner (`db/migrate.ts`). Drizzle's migration generator is not used.
- **Colours:** main `#003801`, secondary `#fce3c5`, third `#633601`, neutral warm background derived from them. Logo and button/link images to come from the owner.
- **No emojis** anywhere in the UI, code or messages. A test enforces it on the message files.
- **Arabic:** Modern Standard Arabic. I draft, the owner reviews (see GLOSSARY.md).
- **Anonymous "device" for rate limits (M5):** an httpOnly cookie plus a hashed IP.
- **Package manager:** npm. Latest stable Next.js, Tailwind, next-intl.

### Technical decisions (mine)

- **Versions installed:** Next.js 16.4.3, React 19.3, Tailwind 4.3, next-intl 4.14, Drizzle ORM 0.45, pg 8, Vitest 5, Prettier 3.9, TypeScript 5.9, Node 24 (owner's machine), PostgreSQL 18 (owner's machine; spec requires 14+).
- **`cacheComponents` turned off.** The Next.js scaffold enables this advanced caching mode; it forces extra rules on every page. Not needed, so it is off to keep the code boring.
- **`middleware` is called `proxy.ts`** in Next.js 16 (same function, new name). Used for the language routing.
- **Fonts:** Inter (Latin) and Noto Sans Arabic, installed as npm packages (`@fontsource-variable/*`) so nothing is fetched from Google at runtime. The browser downloads only the character ranges a page uses.
- **404 page:** with the root layout under `[locale]`, Next.js cannot render a normal not-found page (tested: blank page). Fix: the experimental `globalNotFound` flag and `app/global-not-found.tsx`, a bilingual French and Arabic page built from the message files. Alternatives rejected: showing the 404 content with a 200 status (bad for search engines).
- **Migration runner:** each file in its own transaction, name order, SHA-256 checksum stored so an edited, already-applied file is refused, advisory lock against two runners at once. File names must look like `0001_name.sql`.
- **`db:reset` safety:** refuses unless the database name ends with `_dev` or `_test`, and never when `NODE_ENV=production`.
- **Env files:** scripts use Node's `--env-file-if-exists=.env.local`; no `dotenv` package.
- **`drizzle-kit` not installed** (not used, and it pulled in packages with known vulnerabilities). `npm audit` is clean.
- **`@types/node` 24** instead of the scaffold's 20, required by Vitest 5 and matching the owner's Node 24.
- **Translations are type-checked:** `types/next-intl.d.ts` ties keys to `messages/fr.json`.
- **Time zone** `Africa/Tunis` is set in `i18n/request.ts` for formatting.
- **Language switcher** links keep the page path; query strings are dropped for now (tech debt).
- **Placeholder tab icon** (`app/icon.svg`: cream "T" on green) until the logo arrives. Browsers also ask for `/favicon.ico` on their own, so `next.config.ts` redirects it (temporary, not permanent) to `/icon.svg`. Alternative rejected: generating a binary `.ico` for a placeholder that will be replaced.
- **CI:** GitHub Actions, PostgreSQL 16 service container, Node 24.
