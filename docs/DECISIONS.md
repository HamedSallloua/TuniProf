# Decisions log

Dated record of every choice not fixed by the spec. Newest at the bottom of each day.

## 2026-10-29 (M9, fifth round of changes asked by the owner)

- "Green" is the app's main green (the same as the group wizard's new sessions). Today in this calendar is a thin ring instead of the Calendrier's green fill, so a green day always means a session of this group. The red rule reads "overlaps another session" (other groups, or this group's own); the day screen already refuses an added session that overlaps this group's own, so in practice red appears against other groups' sessions.

## 2026-10-29 (M9, fourth round of changes asked by the owner)

- **"Modifier calendrier" shows one month at a time**, chosen by the URL (`?mois=` or `?chercher=`), the same as the sessions list; this replaces the "only months with sessions" cards of the third round on that page only. It also removes the consequence I noted last round (no way to add a day in an empty month).
- Going to "Ajouter une séance" from this page leaves it, so changes prepared but not saved on the calendar are lost; save first. (The arrows and the search do not lose them.)

## 2026-10-29 (M9, third round of changes asked by the owner)

- **"Réinitialiser aussi les séances modifiées" is removed** (owner's request). This differs from spec 5.3 (which has the reset box); the owner's ruling wins. A weekly pattern change never touches sessions moved one by one, added days or past sessions; to change a moved session the teacher edits it day by day.
- **Calendar previews show only months with sessions.** In "Modifier calendrier" the other groups' sessions are still loaded for the whole span of the group (to catch overlaps), only the drawn cards are filtered. Consequence of removing the month buttons: from this page a session cannot be added in a month that has none; use "Ajouter une séance" (Calendrier) or move a session there.
- **"Modifier liste d'élèves" merged into one list.** The immediate inline editing of a field and the immediate "Retirer du groupe" of the old cards were replaced by the prepared edit and the prepared removal (same effect, saved with the list). The three actions that need their own dialog stay immediate: add to another group, move, delete.

## 2026-10-29 (M9, second round of changes asked by the owner)

- **The group price is required** (owner's request). This differs from spec 5.2 and the groups table of the spec ("optional reference price"); the owner's ruling wins. A price is a whole number of millimes above 0, with a pricing model. The database column stays nullable only because groups made before still have none (they show "Prix non défini"); the server refuses to create a group or to save a price without one.
- **Same name AND same phone is refused** (owner's request). It replaces the warning with "Créer quand même" of spec 5.7. My reading: only when the phone is filled in. Two students with the same name and no phone are allowed (they may be two different children); say so if you want that refused too. The rule is per teacher. It applies when creating (profile, picker, group list page) and when editing (the resulting name AND phone together). Migration 0021 (unique index) guarantees it even for two requests at the same moment. A side effect: in "Modifier liste d'élèves" a swap of two students' phones in one save is refused (the first change collides with the second student's old values); do it in two saves.
- **Group page** now only shows information; the work moved to the edit pages ("Modifier calendrier" gets the sessions list, "Modifier liste d'élèves" gets the student cards). The days list folds above 5 days (first 3, "Afficher plus", last). The price card keeps the title "Prix de référence".
- **Next session** on a group card means the next session that is not over yet (today's later ones count), whatever its date.

## 2026-10-29 (M9, first round of changes asked by the owner)

- **Student archiving is removed** (owner's request). This differs from spec 5.7 ("Archiver" and the Actifs / Archivés filter); the owner's ruling wins and replaces the "Archive" decision below. Migration 0020 drops `students.archived_at`. A student archived before is a normal student again (nothing was hidden for good). Deleting (name typed) is the only way to remove a student, and the delete dialog no longer recommends archiving.
- **Delete and move are on the cards**, not only on the student page: group-page cards got "Supprimer", Élèves-list cards got "Déplacer" and "Supprimer". The delete dialog is the same everywhere. From the Élèves list a student can be in several groups, so "Déplacer" first asks which group they leave (skipped when there is only one) and the target cannot be a group the student is in.
- **Search inside a group** is the shared search run in the browser over the members of the group (a group is small, so there is no server mode there); it appears when the group has two students or more.
- **"Modifier liste d'élèves"** (spec silent, owner request, modelled on "Modifier calendrier"):
  - Changes are kept on the page and saved with one button, in one transaction, all or nothing: students removed from the group (memberships end, history stays), information edited (the one student record, so it changes everywhere), existing students added, new students created and added. The order inside the save is removals, edits, creations (with the duplicate check), then the new memberships.
  - A failure rolls everything back and names the row (`list` and `index`); a new student identical to an existing one is the same warning as in "Ajouter élève" (settled per row by "Créer quand même", sent as `force`), and "Utiliser l'élève existant" turns the row into an addition (or drops it when that student is already in the group).
  - Only the students of THIS group can be removed by it (a membership of another group is refused); edits are by student id, restricted to the teacher's own students; at most 200 changes per save (my number).
  - Not in this page (they stay on the cards and the student page): moving a student to another group and deleting a student.
  - "Ajouter élève" has a "prepare only" mode (`stage`) used by this page; the phone is checked at once with the same function as the server (`lib/students/clean.ts`, moved out of the server code so the browser can use it).
  - The name, phone and note rules are unchanged (name 2 to 80, Tunisian mobile phone or empty, note 300).

## 2026-10-29 (M9)

**Difference between AGENT_CONTEXT and the spec (the spec wins, told to the owner):** both give the same M9 content, but AGENT_CONTEXT's "done when" (tests 9, 16, 17, 18, 19) and the spec's student page (month block, "Total du mois", payment filter, revenue warning) need `monthly_accounts`, which both documents build in M10. Decision (proposed to the owner, who answered "start M9"): M9 builds everything that does not need billing; the billing-dependent parts and the parts of tests 9 and 19 that need them are done in M10 (list in PROGRESS.md). Not invented: no amount, counter or payment status exists in M9.

**Data**

- **`students`** has the spec's columns plus `note_norm` (my addition: the search must ignore accents in notes too, and SQL has no accent-folding without an extension) and `role` (always teacher, like groups). The name is 2 to 80 characters, the note at most 300 (my numbers; the spec is silent). `full_name_norm`, `phone_digits` and `note_norm` are written by the application with the same function as the search (`normalizeSearch`), so a search can never disagree with what is stored.
- **`memberships`** has a `teacher_id` column (not in the spec) so that two composite foreign keys, to the group and to the student of the SAME teacher, make a cross-teacher membership impossible in the database (invariant 16, same idea as `sessions`). One open membership per student and group (partial unique index); coming back later is a new row (spec 5.7). `default_discount_millimes` is created now for M10 and unused.
- **Phone:** optional, and validated exactly like a sign-up phone (Tunisian mobile, +216 and 8 digits starting with 2, 4, 5 or 9; spec 5.7 says "validated as in 4.1"). A parent's landline or a foreign number therefore cannot be saved: to confirm with the owner. Stored in E.164, shown as "22 345 678", always left to right.
- **Dates of a membership** are the Tunisia date of the day it is created or ended (`tunisNow`), like sessions.
- **Deleting a group** keeps its students (only the memberships go); they become "Sans groupe".

**Rules**

- **Duplicates:** a new student whose normalised name AND phone (both empty counts as equal) equal an existing student's gets the warning "Utiliser l'élève existant / Créer quand même", not a block (spec 5.7). Editing an existing student never warns.
- ~~**Archive:** only with no active group, "Restaurer"...~~ No longer applies: archiving was removed (see the first round of changes above).
- **Delete:** permanent, the name typed exactly (trimmed), the memberships go with the student. The sentence about recorded payments waits for M10.
- **Add to a group** (one or many students, or one student to many groups) is all or nothing; a student already in the group, or somebody else's student or group refuses the whole request. At most 500 ids per request.
- **Move** ends the membership in the old group and starts one in the target in one step; the target must be another group where the student is not.
- **Search:** name words match from their start; the phone matches digits anywhere but needs at least 2 digits (one digit would match everybody; my number); the note and the names of the student's CURRENT groups match by word start. Ranking name, phone, note, group, alphabetical inside each. Results 20 at a time, debounce 150 ms (spec). Browser filter up to 200 students, server search above (spec "about 200"; the first 200, alphabetical, are sent to the browser in that case). The server narrows with the trigram indexes (`LIKE`, with `%`, `_` and `\` escaped) and at most 500 candidates, then ranks with the same pure functions, so both give the same answer (tested).
- **Group search bar** (spec 5.5 asks for student names and phones): the groups list now also matches the students of each group, by name and phone digits, with a chip "Élève" or "Téléphone d'un élève".

**Screens**

- **Shared pieces:** one search hook, one results line (`StudentSummary`), one group picker (several groups or one), one inline editor ("Modifier" per field) used on the group page and the student page, and the Élèves list has a small edit form per row (name, phone, note at once).
- **Option 2 of "Ajouter élève"** is two steps as in the spec (name, then phone and note with "Confirmer" or "Passer et confirmer"); tapping a suggestion resets the new-student form, so nobody is created by tapping. From the Élèves section (no group) a suggestion opens that student's page instead.
- **New students are highlighted** for about 3 seconds through `?nouveaux=` (group page) and `?nouveau=` (Élèves), only ids that look like ids are used.
- **Access:** all student actions need a fully active Dashboard (read-only and ended Dashboards are refused by the server); searching only needs the Dashboard not to be over (`readableTeacher`), so the list still works in the read-only month.

## 2026-10-28 (M8, fourth round of changes asked by the owner)

- **"Modifier calendrier" gets the day-by-day editing of the wizard** (one function, `changeCalendar` in `lib/dashboard/calendar-change.ts`, which now takes `addedSessions`, `deletedSessionIds` and `editedSessions` next to the pattern). The changes are staged on the page and saved together; everything is checked again by the server in one transaction (all or nothing, past sessions refused, a session that is not this group's refused, overlaps with other groups and between new sessions listed, the database constraint stays the last guard).
- **Is rebuilding the pattern required? No.** Spec 5.3 asks for it ("Modifier calendrier ... applies from an effective date"), and it is useful for a weekly group: changing every future Monday from 08:00 to 09:00 in one action instead of one session at a time. It is optional: the owner can change only days. It makes no sense for a group whose days were picked in a calendar.
- **The pattern is rebuilt only when it changed** (the weekly rules, the end date, or the reset box). Before this round every save rebuilt it, which silently brought back a day the teacher had deleted (found in the browser). Rule now: a save that only touches days changes nothing else. Deleting or editing a pattern session in the same save as a pattern change: that slot is not made again (date-level for a moved session, as before).
- **Edited sessions:** a pattern or moved session that is edited becomes `moved` (it remembers its first date, so "Modifier calendrier" keeps it unless "reset" is ticked); a session added by hand (`extra` or `manual`) keeps its kind. Sessions added here are `manual` (never touched by the pattern).
- **The period follows the sessions:** a day outside the group's period widens it (start earlier or end later, 14 months at most, otherwise refused); for a picked-days group the period is always its first to its last session (it also shrinks when the first or last session is deleted). A group with a pattern keeps its start unless a day is added before it.
- **A picked-days group cannot be given a weekly pattern** in "Modifier calendrier" (owner: it must be a calendar, no reset option). This replaces the earlier rule "a pattern added there is created next to the existing sessions". The server refuses rules for such a group (`invalid_rules`). Adding a weekly pattern to such a group again would need a new decision.
- **Same calendar and same day overlay as the wizard** (`WizardDayOverlay`, `DayPicker`, `GroupCalendarPreview` with an optional click on a day); sessions that are over are shown with "Passée" and have no actions.
- **Arabic:** the owner approved all Arabic texts written so far (including the M6 and M7 drafts and the fourth-round texts of M8).

## 2026-10-28 (M8, third round of changes asked by the owner)

- **"Ajouter une séance" takes several rows at once.** One group for all rows (chosen once at the top), one row per day with its start and end. All or nothing: if one row overlaps a session of the calendar, or another row of the same request, nothing is added and the error names the row. At most 50 rows per request (my number). A row that ends in the past is refused like before. Origin of all rows: `extra`. Alternative rejected: a group per row (the owner said "another row for another day").
- **Days picked in a calendar need no period.** The period is the first to the last picked day and is recomputed whenever a day is added or removed (1, 5, 9 December then 12 December gives 1 to 12 December). The 14-month limit still applies to that computed period (an error is shown and "Suivant" stays disabled). Days before today cannot be picked. Only the end date is stored, as before.
- **The preview calendar of the sessions step is the way to add days** (it replaced being stuck after removing every day). In picked-days mode it shows the months of the picked days and two buttons to show one more month before (not before the current month) or after. In that mode a day can be added anywhere from today on. The teacher's own sessions are loaded for the months shown (up to 18 months at once, my limit in `loadScheduledAction`).
- **Début and Fin are picked in calendars** (one day each) for "Par jours de la semaine"; the number-of-weeks option stays and replaces the Fin calendar. A start in the past is still allowed (its past sessions are simply not created), as with the old date field.
- **Specific days next to a weekly pattern** (spec silent, owner request): in the day overlay of the sessions step the teacher can, for one exact day, add a session, edit one (date and times, with a calendar for the date) or delete one. Rules:
  - An added day is a `manual` session (never touched by "Modifier calendrier", like picked days). It must be inside the group's period and not in the past; at most 3 sessions that day, none overlapping (the pattern's sessions count).
  - An edited pattern session becomes a `moved` session with `original_date` = the date the pattern made it on (the same meaning as "Modifier date"), so "Modifier calendrier" keeps it unless "reset" is ticked.
  - A deleted pattern session is simply not created. Consequence, same as for a session deleted later: "Modifier calendrier" with a pattern that includes that date creates it again (the owner's earlier ruling that deletion is permanent and remembers nothing).
  - The server rebuilds everything itself from the pattern and three lists (`customSessions` = days added, `removedSessions`, `movedSessions`, by date and times) with the same function as the preview (`planSessions`); an adjustment that names a session the pattern does not make is ignored. The client never sends origins. A weekly group with no weekday ticked and only added days is accepted by the server (it is the same as picked days); the wizard still asks for at least one weekday in that mode.
  - Changing the way days are chosen ("Par jours de la semaine" / "En choisissant les jours") clears the days and adjustments made so far. A button "Annuler ces changements" clears the adjustments of a weekly group.
- **Known limit, not new:** `moved` sessions block the pattern from recreating that whole date in "Modifier calendrier", even if the date has two pattern sessions and only one was moved (`original_date` stores a date, not a slot).

## 2026-10-28 (M8, second round of changes asked by the owner)

- **The "Année scolaire en cours" shortcut is removed** (and with it the 1 September to 30 June choice, so that decision below no longer applies). The period is the start date plus an end date or a number of weeks.
- **"Supprimer" a session deletes it for good**; there is no "Restaurer". This differs from spec 5.3 (cancel + restore): the owner's ruling wins. Migration 0018 deletes the sessions that were only cancelled (already invisible), drops `sessions.status` and recreates the overlap constraint without the `WHERE status = 'scheduled'` part. The "Supprimer" button asks for a confirmation in the browser because nothing can bring the session back. A past session still cannot be deleted.
- **Consequence to confirm:** the old rule "a cancelled session does not come back by itself" is gone. If the teacher deletes a Monday one by one and later runs "Modifier calendrier" with a pattern that includes Mondays, that Monday is created again (the screen shows it as an added day in the preview before saving). The alternative would be to remember deleted dates in a separate table, which I did not build because you asked for a permanent deletion. Sessions moved one by one are still kept unless "reset" is ticked.
- **Days picked in a calendar**: in the period step the teacher chooses between "Par jours de la semaine" (the weekly pattern, as before) and "En choisissant les jours dans un calendrier". In the second case step 3 is the list of picked sessions (1 to 3 per day, start and end per session, a "same times for all days" helper) with the calendar and the conflicts under it. Rules: every picked day inside the period and not before today, at most 3 sessions a day, none overlapping, at most 1000 sessions. Such a group has no weekly pattern, so its sessions get the new origin `manual` (not `extra`, which means "Ajouter une séance" and shows the label "Ajoutée"). "Modifier calendrier" never touches `manual` sessions; a pattern added there is created next to them, and the page explains that a hand-picked group is changed one session at a time. The server checks all of this again (reason `invalid_sessions`).
- **Date search**: in the calendar the search bar takes a date and opens the calendar on it with the day overlay open (address `?chercher=`, any view and group filter are kept). In a group it opens that date's month, marks the sessions of that day and says how many there are (or that there is none). It is a date field (no free text), so it behaves the same in French and Arabic.
- **"Aperçu du calendrier"** of a group: one card per month from the group's start to its end (or further if a session was moved outside), days with a session of the group filled with the group's colour, and the number of sessions when there are two or more. On "Modifier calendrier" it first shows the group as it is; after "Voir ce qui va changer" it also marks the real differences (a session removed and created again identically is not drawn as a change).

## 2026-10-28 (M8, changes asked by the owner after review)

- **Archiving groups is removed** (owner's request: "not needed anymore"). This differs from spec 5.5, which lists "Archiver" and "Restaurer": the owner's ruling wins. Migration 0017 drops `groups.status` and makes the group name unique among ALL of a teacher's groups. The migration was written as a new file because 0016 had been applied on the development database; it stops with an error (and deletes nothing) if two groups of one teacher share a name. This replaces the "archived groups keep blocking slots" decision below, which no longer applies. The delete dialog no longer recommends archiving.
- **A period can be given as a number of weeks** from the first day, as an alternative to the end date: the teacher picks one of two options. N weeks = N x 7 days, the first day included (starting Wed 28 Oct, 1 week ends Tue 3 Nov). Whole numbers from 1 to 60: 60 weeks always fit in the 14-month limit. Nothing is stored about the choice: only the end date is saved.
- **Sessions already over are not created**: when a group is created (or its calendar rebuilt from today), any session whose END time has passed in Tunisia time is left out, so the calendar never gets a lesson in the past. A session in progress is kept. A period that only has finished sessions creates zero sessions (valid, as before). The wizard preview says how many were left out. The same rule as the lock on past sessions (end time passed).
- **"Modifier calendrier" no longer deletes a finished session of today** when rebuilt from today (it did: the effective date can be today and the rebuild removed everything from that date).
- **The year view colours days that have sessions**, with the same colour as the month view (the plain "has sessions" circle, not the group colours). Spec 5.10 only asked for navigation in the year view; this is the owner's request.

## 2026-10-28 (M8)

AGENT_CONTEXT and the spec agree on M8. Choices not fixed by the spec (see PRE_PRODUCTION_NOTES section 9):

**Time and overlaps**

- **Dates and times are local Tunisia strings** (`YYYY-MM-DD`, `HH:MM`), never instants: a 17:00 lesson stays 17:00 whatever the server's time zone. Weekday 1 is Monday, 7 is Sunday. "Now" is computed in Africa/Tunis (`tunisNow`).
- **The database refuses overlaps**: exclusion constraint `no_teacher_overlap` (btree_gist) on the teacher and the time range of scheduled sessions. Touching sessions (one ends at 10:00, the next starts at 10:00) are allowed. The application also checks first, only to list the conflicts nicely; the constraint is the guarantee.
- **All writes of a teacher take a lock** (transaction advisory lock on the teacher), so two browser tabs cannot both pass the check. Alternative rejected: relying on the constraint error alone (works, but the message would be less useful).
- ~~An archived group keeps its future sessions in conflicts~~: no longer applies, archiving was removed (see the changes above).
- ~~A cancelled session frees its slot~~: no longer applies, sessions are deleted for good (see the second round of changes); the constraint covers every session.

**Groups**

- ~~Suggested period = school year~~: removed (see the second round of changes). The spec only fixes the 14-month maximum, which is also a database check.
- **Group names are unique among a teacher's groups**, ignoring case and spaces (unique index; it covered only active groups until archiving was removed).
- **Colour:** one of 10 colours picked automatically (the first one not used by an active group), changeable at creation.
- **Delete = typed name** of the group, with a warning that sessions go too. The revenue warning of spec 5.5 waits for M10 (no billing data yet).
- **"Groupe vide"** is shown on every group until students exist (M9).
- **Start date cannot change** in "Modifier calendrier"; the end date can (still within 14 months).

**Sessions**

- **Past sessions are locked in the application** (end time passed in Tunisia time), not in the database, so an admin can still correct data with SQL.
- **"Modifier date" keeps the first original date** if a session is moved twice, and a session cannot be moved onto itself.
- **"Modifier calendrier"** rebuilds only sessions from the chosen date. Sessions the teacher moved are kept unless "reset" is ticked; added (extra) and hand-picked sessions are always kept. A date generated by the pattern that falls on a moved-from date is skipped. (Cancelled sessions no longer exist: see the second round of changes.) It can be run as a dry run that only lists the conflicts.
- **Access:** during the plan everything; read-only for 30 days after it ends (every action refused on the server); then redirect to the subscription page.

**Screens**

- **The wizard is a client form** that calls server actions with data (not a plain form post), because it needs the live preview and React would reset a plain form after an error. The preview uses the same pure functions as the server.
- **Calendar state in the URL** (`?vue=&date=&groupe=&jour=`), so views can be bookmarked and the back button works. Week is the default (spec 5.10).
- **A block in the calendar opens the day overlay**, not the group, because the day is where cancel, move and add happen.
- **Group page shows one month** with a month selector, starting at the month nearest to today within the group's period.
- **Dashboard menu** shows only existing sections (Groupes, Calendrier); Élèves and Statistiques are added with their milestones. On phones the menu is a bottom tab bar.
- **Search normalisation** (`lib/text/normalize.ts`: accents, Arabic letter variants, Arabic digits) is shared code, reused by the student picker at M9.

## 2026-10-28 (M7)

AGENT_CONTEXT and the spec agree on M7. Choices not fixed by the spec (see PRE_PRODUCTION_NOTES section 9):

**The queue**

- **One row per message and channel** (`site`, `whatsapp`, `email`), with a unique key (`user`, `channel`, `dedupe_key`). The key is built from the event (`plan_expiring:7:2027-01-05`, `proof:{requestId}`, `review:{reviewId}`), so repeated calls, a job run twice or a missed day never create a second message. A new term (a renewal changes the end date) is a new key.
- **Channels per kind** (`lib/notifications/kinds.ts`): spec 9 says "WhatsApp or e-mail" for approvals; I queue both (WhatsApp copy-paste always, e-mail only when the teacher gave an address) plus the on-site notice. Payment events: WhatsApp and on-site (spec 9: WhatsApp or Messenger, manual). Expiry reminders, ended plan and grace warning: all three (spec 9 and the owner's M0 ruling for warnings). New review and report outcome: on-site only (spec 9).
- **Messages are written when shown**, from the message files, and stored as kind plus values. The name of the teacher is stored with the message. Dates are formatted in Africa/Tunis.
- **No secret in the queue:** the "code ready" message has no activation code (only a hash exists in the database); the admin sends the code from the payment page, which can re-derive it, and the queue links to it. A payment refusal carries only the reference: the admin's note may be internal.
- **Created in the transaction of the event** (approval, payment decision, review moderation), so a message exists if and only if the event happened.
- **A review published (or restored) is announced once** (key per review). A report outcome goes to the teacher who reported.
- **Not notified:** the reviewer (no channel), suspension and restoration of a profile (spec 9 does not list them), a teacher's own reply.

**The daily job**

- **Reminders at 30, 7 and 1 day** (AGENT_CONTEXT M7; spec 9 lists 7 and 1). Only the smallest threshold that still covers the days left is sent: 20 days left gives the 30-day reminder, 5 days give the 7-day one. Reminders concern the visibility end date; a plan with the Dashboard shares it.
- **"Abonnement terminé"** once, for plans that ended in the last 30 days (so the first run on an old database does not message people whose plan ended long ago).
- **Grace warning:** the Dashboard stays read-only for 30 days after it ends (spec 2.5); the warning goes out 7 days before that ends (my number, `GRACE_WARNING_DAYS`).
- **Only approved or suspended profiles** get plan messages (they once had a visible profile), and only active accounts.
- **Cleanup periods** (my choice, `lib/notifications/schedule.ts`): rate-limit counters 2 days, webhook message ids 30 days, finished verification challenges and sessions 30 days, read or sent notifications 12 months. A message still waiting is never deleted.
- **Postponed to M10:** monthly accounts creation and the 12-month Dashboard data retention with its two deletion warnings. They need the Dashboard tables (M8 to M10); warning teachers about deleting data that does not exist yet would be wrong. Recorded in PRE_PRODUCTION_NOTES.
- **Every step is idempotent** and a failure of e-mail delivery does not stop the steps before it (the delivery runs after the queueing).

**E-mail**

- **`EmailProvider` interface**; development writes the e-mail in the terminal; production has no provider until the owner chooses one (M12), so e-mails stay queued. Alternative rejected: picking a provider myself (account, DNS and cost are the owner's).
- **Bilingual e-mails:** French then Arabic in one message, subject `French | Arabic`, because the language of a teacher is not stored. Alternative rejected: adding a language column to users now.
- **Retries:** claimed with a row lock (two runs never take the same message), 3 attempts, then `failed` with the last error.

**Screens**

- **Admin `/admin/messages`:** a list, not a detail page; copy buttons per language, `wa.me` links with the text, "Marquer comme envoyé". Open Meta templates later by adding a delivery step for the `whatsapp` channel.
- **Teacher notices** on the teacher home (up to 10 unread), marked read one by one.

## 2026-10-28 (M6)

AGENT_CONTEXT and the spec agree on M6. Choices not fixed by the spec (to confirm, see PRE_PRODUCTION_NOTES section 9):

**Rules of a review**

- **One review per account and teacher, final:** no editing and no deleting by the author in v1. The unique key also means a refused review still blocks a new one by that account on that teacher. Alternative rejected: letting the author edit (it would reopen moderation and the rating history).
- **At most 3 reviews per account per day** is a rolling 24 hours, counting every review whatever its status (refused ones too), enforced by a trigger (SQLSTATE `TP002`, not by message text). A calendar day in Africa/Tunis was rejected: a midnight reset would allow 6 reviews in a few minutes.
- **Own phone number:** impossible by design rather than by a comparison. One number is one account with one role (M2), so a teacher's number can only be a teacher; the reviewer sign-in refuses it and the foreign key refuses a teacher as author. Tested both ways.
- **Only a visible profile can be reviewed** (same visibility rule as everywhere). Reviews already written stay when a profile later expires.
- **States:** `pending` (new), `published`, `rejected`, `hidden` (published then taken down). Allowed steps: pending to published or rejected; published to hidden; hidden back to published. Spec 3.5 mentions auto-publishing "later": not done, every review is moderated.
- **Rating cache:** `rating_avg` and `rating_count` count published reviews only and are recalculated by a database trigger on every change, rounded to two decimals, so no code path can forget it.
- **Comment** is optional, up to 500 characters; a rating alone is a valid review. There is no contact-detail filter on comments and replies (the bio has one): React escapes the text, and moderation catches the rest.
- **The author is never shown:** the public sees "Avis vérifié par WhatsApp" and the date. The admin sees the reviewer's phone number (to recognise a repeat abuser).

**Reply and reports**

- **Teacher reply:** one per review, on a published review of their own profile, public at once, final (no edit), 1 to 500 characters. It is not moderated separately; an admin who hides the review hides the reply with it.
- **A teacher sees only published reviews** of their own profile, never the new ones waiting for moderation.
- **Reporting a review:** only the teacher it is about. Reasons (my wording): contenu inapproprié ou injurieux, faux avis, autre (note required). One open report per teacher and review; same hourly limit as profile reports. `reports.reason` gained `fake_review`; the database keeps profile reasons and review reasons apart.
- **Admin decisions on a published review with open reports:** "Masquer" hides it and marks the reports upheld; "Garder" marks them dismissed and the review stays. A later report is possible. Banning abusive accounts, and the full reports screen, are M11.

**Screens and code**

- **Back to the profile after the WhatsApp sign-in:** the reviewer sign-in page takes `?retour=/prof/{slug}`, stores it in a 30-minute httpOnly cookie `tp_return` and, once the number is verified, goes back to it. Only addresses of the form `/prof/{slug}` are accepted, in the page, at storage and at use, so it can never send somebody to another site (tested).
- **Forms are sent by hand** (`onSubmit` + `startTransition`) for the review, reply and report forms, like the profile form of M3, so a refusal does not empty them.
- **The public profile page shows the 20 latest published reviews**; "see more" is a later improvement.
- **Teacher navigation:** a "Mes avis" button on the teacher home, only for approved profiles.
- **Admins see no review box** on a profile (they neither write nor need to be told they cannot); a teacher is told that teacher accounts cannot review.

## 2026-10-27 (owner approvals, after M5)

- The owner approved all Arabic texts written up to M5 (`messages/ar.json`, the refusal reason templates, the Arabic catalogue names, `docs/GLOSSARY.md`) and the wording of the legal page stubs. The real legal texts (CGU, privacy policy, legal notice) are still to be provided and checked by a lawyer; nothing is invented.
- New file `docs/PRE_PRODUCTION_NOTES.md`: everything to do before production. It is updated in every session that changes something relevant (rule added to `CLAUDE.md` and to the memory table of `docs/AGENT_CONTEXT.md`).

## 2026-10-27 (M5)

AGENT_CONTEXT and the spec differ in two small places, and the spec wins: (1) spec 3.1 lists `/devenir-professeur` and `/comment-payer` while the M5 task text only names "legal page stubs": both pages are built; (2) spec 3.3 puts a pin emoji on the card, and the owner's no-emoji rule wins: a small SVG icon is used. Choices not fixed by the spec:

**Search**

- **Where the order is decided:** the database finds the matching teachers (always from `visible_teacher_profiles`), the application ranks them (`lib/marketplace/ranking.ts`, pure and tested), then loads the cards of the page. Alternative rejected: one big SQL `ORDER BY`, which cannot be unit tested. A safety cap of 5,000 candidates applies; fine for years of growth.
- **Default score (out of 100):** 40 completeness (photo 50 %, bio of 200+ characters 25 %, two or more subjects 25 %, because every visible profile already has the required fields), 40 damped rating (a teacher with no review counts as 3 reviews of 4 stars, so newcomers are neither buried nor put above well-reviewed teachers), 20 renewal recency (latest purchase or grant, 1 today down to 0 after a year). The spec gives no numbers; all of this is in `lib/marketplace/config.ts` and `ranking.ts`.
- **Rotation:** scores are cut into bands of 5 points; inside a band the order is a stable pseudo-random shuffle that changes every hour (`rotationSeed`). Stable inside the hour, so page 2 continues page 1.
- **Online everywhere:** a governorate (or délégation) search also returns teachers who give online lessons, unless the visitor asked for "à domicile" or "chez le professeur". Choosing "en ligne" keeps the rule.
- **Price:** the price filter and the "à partir de" figure use the rate of the subject asked for when there is one, otherwise the lowest rate of the teacher. So a card never shows a price that the filter excluded.
- **Subjects:** only approved, active subjects count in search and on profiles ("Autre" subjects stay hidden until M11).
- **Addresses:** `gouvernorat`, `delegation`, `niveau`, `matiere` carry slugs; `mode` is `domicile`, `professeur` or `en-ligne`; `tri` is `pertinence`, `prix-asc`, `prix-desc`, `mieux-notes` or `recents`; `prix_min`/`prix_max` are in DT. Anything invalid is ignored.
- **Results per page:** 20, with previous and next links (plain links, work without JavaScript).
- **Indexing:** only the plain `/recherche` is indexed; any filtered or paged search is `noindex,follow` with the canonical on `/recherche`. A landing page `/{gouvernorat}/{matiere}` is indexed (and in the sitemap) only when at least one visible teacher lives in that governorate; otherwise it still works but is `noindex`, because it would only repeat the online teachers.
- **Mixed route:** `/{gouvernorat}/{matiere}` is a dynamic route; the fixed pages (`/admin/...`, `/prof/...`, `/espace-professeur/...`) win over it, and an unknown governorate or subject is a 404.

**Contact reveal and reports**

- **Reveal limits:** 30 per device per hour (spec), plus 300 per network address per hour (my choice, much higher because mobile networks share addresses; it stops someone who clears cookies). Turnstile from the 11th reveal in the hour. The device is the anonymous `tp_device` cookie (created on the first reveal). Counted in `rate_limit_events` like the other limits; `contact_events` is the permanent log. One database lock per device makes two simultaneous clicks count one after the other.
- **Turnstile:** Cloudflare's always-pass test keys in development when none are set; in production without keys the check fails closed. The token is checked with Cloudflare before the database lock is taken (a network call).
- **What is logged:** only `reveal` events. `view` and `whatsapp` are allowed by the table but not written yet (teacher mini-report, spec 4.4).
- **Reports:** reasons are "informations inexactes", "contenu inapproprié", "demande ou comportement suspect", "autre" (note required for "autre", 500 characters max). They are my wording, the spec does not list reasons. One open report per browser and profile, 5 per hour per browser, only for a visible profile. Admin screen at M11.

**Pages and code**

- **schema.org:** `ProfessionalService` (not `Person`, which cannot carry `aggregateRating`), with the governorate as area served, never the phone number; the rating only when `rating_count > 0`.
- **Header:** now reads the session, so every page is rendered on request (no static pages). Alternative rejected: a client component that asks the server who is signed in (flicker, extra request). Revisit at the M12 performance pass.
- **Language switcher** keeps the query string, using `useSearchParams` inside a `Suspense` boundary.
- **Photos on cards and profiles** use `next/image` with `unoptimized`: photos are already re-encoded to 400 x 400 JPEG, so the image optimizer would only add work.
- **Contact page and payment page** follow the payment pattern: placeholders are shown only in development, production hides them until `contact.configured` (or `payment.configured`) is true. The Arabic payment helper lines are shown only in Arabic and only when the setting `payment.helper_lines_ar` is filled; nothing is invented.
- **Legal stubs** are `noindex` and say the text comes before launch.
- **404:** `app/[locale]/not-found.tsx` (inside the language layout, in the visitor's language) is used when a page refuses an address; `app/global-not-found.tsx` still covers addresses that match no page.
- **Home featured cities:** Tunis, Sfax, Sousse, Ariana, Ben Arous, Nabeul (spec section 11 says to start with Sfax, Tunis and Sousse); featured subjects are the first eight of the catalogue. Easy to change in `app/[locale]/page.tsx`.
- **Dev helper:** `npm run dev:sample-teachers` (`scripts/dev-sample-teachers.ts`), development database only, bypasses the review queue and the founding offer. Not in the spec; added because there is no other way to see the public pages without an admin account and a full purchase. Alternative rejected: committing a seed migration (it would put fake teachers in production).
- `FormCatalogue.delegations` now carries the `slug`, which the search needs.
- **French wording of titles:** "Cours d'Anglais à Sfax", "Cours de Physique au Kef" (`lib/marketplace/french.ts`, tested). Messages use the placeholders `{subjectDe}` and `{governorateIn}` in both languages; in Arabic the helper returns the plain subject and "في" + the governorate.
- **Grade ranges** ("1-4", "L1-L3") are wrapped in a left-to-right `<bdi>` so Arabic text does not reverse them.
- **Report form** is sent by hand (`onSubmit` + `startTransition`) and not through the form's `action`, like the profile form of M3, so a refusal does not empty it.

**Tests**

- The "never visible" tests break an approved teacher in seven different ways (plan expired, listing paused, profile suspended, account suspended, a required field removed, waiting for review, refused) and check search, profile page data, sitemap data and reveal each time.
- Reveal and report tests use an injected `now` and an injected Turnstile check, so the one-hour windows are tested without waiting and without Cloudflare.

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
