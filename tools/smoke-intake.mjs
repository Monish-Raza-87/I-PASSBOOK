// Smoke test for the client-intake mapping and the 📋 Report view.
//
//   node tools/smoke-intake.mjs
//
// Stage 2's whole purpose is that support staff stop needing the Sheet, which
// only holds if the app surfaces what the Sheet holds. So the risky parts here
// are (a) that a column the Form writes is never silently dropped, and (b) that
// the map survives the Form's questions being reordered — it matches headers by
// substring, so a reordered row must still map field-for-field.
//
// See tools/harness.mjs for how app.js is loaded and reached into.

import { loadApp, makeReporter } from './harness.mjs';

const { T, byId } = loadApp(`
  mapSheetRows, buildIntakeMap, INTAKE_FIELDS, intakeValueHtml, toDisplayDateTime,
  toDisplayDate, toISODate, renderIntake,
  get lastSheetAudit() { return lastSheetAudit; },
  get currentIR() { return currentIR; }, set currentIR(v) { currentIR = v; },
`, { capture: true });

const { ok, head, finish } = makeReporter();

// ── The Form Responses header row, as backend.gs describes it ─────────────────
// Columns A–D, F–I, K–N and P–R are accounted for by backend.gs's
// IR_REPO_*_COL constants. E, J and O are NOT — they are the audit's reason to
// exist, so the fixture uses plausible form questions for them.
const HEADERS = [
  'Summary',                                       // A
  'IR Number',                                     // B
  'Timestamp',                                     // C
  'Issue Status',                                  // D
  'Your Role',                                     // E  ← unaccounted for
  'SPOC',                                          // F
  'What Support Is Required?',                     // G
  'Please Describe Your Problem',                  // H
  'Date of Incident',                              // I
  'Score',                                         // J  ← unaccounted for
  'Mention the Drone Serial No (S250XX)',          // K
  "Who's Reporting? (Name & Contact)",             // L
  'Incident Location and Weather',                 // M
  'Evidence: Attach Files From The Incident',      // N
  'Internal Notes',                                // O  ← unaccounted for
  'Email Address',                                 // P
  'Evidence: Attach Screenshot of UAV Forecast',   // Q
  'Where Do You Work?',                            // R
];

const ROW = [
  'https://docs.google.com/document/d/SUMMARY', 'IR409', '2025-09-28 14:02:03', 'In Production',
  'CRM', 'Monish Raza', 'Hardware Damage', 'Drone arm cracked during landing', '2025-09-25',
  '9', 'S25P014', 'SREENIVAS PAI 7828148298', 'Pune, 32C clear',
  'https://drive.google.com/file/d/N/view', 'chase the courier',
  'ops@agrikart.in', 'https://drive.google.com/file/d/Q/view', 'AgriKart Pvt Ltd',
];

const rowsOf = (headers, row) => [headers, row];
const one = (headers = HEADERS, row = ROW) => T.mapSheetRows(rowsOf(headers, row))[0];

head('every modelled column maps to a real column');
// A typo in a needle would silently drop that column from the app. This asserts
// the needle actually matches this header row, rather than trusting it does.
const { map } = T.buildIntakeMap(HEADERS);
const expected = {
  dateRaised: 2, incidentDate: 8, droneId: 10, companyName: 17, customerName: 11,
  contactEmail: 15, spoc: 5, issueType: 6, issueDesc: 7,
  incidentLocationWeather: 12, evidenceFormN: 13, evidenceFormQ: 16, summaryLink: 0,
};
Object.entries(expected).forEach(([field, idx]) => {
  ok(`${field} → column ${idx}`, map[field] === idx, map[field]);
});
ok('every INTAKE_FIELD is read or explicitly derived',
  T.INTAKE_FIELDS.every(f => f.needle || f.derive), T.INTAKE_FIELDS.map(f => f.field));

head('the record the rest of the app reads is unchanged');
const ir = one();
ok('irNumber', ir.irNumber === 'IR409', ir.irNumber);
ok('status from Col D', ir.status === 'In Production', ir.status);
ok('dateRaised is still display-formatted', ir.dateRaised === '28 September 2025', ir.dateRaised);
ok('dateRaisedISO is still ISO', ir.dateRaisedISO === '2025-09-28', ir.dateRaisedISO);
ok('incidentDate is still ISO', ir.incidentDate === '2025-09-25', ir.incidentDate);
ok('droneId', ir.droneId === 'S25P014', ir.droneId);
ok('companyName', ir.companyName === 'AgriKart Pvt Ltd', ir.companyName);
ok('issueType', ir.issueType === 'Hardware Damage', ir.issueType);
ok('issueDesc', ir.issueDesc === 'Drone arm cracked during landing', ir.issueDesc);
ok('spoc', ir.spoc === 'Monish Raza', ir.spoc);
ok('summaryLink', ir.summaryLink.endsWith('SUMMARY'), ir.summaryLink);
ok('incidentLocationWeather', ir.incidentLocationWeather === 'Pune, 32C clear', ir.incidentLocationWeather);
ok('no Priority column → empty, not undefined', ir.priority === '', ir.priority);

