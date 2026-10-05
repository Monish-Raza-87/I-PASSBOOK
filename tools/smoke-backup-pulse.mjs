// Smoke test for the ONE public read of backup health, and the page that shows it.
//
//   node tools/smoke-backup-pulse.mjs
//
// Phase 1 made the backup real: a nightly export, a rotation, a health record in
// `_store/backup.json`. Every one of those is read by an ADMIN, through an action
// that needs a sign-in — which leaves the failure it was all built for unwatchable
// from outside. A backup that has quietly stopped running reports nothing anywhere,
// and the moment you most need to check is the moment sign-in may itself be what is
// broken. So there is exactly one unauthenticated read, `backupPulse`, and this file
// exists to hold it to two promises:
//
//   1. IT ANSWERS THE QUESTION. It runs the REAL function against a fake drive, and
//      checks the verdict in each of the four states a backup can be in: never run,
//      ran fine, ran and failed, and ran so long ago that a night was missed.
//   2. IT GIVES AWAY ALMOST NOTHING. Two fields. Not the stored error message (an
//      Apps Script Drive error quotes the thing it could not open, and that is a file
//      id), not the counts, not the sheet address, not the folder. Asserted against
//      the RESPONSE, not against a reading of the source — an earlier release in this
//      repo shipped a leak because a source-level check could not see it.
//
// The fake platform below is NARROW ON PURPOSE: it implements the four Drive members
// `readJson` actually touches and nothing else. A generic platform double is how a
// test comes to pass for a reason that has nothing to do with the app — this repo has
// already been burnt by a double that invented an API the real platform does not have.
// The one thing it must be faithful about is that a missing file is MISSING and not
// an empty one, because "no backup.json" and "a backup.json that says nothing" are
// different answers.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const url = p => new URL(p, import.meta.url);
const read = p => fs.readFileSync(url(p), 'utf8');

const backendGs = read('../backend.gs');
const backupHtml = read('../backup.html');
const deployJs   = read('../tools/deploy-ghpages.mjs');
const swJs       = read('../sw.js');

// ── A fake drive, four members deep ────────────────────────────────────────────
// `files` is the whole store: name -> text, as it would be on Drive. A FRESH context
// per case, because every store read is memoised per execution (`_storeMemo`) — reuse
// one context and the second case would be answered from the first case's cache, which
// is a test that passes by not running.
function runPulse(files) {
  const it = list => {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  };
  const file = (name, text) => ({
    getId: () => 'fake-' + name,
    getName: () => name,
    getBlob: () => ({ getDataAsString: () => text }),
  });

  const ctx = { console };
  // NO host intrinsics are handed in (no Date, JSON, Object, Array …). A context has
  // its own, and handing it this file's would shadow them, which is the realm bug
  // tools/harness.mjs documents at length. Only the members the platform lacks are
  // supplied.
  ctx.DriveApp = {
    getFolderById: () => ({
      getFoldersByName: name => it(name === ctx.CONFIG.STORE_FOLDER_NAME ? [{ getFilesByName: n => it(n in files ? [file(n, files[n])] : []) }] : []),
      getFilesByName: () => it([]),
    }),
  };
  createContext(ctx);
  runInContext(backendGs, ctx, { filename: 'backend.gs' });
  // Read the real folder name out of the loaded CONFIG rather than repeating it here,
  // so a rename in backend.gs cannot leave this double looking in the wrong drawer and
  // silently testing "file not found" in all four cases.
  ctx.CONFIG = runInContext('CONFIG', ctx);
  const out = runInContext('JSON.stringify(backupPulse())', ctx);
  return JSON.parse(out);
}

const HOUR = 3600 * 1000;
const DAY  = 24 * HOUR;
const record = (over) => JSON.stringify(Object.assign({
  lastRunAt: '03-Oct-2026 23:40:00', lastRunMs: Date.now() - 8 * HOUR,
  ok: true, stamp: '2026-10-03', folderId: 'FOLDERID', sheetUrl: 'https://docs.google.com/spreadsheets/d/SECRETID/edit',
  files: 41, written: 12, irs: 312, users: 22, tookMs: 41000, rotatedOut: 0,
  message: 'Backup complete.',
}, over));

