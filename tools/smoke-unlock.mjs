// Smoke test for quick unlock — the fingerprint / pattern doors on the sign-in
// screen, and the pattern SETUP overlay a signed-in person reaches from their
// profile menu.
//
//   node tools/smoke-unlock.mjs
//
// Two defects the owner hit on his own phone on 2026-09-30, both invisible to
// every other suite:
//
//   1. "Upon clicking add unlock pattern nothing happened." The overlay WAS built
//      — the element was created, wired and appended — but it carried only an id,
//      and the stylesheet styles a CLASS. An unstyled <div> at the end of <body>
//      lands below a full-height app layout: off-screen. Nothing was broken except
//      the one attribute nobody would think to look at.
//
//   2. "as soon as I entered any pattern it landed me on a login page of either
//      signin with google or with code and not showing option to choose
//      fingerprint". A fingerprint record with no pattern yet — the state right
//      after enrolling — drew a canvas, and any draw fell into
//      `if (!rec.patternHash) { setAuthMode('email'); return; }`: a silent jump to
//      the email door, no message, and the fingerprint button the person had just
//      used hidden with the rest of #auth-quick.
//
// The pattern branch is DRIVEN, not grepped. Both bugs are about which branch runs
// with which record on the device, and a regex over the source can only show that
// the words are present — which, in the second case, they were, on the wrong side
// of the break.

import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const appJs    = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const viewsCss = fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8');
const indexSrc = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The app's own hash, re-implemented here from its definition
// (`sha256(seq.join('-') + '|ipb-pattern')`). Re-implemented rather than imported
// so that "the client accepted the right pattern" below is a real agreement
// between two independent computations — if the app changed its salt or its
// separator, the honest-pattern case would fail here instead of quietly passing.
const hashOf = seq => createHash('sha256').update(seq.join('-') + '|ipb-pattern').digest('hex');

// ── 1. The setup overlay can be seen ──────────────────────────────────────────
r.head('the pattern-setup overlay is actually visible');
const ovClass = (appJs.match(/ov\.className\s*=\s*'([^']+)'/) || [])[1];
r.ok('the overlay element the code builds carries a class at all', !!ovClass, ovClass);
const overlayRule = ovClass
  ? (viewsCss.match(new RegExp('\\.' + ovClass + '\\s*\\{[\\s\\S]*?\\n\\}')) || [''])[0]
  : '';
r.ok('...and the stylesheet has a rule for exactly that name',
  !!overlayRule, overlayRule.slice(0, 60));
// These three properties are the whole difference between "an overlay" and "a
// block of markup at the bottom of the page".
r.ok('...and it is taken out of the flow: fixed, full-screen, above the app',
  /position:\s*fixed/.test(overlayRule) && /inset:\s*0/.test(overlayRule) &&
  /z-index:\s*\d+/.test(overlayRule), overlayRule);
r.ok('the id is still there for the once-only guard and the cancel button',
  /ov\.id = 'pattern-setup-overlay'/.test(appJs) &&
  /#pattern-setup-cancel/.test(appJs) &&
  /getElementById\('pattern-setup-overlay'\)/.test(appJs));
