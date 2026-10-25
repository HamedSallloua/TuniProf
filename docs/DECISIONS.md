# Decisions log

Dated record of every choice not fixed by the spec. Newest at the bottom of each day.

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
- **Placeholder tab icon** (`app/icon.svg`: cream "T" on green) until the logo arrives.
- **CI:** GitHub Actions, PostgreSQL 16 service container, Node 24.
