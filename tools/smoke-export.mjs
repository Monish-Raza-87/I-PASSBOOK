// Smoke test for the per-section PDF export, and for the end of digital signatures.
//
//   node tools/smoke-export.mjs
//
// The export is built in three layers so that the part which is easy to get wrong is
// testable without a browser: a PURE model (values -> blocks), a resolver that turns
// attachments into bytes, and one drawing function that owns every pdf-lib call. Only
// the last of those needs the library, and it takes it by injection — so this suite
// hands it the REAL vendored build and proves that a PDF comes out, rather than
// asserting that the code which would draw one exists.
//
// The one thing a stub DOM cannot reach is the merge of a Drive-hosted attachment:
// reading those bytes back is a network call. What IS pinned is the rule that decides
// the outcome — `mergeable` — and the fact that an unreadable attachment is REPORTED,
// never dropped.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const APP_JS    = new URL('../app.js', import.meta.url);
const INDEX     = new URL('../index.html', import.meta.url);
const SW        = new URL('../sw.js', import.meta.url);
const DEPLOY    = new URL('./deploy-ghpages.mjs', import.meta.url);
const VENDOR    = new URL('../vendor/pdf-lib.min.js', import.meta.url);
const LICENCE   = new URL('../vendor/pdf-lib.LICENSE.md', import.meta.url);
const VIEWS_CSS = new URL('../views.css', import.meta.url);

const appSrc    = fs.readFileSync(APP_JS, 'utf8');
const indexSrc  = fs.readFileSync(INDEX, 'utf8');
const swSrc     = fs.readFileSync(SW, 'utf8');
const deploySrc = fs.readFileSync(DEPLOY, 'utf8');
const viewsSrc  = fs.readFileSync(VIEWS_CSS, 'utf8');

// ── Loading the library the way a browser does ────────────────────────────────
//
// The vendored build is a UMD bundle. Evaluating its source inside the sandbox is
// what gives the app a library built from the SAME realm — which matters more than
// it sounds: pdf-lib's page-size check is realm-sensitive, so a copy built out here
// rejects `doc.addPage([w, h])` from inside the sandbox with a "must be of type
// ... or Array" error that has nothing to do with the app. In a browser there is
// only one realm, so this is the faithful arrangement rather than a workaround.
//
// `preload` runs before app.js and attaches `PDFLib` to the sandbox global, exactly
// as the <script> tag does in index.html.
const vendorSource = fs.readFileSync(VENDOR, 'utf8');

const BINDINGS = `
  SECTIONS, SECTION_IDS, FIELD_SECTION_INDEX, EXPORT_TABLES, sectionIdFromFieldId,
  pdfSafe, fitLongEdge, wrapText, analysisNoteText, sectionPdfModel,
  drawSectionPdf, collectExportMedia, normalizeImage, pdfLib,
  exportFileName, sanitizeFileName, deliverExportFiles, exportSectionPdf,
  mergeFlightReportEntries, savedEvidenceEntries,
  EXPORT_IMAGE_LONG_EDGE, EXPORT_IMAGE_QUALITY,
  guessEvidenceType, showToast,
  set evidence(v) { evidenceState = v; },
  set sectionData(v) { currentSectionData = v; },
  set ir(v) { currentIR = v; },
  set user(v) { currentUser = v; },
`;

// Two loads. The first is the app exactly as every other suite sees it — with no PDF
// library in scope, which is itself the proof that app.js never touches `PDFLib` at
// parse time. The second gets the library the way a page does.
const T  = loadApp(BINDINGS);
const TL = loadApp(BINDINGS, { preload: vendorSource });

// The library as the app sees it, used for every fixture and every read-back below
// so that nothing crosses a realm boundary.
const SB = TL.pdfLib();

// A font stand-in for wrapText: 0.5 em per character, close enough to Helvetica for
// line-break arithmetic to be worth asserting on.
const FONT = { widthOfTextAtSize: (s, size) => String(s).length * size * 0.5 };

const isPdf = b => !!b && b.length > 4 && String.fromCharCode(b[0], b[1], b[2], b[3]) === '%PDF';

// ── 1. What the standard PDF fonts can actually carry ─────────────────────────
r.head('text is folded into what the standard fonts can encode');
// pdf-lib THROWS on a character outside WinAnsi rather than dropping it, so one
// unsanitised emoji in a Remarks box would fail the entire export.
r.ok('an em dash becomes a hyphen', T.pdfSafe('a — b') === 'a - b', T.pdfSafe('a — b'));
r.ok('a tick becomes a plain letter', T.pdfSafe('done ✓') === 'done v', T.pdfSafe('done ✓'));
r.ok('a rupee becomes text', T.pdfSafe('₹500') === 'Rs.500', T.pdfSafe('₹500'));
r.ok('curly quotes become straight ones',
  T.pdfSafe('“x”') === '"x"' && T.pdfSafe('‘y’') === "'y'", [T.pdfSafe('“x”'), T.pdfSafe('‘y’')]);
r.ok('an emoji the map does not know becomes ONE "?", not a crash',
  T.pdfSafe('ok 👌') === 'ok ?', T.pdfSafe('ok 👌'));
r.ok('plain Latin-1 survives untouched', T.pdfSafe('Café Ñoño') === 'Café Ñoño', T.pdfSafe('Café Ñoño'));
r.ok('a newline becomes a space — the drawer has already wrapped by then',
  T.pdfSafe('line 1\nline 2') === 'line 1 line 2', JSON.stringify(T.pdfSafe('line 1\nline 2')));
r.ok('so does a tab', T.pdfSafe('a\tb') === 'a b', JSON.stringify(T.pdfSafe('a\tb')));
r.ok('nothing at all is an empty string, not "null"',
  T.pdfSafe(null) === '' && T.pdfSafe(undefined) === '' && T.pdfSafe(0) === '0');