r.ok('the overlay builds the canvas the setup handler wires',
  /pattern-setup-canvas/.test(appJs) && /#pattern-setup-canvas/.test(appJs));

// ── 2. The setup canvas is drawable with a finger ─────────────────────────────
r.head('the setup canvas is drawable on a phone');
// Without the shared rule the setup canvas gets none of this: no size (a 240×240
// canvas is fine unstyled, but a device pixel ratio makes it the wrong box), and
// no `touch-action: none` — so a draw is read as a page scroll and the pattern
// never registers on the one device that needs it.
const canvasRule = (viewsCss.match(/#pattern-canvas\s*,[\s\S]*?\n\}/) || [''])[0];
r.ok('one rule covers BOTH canvases', /#pattern-canvas\s*,/.test(canvasRule) &&
  /#pattern-setup-canvas/.test(canvasRule), canvasRule.slice(0, 60));
r.ok('...and the draw is a gesture, not a page scroll',
  /touch-action:\s*none/.test(canvasRule), canvasRule);
r.ok('...and both are the same box, so a pattern means the same thing in both',
  /width:\s*240px/.test(canvasRule) && /height:\s*240px/.test(canvasRule));

// ── 3. A draw is answered in words, and lands on a door that opens ────────────
r.head('drawing a pattern with no pattern set explains itself');
// A drive harness: real app.js, stubbed transport that COUNTS, and a captured DOM
// so the mode and the error line can be read back.
// A canvas the harness's stub DOM does not provide: `paintPattern` runs on the
// wrong-pattern and incomplete-draw paths this suite drives, and the stub element
// has no 2D context. Every method reached is a real one on a real 2D context —
// nothing here invents an API the browser lacks; the drawing itself is not what
// these assertions are about, which is which BRANCH runs with which record.
function canvasEl() {
  const el = {
    width: 240, height: 240, dataset: {}, style: {},
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 240 }),
    addEventListener() {}, setPointerCapture() {},
  };
  // `classList` is not an invention: it is on every real element, and app.js now
  // writes `.is-busy` on the canvas for the whole of a verification (the visible half
  // of the "nothing shows on screen on what is happening" fix). The stub is a poor
  // stand-in for an element, so it is given the one member the app has started using
  // rather than the app being made defensive about a browser API that always exists.
  const set = new Set();
  el.classList = {
    add:    (n) => { set.add(n); },
    remove: (n) => { set.delete(n); },
    toggle: (n, on) => { (on === undefined ? !set.has(n) : !!on) ? set.add(n) : set.delete(n); },
    contains: (n) => set.has(n),
  };
  return el;
}

// `fetchImpl` is optional and defaults to the suite's standing "no network in test".
// The busy-state tests pass a fetch that is deliberately slow instead — the one thing
// a synchronous stub cannot express.
function drive(record, counters, fetchImpl) {
  const T = loadApp(`
    submitUnlock, saveUnlock, loadUnlock, clearUnlock, localStorage, UNLOCK_KEY,
    setAuthMode, patternHashOf,
    getMode: () => _authMode,
  `, {
    capture: true,
    splitStorage: true,
    // Both are real browser globals a bare VM context lacks (the harness supplies
    // only the genuinely non-V8 ones). webcrypto is the platform's own WebCrypto,
    // not a stand-in, so the SHA-256 the app computes here is the real one.
    globals: { crypto: webcrypto, TextEncoder },
    // THE WARM-UP PING IS NOT A SERVER CALL IN THE SENSE THESE ASSERTIONS MEAN. It has
    // no credential, no email and no device token on it, and the app sends it from the
    // top of the pattern branch so that the round trip it is about to make does not pay
    // for a cold Apps Script start. Counting it here would fail "a wrong gesture cannot
    // be a guess" on a request that could not carry a guess — a probe measuring the
    // wrong thing, which is the failure this file exists to be honest about.
    fetch: fetchImpl || ((url, init) => {
      // The ping is not a server call: a URL carrying action=ping, as a whole param.
      if (!/[?&]action=ping(&|$)/.test(String(url))) { counters.calls++; counters.last = init && init.body; }
      return Promise.reject(new Error('no network in test'));
    }),
  });
  T.byId.set('pattern-canvas', canvasEl());
  if (record) T.T.saveUnlock(record);
  return T;
}
const errorText = byId => ((byId.get('auth-error') || {}).textContent || '').trim();

const FP_ONLY = { email: 'monish.raza@indrones.com', mode: 'fingerprint',
                  deviceToken: 'a'.repeat(32), credentialId: 'ZmFrZQ' };

let c1 = { calls: 0 };
const A = drive(FP_ONLY, c1);
await A.T.submitUnlock('pattern', [1, 2, 3, 4]);
r.ok('a fingerprint device is landed back on the fingerprint door, not the email form',
  A.T.getMode() === 'unlock', A.T.getMode());
r.ok('...and the screen says what is missing',
  /No pattern is set on this device/.test(errorText(A.byId)), errorText(A.byId));
r.ok('...and names where the pattern is added, rather than only refusing',
  /profile menu/i.test(errorText(A.byId)), errorText(A.byId));
r.ok('...and no server call was made for a gesture that could not be checked',
  c1.calls === 0, c1.calls);

let c2 = { calls: 0 };
const B = drive(null, c2);
await B.T.submitUnlock('pattern', [1, 2, 3, 4]);
r.ok('a device with no record at all is told so, not silently sent to email',
  B.T.getMode() === 'email' && /No quick unlock is set up/.test(errorText(B.byId)),
  B.T.getMode() + ' / ' + errorText(B.byId));
r.ok('...and still makes no server call', c2.calls === 0, c2.calls);

// An incomplete draw is not an attempt: the engine never calls back with fewer
// than PATTERN_MIN_DOTS dots, so this is the belt to that brace — and it must not
// move the person anywhere.
let c3 = { calls: 0 };
const S = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), c3);
S.T.setAuthMode('pattern');
await S.T.submitUnlock('pattern', null);
r.ok('a draw of fewer than 4 dots changes nothing at all',
  S.T.getMode() === 'pattern' && errorText(S.byId) === '' && c3.calls === 0,
  S.T.getMode() + ' / ' + errorText(S.byId));

