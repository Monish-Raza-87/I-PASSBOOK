// Smoke test for the customer portal — customer.html's signed-in half.
//
//   node tools/smoke-portal.mjs
//
// ── Why this suite exists, and what it is NOT ─────────────────────────────────
//
// tools/render-portal.mjs is the portal's real acceptance test: it boots the page in
// Chrome against a stub backend, drives both sign-in doors and the list, and measures the
// result. This file is the cheap half that runs everywhere, in a second, with no browser —
// and it guards the four properties that are INVISIBLE until they are wrong:
//
//   1. THIS PAGE MUST NOT SHARE THE APP'S STORAGE KEYS. The whole reason a customer can
//      safely sign in on a machine a staff member has used is the `ipbc_` prefix. Nothing
//      in a browser looks wrong when the two collide: the customer's page simply paints
//      the staff list. It is one keystroke to reintroduce and impossible to notice.
//   2. THE BACKEND URL IS DUPLICATED HERE. This page loads no shared script — deliberately,
//      so it can never be handed a staff session — which means app.js's CONFIG.GAS_URL is
//      copied. A moved deployment is then a portal that signs nobody in, and a copy that
//      drifts is silent. This pins the two copies to each other.
//   3. THE RETIRED-WORD FOLD IS DUPLICATED HERE, for the same reason. If the app retires a
//      stage word and this table does not follow, a customer is shown a word the desk no
//      longer uses — and only for some tickets, so it looks like data, not a bug.
//   4. `[hidden]` MUST ACTUALLY HIDE. `.btn` is inline-flex and `.ticket` is flex; both
//      outrank the UA's `[hidden] { display: none }`. Delete that one rule and a
//      signed-out visitor is shown the signed-in panel.
//
// Everything about the BACKEND half — the customer's permission map, the company filter,
// the sentinel narrowing, the invitation email — lives in tools/smoke-customer.mjs, which
// runs the real backend.gs. This file never loads backend.gs.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const portal = read('../customer.html');
const appJs  = read('../app.js');
const swJs   = read('../sw.js');
const deploy = read('./deploy-ghpages.mjs');
const backend = read('../backend.gs');

// The app, run for real, so the tables compared below are the app's OWN values rather
// than a second reading of its source. `loadApp` evaluating the whole file is itself part
// of the check: it proves app.js still runs top to bottom.
const T = loadApp('CONFIG, STATUS_LEGACY, IR_NUMBER_RE, SESSION_KEY, USER_KEY, IR_LIST_CACHE_KEY, ACCESS_CACHE_KEY, UNLOCK_KEY');

// The portal's copies, pulled out of customer.html's own text. Not `loadApp`: that file is
// a plain end-of-body script with no exports and a different global, and it is the file
// under test — reading its literal is the point.
const foldBody = portal.match(/const STATUS_LEGACY = \{([\s\S]*?)\n  \};/);
const irReBody = portal.match(/const IR_NUMBER_RE = (\/.*\/[a-z]*);/);
const gasUrlBody = portal.match(/GAS_URL: '([^']+)'/);

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the portal keeps its own storage — it can never paint a staff session');
// ═══════════════════════════════════════════════════════════════════════════════
const appKeys = [T.SESSION_KEY, T.USER_KEY, T.IR_LIST_CACHE_KEY, T.ACCESS_CACHE_KEY, T.UNLOCK_KEY];
r.ok('the app\'s five storage keys are the ipb_ ones this is asserted against',
  appKeys.every(k => /^ipb_/.test(k)) && appKeys.length === 5, appKeys);

// The portal's comments NAME the app's keys to explain why it does not use them, and that
// is worth keeping — so what is scanned is the code, not the prose. The strip only removes
// what this file's own style actually produces: HTML comments, block comments, and
// whole-line `//` comments. It deliberately does not try to find trailing ones, because a
// regex doing that would eat the `//` in every `https://` URL on the page.
const stripComments = s => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const portalCode = stripComments(portal);

