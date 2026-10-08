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
    'app.fullName':        'Indrones Product After-Sales Summary Book',

    // ── Navigation ───────────────────────────────────────────────────────────
    'nav.serviceDesk':     'Service Desk',
    'nav.administration':  'Administration',
    'nav.irs':             'IRs',
    'nav.insights':        'Insights',
    'nav.logAnalyser':     'Log Analyser',
    'nav.legacyRecords':   'Legacy Records',
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
    'auth.hint':           'Sign in with the credentials your admin gave you.',
    'auth.email':          'you@indrones.com',
    'auth.password':       'Password',
    'auth.newPassword':    'New password',
    'auth.newPasswordLong':'New password (at least 8 characters)',
    'auth.repeatPassword': 'Repeat the new password',
    'auth.showPassword':   'Show password',
    'auth.unlock':         'Unlock with fingerprint',
    'auth.usePattern':     'Use pattern',
    // The two labels that make the pair of doors BI-DIRECTIONAL. One is the step out
    // of quick unlock and into the email screen; the other is the way back, and it
    // shows only on a device that actually has a registered unlock. The owner's
    // wording, kept verbatim — "(OTP)" is what the desk calls the emailed code, and
    // the phrase says which mechanism the next screen will use.
    'auth.useEmailOtp':    'Use email (OTP) based login method',
    'auth.useQuick':       'Use fingerprint or pattern',
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
    // One address, two audiences. The chip is the whole of the identification, so
    // it is a single word each and it is the first thing on its card.
    //
    // BOTH DOORS ARE NOW ONE CHIP AND ONE FORM, so the two role words are all that
    // is left of this group on the landing page. The four strings that used to
    // describe the customer's half — "Customer Space", the one-line pitch, the two
    // bullets, the invitation blurb — were removed from index.html on the owner's
    // instruction (17 words of prose where a chip and a form would do), and their
    // entries went with them; smoke-i18n fails if a table entry has no markup using
    // it, which is exactly how a dead key gets caught.
    //
    // door.openSpace survives the cut because it is not prose: it is the button a
    // customer who is ALREADY signed in on this device taps instead of a form.
    'door.employee':      'Employee',
    'door.customer':      'Customer',
    'door.openSpace':     'Open the Customer Space',

    // ── The customer's sign-in form ──────────────────────────────────────────
    // Two doors, same two words as the employee's — and that is the point: the two
    // doors ask for the same thing in the same way, so nothing about the customer's
    // box needs explaining.
    //
    // cust.hint says "the email address we invited you at" for one real reason: the
    // account was created by the desk, not by the customer, so a customer who has a
    // personal address and a work one has no way of knowing which one to type. The
    // invitation went to one of them and the other will be refused.
    'cust.hint':          'Sign in with the email address we invited you at.',
    'cust.email':         'you@company.com',
    'cust.useOtp':        'Use email (OTP) based login method',

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

  // ── Resolving ──────────────────────────────────────────────────────────────

  const _warned = new Set();

  // `t('list.title')` → 'IRs'. `t('board.more', { n: 3 })` → '+3 more — see list'.
  //
  // A key with no string returns THE KEY, and warns once. That is deliberately
  // ugly: a raw 'list.title' on screen is unmistakably a bug, whereas a silent
  // empty string is a blank control nobody can account for. smoke-i18n.mjs makes
  // both impossible to ship — this is the belt to that test's braces, for the case
  // where a key is built at runtime and the test cannot see it.
  function t(key, vars) {
    const s = Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : null;
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
        if (typeof STRINGS[key] !== 'string') return;   // the markup's own text stands
        set(el, t(key, varsOf(el)));
      });
    };
    paint('[data-i18n]',             el => el.dataset.i18n,             (el, s) => { el.textContent = s; });
    paint('[data-i18n-title]',       el => el.dataset.i18nTitle,        (el, s) => { el.title = s; });
    paint('[data-i18n-aria]',        el => el.dataset.i18nAria,         (el, s) => { el.setAttribute('aria-label', s); });
    paint('[data-i18n-placeholder]', el => el.dataset.i18nPlaceholder,  (el, s) => { el.setAttribute('placeholder', s); });
  }

  window.I18N = {
    t: t, status: status, priority: priority, applyStatic: applyStatic,
    STRINGS: STRINGS, STATUS_KEYS: STATUS_KEYS, PRIORITY_KEYS: PRIORITY_KEYS,
  };
  // The short alias every call site uses. Exposed separately so app.js can read
  // `window.t` without going through the namespace on every call.
  window.t = t;
})();
