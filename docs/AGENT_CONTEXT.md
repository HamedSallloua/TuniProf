# TuniProf: Agent Memory, Context and Build Plan

> Give this file to your AI coding agent **together with the full spec** ("TuniProf, Product & Implementation Specification v1.1").
> Put both in the repo: `docs/AGENT_CONTEXT.md` (this file) and `docs/SPEC.md` (the spec exported as Markdown).
> **If this file and the spec disagree, the spec wins.** Tell the owner about the difference instead of choosing silently.

---

## 0. Kickoff prompt (paste this to the agent first)

```
You are the lead developer of TuniProf (tuniprof.tn), built from scratch.
Read docs/AGENT_CONTEXT.md fully, then docs/SPEC.md fully. Do not write code yet.
1. Reply with: a 10-line summary of the product, the list of milestones M0 to M12 in your own words,
   and every question or assumption you need confirmed (max 10, prioritised).
2. After I answer, start Milestone M0 only. Work one milestone at a time.
3. After each milestone: run the tests, update docs/PROGRESS.md, give me a plain-language summary
   and the exact commands/clicks I need to run to see it working. Then wait for my "go" for the next one.
```

**Per-milestone prompt template** (the owner pastes this for each step):

```
Start milestone M<N> from docs/AGENT_CONTEXT.md. First restate your plan in <=10 bullets and list
the spec sections you will follow. Then implement, test, update docs/PROGRESS.md and docs/DECISIONS.md,
and finish with the "done when" checklist ticked item by item.
```

---

## 1. Project identity

| Item | Value |
|---|---|
| Brand | **TuniProf** (constant `BRAND_NAME`, never hard-code it in text). Domain: **tuniprof.tn** |
| What | Tunisian marketplace for private tutoring, Primaire to Université |
| Platform | **Responsive website only.** No Android/iOS apps, no PWA requirement. Mobile-first |
| Languages | French (default) and Arabic with full RTL layout, from day one |
| Currency | DT (Tunisian dinar). **Store money as integer millimes** (40.500 DT = 40500) |
| Time zone | Africa/Tunis. Dates and times are stored as local `date` and `time`, no conversion |
| Week | Starts Monday |
| Audience | Teachers (pay a plan), parents/students/visitors (free, no account to search) |

**Core idea.** Teachers create an account and profile. The profile stays hidden until a paid plan is active. Visitors search teachers and see contact details (click-to-reveal) without an account. An optional paid **Dashboard** lets teachers manage groups, sessions, students, payments and statistics.

**Who the owner is.** The owner is a front-end web developer (HTML/CSS) and is **not a backend specialist**. Explain backend and infrastructure steps in plain language, give exact commands and exact dashboard clicks, avoid jargon without a one-line explanation, and never assume prior DevOps knowledge. Keep code readable and boring rather than clever.

---

## 2. How you (the agent) must work

1. **One milestone at a time** (section 8). Never start the next one without the owner's "go".
2. **Plan first**: before coding, restate the plan in at most 10 bullets and name the spec sections you follow.
3. **Rules live in the database and server, not only in the UI.** Every rule in the spec must be enforced server-side (validation, RLS, constraints). The UI only helps.
4. **Small commits** with clear messages. One concern per commit.
5. **Tests for tricky logic** (section 10). Write the test before or with the code, not after.
6. **Keep two memory files up to date** (see section 3). This is how work survives between sessions.
7. **Ask instead of guessing** when something is blocked on the owner (credentials, payment details, legal texts, data files). List blockers at the end of every milestone.
8. **Never invent business rules.** If the spec is silent, choose the simplest option, record it in `docs/DECISIONS.md` and tell the owner.
9. **No secrets in the repo.** Use `.env.local` and provide `.env.example` with placeholder names only.
10. **Simplicity budget:** no extra features, libraries or abstractions beyond the spec. If you think something is missing, propose it, do not build it.

---

## 3. Memory system for the project (create these on day one)