// If the stripper ever ate the file, the check below would pass for a reason that has
// nothing to do with the portal. This is the assertion that keeps it honest.
r.ok('the stripper leaves the portal\'s own ipbc_ keys in the code it scans, so it is really looking at the code',
  /'ipbc_session'/.test(portalCode) && portalCode.length > portal.length * 0.6,
  { kept: portalCode.length, of: portal.length });

// Quoted-string form only: a bare mention in a comment is a warning, not a leak.
const namedInPortal = appKeys.filter(k => new RegExp(`['"\`]${k}['"\`]`).test(portalCode));
r.ok('customer.html names none of them', namedInPortal.length === 0, namedInPortal);

r.ok('...and it does use its own ipbc_ pair',
  /SESSION_KEY:\s*'ipbc_session'/.test(portal) && /USER_KEY:\s*'ipbc_user'/.test(portal));

// The one key it deliberately SHARES, because a display preference is not identity.
r.ok('...but the theme key is shared on purpose, so a customer gets the mode they chose',
  /localStorage\.getItem\('theme'\)/.test(portal), 'the pre-paint script');

// ═══════════════════════════════════════════════════════════════════════════════
r.head('one backend, two copies of its address');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('customer.html carries a backend URL at all', !!gasUrlBody, gasUrlBody && gasUrlBody[0]);
r.ok('...and it is byte-identical to app.js\'s CONFIG.GAS_URL',
  !!gasUrlBody && gasUrlBody[1] === T.CONFIG.GAS_URL,
  { portal: gasUrlBody && gasUrlBody[1], app: T.CONFIG.GAS_URL });
r.ok('...and it is the /exec deployment, never /dev',
  !!gasUrlBody && /\/exec$/.test(gasUrlBody[1]), gasUrlBody && gasUrlBody[1]);

// ═══════════════════════════════════════════════════════════════════════════════
r.head('a retired stage word never reaches a customer');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('the fold table was found in customer.html', !!foldBody);
let portalFold = null;
try { portalFold = new Function('return ({' + foldBody[1] + '});')(); } catch (e) { /* reported below */ }
r.ok('...and it parses', !!portalFold && typeof portalFold === 'object', portalFold);

const appFold = T.STATUS_LEGACY;
r.ok('the app has a fold table to compare against', !!appFold && Object.keys(appFold).length > 0,
  appFold && Object.keys(appFold));
r.ok('...and the portal folds exactly the same words to exactly the same stages',
  !!portalFold && JSON.stringify(Object.entries(portalFold).sort()) ===
                   JSON.stringify(Object.entries(appFold || {}).sort()),
  { portal: portalFold, app: appFold });

// The ten stages are the app's vocabulary. A customer must never see a fold target that is
// not one of them — that would mean this file invented a stage.
const STAGES = ['Open', 'Inward', 'Inspection', 'Investigation', 'Production', 'Quality Test',
                'PDI/Dispatch', 'Delivered', 'On Hold', 'Remote Support'];
r.ok('every word it folds TO is a stage the app actually has',
  !!portalFold && Object.values(portalFold).every(v => STAGES.includes(v)),
  Object.values(portalFold || {}).filter(v => !STAGES.includes(v)));

// A ticket the app holds no row for reads Open — the app's own derived rule, and the
// portal's fallback has to be the same string or the two disagree for exactly the tickets
// nobody has opened yet.
r.ok('a ticket with no stored stage reads Open, the same word the app derives',
  /stageOf\s*=\s*key[\s\S]{0,200}?\?\s*stageLabel\(row\.status\)\s*:\s*'Open'/.test(portal),
  'the stageOf() fallback in customer.html');

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the same rows are tickets — the IR number rule matches the app\'s');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('customer.html has an IR number rule', !!irReBody, irReBody && irReBody[0]);
const portalRe = irReBody ? new Function('return ' + irReBody[1])() : null;
r.ok('...and it accepts and rejects exactly what app.js\'s does',
  !!portalRe && portalRe.source === T.IR_NUMBER_RE.source && portalRe.flags === T.IR_NUMBER_RE.flags,
  { portal: portalRe && String(portalRe), app: String(T.IR_NUMBER_RE) });
