// Smoke test for the customer portal — the signed-in half, in portal.js and portal.css.
//
// v112 moved the portal OUT of customer.html: the markup and the code live in portal.js,
// the styles in portal.css, and customer.html is a two-line loader over both. The suite
// reads portal.js and portal.css now, because that is where the portal is. customer.html
// and index.html are still read, but only to prove the two of them load the same files.
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

// The portal itself.
const portal    = read('../portal.js');
const portalCss = read('../portal.css');
// The two documents that MOUNT it: the standalone loader, and the app in customer mode.
const portalPage = read('../customer.html');
const appJs  = read('../app.js');
const swJs   = read('../sw.js');
const deploy = read('./deploy-ghpages.mjs');
const backend = read('../backend.gs');

// The app, run for real, so the tables compared below are the app's OWN values rather
// than a second reading of its source. `loadApp` evaluating the whole file is itself part
// of the check: it proves app.js still runs top to bottom.
const T = loadApp('CONFIG, STATUS_LEGACY, IR_NUMBER_RE, SESSION_KEY, USER_KEY, IR_LIST_CACHE_KEY, ACCESS_CACHE_KEY, UNLOCK_KEY');

// The portal's copies, pulled out of portal.js's own text. Not `loadApp`: that file is an
// IIFE with no exports, and it is the file under test — reading its literal is the point.
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
r.ok('portal.js names none of them', namedInPortal.length === 0, namedInPortal);

r.ok('...and it does use its own ipbc_ pair',
  /SESSION_KEY:\s*'ipbc_session'/.test(portal) && /USER_KEY:\s*'ipbc_user'/.test(portal));

// The one key it deliberately SHARES, because a display preference is not identity.
r.ok('...but the theme key is shared on purpose, so a customer gets the mode they chose',
  /localStorage\.getItem\('theme'\)/.test(portalPage), 'the pre-paint script');

