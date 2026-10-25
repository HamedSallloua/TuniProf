# TuniProf — Product & Implementation Specification

*Version 1.1 · 24 October 2026 · Updated with your decisions: brand TuniProf (tuniprof.tn), WhatsApp-only verification, founding offer, simplified reviews, new Élèves section and student picker, launch setup guide.*

## 0. What was wrong in the original brief, and what this spec decides

| # | Problem found | Decision in this spec |
| --- | --- | --- |
| 1 | Four brand names (TrouveTonProf, TrouverTonProf, SanadClasse, Mou3allim) | One brand constant, **TuniProf** (domain **tuniprof.tn**), used everywhere (UI, WhatsApp text, codes, emails). |
| 2 | 6-month plan listed at 90 DT = 15 x 6, i.e. **0% saving**, while labelled 20% | Corrected to **72 DT** (20% off). |
| 3 | 3-month bundle labelled 14% saving; 65 vs 75 DT is really 13.3% | Label corrected to **13%**. |
| 4 | Pitch says 'up to Baccalauréat' but the profile form includes Université L1-L3 | Confirmed: scope is **Primaire to Université**. |
| 5 | Calendar badge counted 'groups' in one place and 'sessions' in another | Always count **sessions** (a group with 2 sessions that day counts 2). |
| 6 | Payment status had no billing period (what happens next month?) | Payments live in a **monthly account** per student per group. |
| 7 | 'Montant à payer' was not defined: calculated or typed? (clarified by your edit) | The amount to pay is **entered manually by the professor**; the counter and the group price never change it. Status is still **derived** from amounts, never stored. |
| 8 | 'Modifier date' asked for a number of sessions although it moves one session | It moves **one** session (new date + start/end). Extra sessions use 'Ajouter une séance'. |
| 9 | Only one time field per session, but examples use 08:00 to 10:00 | Every session has **start and end** time. |
| 10 | Anyone could review without an account (fake reviews) | Reviews need a light phone-verified account, one review per teacher. |
| 11 | Teacher pays, then profile is 'reviewed' (could be rejected) | Subscription clock starts when the profile is **approved**, never before. |
| 12 | What happens to dashboard data after the plan ends was undefined | 30-day read-only grace + export, then 12-month retention. |
| 13 | Public phone numbers can be scraped | Click-to-reveal, rate limits, CAPTCHA after abuse, reveal logging. |
| 14 | A student in several groups would be retyped each time | Teacher-level **student record** linked to groups (memberships). |
| 15 | Deleting a student/group would silently erase revenue history | Remove = end membership (history kept); hard delete only with typed confirmation. |
| 16 | No online-teaching option, no photo, no admin panel, no notifications | Added (sections 3, 4, 6, 9). |
| 17 | The brief asked for Android and iOS apps as well as the website | Dropped by decision: **responsive website only**. No native apps, so no app-store rules; the manual Flouci / CCP payment flow works on the site as designed. |
| 18 | 'Next day plan' is ambiguous | Defined as 'Prochaines séances': rest of today + tomorrow. |
| 19 | Students could only be created inside a group: no place to find, edit or reuse them, and duplicates were easy | New Élèves section (5.7). Adding to a group offers an existing-student multi-select search or a new student with live duplicate suggestions (5.6). |
| 20 | Verification by SMS was assumed in several places | WhatsApp only in v1 (8.5); SMS can be added later without redesign. |

## 1. Product summary

**TuniProf** (tuniprof.tn) is a Tunisian marketplace for private tutoring (Primaire, Préparatoire, Secondaire, Université).

- **Teachers** create an account and a profile. The profile stays hidden until they activate a paid plan.
- **Parents, students and visitors** search and see teacher contact details **without an account**.
- **Dashboard (optional add-on)** lets a teacher manage groups, sessions, students, payments and statistics, replacing paper notebooks.

**Roles:** Visitor · Parent/Student (light account, only for reviews) · Teacher · Admin.

**Platforms:** responsive website only (French + Arabic, full RTL support from day one), designed mobile-first for phones, tablets and desktop. There are no Android or iOS apps.

**Out of scope for v1:** in-app messaging, lesson booking, online payment of lessons, identity verification badge, video classes, automatic subscription payment (all listed in the roadmap).

## 2. Business rules

### 2.1 Plans and prices (corrected)

All prices in DT, stored as integer millimes (40.500 DT = 40500).

| Plan | Duration | Visibility only | With Dashboard | Per month (visibility / with dashboard) | Saving vs monthly |
| --- | --- | --- | --- | --- | --- |
| Mensuel | 30 days | 15.000 | 25.000 | 15.00 / 25.00 | 0% |
| Trimestriel | 90 days | 40.500 | 65.000 | 13.50 / 21.67 | 10% / 13% |
| Semestriel | 180 days | **72.000** | 111.000 | 12.00 / 18.50 | 20% / 26% |
| Annuel | 365 days | 120.000 | 180.000 | 10.00 / 15.00 | 33% / 40% |

Prices live in a `plans` table editable by admin; nothing is hard-coded.

### 2.2 Entitlements: two independent expiry dates

Each teacher has `visibility_until` and `dashboard_until`.

- A plan code extends `visibility_until` by the plan duration, and `dashboard_until` too if the dashboard option was bought.
- Extension starts from `max(today, current_until)`, so renewing early never loses days.
- **Dashboard added mid-term:** admin issues an 'upgrade' code that grants dashboard days equal to the remaining visibility days. Price = add-on price of the plan x remaining days / plan days, rounded to 0.5 DT (add-on = bundle price minus visibility-only price).

### 2.3 Visibility formula (single source of truth)