head("Col L splits into name + phone");
ok('customerName is the name only', ir.customerName === 'SREENIVAS PAI', ir.customerName);
ok('contactPhone is the phone only', ir.contactPhone === '7828148298', ir.contactPhone);

head('the raised TIME is kept (the ticket never showed it before)');
ok('intake keeps the raw Timestamp cell', ir.intake.dateRaised === '2025-09-28 14:02:03', ir.intake.dateRaised);
ok('toDisplayDateTime keeps the clock time',
  T.toDisplayDateTime('2025-09-28 14:02:03') === '28 September 2025, 14:02',
  T.toDisplayDateTime('2025-09-28 14:02:03'));
ok('intake.customerName is the split name', ir.intake.customerName === 'SREENIVAS PAI', ir.intake.customerName);
ok('intake.contactPhone is the split phone', ir.intake.contactPhone === '7828148298', ir.intake.contactPhone);

head('columns the app does not model are surfaced, not dropped');
ok('E/J/O land in extra', ir.extra.length === 3, ir.extra);
ok('extra keeps the Sheet header as the label',
  ir.extra.map(x => x.label).join(',') === 'Your Role,Score,Internal Notes',
  ir.extra.map(x => x.label));
ok('extra keeps the value', ir.extra.find(x => x.label === 'Score').value === '9');
ok('the audit names exactly those columns',
  T.lastSheetAudit.unmapped.join(',') === 'Your Role,Score,Internal Notes',
  T.lastSheetAudit.unmapped);
ok('mapped columns are NOT reported as unmapped',
  !T.lastSheetAudit.unmapped.includes('SPOC') && !T.lastSheetAudit.unmapped.includes('IR Number'),
  T.lastSheetAudit.unmapped);

head('a blank unknown column adds no noise');
const blankExtra = one(HEADERS, ROW.map((v, i) => (i === 14 ? '' : v)));
ok('blank "Internal Notes" is omitted', blankExtra.extra.length === 2, blankExtra.extra);
ok('but the column is still audit-reported as unmapped',
  T.lastSheetAudit.unmapped.includes('Internal Notes'), T.lastSheetAudit.unmapped);

head('a reordered Form does not scramble the map');
// The Form's questions can be reordered at any time. Both the header row and the
// values move together; every field must still land where it belongs.
const REV_H = HEADERS.slice().reverse();
const REV_R = ROW.slice().reverse();
const rev = one(REV_H, REV_R);
ok('irNumber survives a reversed header row', rev.irNumber === 'IR409', rev.irNumber);
ok('status survives', rev.status === 'In Production', rev.status);
ok('droneId survives', rev.droneId === 'S25P014', rev.droneId);
ok('name/phone split survives', rev.customerName === 'SREENIVAS PAI' && rev.contactPhone === '7828148298',
  [rev.customerName, rev.contactPhone]);
ok('the unmodelled columns still surface, by header', rev.extra.map(x => x.label).join(',') === 'Internal Notes,Score,Your Role',
  rev.extra.map(x => x.label));

head('a Priority column, when the Form grows one');
const PH = HEADERS.concat(['Priority']);
const PR = ROW.concat(['Urgent']);
const pri = one(PH, PR);
ok('priority flows straight through', pri.priority === 'Urgent', pri.priority);
ok('and is not duplicated into extra', !pri.extra.some(x => x.label === 'Priority'), pri.extra);
ok('and the audit is unchanged by it',
  T.lastSheetAudit.unmapped.join(',') === 'Your Role,Score,Internal Notes', T.lastSheetAudit.unmapped);

head('degenerate input');
ok('header row only → no records', T.mapSheetRows([HEADERS]).length === 0);
ok('empty input → no records, no throw', T.mapSheetRows([]).length === 0);
ok('null input → no records, no throw', T.mapSheetRows(null).length === 0);
const noIr = one(HEADERS, ROW.map((v, i) => (i === 1 ? '' : v)));
ok('a row with no IR Number is skipped', noIr === undefined, noIr);
ok('and the audit still ran', T.lastSheetAudit.headers.length === HEADERS.length);

