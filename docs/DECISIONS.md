# Decisions log

Dated record of every choice not fixed by the spec. Newest at the bottom of each day.

## 2026-10-27 (M4)

AGENT_CONTEXT and the spec agree on M4. Choices not fixed by the spec:

**Entitlements**

- **Two independent dates** per teacher: `visibility_until` and `dashboard_until` (spec 2.1). A plan with Dashboard extends both; Dashboard never extends visibility by itself.
- **Extending** starts from the later of "now" and the current end date, so renewing early loses no day. Plans count in nominal days (30, 90, 180, 365).
- **Credit before approval:** days bought or given while the profile is not approved wait in `pending_visibility_days` and `pending_dashboard_days`; they start at approval (`startCredit`), so a teacher never pays for days spent in the review queue.
- **One SQL definition of visibility:** `teacher_is_visible(user, at)` (approved, listed, not suspended, `visibility_until` in the future) and the view `visible_teacher_profiles`, which never exposes the phone number. M5 search and profile pages must read this view (invariant 1).
- **Grace period** of 30 days of read-only Dashboard access after expiry (`GRACE_DAYS`).
- **Founding offer:** taken inside the approval transaction with `UPDATE settings ... WHERE used < total` (so two simultaneous approvals cannot take the same last place), one claim per phone number (`founding_claims` stays even if the account is deleted), 365 days of visibility and Dashboard (settings `founding.grant_visibility` and `founding.grant_dashboard`, both true: the owner has not yet confirmed that the free year includes the Dashboard). Sign-up shows the places left.

**Payments and codes**

- **One open payment request per teacher** (partial unique index); the price is copied into the request when it is created, so a later price change never alters a request already given to a teacher.
- **Reference** `TTP-` + 5 digits, unique, written by the teacher on the payment.
- **The same proof never twice:** `transaction_ref` is unique among verified requests, so a reused receipt is refused at the database (SQLSTATE 23505), not only in the form.
- **Activation code** `TTP-XXXX-XXXX-XXXX` (12 characters without look-alikes), derived from the request id and `AUTH_SECRET`; only an HMAC hash is stored. The admin page re-derives it to show it again, and the teacher sees it on their Abonnement page. Bound to one request and one teacher, valid 90 days (setting `codes.expiry_days`), single use. Cancelling a code closes the request as refused.
- **Redeem lockout:** 5 wrong codes within one hour lock redemption until one hour after the last failure. (A first version counted failures in a sliding hour and unlocked too early; found by a test and fixed.)
- **Upgrade price** (adding the Dashboard mid-term) = (bundle price - visibility price) x remaining days / plan days, rounded to the nearest 0.5 DT. It grants the remaining visibility days as Dashboard days. This formula is mine; the spec only says the price is prorated. Easy to change in `lib/billing/plans.ts`.
- **Manual grant** by an admin requires a note and writes an `entitlement_grants` row and an `audit_log` row.
- **Payment details are placeholders** in `settings` (`payment.*`). In production the payment page and the request form are hidden until `payment.configured` is true, so a teacher is never told to pay a placeholder CCP number. The Arabic helper lines are not invented: setting `payment.helper_lines_ar` stays empty until the owner sends them.
- **Who can handle payments:** support and super admins both (the spec restricts only prices and settings). Every step is checked in the database as well as on the page and written to `audit_log`.

**Daily job**

- `/api/jobs/daily` answers only a `Authorization: Bearer <CRON_SECRET>` call (compared in constant time); without `CRON_SECRET` set it is off. `npm run job:daily` does the same by hand. For now it only expires old codes; reminders and cleanup join it at M7.

**Screens and code**

- **Class strings for forms and buttons moved to `components/auth/styles.ts`.** They were exported from `ui.tsx` (`'use client'`); a server page that imports a string from a client file gets a client reference, not the text, so the payment form lost all its styling. Rule from now on: shared class strings and other plain values never live in a `'use client'` file.
- Amounts are written "40.500 DT" in French and Arabic (always left to right); numbers inside Arabic sentences use a `<num>` tag so they keep their direction.
- **`kind` label** on the admin screens says "Nouvelle formule" or "Ajout du Dashboard".

**Tests**

- Two JSON keys with the same name silently overwrote each other in `messages/*.json` (found with `subscription.status`); a test now fails on any duplicate key.
- DB tests use an injectable `now` and roll back their transactions, so time-based rules (expiry, lockout, credit) are tested without waiting.

## 2026-10-26 (M3)

AGENT_CONTEXT and the spec agree on M3. Choices not fixed by the spec:

**Database**

- **Rules in the database, not only the form:** a profile can only become `pending` or `approved` if `profile_is_complete()` is true (trigger on status). Only a `teacher` account can own a profile (composite foreign key on `(id, role)`). A zone is a délégation of the profile's governorate (two composite foreign keys), so changing governorate means removing the zones first. This function is the one definition reused for public visibility at M4 and M5 (invariant 1). The "bio has no contact details" rule can only be checked in code, so it lives in `lib/profile/rules.ts`.
- **`settings` and `audit_log` created now** (planned for M4 and M11) so the admin actions of M3 are logged from the start instead of added later. `settings` holds the hourly rate range (`profile.rate_min_millimes` 5000, `profile.rate_max_millimes` 300000).
- **Profile data is nullable while in draft** (progressive saving); completeness is checked at submit, at approval, and after any edit of an approved profile.
- **Plain SQL** (`pg`) for the profile modules too, for the same reasons as auth (locks, small transactions).

