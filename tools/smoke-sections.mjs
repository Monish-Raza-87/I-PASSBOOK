// Smoke test for the section contract after the restructure: six sections, B–G.
//
//   node tools/smoke-sections.mjs
//
// Three things were merged away in one change, and each of them breaks silently:
//
//   1. Section A became the Overview panel. It is NOT a section — but its DATA key
//      (`sec-a`) survives, so anything that equates "a section id" with "a key in
//      APP_DATA" now has a gap in it.
//   2. Old `sec-g` (Flight Test) merged into `sec-f`, and old `sec-h`/`sec-i` into
//      the new `sec-g`. The FIELD IDS were deliberately not renamed, so `sec-f`
//      contains `f_*` AND `g_*` keys, and `sec-g` contains `h_*` AND `i_*`.
//   3. That wart is only survivable because a field id is resolved through an index
//      built from SECTIONS. Resolving it by prefix — the way this used to work —
//      now sends `g_missionReport` to a section that no longer exists.
//
// So the load-bearing assertion in this file is the sweep: EVERY field id declared
// by EVERY section must resolve back to the section that declares it. A merge that
// forgets one field, or a rename that slips into one entry, is caught by that one
// loop rather than by a spot check that happens to name the wrong example.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html  = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const T = loadApp(`
  SECTION_IDS, SECTION_LABELS, SECTION_SHORT, SECTIONS, FIELD_SECTION_INDEX,
  OVERVIEW_KEY, sectionIdFromFieldId, fieldLabelFor,
  saveDraft: id => saveDraft(id),
  get currentIR() { return currentIR; }, set currentIR(v) { currentIR = v; },
  TRIAGE_LABEL, TRIAGE_SHORT,
