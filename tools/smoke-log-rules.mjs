// The flight-log LIMITS: where they live, and what an absent one does.
//
//   node tools/smoke-log-rules.mjs
//
// Two things are under test here, and the first is the more important.
//
// 1. THE PUBLISHED FILE CARRIES NO OPERATING DATA. dataflash.js is served from a
//    public website, so any limit written into it is a limit published. The
//    airframe numbers are Indrones' own and live in the private store instead. The
//    guard below fails the moment one of them gains a value in LIMITS again — which
//    is the mistake that would not look like a mistake in a diff.
//
// 2. AN ABSENT LIMIT MEANS NO LIMIT. Not zero, not the default, not "pass". A blank
//    field in the Log limits panel resolves to a missing key, and the scorer must
//    then SHOW the area and not score it — the area is left out of the mean and
//    named in `open`. Scoring it 100 would quietly reward having no rule; scoring it
//    0 would ground aircraft on a number nobody set. Both are the bug this pins.

import fs from 'node:fs';
import vm from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const source = fs.readFileSync(new URL('../dataflash.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'dataflash.js' });
const DF = globalThis.DataFlash;

// ── 1. the file is clean ──────────────────────────────────────────────────────
r.head('the published file carries no Indrones operating numbers');

const OPERATING_KEYS = ['curReview', 'curFail', 'pwmSpread', 'attTrack', 'scoreWobble'];
r.ok('none of the airframe limits has a value in LIMITS',
  OPERATING_KEYS.every(k => !Object.prototype.hasOwnProperty.call(DF.LIMITS, k)),
  OPERATING_KEYS.filter(k => k in DF.LIMITS));
r.ok('...and the check is not vacuous — those names ARE the keys the store may set',
  OPERATING_KEYS.every(k => DF.TUNED.some(f => f.key === k)),
  DF.TUNED.map(f => f.key));
// ArduPilot's published figures ARE allowed here, because a stranger can already
// read them at the source. Named explicitly so "no numbers at all" is not mistaken
// for the rule — the rule is "no numbers a stranger could not already have".
r.ok('ArduPilot\'s own published figures are still present, and cited',
  DF.LIMITS.vibeXYFail === 60 && DF.LIMITS.vibeZFail === 60 &&
  DF.LIMITS.hdopReview === 1.5 && DF.LIMITS.hdopFail === 2.0,
  [DF.LIMITS.vibeXYFail, DF.LIMITS.vibeZFail, DF.LIMITS.hdopReview, DF.LIMITS.hdopFail]);
r.ok('the field list is exported, so the panel is built from ONE definition',
  Array.isArray(DF.TUNED) && DF.TUNED.length >= 8 &&
  DF.TUNED.every(f => f.group && f.key && f.label && 'pub' in f),
  DF.TUNED.length);
r.ok('resolveRules is exported', typeof DF.resolveRules === 'function');

// ── 2. what a profile does ────────────────────────────────────────────────────
r.head('a profile overrides the public defaults, and only where it says something');

const cfg = (profiles, models) => ({ profiles: profiles || {}, models: models || [] });

{
  const R = DF.resolveRules(cfg({ S25: { curReview: 35, curFail: 50, curHoldMs: 5000 } }), 'S25');
  r.ok('a set limit replaces the default', R.curReview === 35 && R.curFail === 50, [R.curReview, R.curFail]);
  r.ok('a field the profile does not mention keeps the public default',
    R.hdopReview === 1.5 && R.vibeZFail === 60, [R.hdopReview, R.vibeZFail]);
  r.ok('the report can name the profile it used', R.airframe === 'S25' && R.profile === 'S25', [R.airframe, R.profile]);
}

{
  const R = DF.resolveRules(cfg({}), '');
  r.ok('with no config at all, an airframe limit is simply ABSENT',
    !('curReview' in R) && !('curFail' in R) && !('pwmSpread' in R) && !('attTrack' in R),
    Object.keys(R).filter(k => /curReview|curFail|pwmSpread|attTrack/.test(k)));
  r.ok('...and the public defaults are still there', R.vibeZFail === 60 && R.hdopFail === 2.0);
}

r.head('an airframe with nothing set falls back without inheriting');
{
  const c = cfg({ S25: { curReview: 35, curFail: 50 }, STRIVER: {} });
  const s = DF.resolveRules(c, 'S25');
  const t = DF.resolveRules(c, 'STRIVER');
  r.ok('S25 gets its own numbers', s.curReview === 35, s.curReview);
  r.ok('STRIVER does NOT inherit S25\'s — an unrelated model must not be capped by it',
    !('curReview' in t), t.curReview);
}

r.head('the shared default profile sits UNDER a named one');
{
  const c = cfg({ __default__: { pwmSpread: 250, attTrack: 15 }, S25: { attTrack: 20 } });
  const s = DF.resolveRules(c, 'S25');
  r.ok('a named profile wins over the default', s.attTrack === 20, s.attTrack);
  r.ok('and the default still fills what the named one leaves out', s.pwmSpread === 250, s.pwmSpread);
  const unnamed = DF.resolveRules(c, '');
  r.ok('a log with no airframe chosen still gets the default profile',
    unnamed.attTrack === 15 && unnamed.profile !== 'built-in defaults', [unnamed.attTrack, unnamed.profile]);
}

r.head('an explicitly empty value REMOVES the default, rather than falling back to it');
{
  const R = DF.resolveRules(cfg({ S25: { hdopFail: null } }), 'S25');
  r.ok('null clears a public default', !('hdopFail' in R), R.hdopFail);
  const R2 = DF.resolveRules(cfg({ S25: { hdopFail: '' } }), 'S25');
  r.ok('...and so does an empty string, which is what a cleared field posts',
    !('hdopFail' in R2), R2.hdopFail);
}

r.head('a malformed config degrades to the defaults — it never takes the analyser down');
{
  const bad = [null, undefined, 'nonsense', 42, {}, { profiles: 'no' }, { profiles: { S25: 'no' } }];
  bad.forEach(b => {
    const R = DF.resolveRules(b, 'S25');
    r.ok('survives ' + JSON.stringify(b), !!R && R.vibeZFail === 60, R && R.vibeZFail);
  });
  const junk = DF.resolveRules(cfg({ S25: { curReview: 'a lot', curFail: NaN, pwmSpread: Infinity, attTrack: 15 } }), 'S25');
  r.ok('a non-numeric value is ignored rather than coerced',
    !('curReview' in junk) && !('curFail' in junk) && !('pwmSpread' in junk), Object.keys(junk));
  r.ok('...while the good value beside it still lands', junk.attTrack === 15, junk.attTrack);
}

// ── 3. what an absent limit does to a score ───────────────────────────────────
r.head('a missing limit means the area is SHOWN and left OUT of the score');

const t0 = 1000;
const flight = msgs => {
  const parsed = { __messages: msgs, __time: { min: t0, max: t0 + 60 } };
  const findings = [];
  return DF.scoreFlightLog(parsed, findings, DF.resolveRules(cfg({}), ''));
};
const bat = (t, curr) => ({ _name: 'BAT', _t: t, Volt: 22, Curr: curr });

{
  // 60 A held for the whole flight — far past any limit the store might set, and
  // against a config that sets none. This is the case that must NOT fail.
  const msgs = [];
  for (let i = 0; i <= 20; i++) msgs.push(bat(t0 + i * 3, 60));
  const r1 = flight(msgs);

  const ids = r1.score.parts.map(p => p.id);
  r.ok('current is NOT a scored area when no current limit is set',
    ids.indexOf('current') < 0, ids);
  r.ok('...and it raises no fail', !r1.findings.some(f => f.severity === 'fail' && /current/i.test(f.title)),
    r1.findings.map(f => f.title));
  r.ok('...and no review either', !r1.findings.some(f => f.severity === 'review' && /current/i.test(f.title)),
    r1.findings.map(f => f.title));
  r.ok('...but the gap IS named on screen, not silently dropped',
    r1.score.open.some(o => /Current — no limit set/.test(o.label)),
    r1.score.open.map(o => o.label));
  r.ok('...and the total is not dragged to 0 by it', r1.score.total !== 0, r1.score.total);
}

r.head('...and a limit that IS set does the opposite');
{
  const msgs = [];
  for (let i = 0; i <= 20; i++) msgs.push(bat(t0 + i * 3, 60));
  const parsed = { __messages: msgs, __time: { min: t0, max: t0 + 60 } };
  const findings = [];
  const r2 = DF.scoreFlightLog(parsed, findings,
    DF.resolveRules(cfg({ S25: { curReview: 35, curFail: 50, curHoldMs: 5000 } }), 'S25'));

  r.ok('with a limit set, current IS scored', r2.score.parts.some(p => p.id === 'current'),
    r2.score.parts.map(p => p.id));
  r.ok('60 A held past a 50 A limit fails', findings.some(f => f.severity === 'fail' && /current/i.test(f.title)),
    findings.map(f => f.title));
  r.ok('...and it is no longer listed as having no rule',
    !r2.score.open.some(o => /Current — no limit set/.test(o.label)),
    r2.score.open.map(o => o.label));
  r.ok('the score says which profile judged it', r2.score.airframe === 'S25', r2.score.airframe);
}

r.head('the same log scores differently on two airframes — which is the whole point');
{
  const msgs = [];
  for (let i = 0; i <= 50; i++) msgs.push({ _name: 'VIBE', _t: t0 + i, VibeX: 25, VibeY: 6, VibeZ: 8, Clip0: 0, Clip1: 0, Clip2: 0 });
  const c = cfg({
    // X and Y watch at 30 / fail at 60 — ArduPilot's figure, so 25 is under it.
    LOOSE: {},
    // ...and a tighter pair on the same axis: 25 is now past the watch level.
    TIGHT: { vibeXYReview: 20, vibeXYFail: 30 },
  });
  const run = name => {
    const findings = [];
    return DF.scoreFlightLog({ __messages: msgs, __time: { min: t0, max: t0 + 50 } }, findings, DF.resolveRules(c, name));
  };
  const loose = run('LOOSE'), tight = run('TIGHT');
  r.ok('X at 25 is clean under the loose profile', loose.score.total === 100, loose.score.total);
  r.ok('X at 25 costs points under the tight one', tight.score.total < 100, tight.score.total);
  r.ok('...and the two totals differ', loose.score.total !== tight.score.total, [loose.score.total, tight.score.total]);
}

// ── 4. the pack: arithmetic that makes a reading comparable, never a rule ─────
r.head('a voltage is per CELL, or it is not comparable with another aircraft');

{
  // The three packs as the owner described them: 4S3P of 4200 mAh cells; two 6S4P
  // of 5000 mAh in parallel; one 6S3P of 5000 mAh. Series count differs, so the
  // same pack voltage means two entirely different things across the fleet — this
  // is the whole reason the fields exist.
  const fleet = cfg({
    S25:    { cellsSeries: 4, packMah: 12600 },
    S100:   { cellsSeries: 6, packMah: 40000 },
    S25PRO: { cellsSeries: 6, packMah: 15000 },
  });

  const p25 = DF.packInfo(DF.resolveRules(fleet, 'S25'));
  const p100 = DF.packInfo(DF.resolveRules(fleet, 'S100'));
  r.ok('a 4S pack is 16.8 V full and a 6S one is 25.2 V',
    Math.abs(p25.fullPack - 16.8) < 0.01 && Math.abs(p100.fullPack - 25.2) < 0.01,
    [p25.fullPack, p100.fullPack]);
  r.ok('the two packs hold different charge', p25.packMah === 12600 && p100.packMah === 40000,
    [p25.packMah, p100.packMah]);

  const pack = R => DF.packInfo(DF.resolveRules(fleet, R));
  r.ok('an airframe with no pack recorded yields NO number rather than a guessed one',
    pack('STRIVER').series === null && pack('STRIVER').packMah === null, pack('STRIVER'));
  r.ok('nonsense in the store is refused the same way, not coerced',
    DF.packInfo({ cellsSeries: 0, packMah: -5 }).series === null &&
    DF.packInfo({ cellsSeries: '6', packMah: NaN }).packMah === null,
    DF.packInfo({ cellsSeries: 0, packMah: -5 }));

  // THE TRAP THIS CLOSES. A cell count is a fact about ONE aircraft, so the shared
  // default must not be allowed to set one: a 4S default picked up by a 6S airframe
  // would divide by the wrong number and print a per-cell voltage that looks
  // completely reasonable. Refusing the layer gives a MISSING number instead of a
  // FALSE one.
  const sharedPack = cfg({ __default__: { cellsSeries: 4, packMah: 12600 }, S100: { cellsSeries: 6 } });
  const s100 = DF.packInfo(DF.resolveRules(sharedPack, 'S100'));
  r.ok('the shared default may NOT describe an aircraft — a 4S default never reaches a 6S airframe',
    s100.series === 6, s100.series);
  r.ok('...and a limit beside it in that same default IS still shared',
    DF.resolveRules(cfg({ __default__: { cellsSeries: 4, attTrack: 15 } }), 'S100').attTrack === 15);
  const inheritedOnly = DF.packInfo(DF.resolveRules(sharedPack, ''));
  r.ok('...so a log with no airframe chosen gets no per-cell figure at all, rather than the default\'s',
    inheritedOnly.series === null, inheritedOnly.series);
}

r.head('the report reads the pack: per cell, and mAh as a proportion');

{
  const t0 = 1000;
  // 100 A held for 108 s is 3000 mAh, exactly. Drawn from a 6000 mAh pack that is
  // half the battery; the same 3000 mAh from a 40000 mAh one is nothing at all.
  // Only the proportion is readable — the raw figure is identical in both.
  const drain = [];
  for (let i = 0; i <= 54; i++) drain.push({ _name: 'BAT', _t: t0 + i * 2, Volt: 25.2, Curr: 100 });
  const run = (prof, model) => DF.scoreFlightLog(
    { __messages: drain, __time: { min: t0, max: t0 + 108 } }, [], DF.resolveRules(cfg(prof), model)).score;

  const big = run({ S100: { cellsSeries: 6, packMah: 40000 } }, 'S100');
  const small = run({ S25PRO: { cellsSeries: 6, packMah: 6000 } }, 'S25PRO');
  const volBig = big.open.find(o => o.id === 'voltage');
  const volSmall = small.open.find(o => o.id === 'voltage');
  const mahBig = big.checklist.find(c => c.id === 'mah');
  const mahSmall = small.checklist.find(c => c.id === 'mah');

  r.ok('the voltage is given PER CELL, and named as such',
    volBig.label === 'Lowest cell voltage' && /4\.20 V per cell/.test(volBig.detail), volBig.detail);
  r.ok('...and names the pack it came from, so the division is checkable',
    /25\.20 V on a 6S pack \(25\.2 V full\)/.test(volBig.detail), volBig.detail);
  r.ok('the same 3000 mAh is 8% of one pack and 50% of another — the whole point of the percentage',
    /3000 mAh drawn — 8% of the 40000 mAh/.test(mahBig.detail) &&
    /3000 mAh drawn — 50% of the 6000 mAh/.test(mahSmall.detail),
    [mahBig.detail, mahSmall.detail]);

  // With no pack recorded the measurement is still shown — it is real — but the
  // report must not imply it can be compared with another aircraft's.
  const bare = run({ S25: {} }, 'S25');
  const volBare = bare.open.find(o => o.id === 'voltage');
  const mahBare = bare.checklist.find(c => c.id === 'mah');
  r.ok('with no pack recorded the plain pack voltage is still shown',
    volBare.label === 'Lowest pack voltage' && /25\.20 V/.test(volBare.detail), volBare.detail);
  r.ok('...and it says outright that it cannot be compared, rather than implying it can',
    /cell count is not recorded/.test(volBare.detail), volBare.detail);
  r.ok('...and the capacity is shown as a raw figure with no invented proportion',
    /3000 mAh drawn \(the pack is not recorded/.test(mahBare.detail), mahBare.detail);

  // The pack is not a limit: it must change no score and raise no finding.
  const with0 = run({ S25PRO: { cellsSeries: 6, packMah: 6000 } }, 'S25PRO');
  const without = run({ S25PRO: {} }, 'S25PRO');
  r.ok('declaring the pack changes NOTHING about the score',
    with0.total === without.total, [with0.total, without.total]);
  r.ok('...and it is never a scored area', !with0.parts.some(p => /pack|cell/i.test(p.id)),
    with0.parts.map(p => p.id));
}

r.head('a profile that sets NOTHING still names itself, so the screen can say so');
{
  const parsed = { __messages: [bat(t0, 10)], __time: { min: t0, max: t0 + 10 } };
  const s = DF.scoreFlightLog(parsed, [], DF.resolveRules(cfg({}), '')).score;
  r.ok('the built-in defaults are named as such, not as an airframe',
    /built-in defaults/.test(s.profile) && s.airframe === '', [s.profile, s.airframe]);
  r.ok('and the report says so in the open list',
    s.open.some(o => o.id === 'profile' && /built-in defaults/.test(o.detail)),
    s.open.map(o => o.detail));
}

r.finish();