head('intake value rendering');
ok('an empty value renders an em-dash', T.intakeValueHtml('text', '') === '<span class="intake-empty">—</span>');
ok('null renders an em-dash', T.intakeValueHtml('text', null).includes('intake-empty'));
ok('an email renders as mailto', T.intakeValueHtml('email', 'a@b.com').includes('mailto:a@b.com'));
const twoLinks = T.intakeValueHtml('links', 'https://a.test/1 https://b.test/2');
ok('two evidence URLs render as two links', (twoLinks.match(/<a /g) || []).length === 2, twoLinks);
ok('evidence links are labelled by position', twoLinks.includes('Evidence file 1') && twoLinks.includes('Evidence file 2'));
ok('a non-URL evidence token renders as plain text, not a broken link',
  T.intakeValueHtml('links', 'see folder').includes('intake-plain'));
ok('angle brackets in client text are escaped',
  T.intakeValueHtml('longtext', '<script>x</script>').includes('&lt;script&gt;'), T.intakeValueHtml('longtext', '<script>x</script>'));
ok('an unparseable timestamp falls back to raw, never NaN',
  !T.toDisplayDateTime('not a date').includes('NaN') && T.toDisplayDateTime('not a date') === 'not a date',
  T.toDisplayDateTime('not a date'));

// ── The rendered report ───────────────────────────────────────────────────────
// What staff actually see. renderIntake() is the deliverable, so it is asserted
// on the HTML it produces, not only on the data feeding it.
head('the rendered 📋 Report');
const html = () => byId.get('sec-intake-body').innerHTML;

T.currentIR = ir;
T.renderIntake();
const rendered = html();

ok('every intake label is rendered',
  T.INTAKE_FIELDS.filter(f => f.field !== 'summaryLink').every(f => rendered.includes(f.label)),
  T.INTAKE_FIELDS.filter(f => f.field !== 'summaryLink' && !rendered.includes(f.label)).map(f => f.label));
ok('the raised time is shown', rendered.includes('28 September 2025, 14:02'), rendered.slice(0, 200));
ok('the email is a mailto link', rendered.includes('mailto:ops@agrikart.in'));
ok('the SPOC is shown', rendered.includes('Monish Raza'));
ok('evidence renders as links', rendered.includes('drive.google.com/file/d/N/view'));
ok('the summary link is the header link, not a row',
  rendered.includes('intake-open') && rendered.includes('Open original report ↗'));
ok('the report is not listed as its own row', !rendered.includes('>Summary document<'));
ok('the read-only note is shown', rendered.includes('The app never edits these values'));
ok('unmodelled columns get their own block', rendered.includes('Other columns from the Sheet'));
ok('and their labels are shown',
  ['Your Role', 'Score', 'Internal Notes'].every(l => rendered.includes(l)),
  rendered.match(/>Your Role<|>Score<|>Internal Notes</g));
ok('a Sheet-sourced ticket shows no "no Sheet row" note', !rendered.includes('No Sheet row'));

head('escaping: the client types into this view');
// The description, the company name and the location all come straight from the
// customer. Nothing here may be interpreted as markup.
const nasty = 'IR666 <img src=x onerror=alert(1)> & <script>alert(2)</script>';
T.currentIR = { irNumber: 'IR666', intake: { issueDesc: nasty, companyName: nasty, summaryLink: 'https://x.test/ok' } };
T.renderIntake();
const evil = html();
ok('the raw <script> never reaches the DOM', !evil.includes('<script>'), evil.match(/<script>/));
ok('the raw <img> never reaches the DOM', !evil.includes('<img'), evil.match(/<img/));
ok('no html tag of any kind is created from it', !/<(img|script|iframe)\b/i.test(evil), evil.match(/<(img|script|iframe)\b/gi));
ok('the payload lands as inert escaped text',
  evil.includes('&lt;img src=x onerror=alert(1)&gt;'), evil.slice(0, 300));
ok('it is rendered as escaped text', evil.includes('&lt;script&gt;'));
ok('an ampersand is escaped once, not double-escaped', evil.includes('&amp;') && !evil.includes('&amp;amp;'));

head('a ticket with no Sheet row (legacy / demo)');
T.currentIR = {
  irNumber: 'IR310', droneId: 'S25P001', customerName: 'Legacy Co', issueType: 'Battery Issue',
  status: 'Closed', dateRaised: '10 August 2025', contactEmail: 'a@b.com',
};
T.renderIntake();
const legacy = html();
ok('it says so instead of showing blanks', legacy.includes('No Sheet row for this ticket'));
ok('but still shows what the record does hold',
  legacy.includes('Legacy Co') && legacy.includes('Battery Issue'), legacy);
ok('no undefined or NaN leaks into the view', !/undefined|NaN/.test(legacy));
ok('no original-report link when there is none', !legacy.includes('Open original report'));

head('no ticket open');
T.currentIR = null;
T.renderIntake();
ok('renders a note, not a throw', html().includes('No ticket selected'), html());

finish();
