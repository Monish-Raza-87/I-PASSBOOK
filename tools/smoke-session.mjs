// Smoke test for the session model: a token in localStorage, an absolute 8h30m
// expiry, and an interceptor that does not eject people on a bad connection.
//
//   node tools/smoke-session.mjs
//
// Two things are being pinned here, and they are the two the owner complained
// about ("dont prompt signin again and again"):
//
//   1. The session lives in localStorage and survives a close. It used to live in
//      sessionStorage with a 15-minute idle timeout.
//   2. confirmSessionAlive() answers TRUE when it cannot reach the server. That
//      single default is what stops a flaky connection — or a GAS hiccup, or a
//      CORS failure — from being read as "you are signed out". Ejecting on those
//      is not a session problem; it is the bug.
//
// The TTL itself is NOT asserted here. It moved to 8h30m absolute with no slide,
// and that is the BACKEND's clock — the token this file stores carries no expiry
// of its own, so a frontend test could only restate a constant. smoke-store.mjs
// proves the real expiry against the real mint.
//
// This suite needs splitStorage: by default the harness aliases localStorage and
// sessionStorage to ONE store, which would make "survives a sessionStorage wipe"
// pass no matter which store the app used. That false pass is exactly why the
// option exists.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const T = loadApp(`
  SESSION_KEY, persistSession, loadSession, clearLocalAuth, confirmSessionAlive,
  persistUser, loadStoredUser, localStorage, sessionStorage,
  setUser: u => { currentUser = u; },
  setStopNudgePolling: fn => { stopNudgePolling = fn; },
