// The "a newer build is deployed" notice, and the version reporting that makes it
// safe to stop chasing people.
//
// Two things are being protected here, and they are different in kind:
//
//  1. The SW-side fix, which is what makes the CHECK able to see the network at
//     all. It is asserted as source, because the failure it prevents is a race
//     with the browser's own HTTP cache — not something a stubbed fetch can
//     reproduce. The one that matters most is the self-script exclusion: without
//     it the probe is answered from the worker's own cache, which means it is
//     right exactly once and then lies for the rest of that cache's life.
//
//  2. The banner and the tap, which ARE behaviour and are driven for real through
//     the harness — including the two ways this feature could hurt someone:
//     reloading a page nobody asked to reload, and reloading away an in-flight
//     save.
import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// ══════════════════════════════════════════════════════════════════════════════
r.head('the check can reach the network — the half that lives in sw.js');

// The probe is a same-origin, non-navigation request: exactly the shape the
// stale-while-revalidate branch serves out of cache. The Cache API ignores a
// request's `cache:` mode, so `cache: 'no-store'` on the probe cannot save it —
// the worker has to decline to intercept its own script.
r.ok('the worker never intercepts its own script',
  /isOwnScript\(url\)\)\s*return;/.test(SW) &&
  /const isOwnScript = url => url\.split\('\?'\)\[0\] === self\.location\.href\.split\('\?'\)\[0\]/.test(SW),
  (SW.match(/[^\n]*isOwnScript[^\n]*/g) || []).join(' | '));
r.ok('...and that guard sits BEFORE the cache lookup it would otherwise poison',
  SW.indexOf('if (isOwnScript(url)) return;') < SW.indexOf('caches.open(CACHE_NAME).then(cache =>'),
  SW.indexOf('if (isOwnScript(url)) return;') + ' vs ' + SW.indexOf('caches.open(CACHE_NAME).then(cache =>'));

// A brand new CACHE_NAME is only worth anything if the bodies inside it are new
// too. Plain `cache.addAll(SHELL)` fetches through the HTTP cache, so gh-pages'
// ~10-minute max-age can fill v55's cache with v54's app.js — the version number
// moves and the code does not.
r.ok('a new cache is filled with bodies fetched past the HTTP cache',
  /cache\.addAll\(SHELL\.map\(u => new Request\(u, \{ cache: 'reload' \}\)\)\)/.test(SW),
  (SW.match(/[^\n]*addAll[^\n]*/) || [''])[0]);