// The sheet's IR Number column is free text a human types, so the rule has to be the loose
// one. A stricter rule here would silently hide a customer's own ticket from their list.
const SAMPLES = ['IR107', 'IR 107', 'ir-107', '  IR 483 ', 'Spare parts order', 'IR', 'IRX13', ''];
r.ok('...on the same handful of real spellings, including the ones that must be REJECTED',
  !!portalRe && SAMPLES.every(s => portalRe.test(s) === T.IR_NUMBER_RE.test(s)),
  SAMPLES.map(s => s + ' ' + (portalRe && portalRe.test(s)) + '/' + T.IR_NUMBER_RE.test(s)));

// The store is keyed the way the backend keys it, or a customer's ticket would look up an
// empty row and read Open forever.
r.ok('the row is keyed the way the backend\'s irKey() keys it — upper case, spaces stripped',
  /key:\s*ir\.toUpperCase\(\)\.replace\(\/\\s\+\/g,\s*''\)/.test(portal),
  'the key: line in rowsFromGrid()');

// ═══════════════════════════════════════════════════════════════════════════════
r.head('`hidden` hides, or a signed-out visitor sees the signed-in panel');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('the rule is `!important`, because .btn and .ticket both outrank the UA\'s own',
  /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(portal),
  (portal.match(/\[hidden\][^\n]*/) || [])[0]);
r.ok('...and the blocks it protects really do start hidden',
  /<section id="reports"[^>]*\shidden>/.test(portal)
  && /<div class="sheet" id="signin" hidden>/.test(portal)
  && /id="report-one" hidden>/.test(portal)
  && /id="access-member" hidden>/.test(portal),
  (portal.match(/<section id="reports"[^>]*>/) || [])[0]);

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the page is published, and never precached');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('deploy-ghpages.mjs serves it', /'customer\.html'/.test(deploy));
// A cached copy of somebody's tickets is the one thing the shell must never hand out.
r.ok('...and sw.js does NOT put it in the shell',
  !/customer\.html/.test(swJs), (swJs.match(/'[^']*customer[^']*'/) || [])[0]);

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the two forms the owner asked to reuse are the two that are wired');
// ═══════════════════════════════════════════════════════════════════════════════
const urls = [...portal.matchAll(/(SUPPORT_FORM_URL|FEEDBACK_FORM_URL)\s*=\s*'([^']+)'/g)]
  .map(m => [m[1], m[2]]);
r.ok('both form URLs are set, not left as placeholders',
  urls.length === 2 && urls.every(([, u]) => /^https:\/\/docs\.google\.com\/forms\//.test(u)), urls);
r.ok('the support form is wired to every report button on the page',
  (portal.match(/wire\('raise[^']*',\s*SUPPORT_FORM_URL\)/g) || []).length === 3,
  (portal.match(/wire\('raise[^']*',[^)]*\)/g) || []));
r.ok('...and the feedback form to the feedback button',
  /wire\('feedback',\s*FEEDBACK_FORM_URL\)/.test(portal));

// A staff session and a customer session are different keys, so the only thing that could
// still cross the two pages is a LINK. The old anchor into the app's customer sign-in is
// gone, and must not come back: the app has no customer sign-in, and that hash did nothing.
r.ok('nothing links into a customer-sign-in anchor that does not exist in the app',
  !/index\.html#customer-signin/.test(portal) && !/customer-signin/.test(appJs),
  (portal.match(/[^\n]*customer-signin[^\n]*/) || [])[0]);

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the invitation names a door that exists, and mails no credential');
// ═══════════════════════════════════════════════════════════════════════════════
const invite = backend.match(/function inviteCustomer\(params, authEmail\)[\s\S]*?\n\}/);
r.ok('inviteCustomer is in the backend', !!invite);
r.ok('...and it sends no code of any kind — a fresh account cannot redeem a login code',
  !!invite && !/issueAuthCode/.test(invite[0]) && !/\b\d{6}\b/.test(invite[0]),
  (invite && (invite[0].match(/\b\d{6}\b/) || [])[0]));
r.ok('...and it names the door it does open, by the words on the page',
  !!invite && /First time here\?/i.test(invite[0]) && /choose your password/i.test(invite[0]));
r.ok('...and that wording is on the page it names',
  /First time here\?/.test(portal));

r.finish();