`, { splitStorage: true });

// ── Where the session lives ───────────────────────────────────────────────────
r.head('the session is stored in localStorage');
T.persistSession('tok-123');
r.ok('loadSession returns it', T.loadSession() === 'tok-123', T.loadSession());
r.ok('it is in localStorage', T.localStorage.getItem(T.SESSION_KEY) === 'tok-123',
  T.localStorage.getItem(T.SESSION_KEY));
r.ok('and NOT in sessionStorage', T.sessionStorage.getItem(T.SESSION_KEY) === null,
  T.sessionStorage.getItem(T.SESSION_KEY));

r.head('it survives the browser closing (sessionStorage wiped)');
T.sessionStorage.removeItem(T.SESSION_KEY);
T.sessionStorage.removeItem('ipb_user');
r.ok('the token is still there', T.loadSession() === 'tok-123', T.loadSession());

r.head('the profile survives too');
T.persistUser({ name: 'Asha', email: 'asha@indrones.com', initial: 'A' });
r.ok('the profile is in localStorage', T.localStorage.getItem('ipb_user') !== null);
r.ok('and NOT in sessionStorage (the old home)', T.sessionStorage.getItem('ipb_user') === null,
  T.sessionStorage.getItem('ipb_user'));
r.ok('the password is never in it',
  !/password/i.test(T.localStorage.getItem('ipb_user') || ''), T.localStorage.getItem('ipb_user'));
r.ok('reloading gives the same profile', T.loadStoredUser().email === 'asha@indrones.com', T.loadStoredUser());

// ── One teardown path ─────────────────────────────────────────────────────────
r.head('clearLocalAuth is the single clear path');
// Stop the nudge poll, or it keeps firing an unauthorized request every 90s into
// a dead session — the loop that re-armed the ejector and caused the repeated
// sign-in prompts. The spy is installed from INSIDE app.js's lexical scope,
// because a top-level `function` declaration lives on the global object and that
// is what the identifier inside clearLocalAuth resolves to.
let stopped = 0;
T.setStopNudgePolling(() => { stopped++; });
T.clearLocalAuth();
r.ok('the token is gone from localStorage', T.loadSession() === null, T.loadSession());
r.ok('the profile is gone from localStorage', T.localStorage.getItem('ipb_user') === null);
r.ok('nothing is left in sessionStorage either',
  T.sessionStorage.getItem(T.SESSION_KEY) === null && T.sessionStorage.getItem('ipb_user') === null);
r.ok('the comment poll was stopped', stopped === 1, stopped);

// ── The death test ────────────────────────────────────────────────────────────
// The harness's fetch always rejects, so this is the network-failure path.
r.head('an unreachable server is NOT a dead session');
T.persistSession('tok-123');
T.setUser({ email: 'plain@indrones.com', sessionToken: 'tok-123' });
const alive = await T.confirmSessionAlive();
r.ok('confirmSessionAlive() resolves true when fetch rejects', alive === true, alive);
r.ok('so the session was not torn down', T.loadSession() === 'tok-123', T.loadSession());

r.head('a missing token is the one thing that is definitely dead');
T.setUser({ email: 'plain@indrones.com' });
r.ok('no token → false', (await T.confirmSessionAlive()) === false);

// ── What must no longer exist ─────────────────────────────────────────────────
r.head('the old mechanisms are gone from the source');
// Comments are stripped first: this file documents what it replaced, and a
// negative assertion that a comment can trip is a test that fails for the wrong
// reason. (It also means these patterns are checked against real code only.)
const code = appJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const gone = [
  ['the idle timeout', /IDLE_MS|startIdleTimer|resetIdleTimer|_idleTimer/],
  ['the self-signup flow', /requestSignup|verifySignup|getCaptcha|_captchaId|_pendingSignup/],
  ['the access-request flow', /requestAccessAction|pendingRequest|'requestAccess'/],
  ['the ACL editor', /'saveACL'|'listACL'|'decideRequest'/],
];
gone.forEach(([what, re]) => r.ok(what + ' is not referenced in app.js', !re.test(code),
  (code.match(re) || [''])[0]));

// The old persistence rule deleted the profile on every save, which is what
// forced a re-login on the next open. Exactly one removal must remain — the one
// inside clearLocalAuth().
r.head('the forced-re-login mechanism is gone');
// The stored profile's key has one definition (`USER_KEY`) and every site refers to
// it, because hasStoredSession()'s answer is only correct if the name read is the
// name persistUser() wrote. Counted through either spelling so this stays a test of
// "one removal remains" rather than a test of how the key is spelled.
const removals = (code.match(/localStorage\.removeItem\((?:'ipb_user'|USER_KEY)\)/g) || []).length;
r.ok('exactly one removal of the stored profile remains (in clearLocalAuth)',
  removals === 1 &&
  /const USER_KEY\s*=\s*'ipb_user';/.test(code) &&
  /function clearLocalAuth[\s\S]*?removeItem\(USER_KEY\)/.test(code), removals);
r.ok('persistUser does not clear the profile',
  !/function persistUser[\s\S]{0,400}removeItem/.test(code));

r.head('the interceptor is the four-rule version');
r.ok('a JSON parse failure clears suspicion instead of ejecting',
  /catch \{ _authSuspect = false; return resp; \}/.test(appJs));
r.ok('only a call that carried a token may eject',
  /if \(!resp \|\| !resp\.ok \|\| isAuthCall \|\| !sessionToken\) return resp;/.test(appJs));
r.ok('the admin modal gets a retry, not a sign-out',
  /renderAccessReconnect\(String\(data\.message \|\| ''\)\)/.test(appJs));
r.ok('and the retry button reloads rather than signing out',
  /access-reconnect-btn[\s\S]{0,200}loadAccessData\(\)/.test(appJs) ||
  /rb\.addEventListener\('click', \(\) => \{ panels\.innerHTML[\s\S]{0,80}loadAccessData\(\)/.test(appJs));

// ── A temporary password is a CORRECT credential, not a failed login ──────────
r.head('a temporary password reaches the change screen, not "Login failed."');
// The backend answers a first sign-in on an admin-issued temporary password with
// {status:'ok', mustChangePassword:true} and NO session token — by design, since
// changing it is the only way forward. loginBackend decided "success" on
// sessionToken alone, so that answer fell through to the error branch, found no
// `message` on it, and reported "Login failed." with the correct password sitting
// in the box. That is every account's first sign-in, the admin's included, and the
// caller's perfectly good `d.mustChangePassword` check was unreachable.
//
// Driven for real against a stubbed transport rather than grepped: this is a
// data-flow bug, and a regex would only have proved the strings were present —
// which they were, on both sides of the break.
let reply = {
  status: 'ok', mustChangePassword: true,
  email: 'monish.raza@indrones.com', name: 'Monish Raza',
};
const L = loadApp(`
  loginBackend, SESSION_KEY, localStorage,
  getUser: () => currentUser,
  setUser: u => { currentUser = u; },