// ── 4. A wrong draw is still a wrong draw ────────────────────────────────────
r.head('a wrong pattern stays on the pattern screen');
let c4 = { calls: 0 };
const W = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), c4);
W.T.setAuthMode('pattern');
await W.T.submitUnlock('pattern', [1, 2, 3, 5]);
r.ok('the mode does not change', W.T.getMode() === 'pattern', W.T.getMode());
r.ok('the message is the wrong-pattern one', /Wrong pattern/.test(errorText(W.byId)), errorText(W.byId));
r.ok('...and the token never reaches the server — a wrong gesture cannot be a guess',
  c4.calls === 0, c4.calls);

// ── 4b. The wait after a draw says what it is doing, and refuses a second draw ─────
// The owner, 2026-10-08: "pattern functionality works ambigously, as in once we enter
// pattern it takes a long halt and meanwhile nothing shows on screen on what is
// happening and I can enter as many times pattern as I want over that." Both halves of
// that sentence are one bug: the canvas went on accepting pointer input and drawing for
// the whole of a round trip that is ~1.8s of store hops, and nothing on the card changed
// while it did. So the fix is a busy flag the canvas reads on the way IN and that every
// exit path clears on the way OUT — and the second half is the one that bites, because a
// flag left set is a canvas that never draws again.
//
const busyCanvas = (byId) => byId.get('pattern-canvas');
const titleOf = (byId) => ((byId.get('pattern-title') || {}).textContent || '');
const isBusy = (byId) => busyCanvas(byId).classList.contains('is-busy') === true;
// "During the wait" has to be a state this suite can STAND INSIDE rather than a race
// it tries to win: the pattern is hashed with real WebCrypto before the request goes
// out, so there is an await in front of the flag and a busy flag read synchronously
// after the call would still be false. Instead the request is held open — a fetch that
// never settles — and the test waits for the flag to appear. Nothing is invented: this
// is the one promise the app would have got from a backend that is slow to answer.
const settle = async (fn, tries = 200) => {
  for (let i = 0; i < tries; i++) { if (fn()) return true; await new Promise(res => setTimeout(res, 0)); }
  return false;
};

let cBusy = { calls: 0 };
const BUSY = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), cBusy,
                   () => new Promise(() => {}));
BUSY.T.setAuthMode('pattern');
const pending = BUSY.T.submitUnlock('pattern', [1, 2, 3, 4]);
r.ok('the canvas locks itself for the whole of the wait',
  await settle(() => isBusy(BUSY.byId)), { busy: isBusy(BUSY.byId) });
r.ok('...and the line under it stops asking for a pattern and says what is happening',
  titleOf(BUSY.byId) === 'Checking your pattern…', titleOf(BUSY.byId));
r.ok('...and it is the same canvas, not a second one drawn over it',
  busyCanvas(BUSY.byId) === BUSY.byId.get('pattern-canvas'));
pending.catch(() => {});