`);

// ── The list itself ───────────────────────────────────────────────────────────
r.head('six sections, letters B–G, in order');
r.ok('SECTION_IDS is the six survivors',
  T.SECTION_IDS.join(',') === 'sec-b,sec-c,sec-d,sec-e,sec-f,sec-g', T.SECTION_IDS);
r.ok('SECTIONS has exactly those keys',
  Object.keys(T.SECTIONS).join(',') === T.SECTION_IDS.join(','), Object.keys(T.SECTIONS));
r.ok('every section has a letter', T.SECTION_IDS.every(s => T.SECTION_LABELS[s]),
  T.SECTION_IDS.map(s => s + '=' + T.SECTION_LABELS[s]));
r.ok('the letters are B–G with no A, H or I',
  T.SECTION_IDS.map(s => T.SECTION_LABELS[s]).join('') === 'BCDEFG',
  T.SECTION_IDS.map(s => T.SECTION_LABELS[s]));
r.ok('every section has a short name', T.SECTION_IDS.every(s => T.SECTION_SHORT[s]),
  T.SECTION_IDS.filter(s => !T.SECTION_SHORT[s]));
r.ok('the short names are the six the owner reads',
  T.SECTION_SHORT['sec-f'] === 'Quality Test Report' &&
  T.SECTION_SHORT['sec-g'] === 'PDI Report/Dispatch Record',
  [T.SECTION_SHORT['sec-f'], T.SECTION_SHORT['sec-g']]);

// The titles must keep the `Section X — ` prefix: app.js strips it with
// title.replace(/^Section [A-Z] — /, '') for the comment modal's label, and a
// missing prefix silently returns the WHOLE title as the label.
r.head('every title keeps the prefix the label-stripper depends on');
T.SECTION_IDS.forEach(s => {
  const title = T.SECTIONS[s].title;
  r.ok(s + ' title matches /^Section [A-Z] — /', /^Section [A-Z] — /.test(title), title);
});
r.ok('and the letters in the titles match the ids',
  T.SECTION_IDS.every(s => T.SECTIONS[s].title.indexOf('Section ' + T.SECTION_LABELS[s] + ' — ') === 0),
  T.SECTION_IDS.map(s => s + ': ' + T.SECTIONS[s].title));

// A section with no fields renders an empty pane and saves nothing — and it would
// look, to anyone testing, exactly like a section whose data was never entered.
r.head('no section is empty');
T.SECTION_IDS.forEach(s => {
  r.ok(s + ' declares fields', (T.SECTIONS[s].fields || []).length > 0, (T.SECTIONS[s].fields || []).length);
});

// ── The three retired ids ─────────────────────────────────────────────────────
r.head('the retired ids are gone, and the merge map is the only place they live');
r.ok('sec-a is not a section', !T.SECTION_IDS.includes('sec-a'));
r.ok('sec-h is not a section', !T.SECTION_IDS.includes('sec-h'));
r.ok('sec-i is not a section', !T.SECTION_IDS.includes('sec-i'));
r.ok('SECTIONS has no entry for any of them',
  !T.SECTIONS['sec-a'] && !T.SECTIONS['sec-h'] && !T.SECTIONS['sec-i'], Object.keys(T.SECTIONS));
r.ok('but sec-a survives as the Overview\'s DATA key',
  T.OVERVIEW_KEY === 'sec-a', T.OVERVIEW_KEY);
r.ok('and it is explicitly NOT in SECTION_IDS, so no loop treats it as one',
  !T.SECTION_IDS.includes(T.OVERVIEW_KEY));
// The ONE legitimate table that names the retired ids is HISTORICAL_SECTION_NAMES,
// whose whole job is to relabel pre-merge history without misattributing the work
// that was done under the old letter. Everything else — a label map, a form, a
// fallback path — must not mention them at all.
r.head('no frontend table still lists a retired id as a live section');
r.ok('HISTORICAL_SECTION_NAMES exists and is the deliberate exception',
  /const HISTORICAL_SECTION_NAMES = \{/.test(appJs) && /'sec-h':/.test(appJs) && /'sec-i':/.test(appJs),
  (appJs.match(/HISTORICAL_SECTION_NAMES = \{[\s\S]{0,220}?\};/) || [''])[0].slice(0, 200));
const histAt = appJs.indexOf('const HISTORICAL_SECTION_NAMES');
const histEnd = appJs.indexOf('\n};', histAt);
const histBlock = appJs.slice(histAt, histEnd + 3);
r.ok('the historical block is bounded, so this exception cannot swallow the file', histBlock.length < 600, histBlock.length);
const retiredTables = [
  { name: 'SECTION_IDS',    re: /const SECTION_IDS = \[([^\]]*)\]/ },
  { name: 'SECTION_LABELS', re: /const SECTION_LABELS = \{([^}]*)\}/ },
  { name: 'SECTION_SHORT',  re: /const SECTION_SHORT = \{([\s\S]*?)\n\};/ },
];
retiredTables.forEach(({ name, re }) => {
  const body = (appJs.match(re) || [])[1] || '';
  r.ok(name + ' names none of sec-a / sec-h / sec-i',
    !/sec-[ahi]\b/.test(body), (body.match(/sec-[ahi]\b/g) || []));
});
// Sweep the whole file: every quoted retired id must sit inside that one block or
// be the OVERVIEW_KEY assignment. Comments are stripped first — the code explains
// these very ids in prose, and a commentary mention is not a live mapping.
r.head('every quoted retired id is the Overview key or history');
const codeOnly = appJs.replace(/^\s*\/\/.*$/gm, '');
const strays = [...codeOnly.matchAll(/['"]sec-[ahi]['"]/g)].map(m => ({ id: m[0], line: codeOnly.slice(codeOnly.lastIndexOf('\n', m.index) + 1, codeOnly.indexOf('\n', m.index)).trim() }))
  .filter(x => !histBlock.includes(x.id) &&
               !/OVERVIEW_KEY = 'sec-a'/.test(x.line) &&
               !/return OVERVIEW_KEY/.test(x.line));
r.ok('nothing maps a retired id to a live section', strays.length === 0, strays.slice(0, 8));
r.ok('sec-a survives as the Overview\'s data key', /const OVERVIEW_KEY = 'sec-a'/.test(appJs));
// `sec-a` must never be a key a form builder could render, or the Overview would
// grow a second, divergent copy of the intake facts.
r.ok('SECTIONS has no sec-a entry, so nothing builds a form for it',
  !/\n\s*'sec-a':\s*\{/.test(appJs));

// ── THE sweep: every field id resolves to the section that declares it ────────
r.head('every declared field resolves back to its own section');
// This is the whole reason the ids were not renamed. `sec-f` holds `f_*` and `g_*`;
// `sec-g` holds `h_*` and `i_*`. A prefix-based resolution sends `g_basicReport` to
// `sec-g` and loses the value.
let declared = 0;
const misresolved = [];
T.SECTION_IDS.forEach(s => {
  (T.SECTIONS[s].fields || []).forEach(f => {
    declared++;
    const got = T.sectionIdFromFieldId(f.id);
    if (got !== s) misresolved.push({ field: f.id, declaredIn: s, resolvedTo: got });
  });
});
r.ok('the sweep is not vacuous — it covered a real number of fields', declared > 40, declared);
r.ok('EVERY field id resolves to its declaring section', misresolved.length === 0, misresolved);

r.head('the index is built from SECTIONS, so it cannot drift from it');
r.ok('FIELD_SECTION_INDEX has one entry per declared field',
  Object.keys(T.FIELD_SECTION_INDEX).length === declared,
  { index: Object.keys(T.FIELD_SECTION_INDEX).length, declared });
r.ok('no field id is declared by two sections',
  Object.keys(T.FIELD_SECTION_INDEX).length === new Set(Object.keys(T.FIELD_SECTION_INDEX)).size);
r.ok('the index agrees with SECTIONS on every key',
  Object.keys(T.FIELD_SECTION_INDEX).every(k => T.SECTION_IDS.includes(T.FIELD_SECTION_INDEX[k])));

// The four cases that fail the moment anybody "simplifies" this back to a prefix
// guess. Named individually as well as swept, because these are the examples the
// comment in app.js points at and a future reader will grep for them.
r.head('the merged-id cases, named');
r.ok('g_basicReport (Flight Test, once its own section) resolves to sec-f',
  T.sectionIdFromFieldId('g_basicReport') === 'sec-f', T.sectionIdFromFieldId('g_basicReport'));
r.ok('h_dispatchChecklist (old PDI) resolves to sec-g',
  T.sectionIdFromFieldId('h_dispatchChecklist') === 'sec-g', T.sectionIdFromFieldId('h_dispatchChecklist'));
r.ok('i_courier (old Dispatch) resolves to sec-g',
  T.sectionIdFromFieldId('i_courier') === 'sec-g', T.sectionIdFromFieldId('i_courier'));
r.ok('an a_* intake field resolves to the Overview key',
  T.sectionIdFromFieldId('a_crmOwner') === T.OVERVIEW_KEY, T.sectionIdFromFieldId('a_crmOwner'));
r.ok('sec-f really does hold both prefixes',
  Object.keys(T.FIELD_SECTION_INDEX).some(k => k.indexOf('f_') === 0 && T.FIELD_SECTION_INDEX[k] === 'sec-f') &&
  Object.keys(T.FIELD_SECTION_INDEX).some(k => k.indexOf('g_') === 0 && T.FIELD_SECTION_INDEX[k] === 'sec-f'),
  Object.keys(T.FIELD_SECTION_INDEX).filter(k => T.FIELD_SECTION_INDEX[k] === 'sec-f').slice(0, 40));
r.ok('sec-g really does hold both prefixes',
  Object.keys(T.FIELD_SECTION_INDEX).some(k => k.indexOf('h_') === 0 && T.FIELD_SECTION_INDEX[k] === 'sec-g') &&
  Object.keys(T.FIELD_SECTION_INDEX).some(k => k.indexOf('i_') === 0 && T.FIELD_SECTION_INDEX[k] === 'sec-g'),
  Object.keys(T.FIELD_SECTION_INDEX).filter(k => T.FIELD_SECTION_INDEX[k] === 'sec-g').slice(0, 40));

r.head('the prefix guess survives only as a fallback');
// An id no form declares — a retired field, or one added to the Sheet by hand —
// still has to resolve to something, or its saved value becomes unfindable.
r.ok('an undeclared b_* id still guesses sec-b',
  T.sectionIdFromFieldId('b_someRetiredField') === 'sec-b', T.sectionIdFromFieldId('b_someRetiredField'));
r.ok('an undeclared field for a deleted letter resolves to nothing usable',
  T.sectionIdFromFieldId('z_nonsense') === 'sec-z', T.sectionIdFromFieldId('z_nonsense'));
r.ok('an empty id is null, not a crash', T.sectionIdFromFieldId('') === null && T.sectionIdFromFieldId(null) === null);
r.ok('fieldLabel falls back to the raw id for an unknown field',
  T.fieldLabelFor('zzz_nope') === 'zzz_nope', T.fieldLabelFor('zzz_nope'));
r.ok('and returns the label for a known one',
  T.fieldLabelFor('g_basicReport') !== 'g_basicReport', T.fieldLabelFor('g_basicReport'));

// ── The Overview's structural isolation ───────────────────────────────────────
r.head('the Overview is not a section in the shell either');
const tabs = [...html.matchAll(/<div class="tab[^"]*"([^>]*)>/g)].map(m => (m[1].match(/data-section="([^"]+)"/) || [])[1]).filter(Boolean);
r.ok('no tab points at sec-a', !tabs.includes('sec-a'), tabs);
r.ok('no tab points at sec-h or sec-i', !tabs.includes('sec-h') && !tabs.includes('sec-i'), tabs);
const panes = [...html.matchAll(/<div id="(sec-[a-z]+)" class="section-content/g)].map(m => m[1]);
r.ok('no pane exists for the retired ids',
  !panes.includes('sec-a') && !panes.includes('sec-h') && !panes.includes('sec-i'), panes);
r.ok('every declared section has both a tab and a pane',
  T.SECTION_IDS.every(s => tabs.includes(s) && panes.includes(s)), { tabs, panes });
// The panel deliberately sits outside #sections-wrapper: that excludes it from the
// delegated input/change listeners that drive saveDraft. Intended, not an oversight.
r.ok('the Overview panel lives outside #sections-wrapper',
  html.indexOf('id="ir-overview"') < html.indexOf('id="sections-wrapper"'));
r.ok('the Overview has no form container in SECTIONS\' shape',
  !/id="sec-a-form"/.test(html) && !/id="sec-a"/.test(html));

// ── saveDraft refuses everything that is not a section ────────────────────────
r.head('saveDraft writes nothing for a non-section');
// The 📋 Report tab is read-only and the Overview is always visible; neither has a
// draft. The guard is what keeps the wrapper's delegated listener from writing
// empty junk for them on every keystroke.
r.ok('the guard is the SECTIONS lookup, not a list of ids to exclude',
  /if \(!SECTIONS\[sectionId\]\) return;/.test(appJs),
  (appJs.match(/[^\n]*SECTIONS\[sectionId\][^\n]*/) || [''])[0]);
T.currentIR = { irNumber: 'IR409' };
let threw = null;
try { T.saveDraft('sec-a'); } catch (e) { threw = String(e && e.message); }
r.ok('saveDraft(\'sec-a\') does not throw', threw === null, threw);
r.ok('saveDraft(\'sec-h\') does not throw', (() => { try { T.saveDraft('sec-h'); return true; } catch (e) { return false; } })());
r.ok('saveDraft(\'sec-intake\') does not throw', (() => { try { T.saveDraft('sec-intake'); return true; } catch (e) { return false; } })());
T.currentIR = null;

// ── Triage is not a section ───────────────────────────────────────────────────
r.head('Triage is a separate axis, not a seventh section');
r.ok('it has its own label constants', T.TRIAGE_LABEL === 'TR' && !!T.TRIAGE_SHORT,
  [T.TRIAGE_LABEL, T.TRIAGE_SHORT]);
r.ok('it is NOT in SECTION_LABELS', !Object.values(T.SECTION_LABELS).includes(T.TRIAGE_LABEL),
  Object.values(T.SECTION_LABELS));
r.ok('it is NOT in SECTION_SHORT, so no Object.keys() loop treats it as a section',
  !T.SECTION_SHORT['triage'] && !T.SECTION_SHORT[T.TRIAGE_LABEL],
  Object.keys(T.SECTION_SHORT));
r.ok('and it is not in SECTION_IDS',
  !T.SECTION_IDS.includes('triage') && !T.SECTION_IDS.includes('sec-triage'), T.SECTION_IDS);
// The admin UI collects grants by querying .acc-grant[data-key] and reading
// dataset.sec, so the Triage cell only has to carry data-sec="triage" to be saved
// with no change to the collector. Asserted because "it is collected automatically"
// is exactly the kind of claim that stops being true after one refactor.
r.ok('the admin UI renders a Triage grant cell with data-sec="triage"',
  /data-sec="triage"/.test(appJs), (appJs.match(/[^\n]*data-sec="triage"[^\n]*/) || [''])[0]);
r.ok('the collector still reads dataset.sec, so it picks Triage up unchanged',
  /dataset\.sec/.test(appJs) && /acc-grant/.test(appJs),
  (appJs.match(/[^\n]*dataset\.sec[^\n]*/) || [''])[0]);

r.finish();
