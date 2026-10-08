// ─────────────────────────────────────────────────────────────────────────────
// I-PASSBOOK — THE ENGLISH LANGUAGE LAYER
// ─────────────────────────────────────────────────────────────────────────────
//
// Only English ships. This file exists so that a SECOND language is later a data
// file rather than a refactor, and that is the whole of its purpose today.
//
// A plain script, in the same style as dataflash.js, and for the same reason:
// app.js is an end-of-body plain script with no module system, so anything it
// reads has to exist on `window` before it runs. It is deliberately NOT a
// stylesheet — the six-file cascade documented in index.html is pinned by
// smoke-shell.mjs, and a language layer has no business in it.
//
// ── What "translated" means here, honestly ───────────────────────────────────
//
// The static chrome (nav, headings, buttons, placeholders), the workflow status
// words, and every string the board and the customer door add. NOT the ~10,000
// lines of section forms and validation copy in app.js — that sweep is staged, and
// until it happens a second language would leave those in English.
//
// ── Why the English text ALSO stays in index.html ────────────────────────────
//
// Every `data-i18n` attribute is paired with the real English text inside the
// element. applyStatic() overwrites it at boot with the same words. So the markup
// is correct on its own — if this file fails to load, or fails to parse, or is
// blocked on a flaky phone network, the app reads exactly as it does today rather
// than showing a screen of dotted keys. A translation layer whose failure mode is
// a broken UI is worse than no translation layer.