r.ok('an unpaired surrogate does not survive either',
  T.pdfSafe('a\uD800b') === 'a?b', JSON.stringify(T.pdfSafe('a\uD800b')));

// ── 2. Fitting an image to the page ───────────────────────────────────────────
r.head('an image is fitted by its LONG edge, and never enlarged');
r.ok('a landscape photo is capped on its width',
  JSON.stringify(T.fitLongEdge(4000, 2000, 1600)) === JSON.stringify({ width: 1600, height: 800, scale: 0.4 }),
  T.fitLongEdge(4000, 2000, 1600));
r.ok('a portrait photo is capped on its height',
  JSON.stringify(T.fitLongEdge(2000, 4000, 1600)) === JSON.stringify({ width: 800, height: 1600, scale: 0.4 }),
  T.fitLongEdge(2000, 4000, 1600));
r.ok('a small photo is left exactly as it is',
  JSON.stringify(T.fitLongEdge(800, 600, 1600)) === JSON.stringify({ width: 800, height: 600, scale: 1 }),
  T.fitLongEdge(800, 600, 1600));
r.ok('a square photo lands exactly on the cap',
  JSON.stringify(T.fitLongEdge(1600, 1600, 1600)) === JSON.stringify({ width: 1600, height: 1600, scale: 1 }),
  T.fitLongEdge(1600, 1600, 1600));
r.ok('zero or nonsense dimensions give a zero box rather than NaN',
  T.fitLongEdge(0, 0, 1600).width === 0 && T.fitLongEdge(0, 100, 1600).width === 0 &&
  T.fitLongEdge('x', undefined, 1600).height === 0,
  [T.fitLongEdge(0, 0, 1600), T.fitLongEdge('x', undefined, 1600)]);
r.ok('the caps are the ones the plan names',
  T.EXPORT_IMAGE_LONG_EDGE === 1600 && T.EXPORT_IMAGE_QUALITY === 0.82,
  [T.EXPORT_IMAGE_LONG_EDGE, T.EXPORT_IMAGE_QUALITY]);

// ── 3. Wrapping text into a column ────────────────────────────────────────────
r.head('a paragraph wraps to the column, and keeps the breaks the author typed');
r.ok('an empty value draws nothing at all',
  T.wrapText('', FONT, 10, 100).length === 0 && T.wrapText(null, FONT, 10, 100).length === 0,
  T.wrapText('', FONT, 10, 100));
r.ok('a blank line inside a paragraph survives as a blank line',
  JSON.stringify(T.wrapText('a\n\nb', FONT, 10, 100)) === JSON.stringify(['a', '', 'b']),
  T.wrapText('a\n\nb', FONT, 10, 100));
r.ok('a line that fits is left alone',
  JSON.stringify(T.wrapText('short line', FONT, 10, 100)) === JSON.stringify(['short line']),
  T.wrapText('short line', FONT, 10, 100));
r.ok('a long paragraph is broken into lines that each fit', (() => {
  const lines = T.wrapText('the quick brown fox jumps over the lazy dog again and again', FONT, 10, 100);
  return lines.length > 1 && lines.every(l => FONT.widthOfTextAtSize(l, 10) <= 100);
})(), T.wrapText('the quick brown fox jumps over the lazy dog again and again', FONT, 10, 100));
{
  const url = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view';
  const lines = T.wrapText(url, FONT, 10, 100);
  r.ok('a word longer than the column is hard-broken, not run off the page',
    lines.length > 1 && lines.every(l => FONT.widthOfTextAtSize(l, 10) <= 100), lines);
  r.ok('and nothing is lost in the break', lines.join('') === url, lines.join(''));
}
r.ok('a word that exactly fits is not broken',
  JSON.stringify(T.wrapText('abcdefghij', FONT, 10, 100)) === JSON.stringify(['abcdefghij']),
  T.wrapText('abcdefghij', FONT, 10, 100));

// ── 4. The model — SECTIONS in, blocks out, no DOM and no library ─────────────
r.head('the model is driven by SECTIONS, so a field added later exports with no new code');
const bValues = {
  b_inwardTable: { 'Flight Controller': { model: 'Pixhawk 6X', qty: '1', remark: 'ok' } },
  b_inwardPhotos: [{ caption: 'Box as received', link: 'https://drive.google.com/file/d/AAA/view', type: 'image', name: '' }],
  b_remarks: 'Two props missing.',
};
const bModel = T.sectionPdfModel('sec-b', bValues, { irNumber: 'IR409', droneId: 'DRN-7' });
r.ok('the section title, the IR and the system id are all on the model',
  bModel.title === T.SECTIONS['sec-b'].title && bModel.irNumber === 'IR409' && bModel.droneId === 'DRN-7',
  [bModel.title, bModel.irNumber, bModel.droneId]);
r.ok('every block is one of the five kinds the drawer knows',
  bModel.blocks.every(b => ['divider', 'note', 'field', 'images', 'table'].includes(b.kind)),
  [...new Set(bModel.blocks.map(b => b.kind))]);
r.ok('the photo field produces an images block, keyed for its bytes',
  (() => {
    const im = bModel.blocks.find(b => b.kind === 'images');
    return !!im && im.items.length === 1 && im.items[0].key === 'b_inwardPhotos#0' &&
           im.items[0].caption === 'Box as received' && im.label === 'Inward Photos (Image or PDF)';
  })(), bModel.blocks.filter(b => b.kind === 'images'));
r.ok('the inward table produces a table block with its four columns',
  (() => {
    const t = bModel.blocks.find(b => b.kind === 'table');
    return !!t && t.columns.join('|') === 'Particulars|Model|Qty|Remark' &&
           t.rows[0].join('|') === 'Flight Controller|Pixhawk 6X|1|ok';
  })(), bModel.blocks.filter(b => b.kind === 'table'));
