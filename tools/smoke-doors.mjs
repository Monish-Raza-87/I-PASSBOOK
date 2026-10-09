// Smoke test for the two landing doors: BOTH SHUT ON ARRIVAL, and each one toggles
// ITSELF.
//
//   node tools/smoke-doors.mjs
//
// ── Why this runs the app instead of reading it ───────────────────────────────
//
// The doors have now been got wrong twice, and both times the failure was the same
// kind: the code READ as if it did what was asked. The first version made a written
// argument for leaving one door open on arrival and left it open; the second coupled
// the two, so opening one shut the other. Neither is visible in the source without
// holding all three of `data-open`, `hidden` and `aria-expanded` in your head at
// once, and the owner has been shown a "done" for both. So this suite sets the state
// up, CALLS the real functions, and reads back what a browser would see.
//
// The owner's words, 2026-10-09: *"I asked page opens the tabs collapsed, then we may
// open anyone or collapse anyone without being dependent on other."* — two rules, and
// the second is the one that was broken.
//
// index.html itself cannot be render-checked (app.js raises a blocking alert over
// `file://`, so the DevTools protocol never gets a turn), which is exactly why the
// state machine is driven here rather than photographed.

import { loadApp } from './harness.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// `capture: true` memoises elements by id, so the object `setDoor` writes into is the
// same object read back here. Without it every `getElementById` returns a fresh stub
// and every assertion below would pass against nothing.
const { T, byId } = loadApp(
  `paintDoors: () => paintDoors(), toggleDoor: (w) => toggleDoor(w), DOORS: () => DOORS.map(d => d)`,
  { capture: true }
);

const DOORS = T.DOORS();
head('the two doors exist as a pair');
ok('DOORS is exactly employee then customer',
  DOORS.join(',') === 'employee,customer', DOORS);

// One door's whole state, in the three places it is written. Read together on purpose:
// they are three statements of one fact, and any disagreement between them IS the bug
// (a shut panel with an open arrow, or an open panel a screen reader is told is shut).
const state = w => {
  const sec = byId.get('door-' + w);
  const bar = byId.get('door-' + w + '-toggle');
  const body = byId.get('door-' + w + '-body');
  return {
    open: sec && sec.dataset.open,
    aria: bar && bar.getAttribute('aria-expanded'),
    hidden: body && body.hidden,
  };
};
const shut = s => s.open === '0' && s.aria === 'false' && s.hidden === true;
const open = s => s.open === '1' && s.aria === 'true' && s.hidden === false;
const both = () => DOORS.map(w => `${w}=${state(w).open}`).join(' ');

// ── Rule 1: arriving gives you two shut doors ─────────────────────────────────
head('rule 1 — the page opens with both doors collapsed');
T.paintDoors();
ok('employee is shut on arrival', shut(state('employee')), state('employee'));
ok('customer is shut on arrival', shut(state('customer')), state('customer'));
ok('...in all three places the fact is written, and all three agree',
  DOORS.every(w => shut(state(w))), both());

// Nothing is restored: a door once opened on this device must NOT reopen next visit.
// The stored key is for the code screen to come back to, not for the landing page.
head('rule 1 — and a remembered door does not reopen the page');
T.toggleDoor('customer');
ok('customer is open (so there is something to remember)', open(state('customer')), state('customer'));
T.paintDoors();
ok('...and painting the page again shuts it, storage notwithstanding',
  shut(state('customer')), state('customer'));

// ── Rule 2: the two doors are INDEPENDENT ─────────────────────────────────────
//
// This is the rule that was broken. The earlier code closed the other door inside
// `setDoor`, which is the accordion shape: at most one open, guaranteed. The owner
// asked for the opposite — "without being dependent in other" — so each toggle must
// read only its OWN state and touch only its OWN three places.
head('rule 2 — opening one does not shut the other');
T.paintDoors();
T.toggleDoor('employee');
ok('employee opens', open(state('employee')), state('employee'));
ok('...and customer is still SHUT, not opened by association', shut(state('customer')), state('customer'));

T.toggleDoor('customer');
ok('customer opens', open(state('customer')), state('customer'));
ok('...and employee is STILL OPEN — this is not an accordion, and both may stand open',
  open(state('employee')), both());

head('rule 2 — closing one does not shut the other');
T.toggleDoor('employee');
ok('employee shuts', shut(state('employee')), state('employee'));
ok('...and customer is STILL OPEN', open(state('customer')), both());

head('rule 2 — every door toggles itself, both ways');
T.paintDoors();
for (const w of DOORS) {
  T.toggleDoor(w);
  const afterOpen = state(w);
  T.toggleDoor(w);
  const afterShut = state(w);
  ok(`${w} goes shut → open → shut on its own bar`,
    open(afterOpen) && shut(afterShut), { afterOpen, afterShut });
}

head('rule 2 — the other door is untouched by a toggle, field for field');
// The strongest form of "independent": snapshot the other door completely, toggle,
// and require the snapshot to be identical. A handler that quietly reset a class or
// an attribute on the wrong door would show up here and nowhere else.
T.paintDoors();
T.toggleDoor('customer');
const employeeBefore = JSON.stringify(state('employee'));
T.toggleDoor('customer');
const employeeAfter = JSON.stringify(state('employee'));
ok('toggling customer twice leaves employee byte-for-byte identical',
  employeeBefore === employeeAfter, { employeeBefore, employeeAfter });

// ── An unknown door name must not fall through to "open everything" ───────────
head('a bad door name fails safe');
T.paintDoors();
T.toggleDoor('nobody');
ok('an unknown name is treated as the employee door, not as a wildcard',
  open(state('employee')) && shut(state('customer')), both());

console.log(fails ? `\n${fails} FAILED` : '\nall door assertions passed');
process.exitCode = fails ? 1 : 0;