**Status machine**

- draft -> pending (teacher submits) -> approved or rejected (admin); rejected -> pending again after the teacher fixes it. A pending profile can still be edited by its owner (it is not public). Suspension is only possible from approved, and restore goes back to approved. A suspended profile cannot be edited, re-listed or submitted.
- **Pending version** covers exactly name, photo, bio and diploma (spec 4.2), stored as JSON on the profile. A second edit replaces the waiting one; changing back to the live values removes it. Approving applies the four fields; refusing keeps the live version and stores the reason shown on the teacher's banner.
- **Public address (`slug`)** is created at the first approval from name + first subject + governorate, made unique with -2, -3, and never changes (name edits later do not change the URL).
- **Refusal reasons:** 8 templates (incomplete info, invalid name, inappropriate photo, contact details in the bio, vague bio, diploma to specify, unrealistic rates, other) plus an optional note; "other" requires a note. Stored as codes, shown to the teacher in their language.
- **Admin review functions check in the database** that the actor is an active admin, in addition to the page guard. Support and super admins can both review (the spec restricts only prices and settings).
- **The admin sees the teacher's phone number** on the review page (needed to judge a profile; teachers consented to display, spec 4.1).
- **Founding offer and credit-before-approval** will hook into `approveProfile` at M4 (a comment marks the place).

**Content rules**

- **Name:** 2-60 characters, letters (Latin or Arabic), spaces, hyphens, apostrophes and dots; no digits or symbols.
- **Bio contact detection:** refuses a run of 8 or more digits (any separators, Arabic digits too, except a year range such as 2015-2020), `@handles` and e-mail addresses, links and web addresses, and the names of messaging and social apps (WhatsApp, Facebook, Instagram, Telegram, TikTok, Snapchat, Messenger, Viber, also in Arabic). The spec says "phone numbers, links and social handles"; refusing app names is my addition, because "contact me on WhatsApp" defeats the reveal button. Easy to relax if the owner finds it too strict.
- **Hourly rates:** typed in DT with a dot or a comma (up to 3 decimals), stored in millimes, range read from the settings.
- **"Autre" subject:** a subject typed by the teacher becomes a `pending` subject owned by that teacher (hidden from the public catalogue); the same name (any letter case) reuses the existing subject; at most 3 waiting subjects per teacher to limit catalogue spam. Approval screen: M11.

**Photos**

- Checked by the file's bytes (never its name or declared type), refused above 2 MB, more than 36 million pixels is refused before decoding, then re-encoded as a **400 x 400 JPEG, centre crop**, quality 82, metadata removed, transparent PNG flattened on white. The file name is a new random id, so replaced photos get a new address and old files are deleted after the save succeeds.
- `StorageProvider` interface with a local-folder implementation (`./uploads`, git-ignored) served by `/media/photos/...`; the S3 version comes at M12.
- Server actions accept bodies up to 3 MB (the default 1 MB is smaller than a photo).

**Screens**

- **The profile form is sent by hand (`onSubmit`) instead of through the form's `action`**: React empties a form after an action, which unticked the levels and zones the teacher had chosen after any validation error (found while testing in the browser).
- Saving a draft is lenient (empty fields allowed, filled fields must be valid); submitting, and every edit of an approved profile, is strict.
- All admin screens are available in French and Arabic like the rest of the site (Arabic is a draft).
- The teacher can pause and resume the public listing (`is_listed`, spec 2.3); it has no visible effect until M5.

**Tests**

- `clearAuthTables` now deletes rows table by table instead of `TRUNCATE ... CASCADE`, which would also have emptied the catalogues and settings (they now point at users).
- A test compares the TypeScript completeness rule with the SQL function on 1,536 combinations of present and missing fields.

## 2026-10-26 (M2)

Owner decisions applied: reviewer accounts have `NULL` password and a fresh WhatsApp check for every session, with strict permissions (see the M0 entry for the full decision). AGENT_CONTEXT and spec agree on the rest of M2.