r.ok('Remarks comes through as a field block',
  (() => {
    const f = bModel.blocks.find(b => b.kind === 'field' && b.label === 'Remarks');
    return !!f && f.value === 'Two props missing.';
  })(), bModel.blocks.filter(b => b.kind === 'field'));
r.ok('a field with nothing in it is still listed, so the form is complete on paper',
  (() => {
    const f = T.sectionPdfModel('sec-b', {}, null).blocks.find(b => b.kind === 'field' && b.label === 'Remarks');
    return !!f && f.value === '';
  })());
r.ok('every declared field of the section appears in some block', (() => {
  const modelled = new Set();
  bModel.blocks.forEach(b => {
    if (b.kind === 'field' || b.kind === 'table' || b.kind === 'images') modelled.add(b.label);
  });
  return T.SECTIONS['sec-b'].fields.filter(f => f.type !== 'divider').every(f => modelled.has(f.label));
})(), T.SECTIONS['sec-b'].fields.map(f => f.label));
r.ok('an unknown section gives an empty model rather than a crash',
  JSON.stringify(T.sectionPdfModel('sec-z', {}, null)) === JSON.stringify({ title: '', irNumber: '', droneId: '', blocks: [] }),
  T.sectionPdfModel('sec-z', {}, null));

r.head('Section B and Section C gained the attachment control, and C lost its link');
const fieldIds = sid => T.SECTIONS[sid].fields.map(f => f.id);
r.ok('B has a photo field BETWEEN the received table and Remarks', (() => {
  const ids = fieldIds('sec-b');
  return ids.indexOf('b_inwardTable') < ids.indexOf('b_inwardPhotos') &&
         ids.indexOf('b_inwardPhotos') < ids.indexOf('b_remarks');
})(), fieldIds('sec-b'));
r.ok('C has one AFTER the visual checklist and before Remarks', (() => {
  const ids = fieldIds('sec-c');
  return ids.indexOf('c_iqcTable') < ids.indexOf('c_iqcPhotos') &&
         ids.indexOf('c_iqcPhotos') < ids.indexOf('c_remarks');
})(), fieldIds('sec-c'));
r.ok('both are the shared imageEvidence control, not a second implementation',
  T.SECTIONS['sec-b'].fields.find(f => f.id === 'b_inwardPhotos').type === 'imageEvidence' &&
  T.SECTIONS['sec-c'].fields.find(f => f.id === 'c_iqcPhotos').type === 'imageEvidence');
r.ok('the "Link to Evidence folder" field is gone from C',
  !fieldIds('sec-c').includes('c_evidenceLink') && !/c_evidenceLink/.test(appSrc));
r.ok('and from the markup, so no dead container is left behind',
  !/c_evidenceLink/.test(indexSrc));

r.head('every table shape the app stores renders');
r.ok('the IQC checklist carries the item name, its result and its remark', (() => {
  const m = T.sectionPdfModel('sec-c', { c_iqcTable: { z1: { name: 'Airframe', result: 'Pass', remark: 'hairline scratch' } } }, null);
  const t = m.blocks.find(b => b.kind === 'table');
  return t.columns.join('|') === 'Zone / Item|Result|Remark' && t.rows[0].join('|') === 'Airframe|Pass|hairline scratch';
})(), (T.sectionPdfModel('sec-c', { c_iqcTable: { z1: { name: 'Airframe', result: 'Pass', remark: 'x' } } }, null).blocks.find(b => b.kind === 'table') || {}).rows);
r.ok('an IQC row with no name falls back to its zone id', (() => {
  const t = T.sectionPdfModel('sec-c', { c_iqcTable: { z1: { result: 'Pass' } } }, null).blocks.find(b => b.kind === 'table');
  return !!t && t.rows[0][0] === 'z1' && t.rows[0][1] === 'Pass';
})(), T.sectionPdfModel('sec-c', { c_iqcTable: { z1: { result: 'Pass' } } }, null).blocks.filter(b => b.kind === 'table'));
r.ok('the cost table renders its five columns in order', (() => {
  const m = T.sectionPdfModel('sec-d', { d_repairTable: [{ particular: 'Motor', qty: '2', rate: '100', cost: '200', remark: 'r' }] }, null);
  const t = m.blocks.find(b => b.kind === 'table');
  // The headings are the words the owner asked for — "Particular" and "Rate" were
  // the old table's vocabulary and read as jargon next to a cost and a remark. The
  // stored KEYS are untouched, so every existing IR's rows still render.
  return t.columns.join('|') === 'Item description|Qty|Unit cost|Total cost|Remark' && t.rows[0].join('|') === 'Motor|2|100|200|r';
})(), (T.sectionPdfModel('sec-d', { d_repairTable: [{ particular: 'Motor' }] }, null).blocks.find(b => b.kind === 'table') || {}).rows);
r.ok('the dispatch checklist renders particular -> status', (() => {
  const m = T.sectionPdfModel('sec-g', { h_dispatchChecklist: { 'Airframe': 'Packed' } }, null);
  const t = m.blocks.find(b => b.kind === 'table');
  return t.columns.join('|') === 'Particular|Status' && t.rows[0].join('|') === 'Airframe|Packed';
})(), (T.sectionPdfModel('sec-g', { h_dispatchChecklist: { A: 'B' } }, null).blocks.find(b => b.kind === 'table') || {}).rows);
r.ok('all four shapes are the ones the drawer is told about',
  Object.keys(T.EXPORT_TABLES).sort().join(',') === 'costTable,dispatchChecklist,inwardTable,iqcTable',
  Object.keys(T.EXPORT_TABLES));
