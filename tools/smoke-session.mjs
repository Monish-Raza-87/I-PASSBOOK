// Smoke test for the session model: 30 days in localStorage, slid on use, and an
// interceptor that does not eject people on a bad connection.
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
const removals = (code.match(/localStorage\.removeItem\('ipb_user'\)/g) || []).length;
r.ok('exactly one ipb_user removal remains (in clearLocalAuth)', removals === 1, removals);
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

r.finish();