// ── 1. The verdict, in all four states ────────────────────────────────────────
r.head('backupPulse answers the question, in every state a backup can be in');

const never = runPulse({});
r.ok('no record at all reads NOT ok, with no timestamp',
  never.ok === false && never.atMs === 0, JSON.stringify(never));

const good = runPulse({ 'backup.json': record({}) });
r.ok('a run from eight hours ago reads ok',
  good.ok === true && good.atMs > 0, JSON.stringify(good));

const failed = runPulse({ 'backup.json': record({ ok: false, message: 'No item with the given ID could be found.' }) });
r.ok('a run that RECORDED A FAILURE reads not-ok, even though it is recent',
  failed.ok === false && failed.atMs > 0, JSON.stringify(failed));

const stale = runPulse({ 'backup.json': record({ lastRunMs: Date.now() - 3 * DAY }) });
r.ok('a run from three days ago reads not-ok — a night was missed',
  stale.ok === false && stale.atMs > 0, JSON.stringify(stale));

// The boundary, both sides of it. CONFIG.BACKUP_STALE_MS is 36h; the point of pinning
// it is that a change to that number is a change to what the light MEANS, and it must
// be a deliberate one.
const CONFIG = runInContext('CONFIG', (() => { const c = { console }; c.DriveApp = { getFolderById: () => ({ getFoldersByName: () => ({ hasNext: () => false }) }) }; createContext(c); runInContext(backendGs, c, { filename: 'backend.gs' }); return c; })());
const inside  = runPulse({ 'backup.json': record({ lastRunMs: Date.now() - (CONFIG.BACKUP_STALE_MS - HOUR) }) });
const outside = runPulse({ 'backup.json': record({ lastRunMs: Date.now() - (CONFIG.BACKUP_STALE_MS + HOUR) }) });
r.ok('an hour inside the stale window is still ok', inside.ok === true);
r.ok('...and an hour past it is not', outside.ok === false);
r.ok('...and the window is longer than a day, so a merely LATE run is not called a MISSED one',
  CONFIG.BACKUP_STALE_MS > DAY, CONFIG.BACKUP_STALE_MS);
r.ok('...and it is bounded, so a backup that stopped a week ago cannot read green',
  CONFIG.BACKUP_STALE_MS < 7 * DAY, CONFIG.BACKUP_STALE_MS);

// ── 2. What it gives away ──────────────────────────────────────────────────────
r.head('and it gives away two fields, and nothing else');

// Against the RESPONSE, and against a record deliberately stuffed with everything a
// record holds. A key list, not a substring hunt: a substring hunt passes on a field
// that was renamed, which is the same leak with a new name.
const KEYS = Object.keys(good).sort().join(',');
r.ok('the response is exactly status, atMs and ok — no more',
  KEYS === 'atMs,ok,status', KEYS);

// The stored failure message is the one field that can quote a Drive file id, because
// Apps Script's own errors name what they could not open. It must never leave.
const leaky = runPulse({ 'backup.json': record({ ok: false, message: 'No item with the given ID FOLDERID could be found, or you do not have permission to access it.' }) });
const leakyText = JSON.stringify(leaky);
r.ok('a stored ERROR MESSAGE never reaches the response, whatever it says',
  !/No item with the given ID/.test(leakyText) && !/message/.test(leakyText), leakyText);
r.ok('...and no sheet address, folder id, stamp or count does either',
  !/SECRETID|FOLDERID|2026-10-03|docs\.google\.com/.test(leakyText) &&
  !/\b(files|written|irs|users|sheetUrl|folderId|stamp|rotatedOut|tookMs|lastRunAt)\b/.test(leakyText),
  leakyText);
r.ok('and the fields it DOES return are a number and a boolean, so nothing can be smuggled in a string',
  typeof good.atMs === 'number' && typeof good.ok === 'boolean' &&
  typeof never.atMs === 'number' && typeof never.ok === 'boolean');

