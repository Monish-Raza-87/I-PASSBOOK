# I-PASSBOOK — Staff Demo Session

A complete run-sheet for a walkthrough of I-PASSBOOK: what to show, and what to say
while it is on screen. Built to be read aloud, or fed to NotebookLM as the source
for a video or slide deck.

**Audience:** everyone who touches an IR — CR, IQC, Production, QC, Flight Test,
Purchase, Inventory, Engineering, Compliance, Management.
**Length:** about 30 minutes, plus questions.
**Format:** one screen, one presenter, a real IR open throughout.

---

## Before you record — read this first

**1. One feature is not live yet.** Sign-in as coded is two steps: your password,
then a 6-digit code emailed to you. That code step is written and sitting on the
`category-insights` branch, but the **Apps Script backend has not been updated**, so
the live app is still **password only**. Until you paste the new backend in and
deploy a new version, do not promise staff the emailed code on the day. Everything
else in this script matches the app as it runs today.

**2. Sign in as yourself, and use a real IR** — not a demo one. Staff recognise
their own tickets, and it makes the walkthrough land.

**3. Have two accounts ready if you can** — one admin (yours, `monish.raza@indrones.com`)
and one ordinary account, so you can show what a non-admin sees and does not see.

**4. Say these three things out loud at least once:**
- The client's Google Form report is never edited by the app.
- Everyone can read and comment on everything; editing is granted by department.
- Triage (status, assignee, priority, category) is a separate permission from editing.

---

## Beat 1 — What this is (2 min)

**Show:** the sign-in screen. Let the logo and the line under it sit on screen.

**Say:**
"I-PASSBOOK is our product after-sales record. Every IR — from the moment a customer
raises it to the moment the drone ships back — lives in one place, and everyone who
needs to touch it can see it.

Today it has two jobs. It replaces the spreadsheet we have been keeping by hand. And
it gives every IR a proper history, so when someone asks 'what happened to this
unit?', the answer is already written down — with a name and a time next to it.

It is a web app. There is nothing to install. Open it in a browser on your phone or
your laptop, and it works. If you add it to your home screen it behaves like any
other app."

---

## Beat 2 — Getting your account (2 min)

**Show:** nothing yet — this is a talking beat. If you have a spare account, show the
sign-in screen only.

**Say:**
"There is no sign-up. Nobody creates their own account — that is deliberate, because
this holds customer data. I create every account, and I hand you a temporary
password. It looks like `Kx7Qm-4392` — five letters and four digits, with the letters
chosen so you cannot mix up an I and a 1 or an O and a zero.

That temporary password is good for 14 days. The first time you sign in with it, the
app will not let you into anything else — it stops you and asks you to set your own
password. Once you have set it, the temporary one stops working immediately.

If you are ever locked out, use **Forgot password?** on the sign-in screen. It emails
you a 6-digit code; type the code and your new password together and you are back in.
I do not need to be involved."

> **Presenter note — do not say this yet:** once the backend is updated, sign-in adds
> a second step: after your password, the app emails a 6-digit code and you type it
> in. That code is valid for 8 hours 30 minutes, it can be reused within that window
> (so if you sign out and back in the same day, the same code still works), and five
> wrong guesses cancels it. A working session lasts 8 hours 30 minutes from the
> moment you sign in, and it does not extend itself while you work — so a full day
> means signing in once, and possibly once more after lunch.

---

## Beat 3 — The IR list (3 min)

**Show:** the IR list. Type in the search box. Click a status chip. Click a category
chip. Click **↻ Refresh**.

**Say:**
"This is every IR. Newest first.

Search matches the IR number or the drone serial — so if someone calls you about
drone 4471, you can type 4471 and go straight to it.

These chips are filters, and the number on each one is how many IRs are in it. **All,
Open, Paused, Resolved, Closed**. The second row filters by category. And they stack —
pick Paused and REMOTE SUPPORT and you see only paused remote-support jobs.

Each card gives you the IR number, the drone serial, the category, when it was
raised, who it is assigned to, its priority, and its status.