// Both ways OUT clear it. The failure path first.
let cFail = { calls: 0 };
const FAIL = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), cFail);
FAIL.T.setAuthMode('pattern');
await FAIL.T.submitUnlock('pattern', [1, 2, 3, 4]);
// submitUnlock() deliberately does NOT await the answer — it hands the request off
// and returns — so the flag clears in the promise's own turn, one turn after that
// call. Polling for it is what keeps this assertion about the CLEARING rather than
// about how many microtasks the chain happens to take.
r.ok('a backend that cannot be reached leaves the canvas drawable again',
  await settle(() => !isBusy(FAIL.byId)) &&
  titleOf(FAIL.byId) === 'Draw your pattern to unlock.',
  isBusy(FAIL.byId) + ' / ' + titleOf(FAIL.byId));

// And the way out that never reaches the backend at all — the flag is set after the
// hash, so a wrong draw that returns before the request is the one path that could
// skip the busy state entirely and leave the canvas looking stuck if it ever moved.
let cWrong = { calls: 0 };
const WRONG = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), cWrong);
WRONG.T.setAuthMode('pattern');
await WRONG.T.submitUnlock('pattern', [1, 2, 3, 5]);
r.ok('a wrong draw never reaches the backend, and leaves the canvas drawable too',
  !isBusy(WRONG.byId) && titleOf(WRONG.byId) === 'Draw your pattern to unlock.' &&
  cWrong.calls === 0,
  isBusy(WRONG.byId) + ' / calls ' + cWrong.calls);

// And the honest draw gets through to the server, carrying the device credential.
// This is the half that proves the two tests above are not passing because the
// whole pattern branch is dead.
r.head('the RIGHT pattern still unlocks');
let c5 = { calls: 0 };
const R = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), c5);
R.T.setAuthMode('pattern');
await R.T.submitUnlock('pattern', [1, 2, 3, 4]);
// Real FormData API: `entries()` is a METHOD returning the pairs.
const fieldOf = (form, key) => {
  const hit = (form && form.entries() || []).find(e => e[0] === key);
  return hit ? hit[1] : null;
};
r.ok('the device token is sent to the unlock door', c5.calls === 1 && !!c5.last, c5.calls);
r.ok('...with the method named, so the audit line can say which door was used',
  fieldOf(c5.last, 'action') === 'deviceUnlock' && fieldOf(c5.last, 'method') === 'pattern',
  c5.last && c5.last.entries());
r.ok('...and the email the record was enrolled for',
  fieldOf(c5.last, 'email') === 'monish.raza@indrones.com', fieldOf(c5.last, 'email'));
r.ok('...and the token, not a pattern or a hash of one',
  fieldOf(c5.last, 'deviceToken') === 'a'.repeat(32) &&
  !JSON.stringify(c5.last.entries()).includes(hashOf([1, 2, 3, 4])),
  fieldOf(c5.last, 'deviceToken'));

// ── 5. No door is drawn that cannot open ─────────────────────────────────────
r.head('the sign-in screen offers only the doors this device can open');
r.ok('the ids app.js switches are the ids the markup carries',
  /id="auth-pattern-link"/.test(indexSrc) && /id="auth-unlock-btn"/.test(indexSrc) &&
  /id="auth-quick"/.test(indexSrc));
const shown = (byId, id) => (byId.get(id) || { style: {} }).style.display !== 'none';

const D = drive(FP_ONLY, { calls: 0 });
D.T.setAuthMode('unlock');
r.ok('a fingerprint-only device shows the fingerprint button', shown(D.byId, 'auth-unlock-btn'));
r.ok('...and NOT "Use pattern" — the door that led nowhere',
  !shown(D.byId, 'auth-pattern-link'),
  (D.byId.get('auth-pattern-link') || {}).style);

const E = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), { calls: 0 });
E.T.setAuthMode('unlock');
r.ok('a device with both shows both',
  shown(E.byId, 'auth-unlock-btn') && shown(E.byId, 'auth-pattern-link'));

const F = drive({ email: 'monish.raza@indrones.com', mode: 'pattern',
                  deviceToken: 'b'.repeat(32), patternHash: hashOf([4, 3, 2, 1]) }, { calls: 0 });
F.T.setAuthMode('pattern');
r.ok('a pattern-only device shows the pattern door and hides the fingerprint button',
  shown(F.byId, 'auth-pattern-link') && !shown(F.byId, 'auth-unlock-btn'),
  (F.byId.get('auth-unlock-btn') || {}).style);

r.finish();