A profile is publicly visible if and only if:

`profile.status = approved` AND `profile.is_listed = true` (teacher can pause their listing) AND `visibility_until > now` AND all required fields are complete AND the account is not suspended.

### 2.4 Activation codes

- Format `TTP-XXXX-XXXX-XXXX` (12 characters from a 32-character alphabet without 0/O/1/I).
- Generated only by admin after verifying a payment; **bound to a plan** (so the teacher cannot redeem a bigger plan than paid) and to the **payment request** it answers.
- Stored hashed, single use, revocable, unredeemed codes expire after 90 days.
- 5 wrong attempts per hour per account, then a 1-hour lockout.

### 2.5 Teacher lifecycle

| State | Meaning | Visible? | Dashboard |
| --- | --- | --- | --- |
| Draft | Registered, profile incomplete | No | No |
| Pending review | Profile submitted | No | No |
| Rejected | Admin gave a reason, teacher can fix and resubmit | No | No |
| Approved, unpaid | Approved, no active plan | No | No |
| Active | Approved + `visibility_until` in the future | **Yes** | If `dashboard_until` in the future |
| Expired | Plan ended | No | Read-only for 30 days, with export |
| Dormant | 30 days after expiry | No | Locked; data kept 12 months, then deleted after 2 email/WhatsApp warnings |

**Fairness rule:** if a code is redeemed *before* approval, the purchased days are stored as a credit and the clock starts at approval.

### 2.6 Founding teachers (launch offer)

- The **first 100 teacher accounts** receive **1 year free** (365 days). Assumption: the free year includes the Dashboard. The grant has two flags (visibility, dashboard) in the admin settings, so this can be changed without code.
- An 'account' means an **approved profile with a WhatsApp-verified number**. Unfinished or rejected sign-ups do not use a slot. One slot per phone number.
- The grant is applied **automatically at approval** (no code needed), recorded in `entitlement_grants` with source 'founding'. The 365 days start at approval.
- Slots are a counter in the admin settings (`founding_slots_total = 100`, `founding_slots_used`). The home page and the teacher sign-up page can show 'X places restantes'. Admin can adjust the counter and revoke a grant in case of fraud.
- After the year, normal plans apply. Reminders go out 30, 7 and 1 day before the end (section 9).

## 3. Public site (visitors, parents, students)

### 3.1 Pages

| Route | Purpose |
| --- | --- |
| `/` | Hero search (level, subject, governorate) + featured subjects and cities |
| `/recherche` | Results list with filters |
| `/prof/{slug}` | Teacher profile, e.g. `/prof/wassima-chaaben-physique-sfax` |
| `/{gouvernorat}/{matiere}` | Indexable SEO landing pages, e.g. `/sfax/mathematiques` |
| `/devenir-professeur`, `/comment-payer` | Teacher acquisition and payment instructions |
| `/conditions`, `/confidentialite`, `/contact` | Legal pages |

### 3.2 Search and filters

Gouvernorat → délégation (dependent), niveau, matière, mode (à domicile / chez le professeur / en ligne), price range (DT/h), minimum rating, sort. Online teachers appear in every governorate's results.

**Default sort** = profile completeness + rating + renewal recency, with random rotation among near-equal scores so new teachers get exposure. Other sorts: price ascending/descending, best rated, newest.

### 3.3 Teacher card

Photo, name, 📍 zones — governorate, main subject(s), diploma · experience, levels, rating (n), **'à partir de X DT/heure'** (lowest subject rate when several). Phone number is **not** on the card.

### 3.4 Teacher profile page

Back to search · name · zones · diploma and experience · rating · bio · **Matières & Tarifs** table · levels · modes · **'Voir les coordonnées'** · reviews · 'Signaler ce profil'.

- **Contact reveal:** one click shows the phone number plus Call and WhatsApp buttons. Each reveal is logged (anonymous session hash, teacher, timestamp). Limit 30 reveals per device per hour; Cloudflare Turnstile (or similar) after 10. This protects teachers from scraping and gives them a metric.
- **Safety notice** (kept from your brief, shown on search and profile): the platform does not verify teacher identity; check identity and references before any lesson.

### 3.5 Reviews