// ── 3. It is reachable without a sign-in, and reachable ONLY that way ──────────
r.head('one route, GET, no parameter, and no authenticated twin');
const code = backendGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const getPreAuth = code.slice(code.indexOf('function doGet'), code.indexOf('var authed ='));
const getAuthed  = code.slice(code.indexOf('var authed ='), code.indexOf('function doPost'));
const postPreAuth = code.slice(code.indexOf('function doPost'), code.indexOf('function doPost') + 3000);
r.ok('it is routed in doGet\'s preAuth map, so it is answered before requireAuth',
  /backupPulse:\s*function \(\) \{ return backupPulse\(\); \}/.test(getPreAuth),
  (getPreAuth.match(/[^\n]*backupPulse[^\n]*/) || ['none'])[0]);
// The name appearing once in the pre-auth block is the routing AND the call; what must
// be absent is any appearance past `var authed =`, where it would need a session.
r.ok('...and never in the authed map, where it would need a sign-in to answer',
  !/backupPulse/.test(getAuthed), (getAuthed.match(/[^\n]*backupPulse[^\n]*/) || ['none'])[0]);
r.ok('...and not on POST at all — a public write is a different decision, and it was not made',
  !/backupPulse/.test(postPreAuth));
r.ok('the route reads NO request parameter',
  /backupPulse:  function \(\) \{ return backupPulse\(\); \}/.test(backendGs) ||
  /backupPulse:\s*function \(\) \{ return backupPulse\(\); \}/.test(backendGs),
  'the arrow takes no argument and passes none');
r.ok('...and the function itself never touches `e`',
  !/\be\.parameter\b/.test(code.slice(code.indexOf('function backupPulse'), code.indexOf('function backupPulse') + 900)));

// The admin action is still admin-only and still the one that carries the detail.
// Two reads of one record, and they must not converge: this is the difference between
// "how is the backup" and "what is in the backup".
r.ok('getBackupHealth is unchanged and still gated on isAdminEmail',
  /if \(!isAdminEmail\(email\)\) return \{ status: 'error', message: 'Admins only\.' \};/.test(code) &&
  /getBackupHealth: function \(\) \{ return getBackupHealth\(email\); \}/.test(backendGs));
r.ok('...and it is STILL the one allowed to return the counts and the sheet address',
  /sheetUrl: h\.sheetUrl/.test(code) && /files: h\.files/.test(code));

r.ok('no UrlFetchApp — this added no network call',
  !/UrlFetchApp/.test(code), (code.match(/[^\n]*UrlFetchApp[^\n]*/) || ['none']));

// ── 4. The page ────────────────────────────────────────────────────────────────
r.head('the page that shows it is served, and stays out of the app\'s shell');
r.ok('deploy serves backup.html', deployJs.includes(`'backup.html'`));
r.ok('...and it is NOT in sw.js\'s precache shell, which every install pays for',
  !/backup\.html/.test(swJs), (swJs.match(/[^\n]*backup[^\n]*/g) || []));

// Its own styles and no app code, so it cannot drift when the app's tokens change —
// and so it still renders when the app is the thing that is broken.
r.ok('it links no app stylesheet and loads no app script',
  !/<link[^>]+(tokens|palette|theme|base|components|views|desk)\.css/.test(backupHtml) &&
  !/<script[^>]+src=/.test(backupHtml),
  (backupHtml.match(/<script[^>]*>/g) || []).join(' '));
r.ok('...and it declares the phone viewport, or a phone lays it out at 980px',
  /name="viewport" content="width=device-width, initial-scale=1"/.test(backupHtml));
r.ok('...and it is not offered to search engines',
  /name="robots" content="noindex"/.test(backupHtml));