// ...but SHELL itself stays an array of plain strings: five other suites regex
// that literal (`smoke-desk`, `smoke-palette`, `smoke-polish`, `smoke-export`,
// `smoke-shell`), so wrapping each entry in a Request at the call site is what
// keeps the freshness fix from being a five-suite change.
r.ok('...and SHELL is left as plain strings, so every other suite can still read it',
  /const SHELL = \[\s*\n\s*'\.\/',/.test(SW) &&
  !/new Request/.test(SW.slice(SW.indexOf('const SHELL'), SW.indexOf('const isBackend'))),
  SW.slice(SW.indexOf('const SHELL'), SW.indexOf('const isBackend')).slice(0, 80));

// A navigation must revalidate rather than trust a ten-minute cached document.
// 'no-cache' and not 'no-store': it is still a conditional request, so a 304
// reuses the stored body and the HTTP entry the offline fallback needs survives.
r.ok('navigations revalidate instead of trusting the HTTP cache',
  /fetch\(req, \{ cache: 'no-cache' \}\)/.test(SW), (SW.match(/[^\n]*no-cache[^\n]*/) || [''])[0]);
r.ok('...and the offline fallback is untouched',
  /\.catch\(\(\) => caches\.match\('\.\/index\.html'\)\.then\(r => r \|\| caches\.match\('\.\/'\)\)\)/.test(SW));

// skipWaiting is the reason a plain REFRESH delivers a new build — which is the
// owner's actual habit, and the reason the classic waiting-worker pattern would
// have reproduced his complaint instead of fixing it.
r.ok('skipWaiting and clients.claim are kept, so a plain refresh moves a device forward',
  /self\.skipWaiting\(\)/.test(SW) && /self\.clients\.claim\(\)/.test(SW));

// ══════════════════════════════════════════════════════════════════════════════
r.head('the notice has somewhere to appear, on both screens');

for (const id of ['update-banner-ws', 'update-banner-auth']) {
  r.ok(`index.html carries #${id}`, HTML.includes(`id="${id}"`), id);
  // Both slots are captured at parse time as `const x = document.getElementById(..)`,
  // which is the shape smoke-shell.mjs derives its required ids from — so a slot
  // deleted from index.html fails the shell suite too, not just this one.
  r.ok(`app.js binds #${id} at parse time`, APP.includes(`document.getElementById('${id}')`), id);
  r.ok(`#${id} starts hidden`, new RegExp(`id="${id}" style="display:none"`).test(HTML), id);
}
// A device stuck at sign-in never reaches #workspace, so a single slot would
// leave exactly the people who need this most with no way to see it.
r.ok('one slot is inside the app shell and one inside the sign-in card',
  /<div id="workspace">[\s\S]*update-banner-ws[\s\S]*<\/header>/.test(HTML) === false &&
  HTML.indexOf('id="update-banner-ws"') > HTML.indexOf('</header>') &&
  HTML.indexOf('id="update-banner-auth"') > HTML.indexOf('id="auth-container"') &&
  HTML.indexOf('id="update-banner-auth"') < HTML.indexOf('class="auth-head"'),
  { ws: HTML.indexOf('id="update-banner-ws"'), auth: HTML.indexOf('id="update-banner-auth"') });
r.ok('registration asks for updateViaCache none, and says honestly what it is for',
  /register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)/.test(HTML) &&
  /NOT what makes updates land/.test(HTML));

// ══════════════════════════════════════════════════════════════════════════════
// The stub is deliberately only as capable as the real API — a fake that invents
// a member would make this suite green while the live browser threw. Every member
// below exists on the platform (`controller` is a worker OR null, never a
// boolean; `getRegistration()` resolves `undefined` when there is none, which is
// a distinction the app branches on).
function makeSw(opts) {
  const o = opts || {};
  const containerListeners = {};
  const worker = (state) => {
    const ls = {};
    return {
      scriptURL: 'http://127.0.0.1:3000/sw.js',
      state: state || 'installing',
      postMessage() {},
      addEventListener(t, fn) { (ls[t] = ls[t] || []).push(fn); },
      removeEventListener() {},
      _fire(t) { (ls[t] || []).forEach(fn => fn({})); },
    };
  };
  const reg = {
    installing: o.installing || null,
    waiting: o.waiting || null,
    active: null,
    scope: 'http://127.0.0.1:3000/',
    updateViaCache: 'none',
    update() { reg._updates++; return Promise.resolve(); },
    unregister() { return Promise.resolve(true); },
    _updates: 0,
    addEventListener(t, fn) { (containerListeners['reg:' + t] = containerListeners['reg:' + t] || []).push(fn); },
    removeEventListener() {},
  };
  const container = {
    controller: o.controller === undefined ? worker('activated') : o.controller,
    ready: Promise.resolve(reg),
    register() { return Promise.resolve(reg); },
    getRegistration() { return Promise.resolve(o.none ? undefined : reg); },
    addEventListener(t, fn) { (containerListeners[t] = containerListeners[t] || []).push(fn); },
    removeEventListener() {},
    _fire(t) { (containerListeners[t] || []).forEach(fn => fn({})); },
  };
  return { container, reg, worker };
}

function makeFetch(body, log) {
  return function (url, init) {
    log.calls.push({ url: String(url), init: init || {} });
    const b = typeof body === 'function' ? body() : body;
    if (b === null) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(b) });
  };
}

// A banner that was never painted has no `innerHTML` and no `style.display` at
// all (the harness's element stub only has what the app has touched), so the
// negative assertions read through these rather than inventing an empty string.
const shown = (byId, id) => !!byId.get(id) && byId.get(id).style.display === 'flex';
const paint = (byId, id) => (byId.get(id) && byId.get(id).innerHTML) || '';

