## Status: M8 pushed (last commit 9b73a5e) plus a third and fourth round of owner changes done locally (not committed, not pushed, checked in a browser); waiting for the owner's review and "go" for M9 (updated 2026-10-28)

Everything that must happen before production is collected in `docs/PRE_PRODUCTION_NOTES.md` (kept up to date with every change).

### Done

- [x] M0 Foundations (2026-10-25). GitHub CI green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded.
- [x] M2 Accounts and WhatsApp verification (2026-10-26). Pushed, CI green.
- [x] M3 Teacher profile and review queue (2026-10-26). Pushed, CI green.
- [x] M4 Entitlements, payment requests, activation codes, founding offer (2026-10-27). Pushed.
- [x] M5 Public marketplace (2026-10-27). Pushed. Checked in a browser with the sample teachers.
- [x] M6 Reviews (2026-10-28). Local commits, not pushed. Rules and data covered by tests, and every screen checked in a browser (reviewer, teacher and admin sides).
- [x] M7 Notifications and jobs (2026-10-28). Pushed. Checked in a browser (admin queue, teacher notices) and by tests; two items of the M7 list are postponed to M10 (see below).
- [x] M8 Dashboard: groups, sessions, calendar (2026-10-28). Local commits, not pushed. Rules and the database refusal of overlaps covered by tests; screens checked in a browser (desktop, phone width, Arabic).

### M8 details