`, {
  splitStorage: true,
  fetch: () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify(reply)) }),
});
// The real caller seeds this before the call (submitLogin does the same), because
// the error branch stamps currentUser.sessionError.
L.setUser({ email: 'monish.raza@indrones.com' });

const temp = await L.loginBackend('monish.raza@indrones.com', 'gHNGU-6975');
r.ok('the backend answer is passed through instead of becoming an error',
  !!temp && temp.status === 'ok' && temp.mustChangePassword === true, temp);
r.ok('no session token is invented', !!temp && !temp.sessionToken, temp);
r.ok('...and nothing is written to the session store',
  L.localStorage.getItem(L.SESSION_KEY) === null, L.localStorage.getItem(L.SESSION_KEY));
r.ok('...and no failure reason is left on the user',
  !(L.getUser() || {}).sessionError, (L.getUser() || {}).sessionError);
r.ok('...and that is the field submitLogin routes on',
  /d\.mustChangePassword[\s\S]{0,60}showPasswordChange/.test(appJs));

reply = { status: 'error', message: 'Wrong password.' };
const wrong = await L.loginBackend('monish.raza@indrones.com', 'nope');
r.ok('a genuinely wrong password still reports the backend message',
  !!wrong && wrong.status === 'error' && wrong.message === 'Wrong password.', wrong);

// The ordering is the whole fix: the pass-through must stand ABOVE the fallback,
// not beside it. 'data.mustChangePassword' is the code check, not the comment.
const lb = (appJs.match(/function loginBackend\s*\([\s\S]*?\n\}/) || [''])[0];
const passAt = lb.indexOf('data.mustChangePassword');
const errAt  = lb.indexOf("'Login failed.'");
r.ok('the pass-through sits BEFORE the generic error fallback',
  passAt > -1 && errAt > -1 && passAt < errAt, { passAt, errAt });

r.head('a reply that is not JSON is retried once — a JSON reply never is');
// The live failure this exists for: Apps Script answers /exec with a 302 to
// script.googleusercontent.com, and that second hop intermittently comes back 404
// carrying a Google HTML page. The old code turned it into one opaque sentence and
// gave up; the owner met it as "Bad response from server." on a laptop while the
// identical call from a phone signed in fine.
//
// Driven for real, because the difference between "retried" and "not retried" is a
// call COUNT — a regex over the source could only show that the words are present.
const HTML_404 = () => Promise.resolve({
  status: 404, text: () => Promise.resolve('<!DOCTYPE html><title>Page not found</title>'),
});
let tries = 0;
const R = loadApp('loginBackend, setUser: u => { currentUser = u; }', {
  fetch: () => {
    tries++;
    if (tries === 1) return HTML_404();
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'ok', otpRequired: true })) });
  },
});
R.setUser({ email: 'someone@indrones.com' });
const retried = await R.loginBackend('someone@indrones.com', '');
r.ok('an HTML reply is retried, once', tries === 2, tries);
r.ok('...and the retry\'s answer is the one the caller acts on',
  !!retried && retried.otpRequired === true, retried);

// A JSON reply proves the SCRIPT ran, so re-sending is never right: it would
// re-redeem a spent code or re-send a rejected password. This is the half that
// keeps the retry from becoming a double-submit.
let jsonTries = 0;
const J = loadApp('loginBackend, setUser: u => { currentUser = u; }', {
  fetch: () => {
    jsonTries++;
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'error', message: 'Wrong password.' })) });
  },
});
J.setUser({ email: 'someone@indrones.com' });
const refused = await J.loginBackend('someone@indrones.com', 'nope');
r.ok('a JSON error is NOT retried', jsonTries === 1, jsonTries);
r.ok('...and the backend\'s own message still reaches the caller',
  refused.message === 'Wrong password.', refused);

// When the retry fails too, the report has to say WHICH hop failed. "Bad response
// from server" cost this session hours: it describes the app's parse failure, not
// the edge's 404, and sent the hunt looking at the wrong side of the wire.
let deadTries = 0;
const X = loadApp('loginBackend, setUser: u => { currentUser = u; }', {
  fetch: () => { deadTries++; return HTML_404(); },
});
X.setUser({ email: 'someone@indrones.com' });
const dead = await X.loginBackend('someone@indrones.com', '');
r.ok('a reply that never parses gives up after ONE retry', deadTries === 2, deadTries);
r.ok('...and names the status, not the parser',
  !!dead && dead.status === 'error' &&
  /HTTP 404/.test(dead.message) && !/Bad response/.test(dead.message), dead);

r.head('a credential the first attempt SPENDS is never retried');
// The retry shipped without this distinction and broke the Google door the same
// evening: attempt one redeemed the handoff code and minted the session, the reply
// was lost to the same edge hop the retry exists for, and attempt two answered
// "that Google sign-in link is no longer valid" — for a code it had burned itself,
// while a good session was thrown away with it. Counted, because the bug is a call
// count and nothing in the source would look wrong.
let exTries = 0;
const G = loadApp('googleExchangeBackend, navigator, window', {
  fetch: () => { exTries++; return HTML_404(); },
});
await G.googleExchangeBackend('deadbeefdeadbeefdeadbeefdeadbeef');
r.ok('googleExchange is attempted exactly once, even when the reply is lost',
  exTries === 1, exTries);

let rpTries = 0;
const P = loadApp('resetPasswordBackend', {
  fetch: () => { rpTries++; return HTML_404(); },
});
await P.resetPasswordBackend('someone@indrones.com', '123456', 'a-new-password');
r.ok('resetPassword is attempted exactly once — its code is single use',
  rpTries === 1, rpTries);

let fpTries = 0;
const Q = loadApp('forgotPasswordBackend', {
  fetch: () => { fpTries++; return HTML_404(); },
});
await Q.forgotPasswordBackend('someone@indrones.com');
r.ok('forgotPassword is attempted exactly once — a second call would issue a SECOND code',
  fpTries === 1, fpTries);

// ...and the door that must KEEP retrying still does. The emailed login code is
// reusable inside its window, so re-redeeming it is harmless — which is why the
// owner's OTP sign-in was never affected by any of this.
let keepTries = 0;
const K = loadApp('loginBackend, setUser: u => { currentUser = u; }', {
  fetch: () => {
    keepTries++;
    if (keepTries === 1) return HTML_404();
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'ok', otpRequired: true })) });
  },
});
K.setUser({ email: 'someone@indrones.com' });
await K.loginBackend('someone@indrones.com', '');
r.ok('login still retries, because its emailed code is REUSABLE', keepTries === 2, keepTries);

r.head('the poll restarts after an in-page re-login');
// clearLocalAuth() stops the poll — correct for a dead session, wrong for a LIVE
// one. Signing in again without a page reload hits showApp()'s `_appBooted` early
// return, which used to skip startNudgePolling(): the person was signed in and
// would never see another comment notification for the life of the tab.
// The fix is that the early return runs startAppData(), which is also the boot
// path — so boot and re-login cannot drift apart. Asserted structurally, on the
// pairing, not on the name.
const showApp = (code.match(/function showApp\s*\([\s\S]*?\n\}/) || [''])[0];
r.ok('showApp has an already-booted early return', /_appBooted/.test(showApp), showApp.slice(0, 200));
r.ok('...and that early return runs the shared data starter',
  /_appBooted[\s\S]{0,160}startAppData\(\)/.test(showApp),
  (showApp.match(/_appBooted[^\n]*/) || [''])[0]);
r.ok('the shared data starter starts the poll', /function startAppData\s*\([\s\S]*?\n\}/.test(code) &&
  /startNudgePolling\(\)/.test((code.match(/function startAppData\s*\([\s\S]*?\n\}/) || [''])[0]));

r.head('the dead re-auth helper stays dead');
// forceReauth() revoked the server session, cleared local state and showed the
// login screen — and nothing called it, while its comment named two call sites
// that did not exist. Sign Out is the one place a live token is revoked.
r.ok('forceReauth is not defined', !/function forceReauth\s*\(/.test(code));
r.ok('...and not called either', !/forceReauth\s*\(/.test(code),
  (code.match(/[^\n]*forceReauth[^\n]*/) || [''])[0]);

r.head('the sign-in call tells the backend which device this is');
// The sign-in audit records what the browser CLAIMS, so the payload has to carry
// it — a log line saying "device not reported" for every sign-in would be a log
// nobody can act on. Driven for real: the FormData the app builds is captured and
// read back, because a regex would only prove the string exists somewhere in the
// file, not that it is in the request.
let signinForm = null;
const D = loadApp('deviceLabel, loginBackend, navigator, window', {
  fetch: (url, init) => {
    signinForm = init && init.body;
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ status: 'error', message: 'nope' })) });
  },
});
// Real FormData API: `entries()` is a METHOD returning the pairs.
const fieldOf = (form, key) => {
  const hit = (form && form.entries() || []).find(e => e[0] === key);
  return hit ? hit[1] : null;
};

D.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36';
await D.loginBackend('someone@indrones.com', 'a-password');
r.ok('the login request carries a device field',
  fieldOf(signinForm, 'device') !== null, (signinForm && signinForm.entries()));
r.ok('an Android phone reports as Android · Chrome, not as Safari',
  fieldOf(signinForm, 'device') === 'Android · Chrome', fieldOf(signinForm, 'device'));

D.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0 Safari/537.36 Edg/119.0';
await D.loginBackend('someone@indrones.com', 'a-password');
r.ok('an Edge browser reports as Edge, not as the Chrome it also claims to be',
  fieldOf(signinForm, 'device') === 'Windows · Edge', fieldOf(signinForm, 'device'));

D.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1';
await D.loginBackend('someone@indrones.com', 'a-password');
r.ok('a bare iPhone reports iOS · Safari',
  fieldOf(signinForm, 'device') === 'iOS · Safari', fieldOf(signinForm, 'device'));

D.navigator.userAgent = 'SomethingNobodyHasSeen/1.0';
await D.loginBackend('someone@indrones.com', 'a-password');
r.ok('an unrecognised browser says so instead of guessing',
  fieldOf(signinForm, 'device') === 'unknown OS · unknown browser', fieldOf(signinForm, 'device'));
r.ok('and the label never carries a version number or a raw UA',
  !/\d+\.\d+/.test(fieldOf(signinForm, 'device') || ''), fieldOf(signinForm, 'device'));

r.finish();