(function () {
  'use strict';

  // ── The table ──────────────────────────────────────────────────────────────
  // Keys are dotted and read as paths: <area>.<thing>. They are referenced from
  // index.html's data-i18n attributes and from app.js's t() calls, and
  // smoke-i18n.mjs asserts the three agree — an orphan key and a key with no
  // string are both failing tests, because the first is dead weight and the second
  // is a screen that shows a raw key to a user.
  const STRINGS = {

    // ── The app itself ───────────────────────────────────────────────────────
    'app.name':            'I-PASSBOOK',
    // THE EXPANSION OF THE NAME, and it is ONE STATIC LINE — the owner's correction of
    // 2026-10-08, and the correction is about the page rather than about the words:
    //
    //   *"You wrote it full 'INDRONES FROM I · PRODUCT FROM P · …' I meant it to explain
    //   it to you, plus because of this, the whole page below it is increasing/decreasing
    //   its height. So, what should be correct is below I-PASSBOOK this will come —
    //   'INDRONES-AFTER SALES SERVICE BOOK' … and line increasing/decreasing should not
    //   happen."*
    //
    // He was right on both counts. The spelled-out version was a note to ME about how
    // the acronym works, and shipping it as the strapline was my error; and because
    // app.js TYPED it a term at a time, the line re-wrapped on every keystroke and the
    // whole landing page grew and shrank underneath the doors. The line is read, not
    // animated, from here on.
    //
    // ⚠ It is also no longer SPLIT ON ANYTHING. The `·` separators that buildBrandTyping()
    // used to cut on are gone, so a `·` typed into this value would now be read as a
    // literal dot rather than as a term boundary. Nothing reads this string but the
    // element itself.
    'app.fullName':        'INDRONES-AFTER SALES SERVICE BOOK',

    // ── Navigation ───────────────────────────────────────────────────────────
    'nav.serviceDesk':     'Service Desk',
    'nav.administration':  'Administration',
    'nav.irs':             'IRs',
    'nav.insights':        'Insights',
    'nav.logAnalyser':     'Log Analyser',
    'nav.userAccess':      'User Access',
    // Named separately from the sign-in door's own label, even though the English
    // is the same string. A translator shortening a sidebar label would not want
    // to shorten the link on the sign-in card with it, and a shared key would make
    // that impossible — which is the whole reason this table exists.
    'nav.help':            'Help & FAQ',

    // ── The IR list, and the board it draws the same rows as ─────────────────
    'list.title':          'IRs',
    'list.search':         'Search by IR number or drone ID…',
    'list.viewList':       'List',
    'list.viewBoard':      'List or board',
    'list.viewBoardBtn':   'Board',
    'list.emptyFiltered':  'No IRs match this filter.',
    'list.emptyNone':      'No IRs found. Create one via the customer form.',
    'board.label':         'IR board',
    'board.emptyNone':     'No IRs found.',
    'board.notStarted':    'Not started',
    'board.paused':        'Paused',
    'board.finished':      'Finished',
    'board.more':          '+{n} more — see list',

    // ── Moving a card on, by hand ────────────────────────────────────────────
    'move.to':             'Move to {column} →',
    'move.hint':           'Sets the status to {stage} and starts its clock',

    // ── Sections, as they are titled and as their tabs name them ─────────────
    'section.clientReport': 'Client\'s Original Report',
    'section.overview':     'Overview',
    'section.b':            'Section B — Inward Checklist (Inventory)',
    'section.c':            'Section C — IQC Visual Inspection',
    'section.d':            'Section D — Investigation',
    'section.e':            'Section E — Production (Rework)',
    'section.f':            'Section F — Quality Test Report',
    'section.g':            'Section G — PDI Report/Dispatch Record',
    'section.close':        'Mark Section {letter} completed',
    'section.closed':       'Section closed',

    // ── The workflow stages (IR_STATUS_VALUES) ────────────────────────────────
    'status.open':          'Open',
    'status.inward':        'Inward',
    'status.inspection':    'Inspection',
    'status.investigation': 'Investigation',
    'status.production':    'Production',
    'status.qualityTest':   'Quality Test',
    'status.pdiDispatch':   'PDI/Dispatch',
    'status.delivered':     'Delivered',
    'status.onHold':        'On Hold',
    'status.remoteSupport': 'Remote Support',
    // The one retired word that is not a stage. The escape hatch has no home among
    // the ten, old tickets still hold it, and it must keep reading as a word rather
    // than as a blank pill.
    'status.other':         'Other',

    // ── Priority ─────────────────────────────────────────────────────────────
    // Read through priority() below, never off the stored value: the store keeps
    // 'High', 'Medium', 'Low' — and those are DATA. Translating the store would be
    // a migration; translating the WORD is a lookup.
    'priority.urgent':     'Urgent',
    'priority.high':       'High',
    'priority.medium':     'Medium',
    'priority.low':        'Low',

    // ── Signing in ───────────────────────────────────────────────────────────
    // THE EMPLOYEE PANEL IS ONE LIST, and the list is the owner's, written out in his
    // own order (2026-10-08): *"at the top is 'Log in to I-PASSBOOK' then is a box for
    // entering email, below it is a button 'Continue', below it is a line which
    // separates next below option which is 'continue with indrones' official email'
    // then below it 'continue with fingerprint/passkey' then below it 'continue with
    // pattern'."* The email-and-Continue pair is the primary door and the other three
    // are alternatives to it, which is why the divider sits BETWEEN them and not above
    // the whole list.
    //
    // EVERY ALTERNATIVE IS PREFIXED "Continue with", including the two that are not
    // really "continuing" anything. That is the point of the phrasing: four doors that
    // read as four answers to one question, so the person picks a mechanism instead of
    // working out which of four differently-shaped controls is the real one.
    'auth.loginTitle':     'Log in to I-PASSBOOK',
    'auth.email':          'you@indrones.com',
    'auth.continue':       'Continue',
    // The divider. It replaced "or get a code by email", which named the thing ABOVE
    // it rather than the fork between the two halves of the list.
    'auth.or':             'or',
    // THE GOOGLE DOOR. Still named for Indrones rather than for Google, and now for a
    // second reason as well: the owner's 2026-10-08 note that this must behave like the
    // same button on vercel.com — same tab, straight into Google's own account picker,
    // no pop-up and no wait. See app.js's GOOGLE SIGN-IN block.
    'auth.sso':            'Continue with Indrones’ official email',
    'auth.unlock':         'Continue with fingerprint / passkey',
    'auth.usePattern':     'Continue with pattern',
    // Said when the button is tapped on a device that has not enrolled the method yet.
    // The first line is the owner's own sentence, verbatim. The steps after it are the
    // REAL path through this app and nothing else: the avatar in the top right corner is
    // the way into the menu, and "Turn on Quick unlock" is the row's actual label (see
    // syncQuickUnlockMenu, which owns that wording and changes it with the device's
    // state). Guidance that sends someone looking for a control that does not exist is
    // worse than the silence it replaced.
    'auth.methodInactive.say':      'This login method activates after you enable it from your login.',
    'auth.methodInactive.step1':    'Sign in to I-PASSBOOK with your email and the code we send you.',
    'auth.methodInactive.step2':    'Tap your avatar in the top right corner of the app.',
    'auth.methodInactive.step3':    'Choose “Turn on Quick unlock” and follow the prompt on this device. Set up your fingerprint — and a pattern as well, if you want one.',
    'auth.methodInactive.step4':    'That is all. Come back to this screen and both methods are ready.',
    'auth.methodInactive.dismiss':  'Got it',
    // THE TEMPORARY-PASSWORD DOOR, and it is deliberately the faintest thing on the
    // card. It is NOT a general password login — the owner removed that (see the note
    // on the code view below). It exists for exactly one account state: a person the
    // admin has JUST created, who has an admin-issued password and no other way in,
    // because the backend refuses the emailed code to an account that has never had its
    // password changed (backend.gs's passwordlessLogin, second stage). Deleting this
    // line strands every new hire; the honest long-term fix is on the owner, not here.
    'auth.usePassword':    'First sign-in with a temporary password',
    'auth.password':       'Password',
    'auth.newPasswordLong':'New password (at least 8 characters)',
    'auth.repeatPassword': 'Repeat the new password',
    'auth.showPassword':   'Show password',
    // The way back out of the two sub-screens that are not the list: the password
    // field and the pattern canvas.
    'auth.back':           'Back',
    'auth.signOut':        'Sign Out',

    // ── The Overview panel's own fields ──────────────────────────────────────
    // The three the Triage panel hand-renders. Their LABELS live here; their
    // storage keys live on OVERVIEW_FIELD_LABELS in app.js, which is a different
    // job — that one names a field in the edit history and must not be re-worded
    // when a screen's copy changes.
    'overview.crmOwner':        'Customer Relations Manager',
    'overview.contactPhone':    'Customer Phone',
    'overview.siteLocation':    'Site Location',
    'overview.readOnlyNote':    'Only Customer Relations and Management can edit these. Everyone can read them.',
    // Placeholders. The site one says BOTH things it accepts, because Google's Maps
    // URL API takes a place name and a coordinate pair through the same query — and
    // a CR who does not know that would leave the box empty thinking coordinates
    // were required.
    'overview.crmOwnerHint':    'Name of CRM person',
    'overview.phoneHint':       '+91 XXXXX XXXXX',
    'overview.siteHint':        'Area, city — or latitude, longitude',
    // The banner's section progress. "saved", never "complete": `done[]` records
    // that a section's Save was pressed, and it is monotonic, so "complete" would
    // claim a job is finished because an empty form was saved once.
    'overview.sectionsSaved':   '{n} of {m} sections saved',

    // ── Words the app uses everywhere ────────────────────────────────────────
    'common.saved':        'Saved',
    'common.saving':       'Saving…',
    'common.notSaved':     'Not saved — press again',
    'common.retrying':     'Not saved — retrying',
    'common.unassigned':   'Unassigned',
    'common.overdue':      'Overdue',
    'common.openInMaps':   'Open in Maps →',

    // ── The two doors on the landing page ────────────────────────────────────
    // One address, two audiences. Each door is now a CONDENSED BAR — a role word and a
    // chevron — that opens into its own panel, and the two bars are stacked one above
    // the other. The owner, 2026-10-08: *"let us have both employee login and customer
    // login option arranged vertically aligned, one above another. each condensed, i.e.
    // collapsible, so whichever the person wants to access will click on/arrow and
    // expand it."*
    //
    // The role word is therefore no longer a chip on a card; it is the LABEL OF THE
    // CONTROL THAT OPENS THE CARD. That is why it carries no full stop and no
    // decoration, and why it is inside a <button> rather than a <p>.
    //
    // door.openSpace survives from the two-card layout because it is not prose: it is
    // the button a customer who is ALREADY signed in on this device taps instead of a
    // form.
    'door.employee':      'Employee',
    'door.customer':      'Customer',
    'door.openSpace':     'Open the Customer Space',
    // The bar's accessible name. A bare "Employee" announces a control with no verb,
    // and the chevron that says "this opens" is decorative and aria-hidden — so the
    // verb has to be said here or it is not said at all.
    'door.expand':        'Show the {role} sign-in',
    // The one thing on the landing page that is not this app. It replaced the Sign Up
    // button every site in this shape carries, and the owner's reason is the honest one:
    // there IS no sign-up here, every account is provisioned by an admin. So the corner
    // holds the thing a person who cannot get in actually needs.
    'door.whatsapp':      'Chat with us on WhatsApp',

    // ── The customer's panel ─────────────────────────────────────────────────
    // THE OWNER'S OWN COPY, written out in his message of 2026-10-08 and kept verbatim,
    // including the capitalisation of the tagline and its possessive apostrophe:
    //
    //   *"We will start with a sweet gesture, 'Welcome! This is I-PASSBOOK' in next line
    //   below it, 'For Everything Related To Indrones' After-Sales' then in line below it,
    //   Log in to you I-PASSBOOK account. thats it, then space for email below box of
    //   email in not so highlighted way … 'Use your official email registered with us
    //   while onboarding as a customer'."*
    //
    // This is a THIRD reversal of this block's copy — the two-line pitch was cut on his
    // instruction in v74 and is now back, in his words rather than mine — and that is
    // worth recording so the next reader does not "tidy" it away again. It is prose
    // here on purpose: the employee's panel is a list of mechanisms and carries no
    // welcome, because a staff member signing in for the fourth time today does not want
    // one. A customer arriving for the first time does.
    'cust.welcome':       'Welcome! This is I-PASSBOOK',
    'cust.tagline':       'For Everything Related To Indrones’ After-Sales',
    'cust.login':         'Log in to your I-PASSBOOK account.',
    'cust.email':         'you@company.com',
    // The helper line under the field, "in not so highlighted way" — it is a hint, so it
    // is muted and it is NOT a placeholder: a placeholder vanishes the moment someone
    // starts typing, and this is the sentence that tells them WHICH of their addresses to
    // type while they are typing it.
    'cust.emailHelper':   'Use your official email registered with us while onboarding as a customer',
    'cust.continue':      'Continue',
    'cust.or':            'or',
    // ⚠ This sentence carries a live mail address, and it is the only mail address on the
    // public landing page. `customer.relations@indrones.com` is asserted ABSENT from
    // app.js (smoke-access.mjs:59) because it was de-admined there and must not come back
    // as an authority — but index.html is a different file with a different job, and this
    // is the address a would-be customer is meant to write to. It must never be added to
    // app.js, ADMIN_EMAILS, or TEAM_DIRECTORY_DEFAULTS.
    'cust.unregistered':  'if you are not registered with us so far, contact customer.relations@indrones.com for onboarding. See you there!',
    // The one other place the desk's address is said, and the reason it lives HERE and
    // not in the message app.js raises: a literal in app.js is asserted against (see the
    // "appears nowhere in app.js" check in tools/smoke-access.mjs), so the sentence has to
    // arrive through the table. It also means this line is translated with everything
    // else rather than sitting in the code as English only.
    'cust.tempPasswordNoCode': 'No code was sent. Your account is still on the password Indrones issued — contact customer.relations@indrones.com to have it reset.',

    // ── THE CODE STEP — one screen, shared by both doors ─────────────────────
    // The owner, 2026-10-08, describing what he saw on vercel.com/login and what he
    // wants here: *"it lands in next screen totally blank and in center it says 'Check
    // your email' in big heading and below it is 'If you have a indrones after sales
    // account, we sent a code to <that email id>.' in normal text size. then equivalent
    // number of boxes below that line to fill the code. and a button below boxes saying
    // 'Use a different account'. clicking this button will land back to initial login
    // page."*
    //
    // ⚠ THIS SCREEN IS SHARED, and that is the load-bearing decision on it. An employee
    // arriving at it and a customer arriving at it are in the SAME state — an address
    // that has been mailed a 6-digit code — so a second screen for the second audience
    // would be two copies of one thing, free to drift. It is also why the copy names no
    // audience: "if you have an indrones after sales account" is true for both.
    //
    // The sub-line is written to survive an address that is NOT registered, which is
    // why it is conditional ("If you have…") rather than declarative ("We sent a code
    // to…"). The backend will not say whether an account exists — that is deliberate,
    // it is what stops this unauthenticated step being an oracle — so the sentence has
    // to be true in both cases, and "we sent a code to <address> if you have an account"
    // is the only wording that is.
    //
    // "we sent", not "we have sent": the owner asked for the perfect tense on the
    // sibling sentence and then wrote this one himself in the past simple, so it is
    // kept as he wrote it.
    'code.title':         'Check your email',
    'code.sub':           'If you have a indrones after sales account, we sent a code to',
    'code.different':     'Use a different account',
    // The per-box accessible names. Six boxes that are visually a row of squares read to
    // a screen reader as six unlabelled text fields without this; the slot is filled by
    // a data-i18n-var-letter on each box, exactly like the six section Close buttons.
    'code.digit':         'Digit {n} of the code',
    // ⚠ THREE STRINGS WERE DELETED HERE, not left behind: 'code.resent' ("Sending a new
    // code…"), 'code.resend' ("Send the code again") and 'code.verifying' ("Checking…").
    // They belonged to the resend-and-retry block that lived inside the employee and
    // customer cards. The owner's list for this screen, 2026-10-08, is the heading, the
    // sub-line, the boxes and "Use a different account" — there is no resend on it, and
    // a string with no caller is invisible until it is a stale translation nobody can
    // reach. If a resend is wanted later it comes back WITH its button.

    // ── The foot of the landing page ──────────────────────────────────────────
    // Two things every visitor passes on the way to a door, and neither belongs to
    // either door — so they sit below BOTH, said once, like the FAQ line under them.
    //
    // ⚠ THE TERMS LINE HAS NOTHING TO LINK TO. There is no terms.html and no
    // privacy.html in this repo, and writing either one means writing the company's
    // legal position on its own data, which is the owner's to give and not mine to
    // invent. So the two phrases are plain text with no anchors, and they become links
    // the moment those pages exist. A link to a 404 would be worse than the sentence.
    'landing.terms':      'By continuing, you acknowledge that you understand and agree to the Terms & Conditions and Privacy Policy',
    // The language selector's accessible name. Its OPTIONS are language endonyms and are
    // NOT translated — a person looking for Urdu is looking for the word اردو, not for
    // the word "Urdu" in English.
    'landing.language':   'Language',

    // ── The customer door, and the FAQ behind it ─────────────────────────────
    // The app's second open door. These strings are read on the sign-in screen,
    // before anyone has an account — so they are the only words in this table a
    // member of the public ever sees, and they carry no internal name, no IR number
    // and nothing about how the desk works inside.
    //
    // door.signInHint is the load-bearing one. A customer is told they need no
    // account; Google's form then asks them to sign in, because it records the
    // sender's address. Saying so BEFORE they press anything is the difference
    // between a form and a trap, so do not shorten it away.
    'door.report':      'Report a problem',
    'door.faq':         'Help & FAQ',
    'door.close':       'Close',
    'door.lede':        'Tell the service desk what went wrong. You do not need an account here, and nothing on this screen asks who you are.',
    'door.signInHint':  'The form is made with Google Forms. If this device is not already signed in to a Google account, Google will ask you to sign in before it shows you the form — that is Google asking, not this app.',
    'door.openForm':    'Open the report form',
    'door.escape':      'It opens in a new tab, so this page is still here when you come back.',
    'door.note':        'This form is hosted by Google and your answers go straight to the service desk. Nothing is loaded from Google until you press the button — and if you never press it, nothing is.',

    // ── The Insights dashboard ───────────────────────────────────────────────
    // Only the strings the dashboard's NEW blocks add. The filter labels and the
    // two headings that were already there ("Status mix", "REPAIR — by
    // sub-category") are keyed here too, because they sit in the same template and
    // leaving two of nine headings in a bare literal is the drift this layer
    // exists to prevent. The rest of that older markup — the dropdowns' "All
    // years" / "All customers" options — is a separate sweep and is still English
    // inline.
    'insights.raised':         'Raised',
    'insights.openNow':        'Open now',
    'insights.lateNow':        'Late now',
    'insights.perMonth':       'Last 12 months',
    'insights.raisedPerMonth': 'Raised per month',
    'insights.undatedBucket':  'No date',
    'insights.statusMix':      'Status mix',
    'insights.repairBySub':    'REPAIR — by sub-category',
    'insights.noCategory':     'No category',
    'insights.people':         'People',
    'insights.unassigned':     'Unassigned',
    'insights.colOpen':        'Open',
    'insights.colLate':        'Late',
  };

  // The workflow stages, keyed the way the app stores them. app.js already has ONE
  // list of what a stage may be (IR_STATUS_VALUES); this maps those same values to
  // their keys, so translating a status never means transliterating it — and
  // smoke-i18n.mjs checks the two lists against each other so a stage added there
  // and forgotten here is caught rather than silently shown in English.
  //
  // It carries TWO arms. The first is the ten. The second is the retired Sheet
  // vocabulary, each word pointed at the key of the stage it means today — so a
  // stored 'QC Investigation' reads as 'Investigation' and a stored 'Close' reads as
  // 'Delivered'. Two keys sharing one string is the point: this is the display half
  // of the single fold STATUS_LEGACY/canonicalStage() does in app.js, and keeping
  // the old words readable is exactly what "shorten what is offered, keep old
  // values readable" asked for. It is also why `t()`'s fallback below can stay a
  // plain echo: every word the store can hold is already in here.
  const STATUS_KEYS = {
    // The ten the app offers.
    'Open': 'status.open', 'Inward': 'status.inward',
    'Inspection': 'status.inspection', 'Investigation': 'status.investigation',
    'Production': 'status.production', 'Quality Test': 'status.qualityTest',
    'PDI/Dispatch': 'status.pdiDispatch', 'Delivered': 'status.delivered',
    'On Hold': 'status.onHold', 'Remote Support': 'status.remoteSupport',
    // The retired words.
    'Hold': 'status.onHold',
    'Visual Inspection': 'status.inspection',
    'QC Investigation': 'status.investigation',
    'QC': 'status.qualityTest', 'Flight Test': 'status.qualityTest',
    'PDI': 'status.pdiDispatch', 'Approval': 'status.pdiDispatch',
    'Close': 'status.delivered',
    'Other': 'status.other',
  };

  // The same, for priority. Lower-cased keys because the stored word is capitalised
  // in the seed data and lower-cased in some hand-edited rows, and both mean the
  // same priority.
  const PRIORITY_KEYS = {
    'urgent': 'priority.urgent', 'high': 'priority.high',
    'medium': 'priority.medium', 'low': 'priority.low',
  };

  // ── THE LANGUAGE DIMENSION — and what it honestly is today ─────────────────
  // The landing page carries a language selector (the owner's instruction of
  // 2026-10-08, "like in notion.app where english, urdu, hindi has to be there in
  // selectible dropdown"), so the layer needs somewhere for a second language to go.
  // This is that somewhere, and nothing more.
  //
  // ⚠ IT SHIPS ENGLISH ONLY, AND THE SELECTOR IS HONEST ABOUT IT BY BEHAVING LIKE A
  // HALF-TRANSLATED APP RATHER THAN BY SAYING SO. What is behind the other two options
  // today is the ENGLISH table, through the per-string fallback below — which is exactly
  // what a partially translated app does, and what the reader will conclude. The count
  // is the reason to say it plainly here: STRINGS holds 118 strings, and the app's real
  // translatable surface is on the order of a thousand distinct strings across seven
  // files, every one of the six section forms, every toast and confirm in app.js, plus a
  // right-to-left layout pass for Urdu. That is a project, not a dropdown.
  //
  // So: a second language is now a DATA FILE (`TABLES.ur = { … }`) rather than a
  // refactor — which was the whole of this file's stated purpose from the first line —
  // and the selector, the persistence and the fallback are already wired and tested.
  const LANGS = [
    // The endonyms, NOT their English names. Someone looking for Urdu is looking for
    // the word اردو on the list; "Urdu" is the word for it in the language they are
    // trying to leave. The same reason a country picker shows Deutschland.
    { code: 'en', label: 'English', dir: 'ltr' },
    { code: 'ur', label: 'اردو',    dir: 'rtl' },
    { code: 'hi', label: 'हिन्दी',   dir: 'ltr' },
  ];
  // Only English has a table. An entry added here for 'ur' or 'hi' is picked up with no
  // other change anywhere — that is the test smoke-i18n.mjs holds.
  const TABLES = { en: STRINGS };
  const LANG_KEY = 'ipb_lang';
  let _lang = 'en';

  // ── Resolving ──────────────────────────────────────────────────────────────

  const _warned = new Set();

  // The active language's string for a key, else the English one. The English table is
  // the floor rather than a sibling: a key that a translator has not reached yet reads
  // in English instead of disappearing, which is why a missing translation is a cosmetic
  // problem here and never a blank control.
  function lookup(key) {
    const tbl = TABLES[_lang];
    if (tbl && Object.prototype.hasOwnProperty.call(tbl, key)) return tbl[key];
    return Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : null;
  }

  // `t('list.title')` → 'IRs'. `t('board.more', { n: 3 })` → '+3 more — see list'.
  //
  // A key with no string returns THE KEY, and warns once. That is deliberately
  // ugly: a raw 'list.title' on screen is unmistakably a bug, whereas a silent
  // empty string is a blank control nobody can account for. smoke-i18n.mjs makes
  // both impossible to ship — this is the belt to that test's braces, for the case
  // where a key is built at runtime and the test cannot see it.
  function t(key, vars) {
    const s = lookup(key);
    if (s === null) {
      if (!_warned.has(key)) { _warned.add(key); console.warn('[i18n] no string for ' + key); }
      return key;
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m) : s;
  }

  // The status word for a stored status. Falls back to the stored value itself,
  // which is right: an unrecognised status should read as what the store says, not
  // as an empty pill.
  function status(value) {
    const k = STATUS_KEYS[value];
    return k ? t(k) : String(value == null ? '' : value);
  }

  // The same shape for priority. Lower-cased for the lookup because the stored
  // word is capitalised in the seed data and lower-cased in some hand-edited rows,
  // and both mean the same priority.
  function priority(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    return v && Object.prototype.hasOwnProperty.call(PRIORITY_KEYS, v)
      ? t(PRIORITY_KEYS[v]) : String(value == null ? '' : value);
  }

  // ── Painting the static chrome ─────────────────────────────────────────────
  // Four attributes, one per kind of string a static element can carry:
  //   data-i18n             the element's text
  //   data-i18n-title       its title (the tooltip)
  //   data-i18n-aria        its aria-label (the word a screen reader speaks)
  //   data-i18n-placeholder its placeholder (form fields)
  //
  // Text is written with textContent, never innerHTML: these strings come from a
  // data table that a future translator writes, and an innerHTML here would turn a
  // stray angle bracket in a translation into markup.
  //
  // `data-i18n-var-<name>="value"` supplies a {name} placeholder, so a string with
  // a slot in it — 'Mark Section {letter} completed' — is written in the table
  // once rather than six times, one per section. Any other data-i18n-var-* is read
  // the same way, so a second slot needs no code.
  function varsOf(el) {
    let vars = null;
    for (const a of el.attributes) {
      const m = /^data-i18n-var-(.+)$/.exec(a.name);
      if (m) { (vars || (vars = {}))[m[1]] = a.value; }
    }
    return vars;
  }
  function applyStatic(root) {
    const scope = root || document;
    const paint = (sel, keyOf, set) => {
      scope.querySelectorAll(sel).forEach(el => {
        const key = keyOf(el);
        if (typeof lookup(key) !== 'string') return;   // the markup's own text stands
        set(el, t(key, varsOf(el)));
      });
    };
    paint('[data-i18n]',             el => el.dataset.i18n,             (el, s) => { el.textContent = s; });
    paint('[data-i18n-title]',       el => el.dataset.i18nTitle,        (el, s) => { el.title = s; });
    paint('[data-i18n-aria]',        el => el.dataset.i18nAria,         (el, s) => { el.setAttribute('aria-label', s); });
    paint('[data-i18n-placeholder]', el => el.dataset.i18nPlaceholder,  (el, s) => { el.setAttribute('placeholder', s); });
  }

  // ── Choosing a language ─────────────────────────────────────────────────────
  //
  // `dir` is set on the document ONLY for a language that actually has a table. Without
  // that guard, picking اردو today would mirror the whole page — English words, laid out
  // right-to-left — which is not a half-translation, it is a broken screen, and it would
  // be the first thing anyone tried. A language with no table still REMEMBERS the choice
  // and still sets `lang`, so the preference is already stored for the day the table
  // arrives.
  function ready(code) {
    return !!TABLES[code] && Object.keys(TABLES[code]).length > 0;
  }

  function lang() { return _lang; }

  // 'ur-PK' → 'ur', 'EN' → 'en' — a stored tag is normalised to the primary subtag,
  // because localStorage is a place a human can hand-edit and the rest of the app should
  // not have to care whether someone typed `ur-PK`.
  function _normalise(code) {
    return String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  }

  // …and then reconciled with what this file actually knows. A normalised tag with no
  // LANGS entry reads as English rather than as a table that does not exist.
  function _langOf(code) {
    const want = _normalise(code);
    return LANGS.some(l => l.code === want) ? want : 'en';
  }

  function setLang(code) {
    const want = _normalise(code);
    // An unknown code is REFUSED rather than quietly turned into English: the only caller
    // is a <select> whose options are built from LANGS, so an unknown one means a bug, and
    // a silent fallback would hide a broken picker behind a working-looking page.
    if (!LANGS.some(l => l.code === want)) return false;
    _lang = want;
    try { localStorage.setItem(LANG_KEY, _lang); } catch (e) { /* private mode */ }
    paintLangAttrs();
    applyStatic();
    return true;
  }

  function paintLangAttrs() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const meta = LANGS.filter(l => l.code === _lang)[0] || LANGS[0];
    document.documentElement.lang = _lang;
    // Only a READY language gets to change the reading direction — see the note above.
    if (ready(_lang)) document.documentElement.dir = meta.dir;
  }

  // Read the stored choice before anything paints, so a returning reader never sees the
  // page in English and then watch it change. Called by app.js's load handler, and safe
  // to call with no storage and no DOM at all.
  function init() {
    let stored = '';
    try { stored = localStorage.getItem(LANG_KEY) || ''; } catch (e) { stored = ''; }
    _lang = _langOf(stored);
    paintLangAttrs();
  }

  window.I18N = {
    t: t, status: status, priority: priority, applyStatic: applyStatic,
    STRINGS: STRINGS, STATUS_KEYS: STATUS_KEYS, PRIORITY_KEYS: PRIORITY_KEYS,
    LANGS: LANGS, TABLES: TABLES, init: init, setLang: setLang, lang: lang,
  };
  // The short alias every call site uses. Exposed separately so app.js can read
  // `window.t` without going through the namespace on every call.
  window.t = t;
})();