- [x] Schema (migration 0016): `groups` (name, colour, period of at most 14 months, per-session or per-month reference price), `schedule_rules` (up to 3 slots per weekday), `sessions` (origin rule, moved, extra or manual; migration 0018 removed the "cancelled" state). **The database itself refuses two sessions of one teacher that overlap** (exclusion constraint `no_teacher_overlap`), a second group with the same name, a period over 14 months, and a session in another teacher's group.
- [x] Create a group (`/groupes/nouveau`): name, period (end date or number of weeks), the days either by weekday (weekly pattern, several slots per day) or picked one by one in a calendar, reference price, colour; a live preview lists the sessions that will be created and every conflict (date, hours, group name) before saving. Nothing is saved if there is one conflict.
- [x] Groups list (`/groupes`): live search on the name (word start, accents and Arabic letters handled) and on the price; each result says why it matched; delete (typed name, with a warning).
- [x] Group page (`/groupes/[id]`): the sessions of one month at a time (past, moved, added), a search bar for a date, and "Aperçu du calendrier" under the sessions: one card per month with only this group's sessions.
- [x] Calendar (`/calendrier`): week (default), month and year views, filter by group, "Prochaines séances", a day overlay, a search bar for a date (opens its day), "Ajouter une séance", "Supprimer" a session (for good, after a confirmation, no "Restaurer"), "Modifier date" (Confirmer disabled until something changed, asks before leaving with unsaved changes).
- [x] "Modifier calendrier" (`/groupes/[id]/calendrier`): rebuilds only the future from a chosen date, keeps sessions the teacher moved unless asked to reset them, always keeps added and hand-picked sessions, shows the conflicts before saving, and shows the group's "Aperçu du calendrier" (after "Voir ce qui va changer" it marks the days added and removed).
- [x] Access: full during the plan, read-only for 30 days after it ends (every write is refused on the server, not only hidden), no access afterwards (redirect to the subscription page). The teacher home has a "Mon Dashboard" link.
- [x] **Changes asked by the owner after the first M8 review (2026-10-28):** (1) the archive feature is removed (migration 0017 drops `groups.status`; only "Supprimer" remains); (2) a group can be given a number of weeks (1 to 60) instead of an end date, both ways are in the period step; (3) a session of today that is already over is no longer created (at 16:25 a Wednesday 08:00-10:00 session is left out; one in progress is kept; the wizard says how many were left out; "Modifier calendrier" from today no longer deletes today's finished sessions); (4) the year view now colours the days that have sessions, like the month view. Checked in the browser (weeks option, the note about a finished session, year view colours, group list) and by 6 new tests.
- [x] **Second round of changes asked by the owner (2026-10-28):** (1) the school-year shortcut is removed; (2) a search bar for a date in the calendar (opens that day) and in each group's list of sessions (opens its month and marks the sessions of that day); (3) "Supprimer" a session deletes it for good (migration 0018 drops `sessions.status`, deletes the sessions that were only cancelled, adds the origin `manual`; no "Restaurer"; the browser asks first); (4) "Aperçu du calendrier" with only the group's sessions, under the sessions of the group page; (5) the same preview on "Modifier calendrier", which after "Voir ce qui va changer" marks the days that would be added and removed; (6) when creating a group, the period step offers "En choisissant les jours dans un calendrier": the teacher touches the days, and step 3 becomes the list of those sessions (times per day, "same times for all days") with the calendar and the conflicts under it. Checked in the browser (search in both places, delete with confirmation, preview, a group created from picked days with a conflict detected, then deleted) and by 8 new tests.
- [x] **Third round of changes asked by the owner (2026-10-28):** (1) "Ajouter une séance" (calendar) has one row per day (date, start, end) with a second button "Ajouter un autre jour" that adds a row; the main button ("Ajouter" or "Ajouter les séances (n)") saves all rows in one step, all or nothing, and an overlap (with the calendar or between two rows) refuses everything and marks the row; (2) when creating a group with "En choisissant les jours dans un calendrier", no period is asked: it is computed from the first to the last picked day; (3) in the sessions step of that option, "Retirer ce jour" no longer leaves you stuck: the preview calendar (with "Afficher le mois précédent / suivant") lets you touch any day to add a session, and a day after the last one extends the period (1, 5, 9 December plus 12 December gives 1 to 12 December); (4) with "Par jours de la semaine", Début and Fin are picked in calendars (one day each; the "number of weeks" option stays); (5) in the sessions step of "Par jours de la semaine", touching a day in the preview opens the day overlay where you can add a session on that exact day, and edit (date and times) or delete one session of that day, without touching the other weekdays; a line says how many days were added, edited and deleted, with "Annuler ces changements". Unit and database tests added (19), see below. Checked in a browser in the next session (see the fourth round).
- [x] **Fourth round of changes asked by the owner (2026-10-28):** "Modifier calendrier" now has the day-by-day editing of the wizard.
  - On every group the calendar of the page is interactive: touch a day to add a session on that exact day, or to edit (date and times, the date picked in a calendar) or delete one of its sessions. A day after the last date widens the period. "Afficher le mois précédent / suivant" shows other months. The changes are kept on the page and saved with "Enregistrer le calendrier" (all or nothing; overlaps with other groups are shown in red before saving and refused by the server; past sessions are locked).
  - A group with a weekly pattern also keeps the pattern, with the effective date and the end date picked in calendars. The pattern is rebuilt only if it, its end date or the reset box changed, so a save that only touches days never brings back a day deleted earlier (a bug found in the browser and fixed).
  - A group whose days were picked in a calendar gets only the calendar: no weekly list, no reset box, no "Voir ce qui va changer", and its period is always its first to its last session.
  - Server: new file `lib/dashboard/calendar-change.ts`.
  - The owner asked whether rebuilding the pattern is required: it is in spec 5.3 and useful for weekly groups (change the hours of every future Monday at once), but it is optional and not needed for picked-days groups.
  - Checked in a browser (test teacher, dev server, French, then Arabic and phone width): wizard period calendars and weeks option; period computed from picked days and not stuck after removing every day; add, edit and delete in the wizard overlay; "Modifier calendrier" on a weekly and on a picked-days group (add, edit, delete, period widening, save, no pattern rebuild when unchanged). The two test groups made for this were deleted.
- [ ] Not in M8 (later milestones): students and "Groupe vide" replaced by a student count (M9), the delete-group warning about invoiced revenue (M10), statistics (M10). The Dashboard menu shows only the sections that exist.

### M8 test results (2026-10-28)

- After the fourth round of changes: `npm test` **712 passed, 0 skipped** (35 files); `lint`, `typecheck`, `format:check`, `build` pass. New: 8 database tests (day-by-day "Modifier calendrier" on a weekly group: delete, edit, add a specific day also outside the period, dry run saves nothing, overlaps refused, past / other group / other teacher refused, a day-only save does not rebuild the pattern; on a picked-days group: no pattern allowed, add / edit / delete and the period follows the sessions). The old test "adds a new pattern next to the picked sessions" was replaced (it is now refused on purpose).
- After the third round of changes: `npm test` **704 passed, 0 skipped** (35 files); `lint`, `typecheck`, `format:check`, `build` pass. New: 5 pure tests (period computed from picked days and growing when a later day is added, the plan from a pattern plus days added, edited and deleted by hand, the plan checks) and 14 database tests (specific day next to a pattern = the owner's Saturday 21 November example, delete one and edit one pattern session, adjustments naming nothing are ignored, overlaps and a fourth session refused, conflict with another group, "Modifier calendrier" keeps hand-made changes, "Ajouter une séance" with several rows: all added, one overlap refuses all and names the row, two rows overlapping, bad rows, another teacher's group). The old test "a weekly pattern next to picked days is refused" was replaced (it is now allowed, on purpose).
- Earlier: `npm test`: **685 passed, 0 skipped** (35 files) after both rounds of changes. New: 38 database tests (overlap refused by the database, one slot shared by two groups, create and conflicts = acceptance test 1, delete for good = test 2 (restore removed), days picked in a calendar, move = test 3, the "Confirmer" rule = test 4 on the screen and the unchanged-slot check in code, cross-group badges = test 5, delete, "Modifier calendrier" with dry run and reset, isolation between teachers, two simultaneous creations), 31 pure tests (dates, periods, rules, generation, conflicts, counts), 4 for the search text.
- `npm run lint`, `typecheck`, `format:check`, `build`: pass.
- Checked by hand in the browser (test teacher, dev server): creating a group with a live preview and a conflict list; the group page; week, month and year views; the day overlay; delete, move, add; "Modifier calendrier"; delete with the typed name; Arabic (right to left, no overflow); phone width 375 px (bottom tab bar, week view scrolls sideways, no page overflow).
- Not checked in a browser: the read-only (grace) mode and the no-access redirect (the rules are tested as plain functions; the server actions check them in `writableTeacher`, but no test calls them yet).
- Test data in your development database: the groups you created yourself for the test teacher (Anglais 3eme, Français, Math 4eme). Delete them from `/groupes` when you like.

### M7 details

- [x] Schema (migration 0015): `notifications` (one row per message and channel: on-site notice, WhatsApp copy-paste, e-mail), with a unique key per person, channel and event, so the same message can never be queued twice.
- [x] Messages queued at the right moment, inside the transaction of the event: profile approved or refused, change of profile approved or refused, payment proof received, code ready (never the code itself, only a link to the payment page), payment refused (never the admin's note), new review published (once), outcome of a review report (to the teacher who reported). E-mail only for teachers who gave an address.
- [x] The text is written when shown or sent from the message files (French and Arabic), so wording changes apply to old messages too; dates are shown in the Africa/Tunis time zone.
- [x] Admin `/admin/messages` ("Messages WhatsApp à envoyer"): the message in French and in Arabic, copy buttons, "Ouvrir WhatsApp" links, "Marquer comme envoyé" (checked in the database, logged), a count on the admin home. For a code message, a link to the payment page where the message with the code is.
- [x] Teacher home: unread notices on top ("Marquer comme lu", only their own).
- [x] E-mail: `EmailProvider` interface; in development e-mails are written in the terminal; in production, without a provider, they stay queued. The daily job sends them (French then Arabic in one message), retries 3 times, then marks them failed.
- [x] Daily job: expires old codes; expiry reminders at 30, 7 and 1 day (only the smallest that applies, so a late joiner gets one message, not three; a renewal gives the next term its own reminders); "abonnement terminé" once for plans that ended in the last 30 days; end-of-Dashboard-grace warning 7 days before the 30 read-only days end; e-mail delivery; cleanup of old rows. Running it twice changes nothing (tested, and checked on the development database).
- [ ] **Postponed to M10** (they need tables that do not exist yet): creating the monthly accounts, and the 12-month retention of Dashboard data with its two deletion warnings. See `docs/PRE_PRODUCTION_NOTES.md`.

### Test results (2026-10-28, M7)

- `npm test`: **598 passed, 0 skipped** (32 files), after `npm run db:reset:test`. New: 28 database tests (queue and channels, dedupe, one test per event that queues a message, reminder thresholds and idempotence, expired notices, grace warnings, cleanup, e-mail delivery with success, retry, give-up and no provider, WhatsApp queue and read notices, the daily job run twice, a broken e-mail provider) and 12 pure tests (reminder thresholds, channels per kind, the text of every kind in French and Arabic, dates in Tunis time, plural, greeting).
- `npm run lint`, `typecheck`, `format:check`, `build`: pass.
- Checked by hand in the browser (dev stub, test admin and test teacher): a payment request created by the teacher; the admin marked the proof received, which queued a WhatsApp message (French and Arabic text, wa.me links with the text) and a notice; "Marquer comme envoyé" emptied the queue; issuing the code queued "Votre code d'activation est prêt" with a link to the payment and no code in the text; the teacher home showed both notices, newest first, "Marquer comme lu" removed one, the Arabic page showed them right to left. `npm run job:daily` on the development database printed the counts, and the second run printed zeros.
- Not checked in a browser: the review notices (review published, report outcome) and the profile approval and refusal messages (covered by the database tests); reminders and the grace warning on real dates (tested with dates). A real e-mail was never sent (no provider yet).
- Test data left in your development database: a verified request (TTP-74775, code issued but not redeemed) for your test teacher, and "plan expired" messages for the expired sample teachers (they disappear with `npm run dev:sample-teachers -- --remove`).

### M6 details

- [x] Schema (migration 0014): `reviews` (rating 1 to 5, comment up to 500, status new / published / refused / hidden, one public teacher reply, one review per account and teacher), and `reports` now also covers reviews (`review_id`).
- [x] The database itself enforces: only a reviewer account can be the author (teachers and admins cannot), at most 3 reviews per account per rolling 24 hours (trigger, SQLSTATE `TP002`), one review per account and teacher, a reply only on a review that was published, and `rating_avg` / `rating_count` on the profile are recalculated by a trigger from PUBLISHED reviews only (two decimals).
- [x] Own-phone rule: one phone number is one account with one role (M2), so a teacher's number can never become a reviewer account (the reviewer sign-in answers "account exists"), and the foreign key refuses a teacher as author. Tested both ways.
- [x] Reviewer flow: the profile page shows "Confirmer mon numéro" (WhatsApp, no password) that comes back to the same profile after the check (cookie `tp_return`, only `/prof/{slug}` addresses accepted); then the star form (1 to 5, optional comment, sent by hand so a refusal keeps the fields); afterwards the page shows the status of the review ("reçu, publié après vérification", "publié", "non retenu", "n'est plus affiché").
- [x] Public: published reviews on the profile page (20 latest), with the teacher's reply; the author is never shown, only "Avis vérifié par WhatsApp" and the date. The cached rating now feeds the search filter and sort, the card, and the schema.org `aggregateRating`.
- [x] Teacher: `/espace-professeur/avis` (link on the teacher home, approved profiles): published reviews of their own profile, one public reply per review (final), and "Signaler cet avis" (reasons: contenu inapproprié, faux avis, autre).
- [x] Admin: `/admin/avis` with three lists: new reviews (Publier / Refuser), published reviews reported by a teacher (Masquer, which upholds the reports, or Garder, which dismisses them), and hidden reviews (Rétablir). The admin sees the reviewer's phone number. Every decision is checked in the database (active admin) and written to `audit_log`. The admin home shows how many reviews wait.

### Test results (2026-10-28, M6)

- `npm test`: **558 passed, 0 skipped** (30 files), after `npm run db:reset:test`. New: 27 database tests (including acceptance test 15: a second review of the same teacher by the same account is refused, also after a refusal; the 4th review in a day is refused by the application and by the database, allowed 24 hours later; a teacher or admin cannot review; the teacher's own number cannot sign in as a reviewer), and 4 pure tests (return address, content rules).
- `npm run lint`, `typecheck`, `format:check`, `build`: pass.
- Checked by hand in the browser (dev stub, sample teachers, a test admin and a test teacher account made by the owner):
  - Reviewer side: from a profile, "Confirmer mon numéro" opens the reviewer sign-in with the return address, the (simulated) WhatsApp check comes back to the same profile, the header shows "Déconnexion"; sending without a rating is refused and the typed comment is kept; 4 stars fill 4 stars; after sending, the page shows "Votre avis a été reçu" instead of the form, in French and in Arabic (right to left); a reviewer opening `/admin/avis` or `/espace-professeur/avis` is sent to the home page.
  - Admin: the home shows "Avis à modérer (1)"; `/admin/avis` lists the new review with the teacher, the reviewer's number and Publier / Refuser; publishing makes the review appear on the profile, sets the rating (4.0 (1), replacing the sample's fake 4.5) and adds `aggregateRating` to the search-engine data; "Masquer" removes the review, the rating and `aggregateRating` from the public page; "Rétablir" brings them back; the Arabic page is right to left with no horizontal overflow.
  - Teacher: the teacher home has a "Mes avis" button; `/espace-professeur/avis` lists the published review; an empty reply is refused; a real reply is published (shown on the profile as "Réponse du professeur") and the reply form disappears; reporting with "Autre" and no note is refused and keeps the chosen reason; reporting with "Faux avis" works and the report reaches the admin's "Avis signalés" list with the reason. A teacher looking at a profile sees "Les comptes professeur ne peuvent pas laisser d'avis".
  - Bug found and fixed: an admin looking at a profile saw an empty "Laisser un avis" box (now hidden for admins).
- Not checked in a browser: "Garder (rejeter le signalement)" and "Refuser" (covered by the database tests only). Test data left in your development database: the test reviewer (+216 29 999 900) and its 2 reviews, one on a sample teacher and one on your test teacher; `npm run dev:sample-teachers -- --remove` deletes this reviewer, which deletes both reviews and puts the ratings back to 0.

### M5 details

- [x] Schema (migration 0013): `contact_events` (one row per reveal: teacher, anonymous browser hash, type, time; no phone number), `reports` ("Signaler ce profil"), indexes for searching by level, subject and zone, settings `contact.email` and `contact.configured` (placeholders). The visibility rule itself did not change: everything public reads the view `visible_teacher_profiles` (M4).
- [x] Search (spec 3.2): governorate then délégation (dependent list), level, subject, mode, price range (on the rate of the subject asked for), minimum rating, five sorts, 20 results per page. Online teachers appear in every governorate, unless the visitor asks for another mode. Invalid values in the address are ignored, never an error.
- [x] Default ranking: completeness (photo, long bio, 2+ subjects) + damped rating + renewal recency, near-equal scores shown in a rotating order (changes every hour, stable while browsing). Pure code in `lib/marketplace/ranking.ts`, unit tested.
- [x] Teacher card (spec 3.3): photo or initial, name, governorate and zones, subjects, diploma and experience, levels, rating, "À partir de X DT / heure", never a phone number.
- [x] Profile page `/prof/{slug}` (spec 3.4): all sections, safety notice, "Signaler ce profil", schema.org `ProfessionalService` (rating only when real reviews exist). An unknown or hidden profile gives a real 404.
- [x] Click-to-reveal: the number is not in the page, it is fetched on click, logged, limited to 30 per device per hour (300 per network address), Turnstile asked from the 11th (acceptance test 14).
- [x] SEO: landing pages `/{gouvernorat}/{matiere}`, `sitemap.xml` (visible profiles and landing pages with a teacher living in the city, both languages with hreflang), `robots.txt`, canonical URLs, unique titles and descriptions. Filtered searches and empty landing pages are `noindex`.
- [x] Pages: home (search, subjects, cities, founding places left), `/devenir-professeur` (plans from the table), `/comment-payer`, `/contact`, and stubs for `/conditions` and `/confidentialite` (no invented legal text).
- [x] Header shows the account state (Connexion, or Mon espace / Administration and Déconnexion); the language switcher keeps the search filters; the sign-up checkbox links to the CGU; a French or Arabic 404 page for addresses a page refuses.
- [x] `npm run dev:sample-teachers` adds four made-up teachers to the DEVELOPMENT database so you can see the public pages (`-- --remove` deletes them). It refuses any database not ending with `_dev`.

### Test results (2026-10-27, M5)

- `npm test`: **527 passed, 0 skipped** (28 files), after `npm run db:reset:test`. New: 19 pure tests (parameters, ranking, levels, addresses), 26 database tests (hidden profiles never in search, profile page or sitemap for expired, paused, suspended, account suspended, missing field, waiting, refused; every filter; sorts; pagination; no phone in any result), 11 database tests (acceptance test 14, Turnstile from the 11th reveal, network-address limit, reports).
- `npm run lint`, `typecheck`, `format:check`, `build`: pass. `npm audit`: 0 vulnerabilities.
- Checked by hand in the browser (dev stub, with the 4 sample teachers of `npm run dev:sample-teachers`):
  - Home, search page with its filters and empty state, search results (3 visible teachers; the expired one is absent), a search sent from the form (clean address, délégation list limited to the governorate).
  - Profile page in French and Arabic (right-to-left): the phone number is not in the page source, "Voir les coordonnées" shows it with Call and WhatsApp links, 10 reveals work, the 11th asks for Turnstile (Cloudflare test widget), a second click then reveals it.
  - "Signaler ce profil": "Autre" without a note is refused and the form keeps the chosen reason, with a note the report is sent.
  - Landing pages `/sfax/physique` (indexed), `/sfax/anglais` (only an online teacher lives elsewhere, so `noindex`), `/le-kef/informatique` ("au Kef"), and the Arabic versions; `sitemap.xml` lists the 3 visible profiles and 5 landing pages in both languages and never the expired teacher; `robots.txt`; the 404 pages (status 404, both languages); `/comment-payer`, `/contact`, `/devenir-professeur` on a 375 px phone (no horizontal overflow); the CGU link on the sign-up page.
- Bugs found in the browser and fixed: the report form forgot the chosen reason and the note after a refusal (React empties a form after an action; the form is now sent by hand, as in M3); French titles said "Cours de Anglais" and "à Le Kef" (now "Cours d'Anglais", "au Kef", see `lib/marketplace/french.ts`); a heading showed a raw message key; in Arabic a grade range such as 1-4 was shown reversed (now isolated left to right).
- Not checked in a browser: the photo on a card and profile (the sample teachers have no photo; photo upload and storage were checked in M3), the home page with the sample teachers, the reveal button on a phone-sized screen, and the sign-in state of the header (no sign-in was made).
- The 4 sample teachers, 11 reveal rows and 1 report made by this test are in your development database. `npm run dev:sample-teachers -- --remove` deletes the teachers and, with them, their rows.

### M4 details

- [x] Schema (migrations 0011, 0012): `entitlements` (two independent dates, `visibility_until` and `dashboard_until`, plus waiting credit days), `payment_requests`, `activation_codes`, `entitlement_grants`, `founding_claims`, the SQL rule `teacher_is_visible(user, at)` and the view `visible_teacher_profiles` (never contains the phone number). Settings for the founding offer, the payment details and the code lifetime.
- [x] Plans and prices from the `plans` table (spec 2.2): money is integer millimes, shown as "40.500 DT". Upgrade price = (bundle - visibility price) x remaining days / plan days, rounded to 0.5 DT, and it grants the remaining visibility days of Dashboard.
- [x] Payment request (teacher): choose plan, Dashboard or not, method (Flouci, D17, CCP). One open request per teacher, price frozen at creation, reference `TTP-12345`, instruction page with the exact amount, a prefilled WhatsApp or Messenger message and copy buttons.
- [x] Admin payments (`/admin/paiements`): list, detail page with the 6-point checklist, "proof received", "payment verified: generate code" (transaction number + date required, the same proof can never be used twice), refuse with a reason, cancel a code. The code comes with ready-to-send French and Arabic messages.
- [x] Activation codes `TTP-XXXX-XXXX-XXXX`: derived from the id and `AUTH_SECRET`, only a hash is stored, tied to one request and one teacher, valid 90 days, single use, 5 wrong tries in an hour lock the teacher out for an hour.
- [x] Redeeming adds days from the later of "now" and the current end date (renewing early loses nothing). If the profile is not approved yet, the days wait as credit and start at approval.
- [x] Founding offer (spec 2.6): the first 100 approved teachers (one per phone number, taken atomically in the database) get 365 days of visibility and Dashboard. The sign-up page shows the places left.
- [x] Teacher page "Mon abonnement" (status, plans with saving %, code box, request history) and admin manual grant (note required). Everything is logged in `audit_log`.
- [x] Daily job (`/api/jobs/daily` with `CRON_SECRET`, or `npm run job:daily`): expires old codes. Reminders and cleanup come at M7.
- [x] Payments stay hidden in production until `payment.configured` is set to true (placeholders are shown only in development).

### Test results (2026-10-27)

- `npm test`: **471 passed, 0 skipped** (25 files), after `npm run db:reset:test`.
- `npm run lint`, `typecheck`, `format:check`, `build`: pass. `npm audit`: 0 vulnerabilities. No BOM or garbled characters in changed files.
- Checked by hand in the browser (dev stub): admin approval gave the founding year automatically; teacher created a request (Trimestriel + Dashboard + CCP, 65.000 DT, reference TTP-82497) and saw the instruction page; admin marked the proof, issued the code (French and Arabic messages shown); teacher saw the code, a wrong code gave "Code invalide.", the real code moved both dates from 27 Oct 2027 to 25 Jan 2028 (founding year + 90 days); the Arabic right-to-left page has no horizontal overflow. The made-up accounts were removed afterwards and the founding counter was put back to 0.
- Not run in a browser: the upgrade box (Dashboard added mid-term), refusing a request, cancelling a code, the admin manual grant (covered by the database tests only).
- Bug found while testing in the browser and fixed: the button, input and link class strings lived in a `'use client'` file, so server pages received a client reference instead of the text and the admin payment form had no styling. Some M2 and M3 server pages used the same import, so they are fixed too (not re-checked one by one in the browser). The strings now live in `components/auth/styles.ts`.

### M3 details

- [x] Schema (migrations 0009, 0010): `settings`, `audit_log`, `teacher_profiles`, `teacher_levels`, `teacher_zones`, `teacher_subjects`, `subjects.suggested_by`. The database itself enforces: only teacher accounts own profiles, a zone belongs to the profile's governorate, lists and lengths, and **`profile_is_complete()`**, the single definition of "required fields complete" (a profile cannot become pending or approved without it, even by direct SQL).
- [x] Profile form (spec 4.2): name 2-60, photo, diploma list, experience list, levels with cycle shortcuts, bio 30-600 with no phone number, link, e-mail or social name, modes, governorate, zones that depend on the governorate (required unless online only), subjects with hourly rates 5-300 DT (range from `settings`), and "Autre" subjects.
- [x] Photo: JPG or PNG up to 2 MB, checked by its bytes, re-encoded to a 400 x 400 JPEG, metadata removed, stored through a `StorageProvider` (local folder now, S3 at M12).
- [x] Status machine: draft -> pending -> approved or rejected (with reason) -> resubmit; suspend and restore. After approval, edits to name, photo, bio and diploma become a **pending version** while the old one stays live; price, zone, level, subject, mode and experience changes apply at once.
- [x] Teacher home (spec 4.4): status banner (draft, pending, rejected with reason, approved, change waiting, change refused, suspended), list of what is missing, listing pause switch.
- [x] Admin review queue: list oldest first, detail page with the phone number and a side-by-side view of a waiting change, approve, refuse with reason templates, approve or refuse a change, suspend, restore. Each action is re-checked in the database (active admin only) and writes an `audit_log` row.
- [x] Public address `/prof/{slug}` created at the first approval (name + first subject + governorate), never changed afterwards. The page itself comes at M5.
- [x] Teachers only touch their own rows: one data-access layer that takes the session's teacher id (invariant 16), with tests that teacher A cannot change teacher B.

### Test results (2026-10-26)

- `npm test`: **373 passed, 0 skipped** (22 files), after `npm run db:reset:test`.
- `npm run lint`, `typecheck`, `format:check`, `build`: pass. `npm audit`: 0 vulnerabilities.
- Checked by hand in the browser (dev stub, French and Arabic): sign-up, filling the whole form, the contact-number refusal (all choices kept), saving a draft, photo upload (900 x 600 PNG became a 400 x 400 JPEG without metadata), submit, admin refusal without an explanation (refused), refusal with a template reason (the teacher sees it), fix and resubmit, approval (address `wassima-chaaben-anglais-sfax`), an edit of the approved profile becoming a waiting change with the old name still live, and the Arabic right-to-left form. The made-up test accounts and the test photo were removed afterwards.
- Not run in a browser: approving or refusing a waiting change, suspend and restore (covered by the database tests only).
- Two bugs found while testing in the browser and fixed: the form emptied the ticked levels and zones after any error (React resets forms), and the `subjects` table definition missed a column (the drift test caught it).

### Blockers waiting on owner

(The full list, with exact steps, is in `docs/PRE_PRODUCTION_NOTES.md`. Arabic texts up to M5 were approved by the owner on 2026-10-27.)

- Confirm the contact rule is not too strict: a bio that mentions WhatsApp, Facebook, Instagram, Telegram, TikTok, Snapchat, Messenger or Viber is refused (and phone numbers, links, e-mails, @handles). Years like "2015-2020" are allowed.
- **Payments (needed before going live):** the Arabic payment helper lines, word for word (not in `docs/SPEC.md`; stored in setting `payment.helper_lines_ar`, empty until you send them). Also beneficiary name, Flouci number, CCP number, D17 details and working hours. All are placeholders in the `settings` table; in production payments stay hidden until `payment.configured` is set to true.
- Confirm that the founding free year includes the Dashboard (default: yes, setting `founding.grant_dashboard`).
- Production: set `CRON_SECRET` on the host and make its scheduler call `/api/jobs/daily` once a day (`Authorization: Bearer <secret>`).
- Real WhatsApp (not blocking): Meta Business setup, see the M2 notes.
- First admin account: `npm run admin:create -- --role=admin_super` (you run it, so only you know the password).
- **M5, to look at the pages yourself:** `npm run dev`, then open `/recherche`, `/prof/wassima-chaaben-physique-sfax`, `/sfax/physique` (and the same under `/ar`). Tell me what looks wrong. When you are done: `npm run dev:sample-teachers -- --remove`.
- **Arabic texts:** the owner approved (2026-10-28) all Arabic texts written so far, including the M6 and M7 drafts and every M8 text up to and including the fourth round. Nothing is waiting for approval.
- **M8, please confirm these choices** (details in `docs/DECISIONS.md`): a past session cannot be changed; a session deleted one by one comes back if "Modifier calendrier" rebuilds the future with a pattern that includes it; the Dashboard has no student or statistics section yet.
- **M8, to look at it yourself:** `npm run dev`, sign in as the test teacher, open the Dashboard from the teacher home, create a group, open the calendar.
- **M7, Arabic drafts to approve:** `messages/ar.json` under `notifications` (the text of every message sent to teachers), `teacherNotices` and `adminNotifications`.
- **M7, someone must send the WhatsApp messages:** open `/admin/messages` every day (the admin home shows how many wait), copy, send from the WhatsApp Business app, tick. Choose the e-mail provider before launch (M12).
- **M6, Arabic drafts to approve:** `messages/ar.json` under `reviews`, `teacherReviews` and `adminReviews`.
- **M6, please confirm the review rules** I chose where the spec is silent (details in `docs/DECISIONS.md`): no editing or deleting of one's own review, a refused review still blocks a new one, replies are public at once and final, no contact-detail filter on review comments.
- **M5, Cloudflare Turnstile:** create a Turnstile widget in the Cloudflare dashboard and put the two keys in `.env.local` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. In development the always-pass test keys are used. In production without keys the check fails closed (after 10 reveals nobody can reveal more), so the keys are needed before launch.
- **M5, contact page:** the real contact e-mail address (setting `contact.email`, then set `contact.configured` to true). Until then production shows "L'adresse de contact sera affichée prochainement."
- **M5, domain:** set `SITE_URL` on the host (default in production: `https://tuniprof.tn`); it is used for canonical links and the sitemap.
- **M5, legal pages:** `/conditions` and `/confidentialite` are stubs (wording approved by the owner on 2026-10-27) until you send the real texts (M12).

### Known bugs / tech debt

- Pending "Autre" subjects are created but there is no screen to approve them yet (admin catalogue editors, M11). Until then they stay hidden from the public.
- The profile form needs JavaScript (zones depend on the governorate).
- No rate limit on profile saves and photo uploads yet (signed-in teachers only); to review in M12.
- Photos live in the local `uploads/` folder; the S3 version of `StorageProvider` comes at M12 (no change elsewhere).
- Server actions accept bodies up to 3 MB (needed for the 2 MB photo); it applies to every action.
- Next.js dev prints a harmless "Unexpected end of JSON input" at the first request after starting `npm run dev` (a HEAD request); nothing is affected.
- A reviewer who signs in from the login page (not from a profile) lands on the home page.
- The header now reads the session on every request, so no page is cached as static. Fine at this size; revisit at M12 (performance pass).
- Opening the report form before the page has finished loading can print a harmless React "hydration" warning in the browser console (the `<details>` was opened before React took over).
- Contact reveal needs JavaScript (the number is fetched on click), like the profile form.
- A reviewer is not notified of what happened to their review (they have no channel except the page itself); a teacher is told of a published review and of a report outcome, but not of a new reply (they write it).
- An abusive reviewer can only be suspended with SQL until the admin screens of M11; there is no screen listing a reviewer's reviews.
- The profile page shows the 20 latest reviews, with no "see more" yet.
- Reports about profiles ("Signaler ce profil") are stored in `reports` but have no admin screen yet (M11). Reports about reviews are handled in `/admin/avis`.
- `contact_events` only records reveals. Profile views and WhatsApp clicks (needed by the teacher mini-report of spec 4.4) are not recorded yet.
- No log of searches with no result yet (spec 6, metrics at M11): proposal for M11, it needs a small table written by the search page.
- A profile whose only subjects are still-pending "Autre" subjects is visible but has no listed subject; it is left out of search results until the subject is approved (M11).
- The Turnstile check fails closed in production without keys (see blockers).
- Notification wording is stored as kind + values, not as text: if a message file changes, old waiting messages change too (intended).
- The first request after `npm run dev` starts can answer 500 "Unexpected end of JSON input" (same dev-only hiccup as before); the next request works.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo. The header shows the brand as text only.
- Running `npm ci` fails on Windows while a dev server is running. Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
- The délégation import overwrites names on re-run (meant for the first load only).
- Délégation spelling variants kept as in the owner's file: Ettadhamen, Mdhilla, Sayada-Lamta-Bou Hajar, Beni Mhira, Tameghza.
- The admin still sends the activation code itself by hand (the message with the code is on the payment page); the queue only says "code ready". The code is also visible on the teacher's Abonnement page.
- After the Dashboard expires, `dashboardAccess` allows 30 days of read-only access (`GRACE_DAYS`), shown on the Abonnement page. The group, session and calendar screens (M8) use it; students, billing and statistics come at M9 and M10.
- A past session is locked by the application, not by the database (a database rule would need the time zone and would block corrections by an admin). Session times are stored as local Tunisia date and time.
- Server actions of the Dashboard are not covered by a test of the read-only and no-access cases yet (only `dashboardAccess` is). To add with the M9 tests.
- The Dashboard menu bar on phones sits over the dev-only Next.js "N" indicator; production has no such button.
- Production checklist (M12): set `AUTH_SECRET`, `CRON_SECRET` and the WhatsApp variables on the host; run `npm run db:migrate`, then `npm run db:import:delegations`; create the admin with `npm run admin:create`; switch `StorageProvider` to the S3 bucket.