**↻ Refresh** re-reads the list from the Sheet. If a colleague has just created an IR
from the customer form and it is not showing, refresh before you assume something is
wrong.

One warning: **Closed** here is not the same as finished and forgotten. A closed IR's
files are moved into an archive folder automatically once it has been closed for a
month. The record stays — the ticket still appears here exactly as it did."

---

## Beat 4 — Opening a ticket, and the Report tab (3 min)

**Show:** open one IR. It lands on a section tab. Click **Report** first.

**Say:**
"Every IR opens with the same header: the IR number, the drone and the customer on
the left, and on the right the status, priority, category, sub-category and owner.
If nobody owns it, it says **Unassigned** in plain words.

Now — **Report**. This is the most important tab to understand, because of what it
does *not* do.

This is exactly what the client typed into the Google Form. It is read-only. The app
never edits these values, ever. So when a customer says 'I told you it was a crash,
not a repair', you can open this tab and show them what they submitted, unchanged.

Below the report there is a link through to the full report, the issue description
and the weather at the time."

---

## Beat 5 — The Overview (2 min)

**Show:** the Overview block. Click **Hide** and **Show**.

**Say:**
"The Overview is the summary you actually work from. It pulls the facts you need
without scrolling: IR number, drone serial, date raised, company, who responded, and
what support was asked for.

Two of these boxes are editable — the Customer Relations Manager, and the customer's
phone number. **Only CR and Management can edit them.** Everyone else reads them.
That is not a mistake; it is so the phone number on a ticket is one person's
responsibility rather than everyone's guess.

If the Overview is in your way, hide it. The app remembers that you prefer it hidden."

---

## Beat 6 — The seven sections (6 min)

**Show:** click through the tabs in order: **B: Inward**, **C: IQC**,
**D: Investigation**, **E: Production**, **F: Quality Test**, **G: PDI/Dispatch**.
Do not fill anything in — just show each one and name it.

**Say:**
"The work itself happens in these tabs, and they follow the unit through the
building in order.

**B: Inward** — the unit arrives. Inward date, who received it, the stock transfer
number, what was actually in the box, and photos of it as received.
*Photograph the unit before you touch it.* That photo is the only record of how it
arrived.

**C: IQC** — visual inspection. The checklist is split into zones, and each line gets
a **PASS**, **FAIL** or **NA**. Do not leave a line blank because it looked fine —
mark it PASS. Blank looks the same as forgotten.

**D: Investigation** — this is where the technical answer goes. Who analysed it, when,
what the root cause was, and what we are doing about it — the corrective action, and
the preventive action so it does not happen again. There is also a cost side: whether
it is covered under warranty, the parts and labour as a table you can add rows to,
and whether the customer has given the go-ahead. The total adds itself up.

**E: Production** — the route card and what was actually reworked.

**F: Quality Test** — the QC report, then the flight test: the report itself and two
ticks to confirm the flight logs and the post-processing data were checked.

**G: PDI/Dispatch** — the last gate. The PDI result is either **Pass – Ready to
Dispatch** or **Fail – Return to QC**. Then the dispatch details: courier, tracking
number, and the date the client received it."

---

## Beat 7 — Saving, drafts, and photos (2 min)

**Show:** type into a field, then click **+ Add image / PDF** and **📷 Capture photo**.
Do not save — point at the section's Save button.

**Say:**
"Two things about how saving works.

First, every section has its own Save button. You save the section you worked on, not
the whole ticket. While you are typing, a draft is kept automatically, so a dropped
connection or a closed tab does not lose your paragraph.

Second — evidence. Every section that needs it takes photos and PDFs. **📷 Capture
photo** opens your camera directly, which is the fast way to do it from the shop
floor. Attach the photo to the section it belongs to, not to a general pile."

---

## Beat 8 — Triage (4 min)

**Show:** click **Triage** in the header. Change the status, assign someone, set a
priority and a category.

**Say:**
"Triage is where the ticket is routed, and it is its own permission. You can have
Triage without being able to edit any section — which is exactly how CR and
Management work.