r.head('and the page cannot turn "I do not know" into "everything is fine"');
r.ok('it asks the public action by name',
  /\?action=backupPulse'/.test(backupHtml));
r.ok('...at the PUBLIC deployment, and the SAME one app.js publishes',
  // Read out of app.js rather than typed in twice: two copies of a 90-character URL
  // that must agree is a drift waiting to happen, and the interesting question is not
  // "is this string right" but "do the app and this page talk to the same backend".
  (() => {
    const published = (read('../app.js').match(/GAS_URL:\s*'([^']+)'/) || [])[1] || '(none)';
    return published !== '(none)' && backupHtml.includes(published);
  })());
// The whole reason the page exists. A green light on a page that could not reach the
// server is the exact mistake this phase was built to stop, so the catch branch has
// to exist AND has to be a non-green state that says so in words.
r.ok('a failed request goes to a NON-green state, and says it says nothing about the backup',
  /\.catch\(function \(\) \{[\s\S]{0,400}?'Cannot reach the server'/.test(backupHtml) &&
  /This says nothing about the backup\./.test(backupHtml));
// The timeout is not decoration. Apps Script goes cold after ~5 minutes idle and then
// takes 30-60s to answer the first request — 66.6s has been observed on THIS project.
// The first draft of this page waited 20 seconds and announced "cannot reach the
// server" on a backend that was merely waking up, which is the same lie as a green
// light on a dead one, pointed the other way. So the wait is pinned to a real cold
// start, and the wording for it is a wake-up rather than a failure.
const waitMs = Number((backupHtml.match(/WAKE_UP_MS = (\d+)/) || [])[1] || 0);
r.ok('a hang ends in its own state rather than leaving "Checking…" on the screen forever',
  /setTimeout\(function \(\) \{[\s\S]{0,200}?The server did not answer/.test(backupHtml));
r.ok('...and the wait is long enough for a REAL cold start, measured, not guessed',
  waitMs >= 60000, waitMs);
r.ok('...and it is not so long that a person sits there wondering',
  waitMs <= 120000, waitMs);
r.ok('...and that state tells them to try again rather than implying the backup is bad',
  /press Check again\./.test(backupHtml));
r.ok('...and so does an answer it does not understand',
  /d\.status !== 'ok'/.test(backupHtml) && /did not answer this check/.test(backupHtml));
// The state before the paste, and the one the owner will actually see first: a v5
// deployment has no backupPulse and answers status:"error". Rendered VERBATIM, that
// message is the one field on this endpoint that can quote an internal error, so the
// page must name its own words and never the server's.
r.ok('...and it never renders the server\'s own error text, only its own words',
  /most often because this page/.test(backupHtml) &&
  !/detail\.textContent = d\.message/.test(backupHtml) &&
  !/message/.test(backupHtml.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  (backupHtml.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .match(/[^\n]*(d\.message|\.message)[^\n]*/) || ['none'])[0]);
r.ok('every state it can reach is one the stylesheet actually draws',
  ['.is-ok', '.is-stop', '.is-warn'].every(c =>
    new RegExp('\\' + c + '\\s*\\.verdict\\s*\\{[^}]*color:').test(backupHtml)) &&
  /show\('ok'/.test(backupHtml) && /show\('stop'/.test(backupHtml) && /show\('warn'/.test(backupHtml),
  'a class with no rule is a state that renders as nothing');
// Colour alone is not a verdict. The state has to be a WORD on the screen, written
// into its own element by the same call that colours the card — otherwise the page is
// unreadable to anyone who cannot tell red from green, and this page's entire content
// is one verdict.
r.ok('the verdict is carried by a WORD in the markup, not by colour alone',
  /<span id="verdict">/.test(backupHtml) &&
  /verdict\.textContent = word;/.test(backupHtml) &&
  /card\.className = 'card is-' \+ kind;/.test(backupHtml) &&
  /\.is-stop \.verdict \{ color:/.test(backupHtml),
  'one call sets both, so the two can never disagree');
r.ok('it treats atMs 0 as "never run" rather than as a very old date',
  /if \(!atMs\) \{[\s\S]{0,200}?No backup has ever run/.test(backupHtml));

r.finish();