// ── ONE PORTAL, TWO DOCUMENTS, ZERO COPIES (v112) ─────────────────────────────
// The owner, 2026-10-22: a customer signs in at the app's OWN address and lands in the
// portal there. The way that stays true is that neither document owns the portal: both
// point at these two files. A copy of the markup in either one is the drift this shape
// exists to prevent, so the loader is checked to be a loader and the app is checked to
// fetch the same two names.
r.ok('customer.html is a LOADER — no inline styles, no inline portal script',
  !/<style[\s>]/.test(portalPage) &&
  /<link rel="stylesheet" href="portal\.css">/.test(portalPage) &&
  /<script src="portal\.js"><\/script>/.test(portalPage) &&
  /CustomerPortal\.mount\(/.test(portalPage),
  'style tags: ' + (/<style[\s>]/.test(portalPage) ? 'present' : 'none'));
r.ok('...and it keeps the pre-paint theme script, because a loader still paints first',
  /dataset\.theme = 'dark'/.test(portalPage));
r.ok('...and the app customer mode fetches the same two files, not a page',
  /css\.href = 'portal\.css\?v=' \+ v/.test(appJs) &&
  /js\.src = 'portal\.js\?v=' \+ v/.test(appJs) &&
  /CustomerPortal\.mount\(root\)/.test(appJs));

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
  /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(portalCss),
  (portalCss.match(/\[hidden\][^\n]*/) || [])[0]);
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
r.ok('...and the two files it now needs are served with it',
  /'portal\.css'/.test(deploy) && /'portal\.js'/.test(deploy));
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
// Four now, not three: the portal's Report tile opens its own panel with its own button,
// and the hero, the support aside and the empty state each keep theirs. The property is
// still "every report button on the page is wired to the ONE support form" — a fifth
// button with no URL, or a second form URL, is what this catches.
r.ok('the support form is wired to every report button on the page',
  (portal.match(/wire\('raise[^']*',\s*SUPPORT_FORM_URL\)/g) || []).length === 4,
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
r.ok('...and it sends no code of any kind — the customer asks for one when they sign in',
  !!invite && !/issueAuthCode/.test(invite[0]) && !/\b\d{6}\b/.test(invite[0]),
  (invite && (invite[0].match(/\b\d{6}\b/) || [])[0]));
r.ok('...and it names the code door, not a password to choose',
  !!invite && /press Continue/i.test(invite[0]) && /sign-in code we email you/i.test(invite[0]) &&
  !/first time here|choose your (own )?password/i.test(invite[0]));
r.ok('...and the page it names has no set-password door either',
  !/First time here\?/.test(portal) && !/signin-firsttime/.test(portal) && !/newpass-field/.test(portal));

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the owner can configure the portal, and only on a real read');
// ═══════════════════════════════════════════════════════════════════════════════
// The two silent faults here are both about a FORM, not a view:
//   • The backend writes the CR and the library in ONE file write, so both saves carry
//     both halves. A form painted on a read that never arrived would therefore post
//     blanks over a real configuration, and the store would take them.
//   • The fleet box is filled from the store, so choosing a company is a READ. An edit
//     left in one company's box must not follow the select into the next one.
const indexHtml = read('../index.html');
r.ok('Setup gives the button somewhere to live', /id="setup-tools"/.test(indexHtml));
r.ok('the button is painted only for an admin', /isAdmin\(\)\s*\?\s*'<button[^']*id="setup-portal"/.test(appJs));
const setupAt = appJs.indexOf('function renderSetup()');
r.ok('...and it is painted BEFORE renderSetup\'s own empty-list guard, so an empty list cannot hide it',
  setupAt > 0 &&
  appJs.indexOf('id="setup-portal"', setupAt) < appJs.indexOf('if (!allIRs.length) {', setupAt),
  { setup: setupAt, button: appJs.indexOf('id="setup-portal"', setupAt),
    guard: appJs.indexOf('if (!allIRs.length) {', setupAt) });
r.ok('the form is gated on a successful read, with a way to try again',
  /if \(!portalAdmin\.loaded\)[\s\S]{0,400}portal-retry/.test(appJs));
r.ok('a save is refused while the read is missing or in flight',
  /if \(!portalAdmin\.loaded \|\| portalAdmin\.busy\) return;/.test(appJs));
r.ok('both shared saves carry the CR and the library, because one write covers both',
  (appJs.match(/adminPost\('savePortalConfig', \{ cr: JSON\.stringify\(cr\), library: JSON\.stringify\(library\) \}\)/g) || []).length === 1);
r.ok('the fleet save names its company, and needs one to be chosen',
  /adminPost\('savePortalConfig', \{ company: company, fleet: JSON\.stringify\(fleetRows\) \}\)/.test(appJs) &&
  /if \(!company\) \{ portalAdmin\.busy = false/.test(appJs));
r.ok('the typed values are read BEFORE the panel repaints — a repaint takes them with it',
  appJs.indexOf("const libBox  = document.getElementById('portal-library');") <
  appJs.indexOf('portalAdmin.busy = true;', appJs.indexOf('function portalSave(')),
  'the capture lines must sit above the busy/repaint');

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the code can be asked for again — three times, then a human');
// ═══════════════════════════════════════════════════════════════════════════════
// The owner, 2026-10-22: "Resend is available but not to spam, it can only be sent 3
// times. If more than that then needs to reach out Indrones CR."
//
// The number is checked AGAINST THE BACKEND'S OWN, because the two are the same rule
// seen from two sides: the backend refuses a fourth issue per email per hour, and this
// link stops offering a fourth. If they ever drift, the link promises a mail the server
// will not send — which looks exactly like a broken account.
const resent = portal.match(/const RESEND_MAX\s*=\s*(\d+)/);
const codeCap = backend.match(/var CODE_MAX_PER_HOUR\s*=\s*(\d+)/);
r.ok('the portal names its resend cap', !!resent, resent && resent[0]);
r.ok('...and it is the backend\'s own per-email budget, not a second opinion',
  !!resent && !!codeCap && Number(resent[1]) === Number(codeCap[1]),
  { portal: resent && resent[1], backend: codeCap && codeCap[1] });

r.ok('the link exists in the sheet and starts hidden',
  /id="resend-line" hidden/.test(portal) && /id="signin-resend"/.test(portal));
r.ok('it is wired in wirePortal, where a mounted sheet can actually reach it',
  /\$\('signin-resend'\)\.addEventListener\('click'/.test(portal));
// Step 1 already sends from the button in the middle of the sheet; a second send link
// there would be two controls for one action, one of which silently does nothing.
r.ok('...and it only appears once a code is outstanding',
  /const show = flow\.step === 2;/.test(portal) && /\$\('resend-line'\)\.hidden = !show;/.test(portal));
r.ok('...and it stops offering itself at the cap, in a sentence that says who to ask',
  /if \(flow\.resent >= RESEND_MAX\) \{[\s\S]{0,120}crLine\(\)/.test(portal) &&
  /This code has been sent three times/.test(portal));

// The CR person's address is Indrones operating data and this repository is published;
// it lives in the portal's configuration (_store/portal.json), never in a source file.
// The check is on crLine's OWN body, because the page legitimately prints the company's
// public contact details elsewhere — what must never be typed here is who to write to
// when the three codes are gone, since that is a named person.
const crBody = (portal.match(/function crLine\(\) \{([\s\S]*?)\n  \}/) || [])[1] || '';
r.ok('crLine reads the Customer Relations contact from the configuration',
  /PORTAL_DATA && PORTAL_DATA\.cr/.test(crBody), crBody.slice(0, 80));
r.ok('...and types no address or number of its own',
  crBody.length > 0 && !/@/.test(crBody) && !/\+?\d[\d ]{6,}/.test(crBody));

r.finish();