- To review, a visitor creates a **light account** (phone number verified by WhatsApp). No password needed.
- Eligibility (simplified): any WhatsApp-verified account may leave one review per teacher, with no waiting period; teacher accounts cannot post reviews. Abuse is handled by moderation and rate limits (at most 3 reviews per account per day; a review from the teacher's own phone number is blocked).
- Content: rating 1-5 (required) + comment up to 500 characters. New reviews are held for moderation (auto-publish later once spam is controlled).
- The teacher may post **one public reply** and may report a review; admin decides.
- `rating_avg` and `rating_count` are cached on the profile.

### 3.6 Language and SEO

French and Arabic UI (switcher in header, RTL layout). Teacher-written content is shown as written. Each profile and landing page has a unique title/description, canonical URL, sitemap entry, and schema.org markup (`aggregateRating` only when real reviews exist).

## 4. Teacher space

### 4.1 Account

Sign-up with mobile number (+216, 8 digits starting with 2, 4, 5 or 9), verified by WhatsApp (see 8.5), plus a password. Password reset uses the same WhatsApp verification. There is no SMS in v1; it may be added later as a fallback. Optional email. Accept CGU and **consent to public display of the phone number** (checkbox, stored with timestamp).

### 4.2 Profile form

| Field | Rules |
| --- | --- |
| Full name | Required, 2-60 characters |
| Photo | Optional, JPG/PNG up to 2 MB, resized to 400 px |
| Phone | Verified, shown only after 'Voir les coordonnées' |
| Niveau / Diplôme | Required list: Instituteur(trice), Professeur du collège, Professeur du secondaire, Enseignant universitaire, Étudiant (master / ingénieur / autre), Ingénieur / cadre, Autre diplômé |
| Expérience | Required list: moins d'1 an · 1-3 ans · 3-5 ans · 5-10 ans · 10-15 ans · plus de 15 ans |
| Niveaux enseignés | Multi-select, at least 1. Primaire 1-6, Préparatoire 7-9, Secondaire 1-4, Université L1-L3 (with group shortcuts) |
| Présentation (bio) | Required, 30-600 characters; phone numbers, links and social handles are rejected (contact is only through the reveal button) |
| Mode | Required, at least 1: à domicile · chez le professeur · en ligne |
| Gouvernorat | Required, 24 governorates |
| Zones couvertes | Multi-select of délégations of the chosen governorate; required unless mode is 'en ligne' only |
| Matières & tarifs | At least 1 subject, each with an hourly rate (5 to 300 DT, configurable). Subject list managed by admin: Anglais, Arabe, Français, Histoire-Géo, Informatique, Mathématiques, Philosophie, Physique, Sciences Naturelles, Économie, plus Chimie, Allemand, Italien, Espagnol, Technologie, Gestion/Comptabilité, Éveil scientifique, Autre (needs approval) |

**Review rules:** first submission goes to admin review (target: under 24 h). After approval, edits to name, photo, bio and diploma create a *pending version*: the old approved version stays live until the new one is approved. Edits to prices, zones, levels and subjects apply immediately.

Info banner kept: these details will be visible to parents, fill them in accurately.

### 4.3 Subscription page ('Activer mon profil')

1. **Choose plan** (4 durations, dashboard checkbox). A *payment request* is created with a unique **reference** (e.g. `TTP-48213`) and the exact amount.
2. **Pay by one method** (details and Arabic helper lines taken verbatim from your brief):
   - **Flouci**: transfer to the platform's Flouci number.
   - **D17 (La Poste) / e-Dinar**: transfer from the e-Dinar card.
   - **Versement poste / CCP**: cash deposit or CCP transfer; keep the receipt. Beneficiary name, CCP number and phone numbers are admin settings (not hard-coded).
3. **Send proof**: buttons open WhatsApp or Messenger with a prefilled message containing the teacher's phone, reference, plan and amount. A screenshot or receipt photo is enough. (Optional later: upload the proof on the website.)
4. **Admin verifies** and issues the code, sent by WhatsApp/Messenger and shown in the teacher's space. Promise 'généralement sous 1 heure' only during stated working hours.
5. **Teacher enters the code** (format `TTP-XXXX-XXXX-XXXX`) → entitlements updated → profile visible immediately if approved.

Footer text kept: automatic online payment is coming soon; this manual method guarantees quick, secure activation.

### 4.4 Teacher home

Profile status banner (draft / pending / rejected with reason / approved), plan and expiry date with 'Renouveler', and a mini-report: profile views, contact reveals and new reviews over the last 7 and 30 days. Reminders at 7 days and 1 day before expiry (section 9).

## 5. Dashboard (paid option)

### 5.1 Concepts

| Term | Meaning |
| --- | --- |
| Group | A class (e.g. 'Math 4ème Sciences') with a period, a weekly pattern, an optional reference price and a colour |
| Schedule rule | Weekday + slot (1-3) + start time + end time, belonging to a group |
| Session | One dated occurrence (generated from rules, moved, or added manually) |
| Student | A person in the teacher's own list (name, optional phone, optional note), managed in the Élèves section and reusable across groups |
| Membership | A student's presence in one group (joined / left dates) |
| Monthly account | One row per membership per month: amount due (typed by the professor), attendance count, discount, amount paid |

Navigation: sidebar (desktop) or bottom tab bar (mobile) with **Groupes · Élèves · Calendrier · Statistiques**. Time zone Africa/Tunis; dates and times are stored as local date and time, with no conversion. Weeks start Monday.

### 5.2 Create a group (wizard)

1. **Name**: 2-50 characters, unique among active groups. A colour is assigned automatically.
2. **Period**: start date and end date via calendar pickers. End is on or after start, maximum 14 months. The computed period is shown ('7 sept. 2026 → 21 sept. 2026, 15 jours'). Shortcut: 'Année scolaire en cours'.
3. **Weekly pattern**: seven weekday rows. Selecting a day reveals 'Nombre de séances' (1-3), then one **start** and one **end** time per session. Rules: end after start, within one day, sessions of the same day do not overlap, and none overlaps another session of this teacher on any generated date.
   - A **live preview calendar** of the period shows circles that change colour for the chosen days, with a small number underneath each day = total sessions that day (all groups). New sessions are highlighted.
   - Conflicts turn the day red and are listed ('Lun. 14 sept. 08:00-10:00 chevauche Groupe B 09:00-11:00'); 'Suivant' stays disabled until none remain.
   - Tapping a day opens the day overlay in **read-only preview** (individual edits become available once the group exists).
4. **Price**: model **par séance** or **par mois**, plus an optional reference price in DT (up to 3 decimals). It is only a suggestion shown next to each student's amount and never changes what a student owes.
5. **Create** → group appears in the list as **'Groupe vide'** with a summary of generated sessions.

### 5.3 Session rules

- **Generation:** for every date in the period whose weekday has rules, one session per slot is created (`origin = rule`).
- **Supprimer (one session):** marks it *annulée*. It disappears from the calendar, appears greyed in the day overlay with 'Restaurer', and does not affect other dates. Example: Mondays 08:00-10:00 from 7 to 21 Sept; deleting 14 Sept frees that slot only.
- **Modifier date (one session):** overlay with a calendar, then start/end time of the new slot, buttons 'Confirmer' and 'Retour'. 'Confirmer' is **disabled until something changed**. 'Retour' with unsaved changes shows 'Enregistrer / Quitter sans enregistrer / Annuler'. The session is moved (`origin = moved`, original date kept), may land outside the group's period (make-up lessons), and must not overlap anything.
- **Ajouter une séance:** choose group, date, start, end (a single extra session).
- **Modifier calendrier (whole group):** reuses steps 2-3. Changes apply **from an effective date** (default today); past sessions are never touched. Individually moved or cancelled sessions are preserved unless the teacher ticks 'Réinitialiser aussi les séances modifiées'. Conflicts block saving.
- **Past sessions are locked** in v1 (history integrity).
- **Overlap rule** is enforced in the database (see 7), not only in the UI, so two devices cannot create a conflict.

### 5.4 Day overlay

Opened by tapping a day in the calendar. Shows an hourly timeline (blocks positioned by real start/end, e.g. 13:20-15:45) of all sessions of all groups that day. Each row shows group colour and name, time range, student count and the actions **Supprimer** and **Modifier date**. Tapping the row opens the group overlay. At the bottom: **Ajouter une séance**. Overlaps show a clear error ('Cette séance chevauche Groupe A, 08:00-10:00').

### 5.5 Groups list

Tabs **Actifs / Archivés**. Each row: name, period, schedule summary ('Lun 08:00-10:00 · Mer 14:00-16:00'), price, student count, 'Groupe vide' badge when empty, and actions:

- **Ajouter élève** (quick add): opens the two-option overlay described in 5.6
- **Modifier calendrier**
- **Archiver**: hides the group and its sessions from the calendar; history and revenue stay; can be restored
- **Supprimer**: permanent, requires typing the group name; if payments exist, the dialog recommends 'Archiver' instead and states how much recorded revenue would be erased

Clicking the name or row opens the **group page**.

**Search bar (live filter):** one input matches group name, student names, student phone digits (partial, normalised, accents and Arabic letters handled) and price. Results show a chip saying why they matched, so a number that matches both a phone fragment and a price is never ambiguous.

### 5.6 Group page and students

Top: group summary, **month selector** (default current month), student list.

**Ajouter des élèves** (from the groups list or from the group page). Both entry points open the same overlay with two options:

**Option 1: Ajouter un élève existant**

- A **search bar with live filter**. The professor types any part of a student's information (name, phone number, note, or a group name). Matching ignores case, accents and Arabic diacritics; words are matched from their start (so 'Mo' finds Mohamed and 'sa' finds Sarah) and phone digits match anywhere.
- Tapping a result **selects** it (checkmark). Selected students appear as chips above the results and **stay selected while the professor keeps searching**: search 'Mo', select Mohamed, search 'sa', select Sarah, and both remain selected. The × on a chip removes a student from the selection.
- Students already in this group show 'Déjà dans ce groupe' and cannot be selected. Archived students are hidden.
- The fixed bottom button **'Ajouter les élèves (n)'** is disabled while nothing is selected. It creates one membership per selected student in a single step.
- Afterwards the group page opens and every added row is highlighted for about 3 seconds.

**Option 2: Ajouter un nouvel élève**

- The same overlay as before: step 1 full name, step 2 phone (optional; 'Confirmer' or 'Passer et confirmer'), plus an optional note. **Every input is itself a search bar** using the same search component: typing in the name field lists existing students with a similar name, typing in the phone field lists existing students with that number.
- Tapping a suggestion means 'use this student': the overlay switches to Option 1 with that student already selected, so nobody is created twice.
- If the professor still validates a name and phone that exactly match an existing student, a warning asks 'Utiliser l'élève existant / Créer quand même'.
- Confirming creates the student and the membership, then opens the group page with the new row highlighted (as before).

**One search component everywhere:** both options, the Élèves section (5.7) and the group search bar use the same student search logic (name, phone, note, group name).

**Student row:**

- Name with 'Modifier' underneath; phone with 'Modifier' underneath (plus Call / WhatsApp icons); tapping the name opens the student page (5.7)
- **Actions:** *Retirer du groupe* (ends the membership; past months stay in stats), *Ajouter à un autre groupe* (same student, new membership; opens a multi-select list of groups where the student's current groups are disabled), *Déplacer vers un autre groupe* (ends the membership here and starts one in the target; the current month's figures stay with the old group and can be edited)
- **Séances suivies** counter (-1 / +1, minimum 0; attendance record only, it never changes the amount)
- **Montant à payer** (typed in manually by the professor) and the three payment controls (below)
- **Remise** input

### 5.7 Élèves (student section)

Fourth item of the dashboard navigation. It is the teacher's own address book of students, independent of any group: students can be added, found, edited and attached to groups from here. It reuses the current student information and billing logic; nothing is duplicated.

**List page**

- **Search bar (live filter):** the same student search component as in 5.6; it matches name, phone, note and the names of the student's groups.
- Filters: group, this month's payment status (Payé / Partiel / Non payé / Rien à payer / Sans groupe), Actifs / Archivés.
- Each row: name, phone (Call / WhatsApp icons), group chips, this month's summary (e.g. '2 groupes · 1 non payé') and the actions **Modifier**, **Ajouter à un groupe**, **Ouvrir**.
- **Ajouter un élève** button: the new-student overlay of 5.6 (Option 2: name, optional phone, optional note) with live duplicate suggestions. It creates the student without a group. Afterwards the list scrolls to the new row, highlights it and offers 'Ajouter à un groupe'.

**Student page** (opens from the Élèves list, from a student row inside a group, or from a group overlay in the calendar)

- **Information:** name, phone and note, each with its own 'Modifier' (same inline edit as in the group row). A change applies everywhere the student appears. Phone is optional and validated as in 4.1.
- **Groupes:** one card per active membership. Each card shows the group and **the same month block as the group page** (séances suivies counter, montant à payer, Payé / Non payé / Payé partiellement, remise) with exactly the billing rules of 5.8, plus **Retirer du groupe** and **Déplacer vers un autre groupe**. One month selector drives all cards. Editing a figure here or in the group page edits the same record.
- **Ajouter à un groupe:** multi-select list of the teacher's active groups (groups the student already belongs to are disabled).
- **Total du mois:** amount to pay, paid and remaining across all the student's groups (derived, never stored).
- **Historique:** past memberships and past months per group, read and edited like closed months.
- **Archiver:** hides the student from lists and pickers without losing history; only possible when the student has no active group. **Supprimer:** permanent, requires typing the student's name; if payment history exists the dialog recommends 'Archiver' and states how much recorded revenue would be erased.

**Rules**

- A student is created **once** per teacher and linked to groups through memberships; the groups section never creates a second copy of an existing student.
- Two students with the same name and phone trigger a warning, not a hard block (two siblings may share a parent's phone).
- Removing a student from their last group keeps them in the Élèves list with a 'Sans groupe' badge.
- Re-adding a student to a group they left creates a **new membership**; old months stay in history.
- **Search implementation:** below about 200 students the list is filtered in the browser; above that, search runs on the server using normalised columns and trigram indexes (section 7). Debounce 150 ms. Ranking: word-start match on the name, then phone, then note and group name. Show 20 results with 'Voir plus'.

### 5.8 Billing logic

For a student's monthly account (month M, group G):

- **Montant à payer (`due`)** is **typed in by the professor** for each student and month (number field, DT). It is never calculated from the counter or from the group's price. Until it is typed, the card shows 'Montant à saisir' and the Payé / Payé partiellement buttons are disabled.
- **Suggestion only:** if the group has a reference price, a small hint appears next to the field (e.g. 'Suggestion : 7 x 20 = 140 DT') with an 'Appliquer' button that copies the figure into the field. Nothing is filled automatically. A 'Copier du mois précédent' button also pre-fills the amount.
- `net = max(0, due − remise)`; the remise cannot exceed `due`.
- `remaining = net − amount_paid`.
- **Status (derived from the amounts, never stored):** *Payé* if `net > 0` and `amount_paid ≥ net`; *Non payé* if `amount_paid = 0` and `net > 0`; otherwise *Partiel*; if `net = 0` show 'Rien à payer'. Overpayment is displayed as 'Excédent'.
- **Controls:** green **Payé** sets `amount_paid = net`; red **Non payé** sets 0; grey **Payé partiellement** opens an amount field and shows the remaining amount underneath. Default state is Non payé.
- **Séances suivies counter** is an attendance record only: pressing +1 / -1 changes neither the amount nor the status.
- **If the professor edits the typed amount** after a payment, the status is recalculated (e.g. Payé becomes Partiel if the amount is raised) and a short message says so.
- **Discount display:** when remise > 0, the typed amount and the original remaining are shown **struck through in red** with the new values underneath.
- **Closed months:** typed amounts, discounts and payments of past months stay editable and are kept in the statistics.
- **Default discount:** an optional per-student discount (e.g. siblings) can be 'appliquée à tous les mois suivants'.

Worked example: the professor types 140 DT for October (the hint suggested 7 sessions x 20 DT = 140). Remise 10 → net 130. Paid 100 → remaining 30 (Partiel). Later +1 on the counter only changes the hint (8 x 20 = 160); the typed 140 stays. Tap Payé: paid 130, remaining 0.

Monthly accounts are created lazily the first time a month is opened and by a monthly job.

### 5.9 Statistiques

Filters: month (default), year, all time, include archived (off by default). Definitions:

- **Groupes**: active and archived counts
- **Élèves**: number of **distinct** students (a student in 2 groups counts once)
- **Encaissé** = sum of `amount_paid`; **Attendu** = sum of `net`; **Reste à encaisser** = Attendu − Encaissé
- **Revenu par groupe**: table with the same three columns
- **Pie chart** Payé / Partiel / Non payé: counts monthly accounts (student-group-month) in the selected period, because one student can have several accounts; accounts where no amount has been typed yet are left out

### 5.10 Calendrier

- **Semaine:** days across the top (Monday first), hours down the left (scrollable, default 07:00-22:00), session blocks coloured per group. Tapping a block opens a scrollable overlay with the group-page content.
- **Mois:** day circles with a small number = sessions that day. Tapping a day opens the day overlay.
- **Année:** twelve mini-months for fast navigation; tapping a month opens it, tapping a day opens its week. No data beyond navigation.
- **Prochaines séances:** the rest of today's sessions plus tomorrow's, as a card on the Calendrier page (and the mobile home).
- Group filter, 'Aujourd'hui' button; on phones the week view shows 3 days with horizontal swipe.

### 5.11 Export and expiry

'Exporter' produces a CSV of groups, students, and monthly accounts at any time. During the 30-day grace period after expiry the dashboard is read-only and export stays available.

## 6. Admin panel

- **Review queue:** approve / reject (reason from templates), see pending versions, suspend.
- **Payments:** pending payment requests, proof received (mark), generate code for that request, revoke, manual extension or refund (always with a note).
- **Teachers:** search by name or phone, see entitlements, reveal counts, impersonation-free support view.
- **Reviews and reports:** moderate, hide, restore, ban abusive accounts.
- **Catalogues:** governorates, délégations, levels, subjects (including approving 'Autre'), plans and prices, payment account details, working hours.
- **Audit log:** who created/revoked a code, changed a price, approved a profile.
- **Metrics:** new teachers, active subscriptions, revenue by plan, searches with no results (tells you which subjects/cities to recruit).

Admin roles: *super admin* and *support* (cannot change prices or settings).

## 7. Data model (PostgreSQL)

Use `uuid` primary keys, `created_at` / `updated_at` everywhere, money in integer millimes.

| Table | Key columns |
| --- | --- |
| `users` | id, role, phone\_e164 (unique), email, password\_hash, phone\_verified\_at, status |
| `teacher_profiles` | user\_id, slug, full\_name, photo\_url, diploma, experience, bio, governorate\_id, modes\[\], status, rejection\_reason, is\_listed, rating\_avg, rating\_count, pending\_version (jsonb) |
| `teacher_zones`, `teacher_levels` | teacher\_id + delegation\_id / level\_id |
| `teacher_subjects` | teacher\_id, subject\_id, hourly\_rate\_millimes |
| `governorates`, `delegations`, `levels`, `subjects`, `plans` | catalogues (admin editable) |
| `entitlements` | teacher\_id, visibility\_until, dashboard\_until, pending\_visibility\_days, pending\_dashboard\_days |
| entitlement\_grants | id, teacher\_id, source (code / founding / admin), visibility\_days, dashboard\_days, granted\_at, note |
| otp\_challenges | id, phone\_e164, code\_hash, channel (whatsapp\_inbound / whatsapp\_template), expires\_at, attempts, verified\_at |
| settings | key, value: founding\_slots\_total, founding\_slots\_used, founding grant flags, payment accounts, working hours |
| `payment_requests` | id, teacher\_id, plan\_id, with\_dashboard, amount, method, reference, status, handled\_by |
| `activation_codes` | id, code\_hash, plan\_id, visibility\_days, dashboard\_days, payment\_request\_id, status, redeemed\_by, redeemed\_at, expires\_at |
| `reviews` | id, teacher\_id, author\_id, rating, comment, status, teacher\_reply, unique(teacher\_id, author\_id) |
| `contact_events` | teacher\_id, session\_hash, type (view / reveal / whatsapp), created\_at |
| `reports`, `audit_log`, `notifications` | moderation, traceability, message queue |
| `groups` | id, teacher\_id, name, color, start\_date, end\_date, pricing\_model, reference\_price\_millimes (optional), status (active / archived) |
| `schedule_rules` | id, group\_id, weekday, slot\_no (1-3), start\_time, end\_time |
| `sessions` | id, **teacher\_id**, group\_id, date, start\_time, end\_time, status (scheduled / cancelled), origin (rule / moved / extra), original\_date |
| `students` | id, teacher\_id, full\_name, full\_name\_norm, phone, phone\_digits, note, archived\_at; trigram (pg\_trgm) indexes on full\_name\_norm and phone\_digits |
| `memberships` | id, group\_id, student\_id, joined\_on, left\_on, default\_discount\_millimes |
| `monthly_accounts` | id, membership\_id, year\_month, amount\_due\_millimes (typed, nullable), sessions\_attended, discount\_millimes, amount\_paid\_millimes; unique(membership\_id, year\_month) |

**No-overlap guarantee:** PostgreSQL exclusion constraint on `sessions` using `btree_gist`: `EXCLUDE USING gist (teacher_id WITH =, tsrange(date + start_time, date + end_time) WITH &&) WHERE (status = 'scheduled')`. Access control: all teacher data goes through a data-access layer that filters by the authenticated teacher, with optional PostgreSQL row-level security as defense in depth. A teacher can read and write only rows where `teacher_id` is theirs.

## 8. Architecture, security, compliance

### 8.1 Recommended stack

- **Web:** Next.js (React) with Tailwind CSS, `next-intl` for FR/AR with RTL, mobile-first responsive layout.
- **Backend:** plain PostgreSQL 14+ (already installed locally by the owner; no Supabase, no Docker) with Drizzle ORM and ordered SQL migrations. Custom authentication (phone + password, WhatsApp verification, server-side sessions), photo storage behind a storage interface (local folder in development, S3-compatible bucket in production), scheduled jobs as secured endpoints called by the host's cron. A managed PostgreSQL is chosen for production at launch time.
- **Mobile:** no native apps. The website is mobile-first and tested on Chrome (Android) and Safari (iOS), including low-end phones and slow connections.
- **Jobs (daily):** expiry reminders, grace-period locking, monthly account creation, retention cleanup.
- **Messaging:** WhatsApp Business Platform (Cloud API) for verification and notifications, no SMS in v1 (SMS can be added later as a fallback), plus one provider for transactional email. Setup and costs: 8.5 and 13.2.

### 8.2 Security

HTTPS only, password hashing by the auth service, hashed activation codes, rate limits on login/OTP/code redemption/contact reveal, CAPTCHA on abuse, server-side validation of every rule in this document (never UI-only), image re-encoding on upload, sanitised bios and reviews, daily database backups with a tested restore, audit log for admin actions.

### 8.3 Privacy (Tunisia)

You will store teachers' personal data and teachers will store their students' (often minors') names and phone numbers. Keep only what is needed, restrict access to the owning teacher, publish a privacy policy and CGU, record the consent to publish the phone number, support deletion on request, and check obligations under Tunisia's personal-data law (organic law 2004-63, INPDP) with a lawyer before launch.

### 8.4 Browser support and performance

Target the last two versions of Chrome (Android and desktop), Safari (iOS and macOS), Firefox and Edge, with layouts tested from 360 px wide. Keep pages light for slow mobile connections: compressed images, lazy loading, and server-rendered search and profile pages. Since there is no app, reminders go by WhatsApp, email and on-site notices (section 9).

### 8.5 WhatsApp verification and notifications

Verification and notifications use **WhatsApp only** in v1. SMS can be added later: the `otp_challenges.channel` field means no redesign. Two verification methods, start with the first:

1. **Send-to-verify (recommended start, free to receive):** the sign-up screen shows a 'Vérifier par WhatsApp' button. It opens WhatsApp with a message already written to the platform's number, containing a short one-time code shown on screen (e.g. `TTP-7KQ2`). The WhatsApp webhook receives the message, checks the code and marks the **sender's phone number** as verified. The platform sends nothing, so there is no per-code cost.
2. **Code sent to the user (OTP template):** the platform sends a 6-digit code through an approved WhatsApp *authentication* template. More familiar for users, but every message is billed by Meta and it needs business verification and template approval. Add it when volume justifies it.

Rules for both: code valid 5 minutes, 5 attempts, stored hashed, rate limits per phone number and per device. The verified number must equal the number typed at sign-up. Password reset uses the same flow.

**Notifications that start a conversation** (approval, code delivery, expiry reminders) need pre-approved templates. At launch, send them **manually from the WhatsApp Business app**, using ready-made copy-paste messages in the admin panel; automate with templates once volume grows. Check Meta's current rules and price list for Tunisia before enabling templates. Setup steps are in 13.2.

## 9. Notifications

| Event | Recipient | Channel |
| --- | --- | --- |
| OTP code | Teacher / reviewer | WhatsApp (send-to-verify or code template); no SMS in v1 |
| Profile approved / rejected (reason) | Teacher | WhatsApp or email, on-site notice |
| Payment request received / code issued | Teacher | WhatsApp or Messenger (manual at first), on-site notice |
| Plan expires in 7 days, 1 day, expired | Teacher | On-site banner, email, WhatsApp |
| Grace period ending, data deletion warning | Teacher | Email + on-site banner |
| New review, report outcome | Teacher / reporter | On-site notice |
| Session reminder 1 h before (later) | Teacher | WhatsApp or email |

## 10. Acceptance tests (the tricky logic)

1. **Overlap on create:** group B generates a session overlapping group A on 14 Sept → wizard lists the conflict and blocks 'Suivant'.
2. **Delete one occurrence:** delete Monday 14 Sept of a weekly group → only that date is cancelled; other Mondays remain; 'Restaurer' brings it back.
3. **Move one occurrence:** move Monday 14 Sept 08:00-10:00 to Tuesday 8 Sept 12:00-14:00 → the old slot is free, the new slot is occupied, an overlapping target shows an error.
4. **Unsaved guard:** change a date in 'Modifier date', press Retour → three-choice warning; 'Confirmer' is disabled before any change.
5. **Calendar badge:** group A Mon/Tue/Fri and group B Mon/Wed/Sun in the week of 7 Sept 2026 → badges 2, 1, 1, 0, 1, 0, 1.
6. **Manual amount:** typing 140 DT with a 10 DT remise and 100 DT paid gives remaining 30 and status Partiel; pressing +1 on the counter changes neither amount nor status; before any amount is typed the card shows 'Montant à saisir' and Payé / partiel are disabled.
7. **Discount:** a 10 DT discount strikes through the original total and remaining and shows new values; a discount above the typed amount is refused.
8. **Reference price:** changing the group's reference price changes no amount already typed, in any month.
9. **Student picker (multi-select):** in 'Ajouter élève' of group B, search 'Mo', select Mohamed, search 'sa', select Sarah → both chips stay selected; 'Ajouter les élèves (2)' adds both without creating new students; stats count each student once under 'Élèves' and each membership in the pie.
10. **Entitlement stacking:** renewing 10 days before expiry adds full duration after the current end date.
11. **Credit before approval:** redeeming a 3-month code while pending → profile hidden; at approval, 90 days start.
12. **Expiry:** after `visibility_until` the profile disappears from search within 5 minutes; the dashboard is read-only for 30 days; export still works.
13. **Code abuse:** 6th wrong code in an hour → lockout; a reused or revoked code is refused.
14. **Reveal limit:** 31st reveal from one device in an hour is blocked with a friendly message.
15. **Review rules:** a second review of the same teacher by the same account is refused; a review from the teacher's own phone number is refused; the 4th review by one account in a day is refused.
16. **Picker states:** students already in the group are disabled with 'Déjà dans ce groupe'; the add button is disabled while nothing is selected.
17. **Duplicate suggestions:** typing 'Moha' in the name field of 'Ajouter un nouvel élève' lists existing Mohameds; tapping one switches to the existing-student picker with that student selected; validating an identical name and phone shows 'Utiliser l'élève existant / Créer quand même'.
18. **Élèves section:** editing a student's phone on the student page changes it in every group row and in the search results; removing the student from their last group leaves them listed as 'Sans groupe'.
19. **One record:** changing the montant à payer on the student page and on the group page edits the same record, with no divergence.
20. **Founding offer:** the 100th approved teacher gets 365 days automatically; the 101st does not; a rejected profile does not use a slot.
21. **WhatsApp verification:** the on-screen code sent from a different phone than the one typed fails; a code older than 5 minutes fails; the 6th attempt locks verification for 1 hour.

## 11. Roadmap

| Phase | Content | Rough effort (solo developer) |
| --- | --- | --- |
| 0 | Complete the launch setup (section 13), design system, catalogues (délégations, subjects), legal texts | 1 week |
| 1 | Public search + profiles, teacher signup with WhatsApp verification, profile, admin review, manual payment + codes, entitlements, expiry job, reveal logging | 6-8 weeks |
| 2 | Reviews, notifications, SEO pages, teacher mini-report | 2-3 weeks |
| 3 | Dashboard: groups, wizard, sessions, day overlay, calendar | 5-7 weeks |
| 4 | Dashboard: Élèves section and student picker, billing, statistics, export | 4-5 weeks |
| 5 | Responsive and cross-browser polish, performance, accessibility, launch checklist | 1-2 weeks |
| Later | Automatic payments (e.g. Konnect, Paymee or Flouci API, verify availability), identity-verified badge, proof upload on the site, attendance sheet per session feeding the counter, public-holiday exclusion, section/filière filter (Sciences, Maths, Lettres...), session reminders by WhatsApp or email | — |

**Launch tip:** a marketplace needs teachers before parents. The founding offer (2.6) is the recruitment lever: promote it in Sfax, Tunis and Sousse first, and build the city and subject landing pages early for Google traffic.

## 12. Decisions (confirmed 24 October 2026)

1. **Brand and domain:** TuniProf, tuniprof.tn.
2. **Université** stays in scope.
3. **Verification and notifications:** WhatsApp only, no SMS in v1 (SMS may come later), see 8.5.
4. **Grace period 30 days and retention 12 months:** confirmed.
5. **Founding offer:** the first 100 teacher accounts get 1 year free (2.6). Assumption to confirm: the free year includes the Dashboard.
6. **Reviews:** simplified (3.5).
7. **Browser baseline:** last two versions of Chrome, Safari, Firefox and Edge, from 360 px wide.
8. **Payment details and setup:** needed before launch; guided step by step in section 13.
9. **New in this version:** Élèves section and student picker (5.6, 5.7).

## 13. Launch setup guide (payments, WhatsApp, legal)

*Practical steps for what you must prepare. I am not a lawyer or an accountant, and procedures, limits and fees change: confirm each point with the provider or an accountant.*

### 13.1 Payment accounts

Goal: three ways to receive money, all under the same legal name, shown on the payment page.

1. **Dedicated phone number (SIM)** for the platform, used for Flouci, WhatsApp Business and Messenger. Keep it separate from your personal number.
2. **CCP account** (La Poste) in the owner's name. It gives the CCP number for 'Versement poste / CCP' payments and is the base for D17.
3. **D17 / e-Dinar:** activate D17 (La Poste's mobile app) on that CCP account so teachers can pay by transfer from their e-Dinar card.
4. **Flouci wallet** on the platform number: complete the identity verification (KYC) to raise limits, and check receiving limits and any fees against your expected volume.
5. Enter the beneficiary name, numbers and working hours in the admin settings (never hard-coded).

### 13.2 WhatsApp setup

1. Install **WhatsApp Business** (free app) on the platform number: business profile, opening hours and an auto-reply such as 'Envoyez votre preuve de paiement avec votre référence'. Proofs arrive here in v1.
2. For automatic verification, create a **Meta Business account** and add a WhatsApp Business Platform (Cloud API) number. Use a separate number from the one in the app, unless Meta's 'coexistence' option is available to you (check Meta's current documentation).
3. Complete **business verification** if Meta asks for it; it raises sending limits, and the required documents depend on your legal status.
4. Configure the **webhook** that receives incoming messages (send-to-verify, 8.5) and test it with your own phone.
5. Later, create and submit **message templates** (authentication, utility) for approval before automating notifications.
6. Check Meta's current price list for Tunisia before enabling template messages.

### 13.3 Payment verification checklist (admin, every time)

1. The reference (or phone number) in the proof matches an open payment request.
2. The amount equals the plan price, including the dashboard option if chosen.
3. **The money is actually visible in your Flouci / CCP / D17 history.** Never accept a screenshot alone: screenshots can be faked.
4. The transaction number and date are new. Record them: the same proof cannot be used twice.
5. Generate the code from that payment request, send it, and mark the payment 'verified'.
6. Define reply hours (for example 09:00-20:00, Monday to Saturday), show them on the payment page, and promise 'le lendemain matin' outside them.

Keep a monthly export of verified payments for your accountant.

### 13.4 Business and legal minimum

- Choose and register the form of activity with an accountant (for example a sole-proprietor or auto-entrepreneur status, or a company) so you can legally collect and declare income; get the tax ID if required.
- Register **tuniprof.tn** through an ATI-accredited registrar (the registrar tells you the documents required).
- Publish the CGU, privacy policy and legal notice before launch, and check the INPDP obligations (8.3) with a lawyer.

### 13.5 Pre-launch checklist

| Item | Done when |
| --- | --- |
| Platform phone number + WhatsApp Business | A message from a test phone arrives |
| CCP, D17, Flouci | A real 15 DT test payment from another account is visible in your history |
| Domain and email | tuniprof.tn resolves and the contact email works |
| WhatsApp verification | A new test teacher is verified through send-to-verify |
| Admin settings | Payment details, working hours and founding slots (100) are filled in |
| Catalogues | 24 governorates, délégations, levels and subjects are loaded |
| End-to-end test | Test teacher: sign-up, approval, payment, code, visible profile, dashboard |
| Legal pages | CGU, privacy policy and legal notice are published |
