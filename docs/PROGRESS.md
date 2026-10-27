## Status: M4 done, waiting for the owner's "go" for M5 (updated 2026-10-27)

### Done

- [x] M0 Foundations (2026-10-25). GitHub CI green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded.
- [x] M2 Accounts and WhatsApp verification (2026-10-26). Pushed, CI green.
- [x] M3 Teacher profile and review queue (2026-10-26). Pushed, CI green.
- [x] M4 Entitlements, payment requests, activation codes, founding offer (2026-10-27). Local commits, not pushed yet.

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

- Review the Arabic drafts: `messages/ar.json` (all of `profile` and `admin`), the 8 refusal reason templates, and the Arabic name "الحبيب ثامر بوعطوش" (Gabès).
- Confirm the contact rule is not too strict: a bio that mentions WhatsApp, Facebook, Instagram, Telegram, TikTok, Snapchat, Messenger or Viber is refused (and phone numbers, links, e-mails, @handles). Years like "2015-2020" are allowed.
- **Payments (needed before going live):** the Arabic payment helper lines, word for word (not in `docs/SPEC.md`; stored in setting `payment.helper_lines_ar`, empty until you send them). Also beneficiary name, Flouci number, CCP number, D17 details and working hours. All are placeholders in the `settings` table; in production payments stay hidden until `payment.configured` is set to true.
- Confirm that the founding free year includes the Dashboard (default: yes, setting `founding.grant_dashboard`).
- Review the Arabic drafts of M4: `messages/ar.json` under `subscription` and `adminPayments`, and the Arabic code message sent to teachers.
- Production: set `CRON_SECRET` on the host and make its scheduler call `/api/jobs/daily` once a day (`Authorization: Bearer <secret>`).
- Real WhatsApp (not blocking): Meta Business setup, see the M2 notes.
- First admin account: `npm run admin:create -- --role=admin_super` (you run it, so only you know the password).

### Known bugs / tech debt

- Pending "Autre" subjects are created but there is no screen to approve them yet (admin catalogue editors, M11). Until then they stay hidden from the public.
- No email or WhatsApp message tells the teacher about an approval or refusal: only the banner on their home page (notifications, M7).
- The profile form needs JavaScript (zones depend on the governorate).
- No rate limit on profile saves and photo uploads yet (signed-in teachers only); to review in M12.
- Photos live in the local `uploads/` folder; the S3 version of `StorageProvider` comes at M12 (no change elsewhere).
- Server actions accept bodies up to 3 MB (needed for the 2 MB photo); it applies to every action.
- Next.js dev prints a harmless "Unexpected end of JSON input" at the first request after starting `npm run dev` (a HEAD request); nothing is affected.
- Header always shows "Connexion", even when signed in (keeps pages cacheable). Show the account state at M5.
- Reviewers land on the home page after signing in; the review form comes at M6.
- Cloudflare Turnstile on abuse is not wired yet (M5 and M12).
- `rate_limit_events` and `webhook_events` grow until the cleanup job of M7.
- The terms checkbox has no link to the CGU, because `/conditions` is a stub of M5.
- The language switcher keeps the path but drops query strings (for example search filters). Revisit at M5.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo. The header shows the brand as text only.
- Running `npm ci` fails on Windows while a dev server is running. Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
- The délégation import overwrites names on re-run (meant for the first load only).
- Délégation spelling variants kept as in the owner's file: Ettadhamen, Mdhilla, Sayada-Lamta-Bou Hajar, Beni Mhira, Tameghza.
- No message tells the teacher a code was issued: the admin sends it by WhatsApp or Messenger by hand (the code is also visible on the teacher's Abonnement page). Reminders before expiry come at M7.
- The public pages that use `visible_teacher_profiles` (search, profile page) come at M5; until then visibility is only stored and tested.
- After the Dashboard expires, `dashboardAccess` allows 30 days of read-only access (`GRACE_DAYS`), shown on the Abonnement page. The Dashboard screens that use it come at M8 to M10.
- Production checklist (M12): set `AUTH_SECRET`, `CRON_SECRET` and the WhatsApp variables on the host; run `npm run db:migrate`, then `npm run db:import:delegations`; create the admin with `npm run admin:create`; switch `StorageProvider` to the S3 bucket.
