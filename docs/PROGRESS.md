## Status: M6 done locally (not pushed; the review screens are not yet seen in a browser), waiting for the owner's review and "go" for M7 (updated 2026-10-28)

Everything that must happen before production is collected in `docs/PRE_PRODUCTION_NOTES.md` (kept up to date with every change).

### Done

- [x] M0 Foundations (2026-10-25). GitHub CI green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded.
- [x] M2 Accounts and WhatsApp verification (2026-10-26). Pushed, CI green.
- [x] M3 Teacher profile and review queue (2026-10-26). Pushed, CI green.
- [x] M4 Entitlements, payment requests, activation codes, founding offer (2026-10-27). Pushed.
- [x] M5 Public marketplace (2026-10-27). Pushed. Checked in a browser with the sample teachers.
- [x] M6 Reviews (2026-10-28). Local commits, not pushed. Rules and data covered by tests; the screens (profile reviews, teacher page, admin page) are NOT yet checked in a browser.

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
- **Not checked in a browser:** the review form, the review list and teacher reply on the profile page, `/espace-professeur/avis` and `/admin/avis`. The sample teachers were gone from the development database when I tried, and a visible teacher is needed. To check: `npm run dev:sample-teachers`, `npm run dev`, open a profile, confirm a number as a reviewer (dev stub), send a review; an admin account (`npm run admin:create -- --role=admin_support`) is needed to publish it, and a teacher account to answer it.

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
- **M6, Arabic drafts to approve:** `messages/ar.json` under `reviews`, `teacherReviews` and `adminReviews`.
- **M6, please confirm the review rules** I chose where the spec is silent (details in `docs/DECISIONS.md`): no editing or deleting of one's own review, a refused review still blocks a new one, replies are public at once and final, no contact-detail filter on review comments.
- **M5, Cloudflare Turnstile:** create a Turnstile widget in the Cloudflare dashboard and put the two keys in `.env.local` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. In development the always-pass test keys are used. In production without keys the check fails closed (after 10 reveals nobody can reveal more), so the keys are needed before launch.
- **M5, contact page:** the real contact e-mail address (setting `contact.email`, then set `contact.configured` to true). Until then production shows "L'adresse de contact sera affichée prochainement."
- **M5, domain:** set `SITE_URL` on the host (default in production: `https://tuniprof.tn`); it is used for canonical links and the sitemap.
- **M5, legal pages:** `/conditions` and `/confidentialite` are stubs (wording approved by the owner on 2026-10-27) until you send the real texts (M12).

### Known bugs / tech debt

- Pending "Autre" subjects are created but there is no screen to approve them yet (admin catalogue editors, M11). Until then they stay hidden from the public.
- No email or WhatsApp message tells the teacher about an approval or refusal: only the banner on their home page (notifications, M7).
- The profile form needs JavaScript (zones depend on the governorate).
- No rate limit on profile saves and photo uploads yet (signed-in teachers only); to review in M12.
- Photos live in the local `uploads/` folder; the S3 version of `StorageProvider` comes at M12 (no change elsewhere).
- Server actions accept bodies up to 3 MB (needed for the 2 MB photo); it applies to every action.
- Next.js dev prints a harmless "Unexpected end of JSON input" at the first request after starting `npm run dev` (a HEAD request); nothing is affected.
- A reviewer who signs in from the login page (not from a profile) lands on the home page.
- The header now reads the session on every request, so no page is cached as static. Fine at this size; revisit at M12 (performance pass).
- Opening the report form before the page has finished loading can print a harmless React "hydration" warning in the browser console (the `<details>` was opened before React took over).
- Contact reveal needs JavaScript (the number is fetched on click), like the profile form.
- Nobody is notified of a new review, a reply or an admin decision (M7); the reviewer sees the status only by opening the profile again.
- An abusive reviewer can only be suspended with SQL until the admin screens of M11; there is no screen listing a reviewer's reviews.
- The profile page shows the 20 latest reviews, with no "see more" yet.
- Reports about profiles ("Signaler ce profil") are stored in `reports` but have no admin screen yet (M11). Reports about reviews are handled in `/admin/avis`.
- `contact_events` only records reveals. Profile views and WhatsApp clicks (needed by the teacher mini-report of spec 4.4) are not recorded yet.
- No log of searches with no result yet (spec 6, metrics at M11): proposal for M11, it needs a small table written by the search page.
- A profile whose only subjects are still-pending "Autre" subjects is visible but has no listed subject; it is left out of search results until the subject is approved (M11).
- The Turnstile check fails closed in production without keys (see blockers).
- The first request after `npm run dev` starts can answer 500 "Unexpected end of JSON input" (same dev-only hiccup as before); the next request works.
- `rate_limit_events` and `webhook_events` grow until the cleanup job of M7.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo. The header shows the brand as text only.
- Running `npm ci` fails on Windows while a dev server is running. Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
- The délégation import overwrites names on re-run (meant for the first load only).
- Délégation spelling variants kept as in the owner's file: Ettadhamen, Mdhilla, Sayada-Lamta-Bou Hajar, Beni Mhira, Tameghza.
- No message tells the teacher a code was issued: the admin sends it by WhatsApp or Messenger by hand (the code is also visible on the teacher's Abonnement page). Reminders before expiry come at M7.
- After the Dashboard expires, `dashboardAccess` allows 30 days of read-only access (`GRACE_DAYS`), shown on the Abonnement page. The Dashboard screens that use it come at M8 to M10.
- Production checklist (M12): set `AUTH_SECRET`, `CRON_SECRET` and the WhatsApp variables on the host; run `npm run db:migrate`, then `npm run db:import:delegations`; create the admin with `npm run admin:create`; switch `StorageProvider` to the S3 bucket.