r.ok('an EMPTY table produces no block at all, not an empty grid', (() => {
  const m = T.sectionPdfModel('sec-b', { b_inwardTable: {} }, null);
  return !m.blocks.some(b => b.kind === 'table');
})());
r.ok('a half-filled table row is a row, not a crash', (() => {
  const m = T.sectionPdfModel('sec-b', { b_inwardTable: { 'Prop': { qty: '4' } } }, null);
  const t = m.blocks.find(b => b.kind === 'table');
  return t.rows[0].join('|') === 'Prop||4|';
})(), (T.sectionPdfModel('sec-b', { b_inwardTable: { Prop: { qty: '4' } } }, null).blocks.find(b => b.kind === 'table') || {}).rows);
r.ok('a table given the wrong shape entirely does not throw', (() => {
  try { T.sectionPdfModel('sec-b', { b_inwardTable: 'nonsense' }, null); return true; } catch (e) { return 'threw: ' + e.message; }
})());
r.ok('a cost table given an object rather than an array does not throw', (() => {
  try { T.sectionPdfModel('sec-d', { d_repairTable: { a: 1 } }, null); return true; } catch (e) { return 'threw: ' + e.message; }
})());

r.head('Section D keeps the customer note, as text rather than as markup');
r.ok('the analysis note is a block with the IR and the system id in it', (() => {
  const m = T.sectionPdfModel('sec-d', {}, { irNumber: 'IR409', droneId: 'DRN-7' });
  const n = m.blocks.find(b => b.kind === 'note');
  return !!n && n.text.includes('IR409') && n.text.includes('DRN-7') && !/[<>]/.test(n.text);
})(), T.sectionPdfModel('sec-d', {}, { irNumber: 'IR409', droneId: 'DRN-7' }).blocks.filter(b => b.kind === 'note'));
r.ok('a missing IR leaves placeholders rather than the word "undefined"',
  !/undefined/.test(T.analysisNoteText(null)), T.analysisNoteText(null));
r.ok('a divider in the form becomes a divider in the document',
  T.sectionPdfModel('sec-f', {}, null).blocks.some(b => b.kind === 'divider' && /Flight Test/.test(b.text)),
  T.sectionPdfModel('sec-f', {}, null).blocks.filter(b => b.kind === 'divider'));
r.ok('a checkpoint draws its tick state AND its attachments',
  (() => {
    const m = T.sectionPdfModel('sec-f', { g_flightLogs: { done: true, attach: [{ caption: 'log', type: 'image', name: 'a.png' }] } }, null);
    const f = m.blocks.find(b => b.kind === 'field' && /data check performed/.test(b.label));
    const im = m.blocks.find(b => b.kind === 'images');
    return !!f && f.value === 'Done' && !!im && im.items[0].key === 'g_flightLogs_attach#0';
  })(), T.sectionPdfModel('sec-f', { g_flightLogs: { done: true, attach: [{ caption: 'log' }] } }, null).blocks);

r.head('the two Flight Test uploads are one field now, and only one');
r.ok('g_basicReport carries both jobs', (() => {
  const f = T.SECTIONS['sec-f'].fields.find(x => x.id === 'g_basicReport');
  return !!f && f.label === 'Flight Test Report (Image or PDF)' && f.type === 'imageEvidence';
})(), T.SECTIONS['sec-f'].fields.filter(f => /Report/.test(f.label || '')).map(f => [f.id, f.label]));
r.ok('the old Basic / Mission labels are gone from every label, script and template', (() => {
  // Comments are stripped first: app.js explains the merge in prose, and naming the
  // retired labels there is the point. What must not survive is a user-visible one.
  const codeOnly = appSrc.replace(/^\s*\/\/.*$/gm, '');
  return !/Basic Flight Test Report|Mission Flight Test Report/.test(codeOnly) &&
         !/Basic Flight Test Report|Mission Flight Test Report/.test(indexSrc);
})(), (appSrc.replace(/^\s*\/\/.*$/gm, '').match(/[^\n]*(Basic|Mission) Flight Test Report[^\n]*/) || [])[0]);
r.ok('g_missionReport is gone from every section',
  !Object.keys(T.SECTIONS).some(sid => T.SECTIONS[sid].fields.some(f => f.id === 'g_missionReport')));
r.ok('and no model emits a second report block',
  T.SECTION_IDS.every(sid => !JSON.stringify(T.sectionPdfModel(sid, {}, null)).includes('g_missionReport')));
r.ok('g_basicReport still resolves to sec-f, so its anchored history stays attached',
  T.sectionIdFromFieldId('g_basicReport') === 'sec-f', T.sectionIdFromFieldId('g_basicReport'));

// ── 5. Saving an upload made under the retired field, without losing it ───────
r.head('uploads made under the retired field stay visible');
const entry = (link, name) => ({ caption: '', link: link, type: 'pdf', name: name });
r.ok('the survivor absorbs the retired field\'s uploads',
  T.mergeFlightReportEntries([entry('L1', 'a.pdf')], [entry('L2', 'b.pdf')]).length === 2);
r.ok('the same upload in both is kept once, not twice',
  T.mergeFlightReportEntries([entry('L1', 'a.pdf')], [entry('L1', 'a.pdf')]).length === 1);
r.ok('the survivor\'s own order comes first',
  T.mergeFlightReportEntries([entry('L1', 'a.pdf')], [entry('L2', 'b.pdf')]).map(e => e.link).join() === 'L1,L2');
r.ok('matching falls back to the name when there is no link',
  T.mergeFlightReportEntries([{ caption: '', link: '', type: 'image', name: 'shot.jpg' }],
                             [{ caption: '', link: '', type: 'image', name: 'shot.jpg' }]).length === 1);
