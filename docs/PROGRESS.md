## Status: M3 done, waiting for the owner's "go" for M4 (updated 2026-10-26)

### Done

- [x] M0 Foundations (2026-10-25). GitHub CI green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded.
- [x] M2 Accounts and WhatsApp verification (2026-10-26). Pushed, CI green.
- [x] M3 Teacher profile and review queue (2026-10-26). Local commits, not pushed yet.

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
- **M4 (next):** the Arabic payment helper lines, word for word (not in `docs/SPEC.md`). Also beneficiary name, Flouci number, CCP number, D17 details, working hours, and confirmation that the founding free year includes the Dashboard (default: yes).
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
- Production checklist (M12): set `AUTH_SECRET` and the WhatsApp variables on the host; run `npm run db:migrate`, then `npm run db:import:delegations`; create the admin with `npm run admin:create`; switch `StorageProvider` to the S3 bucket.