| File | Purpose | Update when |
|---|---|---|
| `docs/SPEC.md` | The attached spec, unchanged source of truth | Only when the owner sends a new spec version |
| `docs/AGENT_CONTEXT.md` | This file | Only when the owner changes decisions |
| `docs/PROGRESS.md` | Milestone checklist, what is done, what is next, known bugs, blockers | After **every** work session and milestone |
| `docs/DECISIONS.md` | Dated log of every choice not fixed by the spec (what, why, alternatives) | Whenever you decide something |
| `docs/GLOSSARY.md` | French/Arabic UI strings and domain terms used (optional, grows over time) | When you add UI text |
| `docs/PRE_PRODUCTION_NOTES.md` | Everything to do, decide or check before production (owner items, services, environment variables, settings, code still to write, security, final checks) | In **every** session that changes something relevant, plus its change log |

`docs/PROGRESS.md` format:

```
## Status: M<N> in progress   (updated YYYY-MM-DD)
### Done
- [x] M0 Foundations (date)
### Now
- [ ] M1 task list...
### Blockers waiting on owner
- ...
### Known bugs / tech debt
- ...
```

At the start of every session: read `PROGRESS.md`, `DECISIONS.md`, then the spec sections relevant to the current milestone.

---

## 4. Stack (recommended, do not change without asking)