- **Verification code:** `TTP-` plus 4 characters of the 32-character alphabet (spec 8.5 example `TTP-7KQ2`). It is derived from the challenge id and `AUTH_SECRET` (HMAC), so it is never stored; the database keeps only its keyed hash (`code_hash`), as the spec asks. The screen recomputes the code, and only for the browser that started the challenge.
- **Who can verify:** the webhook looks up the waiting challenge by the SENDER's number. A code sent from any other phone never verifies the typed number; it counts as a wrong try against the challenge that owns the code.
- **Attempts:** "5 attempts" = 5 wrong tries (wrong code, or right code from the wrong phone). After the 5th, the number is locked for 1 hour (also blocks new challenges for that number); the 6th message fails even with the right code (acceptance test 21).
- **One challenge per kind at a time:** starting a new one expires the previous one for that number and purpose.
- **Finishing is bound to the browser:** a verified challenge can be used once, within 5 minutes, only by the browser that started it (anonymous `tp_device` cookie).
- **Device and address:** `tp_device` random cookie (httpOnly, 2 years) hashed with `AUTH_SECRET`, plus a hash of `x-forwarded-for`. Mobile networks share addresses, so the address limits are higher than the cookie limits.
- **Limits (one file, `lib/auth/config.ts`):** starting a WhatsApp check: 5 per phone, 10 per device, 30 per address, per hour. Wrong passwords: 10 per phone, 20 per device, 60 per address, per hour. The spec only says "rate limits"; these numbers are my choice.
- **Password rules:** the spec is silent. I chose 8 to 128 characters, and not containing the phone number. No composition rules. A wrong login never reveals the rules.
- **Login never reveals whether a number has an account** (same message, same work via a dummy hash). Password reset also starts the same way for any number; the person learns "no account" only after proving they own the number. Sign-up does say when a number is already registered (unavoidable for usability).
- **Unverified sign-ups can be redone:** a pending account (number never verified) is replaced by a new sign-up for the same number. Active accounts are never touched.
- **One number = one account = one role.** A teacher or admin number cannot become a reviewer; it signs in with its password.
- **Session lifetimes:** teacher 30 days, reviewer 24 hours, admin 12 hours (my choice; the owner only fixed that reviewers verify again for each new session). Resetting a password signs the account out everywhere.
- **Teacher consents:** two separate timestamped checkboxes (terms, public phone display), both required by a database check for teachers.
- **Email:** optional, stored lowercase, not verified.
- **Admins** are created only with `npm run admin:create` (hidden password prompt), already verified, never through public sign-up.
- **Auth code uses plain SQL** (`pg`) rather than Drizzle: it needs row locks and small transactions. Drizzle stays for ordinary data later.
- **argon2id library:** `@node-rs/argon2` (ready-made binaries, no compiler needed on Windows or Vercel), OWASP settings 19 MiB / 2 passes / 1 thread. Its enum cannot be imported with `isolatedModules`, so the number 2 (argon2id) is written with a comment.
- **WhatsApp provider:** the Cloud API formats (webhook handshake, `X-Hub-Signature-256`, message payload) come from Meta's documentation and are only tested with simulated payloads until the owner's credentials exist. The dev stub can never run in production: `getVerificationProviderName()` always returns `whatsapp` there, and the stub refuses unsigned requests.
- **Dev stub screen:** the "simulate the WhatsApp message" button calls exactly the same function as the webhook.
- **Pages and routes** (French names for both languages, as in the spec routes): `/inscription`, `/connexion`, `/connexion-avis`, `/mot-de-passe-oublie`, `/mot-de-passe-oublie/nouveau`, `/verification`, `/espace-professeur`, `/admin`. All `noindex`.
- **A form that submits itself** (after verification) is guarded to submit once; development mode runs effects twice and a repeated request is also handled on the server (found while testing in the browser).
- **After an error, passwords are cleared** (the browser resets forms); phone, email and the two checkboxes are kept.
- **Phone numbers are always shown left to right** (a `<num>` tag in the messages) even inside Arabic sentences.
- **Test settings:** Vitest sets its own `AUTH_SECRET` and WhatsApp values, so tests never depend on the owner's private settings; database test files run one after the other because some empty the auth tables.
- **Not done on purpose (later milestones):** Turnstile on abuse (M5, M12), cleanup of old rate-limit rows (M7), the CGU link (M5), account state in the header (M3), the review form (M6).

## 2026-10-25 (M1, délégations CSV)

- **Count is 279, not 264.** 264 is the older official figure (2011 decree). The owner's CSV had 278 rows; the English Wikipedia list (a secondary source, itself inconsistent: text says 272, table sums to 279) matches 270 of them exactly after ignoring accents and case. No official list was available to compare against, so newer délégations created since 2011 are plausible but not proven.
- **Four edits to the owner's CSV, all approved by the owner:** added `Nabeul;Hammamet;الحمامات` (missing from the file); in Gabès, `Mareth-Dkhila` became `Mareth` (مارث), `Toujane` became `Dkhilet Toujane` (دخيلة توجان), and `El Hamma Ouest` became `Habib Thameur Bouatouch` (الحبيب ثامر بوعطوش, same délégation under its current name; Arabic name to be confirmed by the owner). Nothing was deleted.
- **Importer accepts a leading article** on the governorate ("La Manouba" for "Manouba", "L'Ariana"). Exact match comes first, so "Le Kef" keeps working. Alternative rejected: editing the owner's rows or renaming the governorate in the database.
- Spelling variants against the reference were left as the owner wrote them (see PROGRESS.md).
- The CSV starts with a BOM (Excel "CSV UTF-8"); the reader strips it.

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