Inside, five things:

**Status** — the stage the unit is at. Open, Inward, Visual Inspection, QC
Investigation, Production, QC, Flight Test, PDI, Approval, Delivered, Remote Support,
and so on. Setting it to **Close** closes the ticket, and moving it off Close reopens
it — I will come back to why that matters.

**Assigned to** — who owns this now. **Assigning someone sends them a notification**,
so do not assign casually.

**Priority** — Urgent, High, Medium or Low.

**Category** — CRASH, GENERAL MAINTENANCE, REMOTE SUPPORT or REPAIR. This one is
required; the app will not let you save without it.

**Sub-category** — only appears if you chose REPAIR. GPS, Tripod/Bipod, Topshell,
Camera/Lens, Battery, Charger, RC, Airframe, or Others. If you pick Others, it asks
you to say what was repaired, so the next person is not left guessing.

One rule worth knowing: everything you set here is recorded **in the passbook, not in
the customer's Sheet**. The client's original report stays exactly as they wrote it."

---

## Beat 9 — Comments and notifications (3 min)

**Show:** click **Comments** in the header. Tag someone. Then click the bell.

**Say:**
"This is how we ask each other things without it living in a WhatsApp group.

You can comment on the whole IR, on a section, or on a single field. Tag the person
you are asking — type **@** and pick them — write your message, and hit Comment. They
get an email.

Every comment is either **Open** or **Resolved**, so a question does not sit there
looking unanswered forever. Resolve it when it is dealt with. You can edit your own
comments if you made a mistake.

The bell at the top shows a count of what is waiting for you. The number in the
comment button on a section tells you how many open comments are on that section.

**Comments are not a substitute for filling the section in.** If you resolved a
question, put the answer in the section it belongs to."

---

## Beat 10 — History and Activity (3 min)

**Show:** scroll to the **Activity** fold at the bottom of the ticket and open it.
Then click **History** in the header.

**Say:**
"This is the part that replaces the argument.

The **Activity** fold at the bottom shows the last 40 things that happened to this
IR. **History** shows everything — up to 400 entries.

Each line says what changed, who changed it, and when: section saved, field changed —
and it shows you the old value and the new one — file uploaded, status changed,
assigned to, priority changed, comment posted, and folder archived or restored.

So 'who changed the root cause?' and 'when did this move to Production?' have answers.
You do not have to remember. It is written down.

This is also why we fill things in properly rather than leaving them blank — the
history is the record we hand over."

---

## Beat 11 — Downloading a section (2 min)

**Show:** click **⬇ Download** on a section. Then **⬇ Download and share**.

**Say:**
"Any section can be downloaded as a PDF — click Download, and you get a clean
document for that IR and that section. Download and share does the same thing and
opens your phone's share sheet, so you can send it straight on.

This is how you send a customer the investigation summary without sending them the
whole system."

---

## Beat 12 — Insights (2 min)

**Show:** open **Insights** from the sidebar. Click a category card.

**Say:**
"Insights is counting, not charting. It answers questions like: how many crush
incidents came in this month? How many repair jobs were GPS?

Filter by year, month, status, category, customer or drone. The cards are clickable —
click CRASH and it takes you to the IR list filtered to crash jobs, so you can go
from the number to the actual tickets in one click.

There is also a REPAIR breakdown by sub-category, which is how we find out which
failure keeps coming back."

---

## Beat 13 — Making it yours (1 min)

**Show:** open the user menu (top right). Switch to Dark. Switch the accent colour.

**Say:**
"Top right, in your menu, you can switch between Light, Dark or System — System
follows your phone — and pick an accent colour. It is a preference and it is yours;
it changes nothing about the data."

---

## Beat 14 — Who can do what (3 min)

**Say:**
"Three sentences and you have the whole permission model.

**One. Everyone signed in can read every section and comment on anything.** There are
no secret tickets.

**Two. Editing is granted by department.** If you are in QC, you can edit sections B,
C, D and F. If you are not, those sections are read-only to you — the fields are
greyed out and the Save button is turned off. That is not the app being broken.