r.ok('two entries with nothing to match on are BOTH kept',
  T.mergeFlightReportEntries([{ caption: '', link: '', type: '', name: '' }],
                             [{ caption: '', link: '', type: '', name: '' }]).length === 2);
r.ok('an empty extra side changes nothing',
  T.mergeFlightReportEntries([entry('L1', 'a.pdf')], []).length === 1 &&
  T.mergeFlightReportEntries([entry('L1', 'a.pdf')], null).length === 1);
r.ok('so a second load cannot duplicate what the first folded in', (() => {
  const base = T.mergeFlightReportEntries([entry('L1', 'a.pdf')], [entry('L2', 'b.pdf')]);
  return T.mergeFlightReportEntries(base, [entry('L2', 'b.pdf')]).length === 2;
})());

r.head('a saved field\'s links are merged back into its entries');
r.ok('an entry whose upload was still pending picks up its Drive link', (() => {
  const v = [{ caption: 'box', link: '', type: 'image', name: '' }];
  T.sectionData = { 'sec-b': { b_inwardPhotos: v, b_inwardPhotos_links: 'https://drive.google.com/file/d/AAA/view' } };
  const got = T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', v, false);
  return got.length === 1 && /AAA/.test(got[0].link) && got[0].caption === 'box';
})(), T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [{ caption: 'box', link: '' }], false));
r.ok('an entry that already has a link is not overwritten', (() => {
  const v = [{ caption: '', link: 'https://drive.google.com/file/d/BBB/view', type: 'image', name: '' }];
  T.sectionData = { 'sec-b': { b_inwardPhotos: v, b_inwardPhotos_links: 'https://drive.google.com/file/d/AAA/view' } };
  const got = T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', v, false);
  return got.length === 1 && /BBB/.test(got[0].link);
})(), T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [], false));
r.ok('two pending entries take the two links in order', (() => {
  const v = [{ caption: 'a', link: '' }, { caption: 'b', link: '' }];
  T.sectionData = { 'sec-b': { b_inwardPhotos: v, b_inwardPhotos_links: 'https://drive.google.com/file/d/AAA/view,https://drive.google.com/file/d/BBB/view' } };
  const got = T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', v, false);
  return /AAA/.test(got[0].link) && /BBB/.test(got[1].link) && got[0].caption === 'a';
})());
r.ok('a record that stored links only still shows them', (() => {
  T.sectionData = { 'sec-b': { b_inwardPhotos_links: 'https://drive.google.com/file/d/AAA/view,https://drive.google.com/file/d/BBB/view' } };
  const got = T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [], false);
  return got.length === 2 && /AAA/.test(got[0].link) && /BBB/.test(got[1].link);
})(), T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [], false));
r.ok('a DRAFT never picks up a Drive link — an unsaved image must not borrow one', (() => {
  T.sectionData = { 'sec-b': { b_inwardPhotos_links: 'https://drive.google.com/file/d/AAA/view' } };
  const got = T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [{ caption: '', link: '', type: 'image', name: '' }], true);
  return got.length === 1 && got[0].link === '';
})(), T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', [{ caption: '', link: '' }], true));
r.ok('no saved data at all is an empty list, not a crash', (() => {
  T.sectionData = {};
  return T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', null, false).length === 0;
})(), T.savedEvidenceEntries('sec-b', 'b_inwardPhotos', null, false));
T.sectionData = {};

// ── 6. What the file is called ────────────────────────────────────────────────
r.head('the exported file is named after the IR and the section');
r.ok('IR409 section B', T.exportFileName('IR409', 'sec-b') === 'IR409 - Section B.pdf', T.exportFileName('IR409', 'sec-b'));
r.ok('section G is a G, not a sec-g', T.exportFileName('IR409', 'sec-g') === 'IR409 - Section G.pdf', T.exportFileName('IR409', 'sec-g'));
r.ok('no IR number still produces a usable name',
  T.exportFileName('', 'sec-c') === 'IR - Section C.pdf' && T.exportFileName(null, 'sec-c') === 'IR - Section C.pdf',
  [T.exportFileName('', 'sec-c'), T.exportFileName(null, 'sec-c')]);
r.ok('a path separator cannot escape the filename',
  T.sanitizeFileName('a/b') === 'a-b' && T.sanitizeFileName('a\\b') === 'a-b' && T.sanitizeFileName('a:b') === 'a-b',
  [T.sanitizeFileName('a/b'), T.sanitizeFileName('a\\b'), T.sanitizeFileName('a:b')]);
r.ok('the other reserved characters go too',
  ['*', '?', '"', '<', '>', '|'].every(c => T.sanitizeFileName('a' + c + 'b') === 'a-b'),
  ['*', '?', '"', '<', '>', '|'].map(c => T.sanitizeFileName('a' + c + 'b')));
r.ok('a directory-traversal attempt is flattened, not honoured',
  T.sanitizeFileName('../../etc/passwd') === '..-..-etc-passwd', T.sanitizeFileName('../../etc/passwd'));
r.ok('runs of whitespace collapse',
  T.sanitizeFileName('  a   b  ') === 'a b', T.sanitizeFileName('  a   b  '));
r.ok('a name that is nothing but separators still has characters left',
  T.sanitizeFileName('///') === '---', T.sanitizeFileName('///'));
r.ok('a blank name falls back rather than vanishing',
  T.sanitizeFileName('') === 'export' && T.sanitizeFileName(null) === 'export' && T.sanitizeFileName('   ') === 'export',
  [T.sanitizeFileName(''), T.sanitizeFileName(null), T.sanitizeFileName('   ')]);

