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
function drive(record, counters, fetchImpl, extraGlobals) {
  const T = loadApp(`
    submitUnlock, saveUnlock, loadUnlock, clearUnlock, localStorage, UNLOCK_KEY,
    setAuthMode, patternHashOf, showMethodInactiveNote, hideMethodInactiveNote,
    tFloor,
    // A typeof on a name that is no longer declared is safe, so this reads the app's
    // OWN scope rather than grepping the file for the dead twin's name — which the
    // comment explaining its removal also contains. See section 6(g).
    deadGestureType: typeof unlockFingerprintGesture,
    getMode: () => _authMode,
  `, {
    capture: true,
    splitStorage: true,
    // Both are real browser globals a bare VM context lacks (the harness supplies
    // only the genuinely non-V8 ones). webcrypto is the platform's own WebCrypto,
    // not a stand-in, so the SHA-256 the app computes here is the real one.
    globals: Object.assign({ crypto: webcrypto, TextEncoder }, extraGlobals || {}),
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

// ── 5. Both doors are drawn; the tap is what knows ───────────────────────────
// This whole block used to read "the sign-in screen offers only the doors this device can
// open". The owner reversed that on 2026-10-08 — *"it would still show it to them but when
// they try to click on it and use that method it would say to them that 'This login method
// activates after you enable it from your login.'"* — so what is pinned now is that the
// ENTRY SCREEN always offers both, and that the PATTERN CANVAS still offers only what
// exists, because there the canvas IS the pattern door and a second one would do nothing.
r.head('the entry screen always offers both unlock doors, and says how to get one');
r.ok('the ids app.js switches are the ids the markup carries',
  /id="auth-pattern-link"/.test(indexSrc) && /id="auth-unlock-btn"/.test(indexSrc) &&
  /id="auth-quick"/.test(indexSrc));
const shown = (byId, id) => (byId.get(id) || { style: {} }).style.display !== 'none';

const D = drive(FP_ONLY, { calls: 0 });
D.T.setAuthMode('unlock');
r.ok('a fingerprint-only device shows the fingerprint button', shown(D.byId, 'auth-unlock-btn'));
r.ok('...and "Continue with pattern" TOO, which this device has not enrolled',
  shown(D.byId, 'auth-pattern-link'),
  (D.byId.get('auth-pattern-link') || {}).style);

const E = drive(Object.assign({}, FP_ONLY, { patternHash: hashOf([1, 2, 3, 4]) }), { calls: 0 });
E.T.setAuthMode('unlock');
r.ok('a device with both shows both',
  shown(E.byId, 'auth-unlock-btn') && shown(E.byId, 'auth-pattern-link'));

// The device that has NEITHER is the case the owner was describing — the one that used to
// see no buttons at all. It now sees both, and the note is what a tap opens.
const N = drive({ email: 'monish.raza@indrones.com' }, { calls: 0 });
N.T.setAuthMode('unlock');
r.ok('a device with neither still sees both doors',
  shown(N.byId, 'auth-unlock-btn') && shown(N.byId, 'auth-pattern-link'));
const noteOf = (d) => d.byId.get('auth-method-note');
r.ok('the explanation ships hidden, and a tap on either door opens it',
  noteOf(N).style.display === 'none' &&
  (N.byId.get('auth-method-note') || {}).children !== undefined &&
  N.T.showMethodInactiveNote() === undefined && noteOf(N).style.display === '',
  noteOf(N).style);
r.ok('...and switching to another door puts it away again, so it cannot outlive its tap',
  (N.T.setAuthMode('email'), noteOf(N).style.display === 'none'));

const F = drive({ email: 'monish.raza@indrones.com', mode: 'pattern',
                  deviceToken: 'b'.repeat(32), patternHash: hashOf([4, 3, 2, 1]) }, { calls: 0 });
F.T.setAuthMode('pattern');
r.ok('a pattern-only device shows the pattern door and hides the fingerprint button',
  shown(F.byId, 'auth-pattern-link') && !shown(F.byId, 'auth-unlock-btn'),
  (F.byId.get('auth-unlock-btn') || {}).style);

// ── 6. THE FINGERPRINT GESTURE, DRIVEN — every failure says which failure it was ──
//
// The owner, 2026-10-10: "There's something wrong with unlock with fingerprint option
// … it used to ask for laptop password in web portal and fingerprint in mobile. I have
// tested in web, its different now."
//
// I cannot reproduce his laptop, so what this section can do is not guess at his cause
// — it is to make sure the app NAMES one. Every failure of `navigator.credentials.get()`
// used to be caught by a single `catch` and reported as "The fingerprint prompt was
// cancelled": four different faults wearing one sentence, one of which (a device whose
// key is gone) is the most likely reading of his report. The mapping is what is pinned
// here, case by case, driven through the app's own `submitUnlock` against a fake
// platform authenticator whose ONLY members are ones the real API has.
const domErr = (name) => { const e = new Error(name); e.name = name; return e; };
const FP_CFG = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
// A `get()` that records the button's label at the instant it is called — the in-flight
// state — and then fails the way the browser would. `seen` is filled in after the app
// loads, because the element it reads does not exist until then; `get` itself is not
// called until `submitUnlock` reaches it, so nothing reads `seen` early.
function getThatFails(err, delayMs, seen) {
  return async () => {
    const b = seen.byId && seen.byId.get('auth-unlock-btn');
    if (b) seen.label = b.textContent;
    if (delayMs) await new Promise(res => setTimeout(res, delayMs));
    throw err;
  };
}
// One case: build the sandbox, then hand it the byId map the recorder will read.
function fpCase(err, delayMs) {
  const seen = {};
  const T = drive(FP_ONLY, { calls: 0 }, undefined, {
    PublicKeyCredential: FP_CFG,
    navigator: { userAgent: 'node', onLine: true, credentials: { get: getThatFails(err, delayMs, seen) } },
  });
  seen.byId = T.byId;
  return { T: T.T, byId: T.byId, seen };
}

r.head('a fingerprint failure names the failure — it is not always "cancelled"');

// (a) THE STALE KEY. The device answered in under a second, which means no sheet was
// ever shown — a prompt cannot be dismissed that fast. That is the credential id no
// longer resolving on this machine, and it is the one reading of "it is different now"
// this suite can positively identify rather than merely report.
const G1 = fpCase(domErr('NotAllowedError'), 0);
await G1.T.submitUnlock('fingerprint');
r.ok('a key the device no longer holds is named as exactly that, not as a cancellation',
  /no longer holds the key registered/.test(errorText(G1.byId)), errorText(G1.byId));
r.ok('...and not the word "cancelled", which is what every failure used to say',
  !/cancel/i.test(errorText(G1.byId)), errorText(G1.byId));
r.ok('...and the way out is named — re-register it, not just "try again"',
  /profile menu/.test(errorText(G1.byId)), errorText(G1.byId));

// (b) THE PROMPT HE ACTUALLY DISMISSED. The same error name, but the call took more
// than a second, so a sheet did appear. Timing is the only thing that separates these
// two cases — the spec makes them the same exception — and this asserts the separation
// is real rather than a comment.
const G2 = fpCase(domErr('NotAllowedError'), 1050);
await G2.T.submitUnlock('fingerprint');
r.ok('a dismissed or timed-out prompt says so, and does NOT blame a missing key',
  /dismissed or timed out/.test(errorText(G2.byId)) &&
  !/no longer holds/.test(errorText(G2.byId)), errorText(G2.byId));

// (c) THE BROWSER THAT WILL NOT PLAY. Distinct error names, distinct sentences: a
// SecurityError and a NotSupportedError are two different problems with two different
// remedies, and one shared sentence would send the person down the wrong one.
const G3 = fpCase(domErr('SecurityError'), 0);
await G3.T.submitUnlock('fingerprint');
r.ok('a browser refusing WebAuthn on this origin says that, and not "cancelled"',
  /will not offer a fingerprint on this address/.test(errorText(G3.byId)), errorText(G3.byId));

const G4 = fpCase(domErr('ConstraintError'), 0);
await G4.T.submitUnlock('fingerprint');
r.ok('a device with no sensor this browser will use offers a pattern instead of a dead end',
  /no fingerprint sensor this browser will use/.test(errorText(G4.byId)) &&
  /pattern/.test(errorText(G4.byId)), errorText(G4.byId));

// (d) AN ERROR NOBODY PREDICTED. The honest answer is the browser's own name for it —
// terse, but TRUE, and it is what makes the owner's next report actionable. Inventing
// a friendly sentence here would be inventing a diagnosis.
const G5 = fpCase(domErr('SomeFutureError'), 0);
await G5.T.submitUnlock('fingerprint');
r.ok('an unrecognised failure reports its own error name rather than a confident guess',
  /SomeFutureError/.test(errorText(G5.byId)), errorText(G5.byId));

// (e) A BROWSER WITH NO WEBAUTHN AT ALL. Reading `navigator.credentials.get` threw a
// TypeError here, which the old catch reported as "the prompt was cancelled" — about a
// prompt that could never have existed.
const G6 = drive(FP_ONLY, { calls: 0 }, undefined, { navigator: { userAgent: 'node', onLine: true } });
await G6.T.submitUnlock('fingerprint');
r.ok('a browser with no WebAuthn at all is told that, instead of being told it cancelled',
  /will not offer a fingerprint here/.test(errorText(G6.byId)), errorText(G6.byId));

// (f) THE BUTTON'S OWN LABEL. `#auth-unlock-btn` carries data-i18n="auth.unlock", so
// I18N applies its text — and the app then wrote a raw English literal over it and
// never put it back. Two things were wrong at once: the label under Hindi flipped to
// English, and the restore wrote a string this button has never had in any language.
const G7 = fpCase(domErr('NotAllowedError'), 0);
await G7.T.submitUnlock('fingerprint');
r.ok('while the prompt is up the button reads its OWN busy label, not a raw literal',
  G7.seen.label === G7.T.tFloor('auth.unlocking', '__FALLBACK__') &&
  G7.seen.label !== '__FALLBACK__',
  { inFlight: G7.seen.label });
r.ok('...and the resting label comes back through the translation table, not hardcoded English',
  (G7.byId.get('auth-unlock-btn') || {}).textContent === G7.T.tFloor('auth.unlock', '__FALLBACK__') &&
  (G7.byId.get('auth-unlock-btn') || {}).textContent !== 'Unlock with fingerprint',
  (G7.byId.get('auth-unlock-btn') || {}).textContent);
r.ok('...which means both keys exist in the language table and not only as English floors',
  G7.T.tFloor('auth.unlocking', '__FALLBACK__') !== '__FALLBACK__' &&
  G7.T.tFloor('auth.unlock', '__FALLBACK__') !== '__FALLBACK__');

// (g) THE DEAD TWIN. A second copy of the unlock gesture — `unlockFingerprintGesture()`
// — sat beside the live one, called by nothing, and asked for the OPPOSITE of what
// enrollment mints (no `allowCredentials` needs a discoverable credential; enrollment
// asks for `residentKey: 'discouraged'`). Deleted rather than repaired. `typeof` on an
// absent name is safe, so this reads the app's own scope rather than the file's text.
const G8 = drive(FP_ONLY, { calls: 0 });
r.ok('the dead second gesture is gone, not merely unused',
  G8.T.deadGestureType === 'undefined', G8.T.deadGestureType);

// ── 6(h). WHICH KEY THE PROMPT IS TOLD TO ASK FOR ─────────────────────────────
//
// The owner, 2026-10-13: *"The fingerprint login option is not working. It has to ask
// for my device's login key but is either asking for some USB method or QR code scan
// method, not sure what is it and this seems to be broken."*
//
// That is not a broken fingerprint. It is a `credentials.get()` that did not name a
// credential. Without `allowCredentials`, a request is asking for a DISCOVERABLE
// credential, and the only thing a browser can do with that is offer its own picker
// across every transport it knows — USB security keys, a phone over QR. Enrolment mints
// this device's key with `residentKey: 'discouraged'`, so the key that picker is hunting
// for cannot exist. The app was asking the wrong question and then reporting the answer
// as a fault in his finger.
//
// The `allowCredentials` WAS there — behind `if (rec.credentialId)`. So the failing state
// is a record that says the method is on but carries no id, which is exactly what the
// picker appeared for. Two properties are pinned here, and they are the two halves of the
// fix: the no-id state never reaches `get()` at all, and every call that DOES reach it
// names the key and its transport. Nothing in this suite could see either one before,
// which is why this shipped.
r.head('the fingerprint prompt is told exactly which key to ask for');
const recGet = () => { const calls = []; return { calls, get: async (o) => { calls.push(o); throw domErr('NotAllowedError'); } }; };
// The app's own base64url decoder, re-implemented here for the same reason the pattern
// hash is (see the top of this file): "the id that went out is the id that was stored"
// has to be an agreement between two independent computations, not a tautology.
const bytesOf = (s) => {
  const raw = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return Array.from(raw);
};

// (i) NO ID. The state the owner was in. There is nothing to ask for, so nothing is asked.
const noId = recGet();
const H1 = drive({ email: 'monish.raza@indrones.com', mode: 'fingerprint',
                   deviceToken: 'a'.repeat(32) }, { calls: 0 }, undefined, {
  PublicKeyCredential: FP_CFG,
  navigator: { userAgent: 'node', onLine: true, credentials: { get: noId.get } },
});
await H1.T.submitUnlock('fingerprint');
r.ok('a record with no credential id never opens a prompt at all — an unnamed request is a picker',
  noId.calls.length === 0, { calls: noId.calls.length });
r.ok('...and says which state the device is in, and how to leave it',
  /no key registered/.test(errorText(H1.byId)) && /profile menu/.test(errorText(H1.byId)),
  errorText(H1.byId));
r.ok('...and points at the door that does open, rather than ending in a dead end',
  /email code/.test(errorText(H1.byId)), errorText(H1.byId));

// ⚠ AND THE MENU IT SENDS HIM TO MUST BE ABLE TO DO WHAT IT SAYS. This is the half that
// was missing for as long as the message has existed (found 2026-10-13, from the owner's
// own report). Every one of those sentences tells him to go and re-register the method —
// and the profile menu, which was ONE button carrying three labels, could not: a record
// holding a fingerprint and no pattern showed "Add unlock pattern" and nothing else, so
// there was no way to remove it and no way to re-register it. **A recovery instruction
// naming a control the app does not have is worse than no instruction**, because it
// converts a dead end into a loop he will keep walking. Removal is its own row now, and
// these two assertions are what keep the row and the sentence married.
r.ok('the profile menu offers removal as its OWN row, and offers it whenever a record exists',
  /id="quick-unlock-remove-btn"/.test(appJs) &&
  /document\.getElementById\('quick-unlock-remove-btn'\)\.addEventListener\('click'/.test(appJs) &&
  /offerRemoveUnlock\(\);\s*\n\s*\}\);/.test(appJs));
r.ok('...and the row is shown by the device state, not left to the primary row\'s three labels',
  /const rm\s+= document\.getElementById\('quick-unlock-remove-btn'\);/m.test(appJs) &&
  /if \(rm\) rm\.style\.display = st \? '' : 'none';/.test(appJs));
r.ok('...and the primary row now offers what is MISSING, so it can never be the only row',
  /if \(!st\) btn\.textContent = 'Turn on Quick unlock';\n\s*else if \(!st\.patternHash\) btn\.textContent = 'Add unlock pattern';/.test(appJs) &&
  /btn\.style\.display = \(st && st\.patternHash\) \? 'none' : '';/.test(appJs));
// The instruction has to name the row by the words actually on it, or he looks for
// something that is not there — which is the exact failure this section exists for.
//
// ⚠ AGAINST COMMENT-STRIPPED SOURCE. The note that explains this bug necessarily QUOTES
// the retired sentence, so a raw-source check fails on the comment that documents the
// absence — the same trap smoke-ui.mjs hit on the `view-full` sidebar rule. Strip first,
// then ask.
const appCodeOnly = appJs
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
r.ok('every recovery sentence names that row by its real label',
  (appCodeOnly.match(/Remove quick unlock/g) || []).length >= 4 &&
  !/off and on again/i.test(appCodeOnly),
  (appCodeOnly.match(/Remove quick unlock/g) || []).length);

// (ii) AN ID. The call names it, and names where it lives.
const withId = recGet();
const H2 = drive(FP_ONLY, { calls: 0 }, undefined, {
  PublicKeyCredential: FP_CFG,
  navigator: { userAgent: 'node', onLine: true, credentials: { get: withId.get } },
});
await H2.T.submitUnlock('fingerprint');
const sent = (withId.calls[0] || {}).publicKey || {};
r.ok('a named key is sent as allowCredentials — the request is never left discoverable',
  Array.isArray(sent.allowCredentials) && sent.allowCredentials.length === 1 &&
  sent.allowCredentials[0].type === 'public-key',
  JSON.stringify(sent.allowCredentials));
r.ok('...and it is the id this device stored, byte for byte',
  String(sent.allowCredentials[0].id) === String(bytesOf(FP_ONLY.credentialId)),
  { got: String(sent.allowCredentials[0].id), want: String(bytesOf(FP_ONLY.credentialId)) });
r.ok('...and it names a TRANSPORT even for a record written before transports were stored',
  String(sent.allowCredentials[0].transports) === 'internal',
  sent.allowCredentials[0].transports);
r.ok('...and the rest of the request is untouched: a challenge, and a required user check',
  sent.challenge && sent.challenge.length === 32 && sent.userVerification === 'required',
  { challenge: !!(sent.challenge), uv: sent.userVerification });

// (iii) THE STORED TRANSPORT WINS when there is one — the record is the authority on
// where its own key lives, and `internal` is only the floor beneath it.
const withTr = recGet();
const H3 = drive(Object.assign({}, FP_ONLY, { transports: ['internal', 'hybrid'] }), { calls: 0 }, undefined, {
  PublicKeyCredential: FP_CFG,
  navigator: { userAgent: 'node', onLine: true, credentials: { get: withTr.get } },
});
await H3.T.submitUnlock('fingerprint');
r.ok('a record that knows its transports sends them, and is not flattened to the floor',
  String(((withTr.calls[0] || {}).publicKey || {}).allowCredentials[0].transports) === 'internal,hybrid',
  ((withTr.calls[0] || {}).publicKey || {}).allowCredentials[0].transports);

// (iv) THE RECORD IS WRITTEN WITH THE TRANSPORT IN IT. The unlock path can only send a
// transport that enrolment stored, so the write is asserted where it happens. Enrolment
// itself needs a platform authenticator this suite does not have; what it CAN read is
// that the stored record has the field, and that the field can only ever hold a
// transport — a `getTransports()` that lies, or is absent, still leaves a real one.
r.ok('enrolment writes the transports beside the id, so the unlock path has something to send',
  /transports: transports\.length \? transports : \['internal'\]/.test(appJs) &&
  /cred\.response\?\.getTransports\?\.\(\)/.test(appJs));
r.ok('...and it accepts either signature algorithm, so a chipset without ES256 is not a broken fingerprint',
  /pubKeyCredParams: \[\{ type: 'public-key', alg: -7 \}, \{ type: 'public-key', alg: -257 \}\]/.test(appJs));
// …and the one line that makes `allowCredentials` mandatory is NOT weakened to compensate
// for it. `residentKey: 'discouraged'` is why a nameless request can never work here, and
// turning it to 'preferred' would make the old bug look fixed while leaving the request
// in the shape that produced the USB/QR picker.
r.ok('...and the non-discoverable credential stays non-discoverable — the rule is not traded for an accident',
  /residentKey: 'discouraged'/.test(appJs) && /authenticatorAttachment: 'platform'/.test(appJs) &&
  /userVerification: 'required'/.test(appJs));


//
// Sections 1 and 2 above assert the setup overlay by READING app.js, and for a good
// reason: the overlay could not be built under the harness at all. `openPatternSetup`
// opens with `if (document.getElementById('pattern-setup-overlay')) return;`, and the
// harness's stub `getElementById` answers EVERY id with an element — so the guard was
// always already taken and the body below it was unreachable. The suite that looks
// like it tests the overlay tests its class name.
//
// That blindness has a cost on the record: an empty `catch (e) { }` — a refused passkey
// silently downgraded to a pattern dialog — sat in that unreachable body and shipped.
// So the harness grew two additive options (`absentIds`, `createElement`) and this
// section runs the real `beginQuickUnlockSetup` end to end: real function, real
// overlay, real message, asserted off the note element the overlay itself built.
//
// The fake platform authenticator offers `create` and `isUserVerifyingPlatform
// AuthenticatorAvailable` — both real members of the real API, in the shapes the real
// API gives them. Nothing here invents a member the browser lacks.
const jsonReply = body => () =>
  Promise.resolve({ text: () => Promise.resolve(JSON.stringify(body)) });

// A stand-in for the element `document.createElement('div')` returns. `querySelector`
// and `textContent` are real members of a real element; the factory memoises children
// so a test can read back the note the overlay wrote, which is the entire point.
function overlayFactory(seen) {
  return () => {
    const kids = new Map();
    const ov = {
      style: {}, dataset: {}, textContent: '', innerHTML: '', children: [],
      classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
      querySelector(sel) {
        if (!kids.has(sel)) kids.set(sel, sel === '#pattern-setup-canvas'
          ? canvasEl()
          : { textContent: '', style: {}, addEventListener() {}, classList: { add() {}, remove() {} } });
        return kids.get(sel);
      },
      querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      appendChild() {}, remove() {},
      setAttribute() {}, getAttribute: () => null,
    };
    seen.ov = ov;
    return ov;
  };
}

function setupCase({ biometric, create, fetch }) {
  const seen = {};
  const built = loadApp(`
    beginQuickUnlockSetup, loadUnlock,
    setUser: (u) => { currentUser = u; },
  `, {
    capture: true,
    splitStorage: true,
    absentIds: ['pattern-setup-overlay'],
    createElement: overlayFactory(seen),
    globals: {
      crypto: webcrypto, TextEncoder,
      PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => biometric },
      navigator: { userAgent: 'node', onLine: true, credentials: { create } },
    },
    fetch,
  });
  built.T.setUser({ email: 'monish.raza@indrones.com', name: 'Monish Raza' });
  return { T: built.T, byId: built.byId, seen };
}
const noteOfSetup = seen => (seen.ov ? (seen.ov.querySelector('#pattern-setup-note') || {}).textContent || '' : '<no overlay was built>');

r.head('enrolling quick unlock says what went wrong, instead of quietly offering a pattern');

// (a) THE PASSKEY IS REFUSED. This exact case was `catch (e) { }` — the person was
// handed a pattern dialog with no word of explanation, which reads as the feature
// half-working. It has to reach the note INSIDE the overlay: a toast fired in the same
// tick as a full-screen dimming overlay opens is a message nobody reads.
const S1 = setupCase({
  biometric: true,
  create: async () => { throw domErr('NotAllowedError'); },
  fetch: jsonReply({ status: 'ok', deviceToken: 'c'.repeat(32) }),
});
await S1.T.beginQuickUnlockSetup();
r.ok('a refused passkey explains itself inside the overlay that follows it',
  /dismissed or timed out/.test(noteOfSetup(S1.seen)), noteOfSetup(S1.seen));
r.ok('...and says the pattern is still a working door, rather than leaving it ambiguous',
  /pattern below will work instead/i.test(noteOfSetup(S1.seen)), noteOfSetup(S1.seen));
r.ok('...and no device record is saved from a half-finished attempt',
  !S1.T.loadUnlock(), S1.T.loadUnlock());

// (b) NO PLATFORM AUTHENTICATOR. Every desktop without Windows Hello enrolled lands
// here, which is most of them — and this branch explained itself with nothing at all.
const S2 = setupCase({
  biometric: false,
  create: async () => { throw new Error('never called'); },
  fetch: jsonReply({ status: 'ok', deviceToken: 'd'.repeat(32) }),
});
await S2.T.beginQuickUnlockSetup();
r.ok('a device with no platform authenticator says so, and names the pattern as the door',
  /no fingerprint or face sensor/.test(noteOfSetup(S2.seen)) &&
  /pattern is the quick-unlock door/.test(noteOfSetup(S2.seen)), noteOfSetup(S2.seen));
r.ok('...and the pattern record IS saved, because that path is a real enrolment',
  !!(S2.T.loadUnlock() && S2.T.loadUnlock().mode === 'pattern' && S2.T.loadUnlock().deviceToken === 'd'.repeat(32)),
  S2.T.loadUnlock());

// (c) THE HAPPY PATH STILL WORKS. Everything above is a failure branch, and a suite
// that only drives failures cannot tell a fixed error message from a feature that has
// stopped working altogether.
//
// The double carries `response.getTransports()` because the real `create()` result
// always does — `PublicKeyCredential.response` is required by the interface, and
// `getTransports()` is the W3C method that answers where the key lives. Leaving it out
// was how this suite stayed green while the app stored a credential with no transport on
// it, i.e. while the unlock prompt was left to guess. The value is deliberately a real
// answer and not 'internal', so the fallback below is not what is being measured here.
const S3 = setupCase({
  biometric: true,
  create: async () => ({ rawId: new Uint8Array([1, 2, 3, 4]),
                         response: { getTransports: () => ['internal', 'hybrid'] } }),
  fetch: jsonReply({ status: 'ok', deviceToken: 'e'.repeat(32) }),
});
await S3.T.beginQuickUnlockSetup();
const rec3 = S3.T.loadUnlock() || {};
r.ok('a device that CAN enrol still does, and stores the credential id it was given',
  rec3.mode === 'fingerprint' && rec3.deviceToken === 'e'.repeat(32) &&
  rec3.credentialId === 'AQIDBA' && rec3.email === 'monish.raza@indrones.com',
  rec3);
r.ok('...and stores the transport the platform reported, beside the id',
  String(rec3.transports) === 'internal,hybrid', rec3.transports);
r.ok('...and no pattern overlay is opened over a successful enrolment',
  !S3.seen.ov, !!S3.seen.ov);

// (d) AND THE FALLBACK IS REAL, not a comment: a platform whose `getTransports()` is
// absent — which is every engine before the method was added, and is why the app reads it
// with `?.` — must still enrol, with the transport floored at the device itself.
const S4 = setupCase({
  biometric: true,
  create: async () => ({ rawId: new Uint8Array([9, 9]) }),
  fetch: jsonReply({ status: 'ok', deviceToken: 'f'.repeat(32) }),
});
await S4.T.beginQuickUnlockSetup();
const rec4 = S4.T.loadUnlock() || {};
r.ok('a platform with no getTransports() enrols anyway, floored at the device itself',
  rec4.mode === 'fingerprint' && rec4.credentialId === 'CQk' &&
  String(rec4.transports) === 'internal', rec4);

r.finish();