- **Web:** Next.js (App Router, TypeScript), Tailwind CSS, `next-intl` for FR/AR, RTL via `dir="rtl"` and logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`).
- **Database:** plain **PostgreSQL 14+** (the owner already has it installed locally). **No Supabase, no Docker.** Use Drizzle ORM (or Prisma) with **ordered SQL migrations in `db/migrations/`**, and never edit the production database by hand. Required extensions: `pgcrypto`, `btree_gist`, `pg_trgm`.
- **Auth (custom):** phone number + password (argon2id), WhatsApp verification, server-side sessions in httpOnly cookies (hashed tokens in `auth_sessions`). Do not add a third-party auth service.
- **File storage:** photos go through a `StorageProvider` interface: a local folder in development, an S3-compatible bucket in production.
- **Scheduled jobs:** secured endpoints `/api/jobs/*` called by the host's cron (a local script in development).
- **Validation:** Zod on every server input.
- **Tests:** Vitest (unit), Playwright (end-to-end), SQL tests for constraints and RLS.
- **Bot protection:** Cloudflare Turnstile (or equivalent) on abuse thresholds.
- **Messaging:** WhatsApp Business Platform (Cloud API) only. **No SMS in v1.** Transactional email via one provider.
- **Hosting:** any Next.js-capable host (the owner chooses; recommend Vercel).
- **Database hosting:** local PostgreSQL for development. For production, choose a managed PostgreSQL (or a VPS) at M12. The app only needs a standard `DATABASE_URL`. Automatic daily backups are mandatory.
- **Browser support:** last two versions of Chrome (Android and desktop), Safari (iOS and macOS), Firefox, Edge; layouts tested from 360 px wide. Keep pages light (compressed images, lazy loading, server-rendered search and profile pages).

Suggested folders:

```
/app/[locale]/(public)/        home, recherche, prof/[slug], [gouvernorat]/[matiere]
/app/[locale]/(teacher)/       espace professeur, abonnement
/app/[locale]/(dashboard)/     groupes, eleves, calendrier, statistiques
/app/[locale]/(admin)/         admin panel
/app/api/                      webhooks (whatsapp), jobs
/lib/                          domain logic (entitlements, billing, sessions, search), pure and tested
/components/                   ui + student-picker + calendars
/db/migrations/                ordered SQL (Drizzle)
/messages/fr.json, ar.json     all UI strings
/docs/                         the memory files above
```

---

### 4.1 Local PostgreSQL setup (the owner does this once; guide them step by step)

1. In PowerShell run `psql --version`. It must be 14 or higher. If the command is not found, add `C:\Program Files\PostgreSQL\<version>\bin` to the Windows PATH.
2. Open `psql -U postgres` (password chosen at install) and run:

```sql
CREATE USER tuniprof_app WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE tuniprof_dev OWNER tuniprof_app;
CREATE DATABASE tuniprof_test OWNER tuniprof_app;
\c tuniprof_dev
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\c tuniprof_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

3. Create `.env.local` (never commit it): `DATABASE_URL=postgresql://tuniprof_app:choose-a-strong-password@localhost:5432/tuniprof_dev`, and `TEST_DATABASE_URL=...` for `tuniprof_test`.
4. If any command fails, the owner pastes the exact error to the agent; do not guess.

---

## 5. Non-negotiable rules (invariants)

**Business**

1. Teacher profile is publicly visible **iff** `status = approved` AND `is_listed` AND `visibility_until > now` AND required fields complete AND account not suspended. Implement once as a database function/view and reuse everywhere (search, profile page, sitemap).
2. Entitlements are two independent dates: `visibility_until`, `dashboard_until`. Renewal extends from `max(today, current_until)`.
3. Days bought before approval are stored as credit; the clock starts at **approval**.
4. Activation codes: `TTP-XXXX-XXXX-XXXX` (12 chars, 32-char alphabet without 0/O/1/I), generated only by admin, **hashed**, single use, bound to a plan and a payment request, unredeemed expire after 90 days, 5 wrong attempts per hour then 1-hour lockout.
5. Phone numbers are public only after **click-to-reveal** (logged; max 30 reveals per device per hour; Turnstile after 10).
6. Founding offer: first **100** approved teacher profiles with a verified WhatsApp number get **365 days free**, applied automatically at approval (counter in settings, one per phone number). Assumption: includes the Dashboard (flag in settings).
7. Expired teachers: profile hidden at once; Dashboard read-only for 30 days with CSV export; data kept 12 months, then deleted after 2 warnings.
8. Reviews: any WhatsApp-verified account, one review per teacher, no waiting period, moderated before publishing, teacher can post one public reply, teacher accounts cannot review, own-phone reviews blocked, max 3 reviews per account per day.

**Dashboard**

9. A session has **start and end** time. **Overlaps for the same teacher are impossible**, enforced by a PostgreSQL exclusion constraint (section 7), not only by the UI.
10. Calendar badges always count **sessions** (not groups).
11. "Supprimer" cancels **one** occurrence (status `cancelled`, restorable). "Modifier date" moves **one** occurrence. "Modifier calendrier" applies from an effective date and never touches past sessions or individually edited ones (unless the teacher ticks reset). **Past sessions are locked.**
12. **Montant à payer is typed by the professor** (never computed from the counter or the group price). The group price is only an optional *reference price* shown as a suggestion ("Appliquer").
13. Billing formulas: `net = max(0, due - remise)`, `remaining = net - amount_paid`. Status is **derived, never stored**: Payé if `net > 0` and `paid >= net`; Non payé if `paid = 0` and `net > 0`; otherwise Partiel; `net = 0` shows "Rien à payer"; overpayment shows "Excédent". The +1/-1 counter is an attendance record only.
14. A student exists **once per teacher** and is linked to groups through memberships. The groups section must never create a second copy of an existing student.
15. Removing a student from a group ends the membership (history stays). Deleting a student or group is permanent and requires typing the name; recommend Archive when history exists.
16. Every teacher only sees their own rows. All teacher data goes through **one data-access layer** that requires the authenticated `teacher_id` and always filters by it; this is covered by tests (teacher A can never read or write teacher B's rows). Add PostgreSQL row-level security with `set_config('app.teacher_id', ...)` per request as defense in depth at M12.

---

## 6. Plans and prices (admin-editable `plans` table; never hard-code)

| Plan | Days | Visibility only | With Dashboard |
|---|---|---|---|
| Mensuel | 30 | 15.000 | 25.000 |
| Trimestriel | 90 | 40.500 | 65.000 |
| Semestriel | 180 | **72.000** | 111.000 |
| Annuel | 365 | 120.000 | 180.000 |

Dashboard added mid-term: admin issues an *upgrade* code granting dashboard days equal to remaining visibility days; price = plan add-on price (bundle minus visibility-only) x remaining days / plan days, rounded to 0.5 DT.

---

## 7. Data model (create via migrations, in this order)

Use `uuid` primary keys, `created_at`/`updated_at`, money in integer millimes. Enable extensions: `pgcrypto`, `btree_gist`, `pg_trgm`.

| Table | Key columns |
|---|---|
| `users` | id, role (teacher / visitor / admin_super / admin_support), phone_e164 unique, email, password_hash (argon2id), phone_verified_at, status |
| `auth_sessions` | id, user_id, token_hash, expires_at, ip_hash, user_agent |
| `teacher_profiles` | user_id, slug, full_name, photo_url, diploma, experience, bio, governorate_id, modes[], status (draft / pending / approved / rejected / suspended), rejection_reason, is_listed, rating_avg, rating_count, pending_version jsonb |
| `teacher_zones`, `teacher_levels`, `teacher_subjects` | teacher_id + delegation_id / level_id / (subject_id, hourly_rate_millimes) |
| `governorates`, `delegations`, `levels`, `subjects`, `plans` | catalogues, admin editable |
| `entitlements` | teacher_id, visibility_until, dashboard_until, pending_visibility_days, pending_dashboard_days |
| `entitlement_grants` | id, teacher_id, source (code / founding / admin), visibility_days, dashboard_days, granted_at, note |
| `payment_requests` | id, teacher_id, plan_id, with_dashboard, amount, method, reference (e.g. TTP-48213), status, transaction_ref, handled_by |
| `activation_codes` | id, code_hash, plan_id, visibility_days, dashboard_days, payment_request_id, status, redeemed_by, redeemed_at, expires_at |
| `otp_challenges` | id, phone_e164, code_hash, channel (whatsapp_inbound / whatsapp_template), expires_at, attempts, verified_at |
| `reviews` | id, teacher_id, author_id, rating 1-5, comment <= 500, status, teacher_reply; unique(teacher_id, author_id) |
| `contact_events` | teacher_id, session_hash, type (view / reveal / whatsapp), created_at |
| `reports`, `audit_log`, `notifications`, `settings` | moderation, traceability, message queue, key/value (founding slots, payment accounts, working hours) |
| `groups` | id, teacher_id, name, color, start_date, end_date, pricing_model, reference_price_millimes (optional), status (active / archived) |
| `schedule_rules` | id, group_id, weekday, slot_no (1-3), start_time, end_time |
| `sessions` | id, **teacher_id**, group_id, date, start_time, end_time, status (scheduled / cancelled), origin (rule / moved / extra), original_date |
| `students` | id, teacher_id, full_name, full_name_norm, phone, phone_digits, note, archived_at; trigram indexes on `full_name_norm`, `phone_digits` |
| `memberships` | id, group_id, student_id, joined_on, left_on, default_discount_millimes |
| `monthly_accounts` | id, membership_id, year_month, amount_due_millimes (typed, nullable), sessions_attended, discount_millimes, amount_paid_millimes; unique(membership_id, year_month) |

**No-overlap guarantee (copy this idea exactly):**

```sql
ALTER TABLE sessions ADD CONSTRAINT no_teacher_overlap
EXCLUDE USING gist (
  teacher_id WITH =,
  tsrange(date + start_time, date + end_time) WITH &&
) WHERE (status = 'scheduled');
```

**Access pattern:** teacher tables are read and written only through the data-access layer, which requires the authenticated `teacher_id` (or a join to the owning group). Public search reads only through a view/function that applies the visibility rule and exposes no phone number. Admin access goes through a separate role check.

---

## 8. Milestones (build order)

Each milestone: **Tasks**, **Spec**, **Done when**. Do not skip ahead.

### M0 Foundations
- Tasks: create repo; Next.js + TypeScript + Tailwind; `next-intl` with `fr` default and `ar` (RTL); layout with header, footer, language switcher; design tokens (colors, spacing, one Latin font, one Arabic font); ESLint/Prettier; `.env.example`; PostgreSQL connection with Drizzle ORM, `npm run db:migrate` and `npm run db:reset` scripts, local database set up as in 4.1; `docs/` memory files created; `/healthz`; CI that runs lint and tests.
- Spec: 1, 3.6, 8.1, 8.4.
- Done when: site runs locally, FR/AR switch works with correct RTL, lint and tests pass, PROGRESS.md exists.

### M1 Database foundation and catalogues
- Tasks: migrations for extensions and all catalogue tables; seed the **24 governorates**, levels (Primaire 1-6, Préparatoire 7-9, Secondaire 1-4, Université L1-L3), subjects (Anglais, Arabe, Français, Histoire-Géo, Informatique, Mathématiques, Philosophie, Physique, Sciences Naturelles, Économie, Chimie, Allemand, Italien, Espagnol, Technologie, Gestion/Comptabilité, Éveil scientifique), plans (section 6). **Délégations**: ask the owner for the official list (about 264) and write an import script from a CSV.
- Spec: 2.1, 4.2, 7.
- Done when: `npm run db:reset` rebuilds everything; seed counts verified by a SQL test.

### M2 Accounts and WhatsApp verification
- Tasks: sign-up with phone (+216, 8 digits starting with 2, 4, 5 or 9) + password; consent checkbox for public phone display (timestamped); a `VerificationProvider` interface with (a) a **dev stub** and (b) the real WhatsApp implementation. **Send-to-verify:** screen shows a short code and a `wa.me` button to the platform number; the webhook receives the message, checks the code and verifies the **sender's number**. Rules: code valid 5 minutes, 5 attempts, hashed, rate-limited per phone and per device; password reset uses the same flow. Server-side sessions (httpOnly cookie, hashed token in `auth_sessions`), argon2id password hashing, roles and admin accounts.
- Spec: 4.1, 8.5, 13.2.
- Done when: a full sign-up and password reset work with the dev stub; webhook logic is unit-tested with simulated payloads; blockers listed (Meta credentials).

### M3 Teacher profile and review queue
- Tasks: profile form (all fields and validations from spec 4.2: bio 30-600 characters and rejecting phone numbers/links/handles, rates 5-300 DT, délégations dependent on governorate, at least one mode); photo upload (JPG/PNG up to 2 MB, re-encode to 400 px) through the `StorageProvider` interface; status machine draft to pending to approved/rejected with reason; **pending version** for edits to name, photo, bio, diploma; admin review queue (approve, reject with reason templates, suspend); teacher home status banner.
- Spec: 2.5, 4.2, 4.4, 6.
- Done when: acceptance of profile rules by tests; admin can approve; old version stays live while a new one is pending.

### M4 Entitlements, payment requests, codes, founding offer
- Tasks: `entitlements`, `entitlement_grants`; subscription page (choose plan + dashboard option, creates payment request with unique reference and exact amount); payment instructions page (Flouci, D17/e-Dinar, CCP/poste; values come from `settings`; keep the Arabic helper lines from the spec); prefilled WhatsApp/Messenger proof buttons; admin payments screen (mark proof received, generate code for that request, revoke); code redemption with lockout; renewal stacking; credit before approval; founding offer at approval; the single visibility function (invariant 1); daily job for expiry and reminders.
- Spec: 2.1 to 2.6, 4.3, 6, 13.3.
- Done when: acceptance tests 10, 11, 12, 13, 20 pass; admin can run a full test purchase end to end.

### M5 Public marketplace
- Tasks: home; search page with filters (governorat to délégation dependent, niveau, matière, mode, price range, minimum rating, sort); default ranking (completeness + rating + renewal recency, random rotation among near-equal scores); teacher card (no phone, "à partir de X DT/heure"); profile page; click-to-reveal with logging, rate limit and Turnstile; safety notice and "Signaler ce profil"; SEO pages `/{gouvernorat}/{matiere}`, sitemap, canonical URLs, schema.org (`aggregateRating` only with real reviews); legal page stubs.
- Spec: 3.1 to 3.6.
- Done when: test 14 passes; a hidden profile never appears in search, profile URL, or sitemap.

### M6 Reviews
- Tasks: light account via WhatsApp verification; review form; moderation queue; teacher reply and report; cached `rating_avg` / `rating_count`.
- Spec: 3.5.
- Done when: test 15 passes.

### M7 Notifications and jobs
- Tasks: `notifications` queue; admin "copy-paste message" helper for manual WhatsApp sending (approval, code delivery, expiry reminders at 30, 7 and 1 day, grace-period and deletion warnings); transactional email; scheduled jobs (expiry, reminders, grace locking, retention cleanup, monthly accounts creation).
- Spec: 9, 8.1.
- Done when: jobs are idempotent and covered by tests.

### M8 Dashboard: groups, sessions, calendar
- Tasks: dashboard gating by `dashboard_until` (read-only during grace); navigation Groupes / Élèves / Calendrier / Statistiques (sidebar desktop, bottom tab bar mobile); group wizard (name, period max 14 months, weekly pattern with 1-3 sessions per weekday and start/end times, live preview with session-count badges, conflict list that blocks Next, optional reference price and model); session generation; exclusion constraint; Supprimer, Modifier date (confirm disabled until changed, unsaved-changes warning), Ajouter une séance, Modifier calendrier from an effective date; day overlay with timeline; groups list (Actifs/Archivés, Archiver, Supprimer with typed name); week/month/year calendar and "Prochaines séances"; group search.
- Spec: 5.1 to 5.5, 5.10, 5.11, 7.
- Done when: tests 1 to 5 pass, and a SQL test proves the database refuses overlapping sessions.

### M9 Élèves and student picker
- Tasks: `students` and `memberships`; **one shared student search component** (live filter on name, phone, note, group name; accents, case and Arabic diacritics ignored; word-start match; 150 ms debounce; ranking name then phone then note/group; 20 results with "Voir plus"; server-side search above about 200 students). Group "Ajouter élève" overlay with two options: **existing student** (multi-select that stays selected across searches as chips, disabled "Déjà dans ce groupe", bottom button "Ajouter les élèves (n)") and **new student** (name, optional phone, optional note; every input is a live search of existing students; tapping a suggestion switches to the existing-student option; duplicate warning "Utiliser l'élève existant / Créer quand même"). Élèves section list with filters, student page (editable info, group cards, total of the month, history, archive, delete). Retirer / Ajouter à un autre groupe / Déplacer.
- Spec: 5.6, 5.7.
- Done when: tests 9, 16, 17, 18, 19 pass.

### M10 Billing and statistics
- Tasks: `monthly_accounts` created lazily and by job; month selector; counter; typed montant à payer ("Montant à saisir" until typed); Payé / Non payé / Payé partiellement; remise with struck-through display; "Appliquer" suggestion and "Copier du mois précédent"; default discount; Statistiques (filters month/year/all/include archived; groups, distinct students, Encaissé / Attendu / Reste, revenue per group, pie of monthly accounts); CSV export.
- Spec: 5.8, 5.9, 5.11.
- Done when: tests 6, 7, 8 pass and formulas live in one tested pure module.

### M11 Admin completion
- Tasks: teachers list and search, reviews/reports moderation, catalogue editors (including approving "Autre" subject), plans and prices editor, settings (payment accounts, working hours, founding slots and flags), audit log, metrics (new teachers, active subscriptions, revenue by plan, searches with no results), roles super admin and support (support cannot change prices or settings).
- Spec: 6.
- Done when: every admin action writes an audit log row.

### M12 Hardening and launch
- Tasks: security review (section 9), performance and cross-browser pass, accessibility pass, backups with a tested restore, legal pages (CGU, privacy, legal notice) with real text from the owner, full end-to-end suite, pre-launch checklist from spec 13.5.
- Spec: 8.2 to 8.4, 13.
- Done when: the whole pre-launch checklist is ticked and a real small test payment has been verified by an admin.

---

## 9. Security and privacy checklist (verify at M12, apply from M0)

- HTTPS only; secrets only in environment variables; every query on teacher data goes through the data-access layer filtered by `teacher_id` (tested), plus row-level security as defense in depth at M12.
- Rate limits on login, OTP, code redemption, contact reveal. Turnstile on abuse.
- Server-side validation of **every** rule (Zod + database constraints). Never trust the UI.
- Activation codes and OTP codes stored hashed. Image re-encoding on upload. Sanitise bios, reviews and notes.
- Students (often minors) store only name, optional phone, optional note. Access restricted to the owning teacher. Support deletion on request. Record consent for public phone display.
- Daily backups and a tested restore. Audit log for admin actions.
- Obligations under Tunisian personal-data law (organic law 2004-63, INPDP): the owner confirms with a lawyer before launch. Do not invent legal text.

---

## 10. Test checklist (the spec's 21 acceptance tests, short form)

1. Overlap on group creation lists conflicts and blocks Next.
2. Delete one occurrence cancels only that date; Restaurer brings it back.
3. Move one occurrence frees the old slot, occupies the new one, overlapping target errors.
4. Modifier date: Confirmer disabled before change; Retour with changes shows 3-choice warning.
5. Calendar badges for group A (Mon/Tue/Fri) and B (Mon/Wed/Sun), week of 7 Sept 2026: 2, 1, 1, 0, 1, 0, 1.
6. Manual amount: 140 DT typed, remise 10, paid 100 gives remaining 30 and Partiel; +1 on the counter changes nothing; before typing, "Montant à saisir" and payment buttons disabled.
7. Discount shows struck-through original values; discount above typed amount refused.
8. Changing a group's reference price changes no typed amount.
9. Student picker: search "Mo", select, search "sa", select; both stay selected; "Ajouter les élèves (2)" adds both with no duplicates; stats count each student once.
10. Renewal 10 days before expiry adds full duration after the current end date.
11. Code redeemed while pending: profile hidden; at approval, days start.
12. After expiry: profile leaves search within 5 minutes; dashboard read-only 30 days; export works.
13. 6th wrong code in an hour locks; reused or revoked code refused.
14. 31st reveal from one device in an hour is blocked.
15. Second review by same account refused; own-phone review refused; 4th review in a day refused.
16. Picker: already-in-group students disabled; add button disabled with no selection.
17. New-student duplicate suggestions; tapping one switches to existing selection; identical name+phone shows the warning.
18. Editing a phone on the student page updates every group row; last-group removal leaves "Sans groupe".
19. Same record edited from student page and group page, no divergence.
20. 100th approved teacher gets 365 days automatically, 101st does not; rejected profile uses no slot.
21. WhatsApp verification: wrong sender, code older than 5 minutes, and 6th attempt all fail.

---

## 11. Items only the owner can provide (list as blockers when you reach them)

| Needed for | What | Needed by |
|---|---|---|
| M0 | Local PostgreSQL ready as in section 4.1 (version, database names, `DATABASE_URL`) | M0 |
| M1 | Official list of délégations (CSV) | M1 |
| M2 | Platform WhatsApp number, Meta Business account, Cloud API credentials, webhook URL | M2 (real provider); dev stub until then |
| M4 | Beneficiary name, Flouci number, CCP number, D17/e-Dinar details, working hours | M4 |
| M5 | Domain `tuniprof.tn` pointing to the host; contact email | M5 |
| M12 | CGU, privacy policy, legal notice text; business registration details | M12 |
| M4 | Confirmation: does the founding free year include the Dashboard? (default: yes) | M4 |

The owner is setting up payments, WhatsApp and legal items by following spec section 13. Until real values exist, use clearly fake placeholders in `settings` and show them only in dev.

---

## 12. UI vocabulary (French first; keep every string in `messages/fr.json` and `messages/ar.json`)

Voir les coordonnées · Signaler ce profil · Activer mon profil · Renouveler · Choisissez votre méthode de paiement · Envoyer la preuve sur WhatsApp / Messenger · Aller à mon espace professeur · Groupes · Élèves · Calendrier · Statistiques · Créer un groupe · Groupe vide · Ajouter élève · Ajouter un élève existant · Ajouter un nouvel élève · Ajouter les élèves (n) · Déjà dans ce groupe · Sans groupe · Retirer du groupe · Ajouter à un autre groupe · Déplacer vers un autre groupe · Supprimer · Archiver · Restaurer · Modifier date · Modifier calendrier · Ajouter une séance · Confirmer · Retour · Passer et confirmer · Montant à payer · Montant à saisir · Payé · Non payé · Payé partiellement · Rien à payer · Excédent · Remise · Prochaines séances · Exporter · Actifs / Archivés.

Arabic equivalents: write them with the owner at M0/M3 and record them in `docs/GLOSSARY.md`. Keep the Arabic helper lines of the payment page exactly as given in the spec.

---

## 13. Out of scope for v1 (do not build)

Native Android/iOS apps, PWA install flow, SMS, in-app chat, lesson booking, online payment of lessons, automatic subscription payment (later: Konnect, Paymee or Flouci API, to be verified), identity-verified badge, in-app proof upload, per-session attendance sheet, public-holiday exclusion, section/filière filter, push reminders.

---

## 14. Final reminders

- The spec is long; **re-read the relevant section before each milestone** instead of relying on memory.
- When the owner sends a new spec version, diff it against the old one, list what changes, update `PROGRESS.md` and `DECISIONS.md`, and only then change code.
- Prefer a boring, working, tested feature over a clever, fragile one.