// ── 7. The library is only ever touched inside a function ─────────────────────
r.head('app.js runs with no PDF library in scope at all');
r.ok('the plain load has no library, and says so', T.pdfLib() === null, T.pdfLib());
r.ok('with no library the export toasts instead of throwing', (() => {
  try { T.exportSectionPdf('sec-b', { share: false }); return true; } catch (e) { return 'threw: ' + e.message; }
})());
r.ok('and the library IS found when the page loads it',
  !!SB && typeof SB.PDFDocument === 'function' && typeof SB.PDFDocument.load === 'function',
  SB && Object.keys(SB).slice(0, 6));
r.ok('PDFLib is never named at the top level of the file', (() => {
  // Every mention must sit inside a function body — indented, or a comment. A
  // module-level `PDFLib.x` would take down every suite in this repo, since none of
  // them load the library.
  return appSrc.split('\n').filter(l => /\bPDFLib\b/.test(l) && !/^\s/.test(l) && !/^\/\//.test(l)).length === 0;
})(), appSrc.split('\n').filter(l => /\bPDFLib\b/.test(l) && !/^\s/.test(l)));

// ── 8. A real PDF actually comes out ──────────────────────────────────────────
r.head('the drawing layer produces a real PDF with the real library');
{
  const bytes = await TL.drawSectionPdf(
    T.sectionPdfModel('sec-b', bValues, { irNumber: 'IR409', droneId: 'DRN-7' }),
    { images: new Map(), attachments: [] },
    SB
  );
  r.ok('the output starts with the PDF magic number', isPdf(bytes), bytes && bytes.length);
  const doc = await SB.PDFDocument.load(bytes);
  r.ok('and pdf-lib can read back what it wrote', doc.getPageCount() >= 1, doc.getPageCount());
  r.ok('a filled Section B is one page', doc.getPageCount() === 1, doc.getPageCount());
  r.ok('and the page is A4', (() => {
    const { width, height } = doc.getPage(0).getSize();
    return Math.round(width) === 595 && Math.round(height) === 842;
  })(), doc.getPage(0).getSize());
}

r.head('a readable attachment is merged INTO the report, as pages');
{
  const src = await SB.PDFDocument.create();
  src.addPage();   // no size argument: a host-realm literal would not be the sandbox library's Array
  src.addPage();   // no size argument: a host-realm literal would not be the sandbox library's Array
  const attached = await src.save();

  const merged = await TL.drawSectionPdf(
    T.sectionPdfModel('sec-b', bValues, { irNumber: 'IR409' }),
    { images: new Map(), attachments: [{ key: 'k', name: 'Test Report.pdf', bytes: attached, mergeable: true }] },
    SB
  );
  r.ok('the merged file is still a PDF', isPdf(merged), merged && merged.length);
  const doc = await SB.PDFDocument.load(merged);
  r.ok('and it is longer by exactly the pages that were attached',
    doc.getPageCount() === 3, doc.getPageCount());
}

r.head('an attachment that cannot be read is named, never merged');
{
  const broken = await TL.drawSectionPdf(
    T.sectionPdfModel('sec-b', bValues, { irNumber: 'IR409' }),
    { images: new Map(), attachments: [{ key: 'k', name: 'Gone.pdf', bytes: null, mergeable: false }] },
    SB
  );
  r.ok('the report is still produced', isPdf(broken));
  const doc = await SB.PDFDocument.load(broken);
  r.ok('with no page added for it', doc.getPageCount() === 1, doc.getPageCount());
}

r.head('the awkward content a real section holds does not break the writer');
{
  const nasty = T.sectionPdfModel('sec-d', {
    d_investigation: 'a'.repeat(400) + '\n\nsecond para',
    d_repairTable: Array.from({ length: 30 }, (_, i) => ({ particular: 'Item ' + i, qty: '1', rate: '10', cost: '10', remark: 'ok' })),
  }, { irNumber: 'IR409', droneId: 'DRN-7' });
  let out = null;
  try { out = await TL.drawSectionPdf(nasty, { images: new Map(), attachments: [] }, SB); }
  catch (e) { out = 'threw: ' + e.message; }
  r.ok('a long paragraph and a 30-row table still produce a PDF', isPdf(out), typeof out === 'string' ? out : out && out.length);
  if (isPdf(out)) {
    const doc = await SB.PDFDocument.load(out);
    r.ok('and it spilled onto another page rather than being cut off', doc.getPageCount() > 1, doc.getPageCount());
  } else {
    r.ok('and it spilled onto another page rather than being cut off', false, out);
  }
}

r.head('degenerate sections still export');
{
  const blank = await TL.drawSectionPdf(T.sectionPdfModel('sec-e', {}, null), { images: new Map(), attachments: [] }, SB);
  r.ok('an empty section is a one-page PDF, not a crash', isPdf(blank), blank && blank.length);
}
{
  const emoji = await TL.drawSectionPdf(
    T.sectionPdfModel('sec-b', { b_remarks: 'fixed 👌 — ok ✅ ₹100' }, null),
    { images: new Map(), attachments: [] }, SB
  );
  r.ok('an emoji in Remarks does not take the export down with it', isPdf(emoji), emoji && emoji.length);
}
{
  const all = [];
  for (const sid of T.SECTION_IDS) {
    try { all.push([sid, isPdf(await TL.drawSectionPdf(T.sectionPdfModel(sid, {}, null), { images: new Map(), attachments: [] }, SB))]); }
    catch (e) { all.push([sid, 'threw: ' + e.message]); }
  }
  r.ok('and every section of the app exports while standing empty',
    all.every(x => x[1] === true), all.filter(x => x[1] !== true));
}
{
  let threw = null;
  try { await TL.drawSectionPdf(T.sectionPdfModel('sec-b', {}, null), { images: new Map(), attachments: [] }, null); }
  catch (e) { threw = e.message; }
  r.ok('without the library the drawer refuses rather than half-drawing',
    threw === 'PDF library not loaded', threw);
}

// ── 9. Deciding what can be merged, before anything is drawn ──────────────────
r.head('an attachment is read before the report is written, so the user can be told');
{
  TL.evidence = { b_inwardPhotos: [{ caption: '', link: '', file: { arrayBuffer: async () => new Uint8Array([1, 2, 3]) }, url: null, type: 'pdf', name: 'local.pdf' }] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('an attached PDF is listed by name',
    media.attachments.length === 1 && media.attachments[0].name === 'local.pdf',
    media.attachments.map(a => a.name));
  r.ok('bytes that are not a PDF are marked unmergeable rather than being merged blind',
    media.attachments[0].mergeable === false && !!media.attachments[0].bytes,
    [media.attachments[0].mergeable, !!media.attachments[0].bytes]);
}
{
  const src = await SB.PDFDocument.create();
  src.addPage();   // no size argument: a host-realm literal would not be the sandbox library's Array
  const good = await src.save();
  TL.evidence = { b_inwardPhotos: [{ caption: '', link: '', file: { arrayBuffer: async () => good }, url: null, type: 'pdf', name: 'now.pdf' }] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('a PDF attached in this sitting is mergeable — it never needs the network',
    media.attachments.length === 1 && media.attachments[0].mergeable === true,
    media.attachments.map(a => [a.name, a.mergeable]));
}
{
  // No file, only a Drive link — and the harness has no network, which is exactly
  // the case the warning dialog exists for.
  TL.evidence = { b_inwardPhotos: [{ caption: 'earlier', link: 'https://drive.google.com/file/d/AAA/view', file: null, url: null, type: 'pdf', name: 'earlier.pdf' }] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('an attachment that cannot be read back is still LISTED, so it cannot vanish silently',
    media.attachments.length === 1 && media.attachments[0].name === 'earlier.pdf' &&
    media.attachments[0].bytes === null && media.attachments[0].mergeable === false,
    media.attachments);
}
{
  TL.evidence = { b_inwardPhotos: [
    { caption: '', link: '', file: { arrayBuffer: async () => new Uint8Array([1]) }, url: null, type: 'pdf', name: 'one.pdf' },
    { caption: '', link: 'https://drive.google.com/file/d/AAA/view', file: null, url: null, type: 'pdf', name: 'two.pdf' },
  ] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('and EVERY attached PDF is accounted for — none can quietly drop out',
    media.attachments.length === 2 && media.attachments.map(a => a.name).join() === 'one.pdf,two.pdf',
    media.attachments.map(a => a.name));
}
{
  // The stub DOM has no createImageBitmap, so the image path fails here — which is
  // the point: an image that cannot be normalised must not take the export down.
  TL.evidence = { b_inwardPhotos: [{ caption: 'photo', link: '', file: { arrayBuffer: async () => new Uint8Array([1]) }, url: null, type: 'image', name: 'p.jpg' }] };
  let media = null, threw = null;
  try { media = await TL.collectExportMedia('sec-b', SB); } catch (e) { threw = e.message; }
  r.ok('an image that cannot be normalised does not throw', threw === null, threw);
  r.ok('and it is not turned into an attachment either',
    !!media && media.attachments.length === 0 && media.images.size === 0,
    media && [media.attachments.length, media.images.size]);
}
{
  TL.evidence = {};
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('a section with no attachments resolves to nothing, not a crash',
    media.attachments.length === 0 && media.images.size === 0,
    [media.attachments.length, media.images.size]);
}
{
  TL.evidence = { zzz_nope: [{ caption: '', link: '', file: null, url: null, type: 'image', name: '' }] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('evidence filed under an unknown id is ignored, not swept in',
    media.attachments.length === 0 && media.images.size === 0);
}
{
  TL.evidence = { b_inwardPhotos: [{ caption: '', link: '', file: null, url: null, type: '', name: 'report.pdf' }] };
  const media = await TL.collectExportMedia('sec-b', SB);
  r.ok('an attachment with no explicit type is still recognised as a PDF by its name',
    media.attachments.length === 1, media.attachments.map(a => a.name));
}
r.ok('an unknown section resolves to nothing rather than throwing',
  (await TL.collectExportMedia('sec-z', SB)).attachments.length === 0);
TL.evidence = {};

// ── 10. Exporting is a READ, so it is never gated ─────────────────────────────
r.head('Download and Download-and-share are on every section, and no user is locked out of them');
const EXPORTABLE = ['b', 'c', 'd', 'e', 'f', 'g'];
const dlHits = indexSrc.match(/id="download-sec-[a-g]">[^<]*</g) || [];
const shHits = indexSrc.match(/id="share-sec-[a-g]">[^<]*</g) || [];
r.ok('every section has a Download button in the markup',
  EXPORTABLE.every(x => new RegExp('id="download-sec-' + x + '"').test(indexSrc)),
  EXPORTABLE.filter(x => !new RegExp('id="download-sec-' + x + '"').test(indexSrc)));
r.ok('and every section has a Download-and-share button',
  EXPORTABLE.every(x => new RegExp('id="share-sec-' + x + '"').test(indexSrc)),
  EXPORTABLE.filter(x => !new RegExp('id="share-sec-' + x + '"').test(indexSrc)));
r.ok('that is six of each, not a vacuous match', dlHits.length === 6 && shHits.length === 6,
  [dlHits.length, shHits.length]);
r.ok('both sit under the Save button, in an export row',
  EXPORTABLE.every(x => new RegExp('save-sec-' + x + '[\\s\\S]{0,200}?class="sec-export-row"').test(indexSrc)),
  EXPORTABLE.filter(x => !new RegExp('save-sec-' + x + '[\\s\\S]{0,200}?class="sec-export-row"').test(indexSrc)));
r.ok('the Download buttons say Download', dlHits.every(s => /Download</.test(s)), dlHits);
r.ok('the share buttons say Download and share',
  shHits.every(s => /Download and share</.test(s)), shHits);
r.ok('the old Investigation-only download is gone from both files',
  !/Download Investigation/.test(indexSrc) && !/downloadSectionDPartA/.test(appSrc));
r.ok('and the CSS for the row is in the stylesheet',
  /\.sec-export-row\s*\{/.test(viewsSrc), (viewsSrc.match(/\.sec-export-row[^}]*\}/) || [''])[0]);
r.ok('an Overview export does NOT exist — it is not a section',
  !/id="(download|share)-overview"/.test(indexSrc) && !/id="(download|share)-sec-a"/.test(indexSrc));

r.head('a view-only user can still export');
// The gating disables every control in the pane. Exporting is a read, so the export
// buttons carry a class the gating skips — and the wiring and the exemption name the
// SAME class, which is what stops one of them being renamed out from under the other.
r.ok('the wiring marks both buttons with the exemption class',
  /classList\.add\('sec-export-btn'\)/.test(appSrc));
r.ok('and the view-only disable skips exactly that class',
  /classList\.contains\('sec-export-btn'\)\)\s*return;/.test(appSrc));
r.ok('the wiring runs for every section, from SECTIONS rather than a hand-kept list',
  /Object\.keys\(SECTIONS\)\.forEach\(secId[\s\S]{0,400}?download-/.test(appSrc),
  (appSrc.match(/Object\.keys\(SECTIONS\)\.forEach\(secId[\s\S]{0,140}/) || [''])[0]);
r.ok('the Save button is NOT exempt — writing is still gated', (() => {
  const at = appSrc.indexOf("querySelectorAll('input, textarea, select, button')");
  if (at === -1) return false;
  const body = appSrc.slice(at, at + 900);
  const guard = body.split("classList.contains('sec-export-btn')")[0] || '';
  return /classList\.contains\('sec-export-btn'\)/.test(body) && !/save-/.test(guard);
})());

// ── 11. Nothing signs a section any more ──────────────────────────────────────
r.head('the digital-signature feature is gone from the source, not just the screen');
r.ok('no esignature field type survives anywhere',
  !Object.keys(T.SECTIONS).some(sid => T.SECTIONS[sid].fields.some(f => f.type === 'esignature')));
r.ok('no renderer, filler, stamp or state survives',
  !/\b(signESignature|renderESignatureHTML|refreshESignature|signSectionOnSave|esignatureState)\b/.test(appSrc));
r.ok('and no signed name or timestamp is written or read',
  !/signedBy|signedAt/.test(appSrc), (appSrc.match(/.*signed(By|At).*/) || [])[0]);
r.ok('the "Recorded automatically when this section is saved" line is gone',
  !/Recorded automatically/.test(appSrc) && !/Recorded automatically/.test(indexSrc));
r.ok('so is the e-signature CSS', !/\.esignature-/.test(viewsSrc));
r.ok('saving a section no longer stamps it', (() => {
  const from = appSrc.indexOf('async function saveSection(');
  return from > -1 && appSrc.slice(from, from + 4000).indexOf('signSectionOnSave(') === -1;
})());

// ── 12. The library has to actually SHIP ──────────────────────────────────────
r.head('the vendored library reaches a browser, not just the repo');
const vendorSrc = fs.existsSync(VENDOR) ? fs.readFileSync(VENDOR, 'utf8') : '';
r.ok('the file is present and is the UMD build that exposes PDFLib',
  vendorSrc.length > 0 && /PDFLib/.test(vendorSrc.slice(0, 600)), vendorSrc.slice(0, 120));
r.ok('it is the whole library, not a stub that happens to parse',
  vendorSrc.length > 400000, vendorSrc.length);
r.ok('its licence travels with it, as a repo artefact', fs.existsSync(LICENCE));
r.ok('index.html loads it BEFORE app.js', (() => {
  const v = indexSrc.indexOf('vendor/pdf-lib.min.js');
  const a = indexSrc.indexOf('src="app.js"');
  return v > -1 && a > -1 && v < a;
})());
r.ok('app.js stays a plain end-of-body script — no module system was introduced',
  /<script src="app\.js"><\/script>/.test(indexSrc) && !/type="module"/.test(indexSrc));
// Without each of these the export button is live but the library 404s.
r.ok('the service worker caches it in the shell',
  /SHELL = \[[\s\S]*?vendor\/pdf-lib\.min\.js[\s\S]*?\]/.test(swSrc));
// The intent is "a returning client is not left holding a shell from BEFORE the
// library existed" — v24 is the last version without it. Asserting the exact current
// number made every later, unrelated bump fail this suite for no reason, which is
// how a real regression gets lost in the noise.
r.ok('and the cache name is past the version that had no pdf-lib, or returning users ' +
     'keep a shell without it',
  (function () {
    const m = swSrc.match(/CACHE_NAME\s*=\s*'ipassbook-v(\d+)'/);
    return !!m && parseInt(m[1], 10) > 24;
  })(), (swSrc.match(/CACHE_NAME\s*=\s*'[^']*'/) || [''])[0]);
r.ok('the deploy tool copies it to the live site',
  /SERVED = \[[\s\S]*?'vendor\/pdf-lib\.min\.js'[\s\S]*?\]/.test(deploySrc));

r.head('and it is not shipped anywhere it should not be');
r.ok('the licence note is NOT served as a public asset',
  !/SERVED = \[[\s\S]*?pdf-lib\.LICENSE[\s\S]*?\]/.test(deploySrc));

r.finish();
