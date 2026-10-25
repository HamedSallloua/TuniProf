## Status: M2 done, waiting for the owner's "go" for M3 (updated 2026-10-26)

### Done

- [x] M0 Foundations (2026-10-25). GitHub CI green.
- [x] M1 Database foundation and catalogues (2026-10-25). 279 délégations loaded.
- [x] M2 Accounts and WhatsApp verification (2026-10-26)

### M2 details

- [x] Schema (migrations 0007, 0008): `users`, `auth_sessions`, `otp_challenges`, `webhook_events`, `rate_limit_events`. Database rules: `password_hash` is NULL for reviewer (visitor) accounts and only for them; teachers must have timestamped consents; Tunisian phone format; one number = one account = one role.
- [x] Phone: +216, 8 digits starting with 2, 4, 5 or 9, accepted in many typed formats and Arabic digits; stored as E.164.
- [x] Passwords: argon2id (OWASP settings), 8 to 128 characters, must not contain the phone number.
- [x] `VerificationProvider` interface with a dev stub and the real WhatsApp Cloud API implementation (signature check, handshake, payload parsing).
- [x] Send-to-verify: screen shows `TTP-XXXX` and a wa.me button; webhook `/api/webhooks/whatsapp` verifies the SENDER's number. Code stored only as a keyed hash, valid 5 minutes, 5 wrong tries lock the number for 1 hour, rate limits per phone, per device and per address, duplicate Meta deliveries ignored.
- [x] Flows: teacher sign-up, login, password reset (same WhatsApp check), reviewer login (no password, fresh WhatsApp check for each session, 24 h session), logout.
- [x] Sessions: httpOnly cookie, only a SHA-256 stored; 30 days teacher, 24 h reviewer, 12 h admin; revoked on password reset.
- [x] Roles and permissions (`lib/auth/permissions.ts`): reviewer can only write reviews; teachers cannot review; support admin cannot change settings. Placeholder pages `/espace-professeur` and `/admin` prove the guards.
- [x] `npm run admin:create -- --role=admin_super` (hidden password prompt).
- [x] Pages in French and Arabic: `/inscription`, `/connexion`, `/connexion-avis`, `/mot-de-passe-oublie`, `/verification`.
- [x] Acceptance test 21 (wrong sender, code older than 5 minutes, 6th attempt) passes.

### Test results (2026-10-26)

- `npm test`: **191 passed, 0 skipped** (17 files), after `npm run db:reset:test`.
- `npm run lint`, `typecheck`, `format:check`, `build`: pass. `npm audit`: 0 vulnerabilities.
- Checked by hand in the browser (dev stub): Arabic and French sign-up with validation errors, WhatsApp simulation, automatic sign-in, logout, wrong then right password, full password reset (including password mismatch), reviewer login, and that a teacher cannot open `/admin` and a reviewer cannot open `/espace-professeur` or `/admin`. Phone-width layout checked. My made-up test accounts were removed from the development database afterwards.
- The real WhatsApp webhook has NOT been run against Meta: formats follow Meta's documentation and are tested with simulated, correctly signed payloads only.

### Blockers waiting on owner

- **M2 real WhatsApp (needed before launch, M5 at the latest for the public URL):** Meta Business account; the platform WhatsApp number added to the WhatsApp Business Platform (Cloud API); then three values in the host's environment: `WHATSAPP_PLATFORM_NUMBER`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (a text you invent); and a public HTTPS address for the webhook `https://<domain>/api/webhooks/whatsapp` (spec 13.2). The dev stub covers everything until then.
- **First admin account:** run `npm run admin:create -- --role=admin_super` yourself (it asks for a phone number and a hidden password), so only you know the password.
- M4: the Arabic payment helper lines, word for word (not in `docs/SPEC.md`). Also beneficiary name, Flouci number, CCP number, D17 details, working hours.
- Review the Arabic strings in `docs/GLOSSARY.md` and `messages/ar.json` (all drafts), and the Arabic name "الحبيب ثامر بوعطوش" (Gabès).

### Known bugs / tech debt

- Header always shows "Connexion", even when signed in (keeps pages cacheable). Show the account state in the header at M3.
- Reviewers land on the home page after signing in; the review form comes at M6.
- Cloudflare Turnstile on abuse is not wired yet (planned with the reveal limits at M5, and in the M12 security review).
- `rate_limit_events` and `webhook_events` grow forever until the cleanup job of M7.
- The terms checkbox has no link to the CGU, because `/conditions` is a stub of M5.
- The language switcher keeps the path but drops query strings (for example search filters). Revisit at M5.
- `app/global-not-found.tsx` relies on an experimental Next.js flag (see DECISIONS.md). Re-check after Next.js upgrades.
- `/favicon.ico` redirects to the placeholder `app/icon.svg`. Replace both when the owner sends the logo. The header shows the brand as text only.
- Running `npm ci` fails on Windows while a dev server is running. Stop `npm run dev` first; `npm install` repairs a half-deleted `node_modules`.
- The délégation import overwrites names on re-run (meant for the first load only).
- Délégation spelling variants kept as in the owner's file: Ettadhamen, Mdhilla, Sayada-Lamta-Bou Hajar, Beni Mhira, Tameghza.
- Production checklist (M12): set `AUTH_SECRET` and the WhatsApp variables on the host; run `npm run db:migrate`, then `npm run db:import:delegations` once; create the admin with `npm run admin:create`.
