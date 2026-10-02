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

    // ── The workflow status words (IR_STATUS_VALUES) ──────────────────────────
    'status.open':             'Open',
    'status.remoteSupport':    'Remote Support',
    'status.hold':             'Hold',
    'status.inward':           'Inward',
    'status.visualInspection': 'Visual Inspection',
    'status.qcInvestigation':  'QC Investigation',
    'status.production':       'Production',
    'status.qc':               'QC',
    'status.flightTest':       'Flight Test',
    'status.pdi':              'PDI',
    'status.approval':         'Approval',
    'status.delivered':        'Delivered',
    'status.close':            'Close',
    'status.other':            'Other',

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

    // ── Words the app uses everywhere ────────────────────────────────────────
    'common.saved':        'Saved',
    'common.saving':       'Saving…',
    'common.notSaved':     'Not saved — press again',
    'common.retrying':     'Not saved — retrying',
    'common.unassigned':   'Unassigned',
    'common.overdue':      'Overdue',
    'common.openInMaps':   'Open in Maps →',
  };

  // The workflow status words, keyed the way the app stores them. app.js already
  // has ONE list of what a status may be (IR_STATUS_VALUES); this maps those same
  // values to their keys, so translating a status never means transliterating it.
  // Built by name rather than hand-written so a status added there and forgotten
  // here is caught by smoke-i18n.mjs rather than silently shown in English.
  const STATUS_KEYS = {
    'Open': 'status.open', 'Remote Support': 'status.remoteSupport',
    'Hold': 'status.hold', 'Inward': 'status.inward',
    'Visual Inspection': 'status.visualInspection',
    'QC Investigation': 'status.qcInvestigation',
    'Production': 'status.production', 'QC': 'status.qc',
    'Flight Test': 'status.flightTest', 'PDI': 'status.pdi',
    'Approval': 'status.approval', 'Delivered': 'status.delivered',
    'Close': 'status.close', 'Other': 'status.other',
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