const SW_BODY = (v) => `// I-PASSBOOK service worker.\nconst CACHE_NAME = 'ipassbook-${v}';\nconst SHELL = [];\n`;
const NAV = `
  APP_VERSION, versionNumber, checkForUpdate, paintUpdateBanner, dismissUpdateBanner,
  applyUpdate, startUpdateWatch, waitForInstallToSettle,
  get _updateTarget() { return _updateTarget; },
  get _updateDismissedFor() { return _updateDismissedFor; },
  get _updateTapped() { return _updateTapped; },
  get _savesInFlight() { return _savesInFlight; },
`;
let reloads = 0;
const LOCATION = {
  hash: '', search: '', hostname: '127.0.0.1', protocol: 'http:',
  href: 'http://127.0.0.1:3000/', reload() { reloads++; },
};

// `navigator` is REPLACED by globals, not merged, so every member the app touches
// has to be here — userAgent feeds deviceLabel(), and dropping it would break an
// unrelated path while looking like this feature's fault.
function boot(sw, fetchLog, opts) {
  return loadApp(NAV, Object.assign({
    capture: true,
    fetch: makeFetch(opts && opts.body, fetchLog),
    globals: {
      navigator: { userAgent: 'node', onLine: true, serviceWorker: sw ? sw.container : undefined },
      location: LOCATION,
      confirm: opts && opts.confirm ? opts.confirm : () => true,
    },
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('the probe reads the DEPLOYED version and compares it');

reloads = 0;
{
  const log = { calls: [] };
  const sw = makeSw({});
  const { T, byId } = boot(sw, log, { body: SW_BODY('v99') });
  const found = await T.checkForUpdate(true);
  r.ok('a higher number in the served sw.js raises the notice', found === true && T._updateTarget === 'v99', T._updateTarget);
  const ws = byId.get('update-banner-ws');
  const auth = byId.get('update-banner-auth');
  r.ok('both slots are filled by ONE writer', ws.innerHTML.length > 0 && ws.innerHTML === auth.innerHTML);
  r.ok('the notice names the version it is offering', ws.innerHTML.includes('v99'), ws.innerHTML.slice(0, 120));
  r.ok('...and says the app will restart, because it will', /will restart/.test(ws.innerHTML));
  r.ok('the tap is the only thing offered — no automatic anything',
    /onclick="applyUpdate\(\)"/.test(ws.innerHTML) && /onclick="dismissUpdateBanner\(\)"/.test(ws.innerHTML));
  r.ok('the slots are made visible', ws.style.display === 'flex' && auth.style.display === 'flex', ws.style.display);
  r.ok('the probe asked the network, not the HTTP cache',
    log.calls.length === 1 && log.calls[0].init.cache === 'no-store' && /sw\.js/.test(log.calls[0].url),
    log.calls[0] && log.calls[0].init);
  r.ok('finding a newer build also installs it, so the tap is a reload and not a wait',
    sw.reg._updates === 1, sw.reg._updates);
}

{
  // THE trap. sw.js's SWR branch would answer this with the cached copy it wrote
  // on the previous probe, so a device would be told about v99 once and then
  // never again. The exclusion in sw.js is the fix; this pins the app's half —
  // that an identical number is not treated as news.
  const log = { calls: [] };
  const { T, byId } = boot(makeSw({}), log, { body: SW_BODY('v55') });
  const found = await T.checkForUpdate(true);
  r.ok('the version the device is ALREADY running is not an update',
    found === false && T._updateTarget === null, T._updateTarget);
  r.ok('...and nothing is painted for it',
    !shown(byId, 'update-banner-ws') && !shown(byId, 'update-banner-auth') &&
    paint(byId, 'update-banner-ws') === '', paint(byId, 'update-banner-ws'));
}

{
  // gh-pages publishes every file in one commit, but a CDN edge can serve a mixed
  // set for a short window. On `!==` this device would be told to "update" DOWN.
  const log = { calls: [] };
  const { T } = boot(makeSw({}), log, { body: SW_BODY('v40') });
  r.ok('an OLDER number is not an update either — strictly newer, never merely different',
    (await T.checkForUpdate(true)) === false && T._updateTarget === null, T._updateTarget);
}

{
  const log = { calls: [] };
  const { T, byId } = boot(makeSw({}), log, { body: null });
  let threw = false;
  try { r.okOrThrew = await T.checkForUpdate(true); } catch (e) { threw = true; }
  r.ok('an unreachable probe is silent: no banner, no throw, no console noise',
    !threw && !shown(byId, 'update-banner-ws') && !shown(byId, 'update-banner-auth'));
}

{
  const log = { calls: [] };
  const { T } = boot(makeSw({}), log, { body: SW_BODY('v99') });
  await T.checkForUpdate(true);
  await T.checkForUpdate();
  await T.checkForUpdate();
  r.ok('the probe is throttled, so a phone resuming does not hammer the network',
    log.calls.length === 1, log.calls.length);
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('applying it is a tap, and only a tap');

reloads = 0;
{
  const log = { calls: [] };
  const { T } = boot(makeSw({}), log, { body: SW_BODY('v99') });
  await T.checkForUpdate(true);
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  r.ok('the tap reloads the app', reloads === 1, reloads);
}

reloads = 0;
{
  // The first install of a worker happens with no controller at all, and with
  // skipWaiting() the claim (and so controllerchange) lands immediately — long
  // before anyone has asked for anything. Reloading on that would reload a page
  // nobody clicked, and would break the intro timing smoke-boot.mjs pins.
  const sw = makeSw({ controller: null });
  const { T } = boot(sw, { calls: [] }, { body: SW_BODY('v55') });
  sw.container._fire('controllerchange');
  await new Promise(res => setTimeout(res, 0));
  r.ok('a worker taking over on its own does NOT reload the page',
    reloads === 0 && T._updateTapped === false, reloads);
}

reloads = 0;
{
  // ...but if the handover lands just after the settle deadline, the reload is
  // still owed, so the same event is a belt once the tap HAS happened.
  const sw = makeSw({});
  const { T } = boot(sw, { calls: [] }, { body: SW_BODY('v99') });
  await T.checkForUpdate(true);
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  const before = reloads;
  sw.container._fire('controllerchange');
  r.ok('...and it cannot double-reload once the tap has been honoured',
    reloads === before && reloads === 1, { before, after: reloads });
}

reloads = 0;
{
  // A reload issued while a worker is still installing is served by the worker
  // being REPLACED — it lands back on the version being left behind and the
  // notice returns, which reads as a broken button.
  const sw = makeSw({});
  const installing = sw.worker('installing');
  sw.reg.installing = installing;
  const { T } = boot(sw, { calls: [] }, { body: SW_BODY('v99') });
  await T.checkForUpdate(true);
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  r.ok('a tap does not reload while a new worker is still installing', reloads === 0, reloads);
  sw.reg.installing = null;
  installing._fire('statechange');
  await new Promise(res => setTimeout(res, 0));
  r.ok('...and reloads the moment the handover settles', reloads === 1, reloads);
}

reloads = 0;
{
  const { T } = boot(makeSw({}), { calls: [] }, { body: SW_BODY('v55') });
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  r.ok('with no registration at all the tap still reloads rather than doing nothing',
    reloads === 1, reloads);
}

reloads = 0;
{
  // The guards. `confirm` is the only thing that can say no, and saying no has to
  // mean the reload does not happen — otherwise the prompt is decoration.
  const { T, byId } = boot(makeSw({}), { calls: [] }, { body: SW_BODY('v99'), confirm: () => false });
  await T.checkForUpdate(true);
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  r.ok('declining the prompt cancels the update', reloads === 0 && T._updateTapped === false, reloads);
  r.ok('...and the notice stays up, because nothing has happened yet',
    byId.get('update-banner-ws').style.display === 'flex');
}

reloads = 0;
{
  // A save in flight is not something a restart prompt may take away, and there is
  // no "restore" for a POST that was cut off mid-flight.
  const { T, byId } = boot(makeSw({}), { calls: [] }, { body: SW_BODY('v99') });
  await T.checkForUpdate(true);
  T._savesInFlight.add('sec-a');
  T.applyUpdate();
  await new Promise(res => setTimeout(res, 0));
  r.ok('a save in flight blocks the reload outright, with no prompt to click through',
    reloads === 0 && T._updateTapped === false, reloads);
  r.ok('...and says why, rather than appearing to do nothing',
    byId.get('toast-text').textContent.includes('Still saving'), byId.get('toast-text').textContent);
  T._savesInFlight.delete('sec-a');
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('dismissing lasts for the visit, and a NEWER version still speaks up');

{
  const log = { calls: [] };
  let served = 'v99';
  const { T, byId } = boot(makeSw({}), log, { body: () => SW_BODY(served) });
  await T.checkForUpdate(true);
  T.dismissUpdateBanner();
  r.ok('the ✕ clears both slots', paint(byId, 'update-banner-ws') === '' &&
    paint(byId, 'update-banner-auth') === '' && !shown(byId, 'update-banner-auth'));
  r.ok('...and remembers WHICH version was dismissed', T._updateDismissedFor === 'v99', T._updateDismissedFor);
  // localStorage, not sessionStorage: a stored dismissal would keep suppressing a
  // real notice if the ✕ happened to be tapped during a CDN blip.
  r.ok('the dismissal is not written to storage', !/ipb_update|update_dismissed/i.test(APP),
    (APP.match(/[^\n]*dismissed[^\n]*/i) || [''])[0].slice(0, 100));
  // ...but it is a dismissal of THAT version only, and a deploy is exactly what
  // happens next — so the next probe must speak up again.
  served = 'v100';
  await T.checkForUpdate(true);
  r.ok('a version NEWER than the one dismissed raises the notice again',
    T._updateTarget === 'v100' && shown(byId, 'update-banner-ws') &&
    paint(byId, 'update-banner-ws').includes('v100'), paint(byId, 'update-banner-ws').slice(0, 120));
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('the watch starts on every boot path, and reads its own version right');

{
  // The three early returns out of the load handler are an already-signed-in
  // device, a Google return and the brief-splash device — the ones that must still
  // be told. Starting the watch after any of them would exempt exactly the people
  // who use the app most.
  const loadAt = APP.indexOf("window.addEventListener('load'");
  const watchAt = APP.indexOf('startUpdateWatch();');
  const firstReturn = APP.indexOf('dismissSplash(true); return;');
  r.ok('the watch is started before EVERY early return in the load handler',
    watchAt > loadAt && watchAt < firstReturn, { watchAt, firstReturn });
  r.ok('...and once, not once per path', (APP.match(/^\s*startUpdateWatch\(\);/gm) || []).length === 1);
}

{
  const { T } = boot(null, { calls: [] }, { body: SW_BODY('v55') });
  r.ok('the version parser reads the shipped shape', T.versionNumber('v55') === 55, T.versionNumber('v55'));
  r.ok('...and refuses anything that is not v<digits>, so junk is never "newer"',
    T.versionNumber('v9x') === null && T.versionNumber('') === null &&
    T.versionNumber(null) === null && T.versionNumber('55') === null,
    [T.versionNumber('v9x'), T.versionNumber(''), T.versionNumber('55')]);
  r.ok('APP_VERSION is the v<digits> shape the parser and the probe both assume',
    /^v\d+$/.test(T.APP_VERSION), T.APP_VERSION);

  // The probe only means anything because these two numbers are pinned together:
  // APP_VERSION is what the page RUNS, CACHE_NAME is what is SERVED, and the
  // comparison between them is the whole detection mechanism. smoke-shell pins the
  // equality; this says why that pin cannot be quietly relaxed.
  const cache = (SW.match(/^const CACHE_NAME = 'ipassbook-([^']+)';/m) || [])[1];
  r.ok('APP_VERSION equals the CACHE_NAME the probe parses — the premise of the whole check',
    cache === T.APP_VERSION, { app: T.APP_VERSION, cache });

  r.ok('no test double invented a member: the app guards on the real ones',
    /navigator\.serviceWorker && navigator\.serviceWorker\.getRegistration/.test(APP) &&
    /typeof navigator\.serviceWorker\.addEventListener === 'function'/.test(APP));
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('the admin can SEE who is behind, without asking anyone');

const VNAV = NAV + `
  renderVersionsTab,
  get accessCache() { return accessCache; },
`;
{
  const { T, byId } = loadApp(VNAV, { capture: true, fetch: makeFetch(SW_BODY('v55'), { calls: [] }) });
  T.accessCache.users = [
    { email: 'zoe@indrones.com', name: 'Zoe', appVersion: 'v55', lastLoginAt: '01-Oct-2026 09:00' },
    { email: 'abe@indrones.com', name: 'Abe', appVersion: 'v54', lastLoginAt: '30-Sep-2026 18:00' },
    { email: 'cal@indrones.com', name: '', appVersion: undefined, lastLoginAt: '' },
  ];
  T.renderVersionsTab();
  const html = byId.get('access-panels').innerHTML;

  // Ordered by build, newest first, with the unknown bucket LAST — the eye should
  // land on the version most people are on, not on the bucket label.
  const order = ['v55', 'v54', 'not reported'].map(v => html.indexOf('>' + v + ' <'));
  r.ok('the list groups by build, newest first, "not reported" last',
    order.every(i => i > -1) && order[0] < order[1] && order[1] < order[2], order);
  r.ok('every person appears under their build',
    html.includes('zoe@indrones.com') && html.includes('abe@indrones.com') && html.includes('cal@indrones.com'));
  r.ok('every group carries its count', (html.match(/acc-badge/g) || []).length >= 3,
    (html.match(/acc-badge[^"]*/g) || []));
  // "behind" is against the ADMIN's own build, so someone ahead of the admin is not
  // flagged — and someone on an unknown build is never flagged either, because
  // "we do not know" is not "they are behind".
  r.ok('an older build is marked behind, and the unknown bucket is not',
    /v54[\s\S]{0,200}?behind/.test(html) && !/not reported[\s\S]{0,200}?behind/.test(html),
    (html.match(/[^\n]*behind[^\n]*/g) || []).length);
  r.ok('the header names the version the admin is running, so the comparison is visible',
    html.includes('v55') && /This app is/.test(html));
  r.ok('a person who has never signed in reads "never" rather than a blank',
    html.includes('last signed in never'), (html.match(/last signed in [^<]*/g) || []));
  // The roster can come from a localStorage cache written by an OLDER build, so the
  // stored value is not trustworthy even though the backend validates it on write.
  T.accessCache.users = [{ email: 'x@indrones.com', name: '', appVersion: '<img src=x onerror=alert(1)>', lastLoginAt: '' }];
  T.renderVersionsTab();
  const nasty = byId.get('access-panels').innerHTML;
  r.ok('a stored version is escaped on render, not trusted because the backend validates it',
    !/<img src=x/.test(nasty) && /&lt;img src=x/.test(nasty), (nasty.match(/&lt;img[^<]*/) || [''])[0]);

  T.accessCache.users = [];
  T.renderVersionsTab();
  r.ok('an empty roster says so instead of drawing an empty list',
    /No accounts yet/.test(byId.get('access-panels').innerHTML));
}

// ══════════════════════════════════════════════════════════════════════════════
r.head('the reported version rides the sign-in that is already happening');

r.ok('the login payload carries the running build',
  /fd\.append\('version', APP_VERSION\)/.test(APP), (APP.match(/[^\n]*append\('version'[^\n]*/) || [''])[0]);
r.ok('...and so do the Google door and the device unlock',
  /postAuth\('googleExchange', \{ code, device: deviceLabel\(\), version: APP_VERSION \}\)/.test(APP) &&
  /postAuth\('deviceUnlock', \{[^}]*version: APP_VERSION \}\)/.test(APP));
// deviceLabel()'s contract is "no version, no raw UA" and smoke-session pins it —
// putting the version inside it would quietly widen what that log line means.
r.ok('the version is NOT folded into deviceLabel()',
  !/function deviceLabel[\s\S]{0,700}?APP_VERSION/.test(APP));

r.finish();