**Three. Triage is separate.** Status, assignee, priority and category, plus the two
Overview boxes, are governed by Triage, not by which sections you can edit.

If you need edit access to a section you cannot change, ask me — access comes from
your department, not from your account."

---

## Beat 15 — Admin-only, and the Legacy workbook (3 min)

**Show (admins only):** open **User Access** from the sidebar. Show the three tabs
briefly. Do **not** open the Danger zone on screen.

**Say:**
"Everything below is admin-only — most of you will never see this, which is how it
should be.

**User Access** is where accounts are created, departments are set up, and
permissions are given. It has three tabs: who is in which department, the departments
themselves, and creating people — one at a time, or a whole list pasted in at once.

There is a **Danger zone** on that screen that can delete every account in one go. It
is deliberately hard to fire: you have to type the word PURGE, then review the list,
then confirm, and the app takes a backup first. Nobody will trigger it by accident.

One more thing in the sidebar: **Legacy Records**. That opens the old I-PASSBOOK
workbook, read-only, for anything that happened before this app existed. It stays
available until we are fully live, so no old record is lost."

---

## Beat 16 — Ground rules (3 min)

**Say:**
"Five things I want everyone to take away.

**One.** Put it in the section, not in a comment. Comments are for asking. Sections
are the record.

**Two.** Photograph the unit at Inward, before anyone touches it.

**Three.** Never leave a checklist line blank to mean 'fine'. Mark it PASS.

**Four.** If the status changes, change it in Triage. The archive rule runs off it —
a closed ticket's folder moves to the archive after a month, and reopening it brings
it straight back. So keep it honest and it takes care of itself.

**Five.** Read the Report tab before you ask the customer anything. They have already
told us once."

---

## Appendix A — Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| "Sign in failed." | Wrong email or password, or the account is disabled. | Check with the admin. Nothing you can fix from your side. |
| "Your temporary password has expired" / cannot sign in with the temp password | The 14-day window closed, or it was already used once. | Ask the admin to reset it. |
| You are back at the sign-in screen without signing out | The session ran out. A session lasts 8h30m from sign-in and does not extend itself. | Sign in again. |
| An IR someone just created is missing | The list has not re-read the Sheet. | Click **↻ Refresh**. |
| A section is greyed out and Save is off | You do not have edit rights for that section. | Ask the admin — access comes from your department. |
| You cannot see the Triage button | Triage is a separate permission. | Ask the admin. |
| The list says "🔍 No IRs match this filter." | A filter is still on. | Click **All**. |
| A PDF export says attachments were named, not included | A file attached to that section could not be read back from Drive. | The file is listed by name in the PDF. Open it in the app. |
| You cannot create your own account | By design — there is no sign-up. | Ask the admin for an account. |

## Appendix B — Questions to expect

**"Can I edit what the customer wrote?"** No. The Report tab is read-only and always
will be. Anything we add goes in the Overview or a section.

**"Can I see tickets that are not mine?"** Yes. Everyone can read every section of
every IR. Only editing is restricted.

**"What happens when a ticket is closed?"** It goes on working exactly as before. Its
files are moved to an archive folder after it has been closed for a month, and if it
is reopened they come straight back.

**"Is there an app to install?"** No. Open it in a browser. You can add it to your
home screen so it opens like an app.

**"Who do I ask for access?"** The admin. Access is granted by department.

**"Can I delete something I typed by mistake?"** Edit the field and save. The History
keeps the old value, so the change is visible, but the field itself is corrected.

---

## Appendix C — 5-minute version

If you only have five minutes, do these five things and stop:

1. **Beat 3** — the list, search, and the filter chips.
2. **Beat 4** — the Report tab is read-only; the app never edits the customer's words.
3. **Beat 6** — walk the seven section tabs without filling any in.
4. **Beat 8** — open Triage and set a status. Say that assigning someone notifies them.
5. **Beat 14** — everyone reads everything; editing comes from your department.

Then point people at Beat 16 and let them ask questions.
