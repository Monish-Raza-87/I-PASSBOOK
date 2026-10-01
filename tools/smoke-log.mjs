// Smoke test for dataflash.js — the ArduPilot .bin flight log reader — and for the
// Log Analyser screen built on it (sections 11–12).
//
//   node tools/smoke-log.mjs
//
// The fixture is BUILT IN MEMORY here, frame by frame, and never committed as a
// binary. Two reasons, and the second is the important one:
//
//   1. A .bin in the repo would be a few hundred KB of opaque bytes that nobody
//      can review, and its licence is not ours to assume.
//   2. More importantly, a recorded log is a fixture whose answers nobody knows.
//      "The parser ran without throwing" is not evidence that it read the flight
//      correctly. Building the frames here means every planted fault has a
//      known-correct answer — the vibration spike is at 2.5 s because the builder
//      wrote it at 2.5 s — so the assertions can be exact, and a detector that
//      fires on a clean file is caught rather than praised.
//
// What this CANNOT prove, and must not be read as proving: that the RULES are
// right. The 30 m/s/s limit, the 500 ms run and the 0.80 brown-out ratio are
// decisions about aircraft, not about code. Only a real log whose flight the
// owner already knows will show whether they are the right ones.

import fs from 'node:fs';
import vm from 'node:vm';
import { makeReporter, loadApp } from './harness.mjs';

const r = makeReporter();
const source = fs.readFileSync(new URL('../dataflash.js', import.meta.url), 'utf8');

// Evaluated as a SCRIPT in this realm, which is the closest thing to a browser
// `<script src>` tag: no module scope, no imports, and `globalThis` is the only
// way out. A fresh `vm` context would be a second realm, and its `Uint8Array`
// would then fail the parser's own `bytes instanceof Uint8Array` check — the
// fixture and the parser have to agree on that, exactly as they do in a page.
r.head('the file loads the way the page loads it');
const prior = globalThis.DataFlash;
let loadError = null;
try { vm.runInThisContext(source, { filename: 'dataflash.js' }); } catch (e) { loadError = e; }
const DF = globalThis.DataFlash;
r.ok('it evaluates as a plain script with no module system', !loadError && !!DF, loadError && loadError.message);
r.ok('...and needs no import or export to do it', !/^\s*(import|export)\s/m.test(source));
r.ok('...exposing exactly the documented surface',
  DF && ['VERSION', 'LIMITS', 'WATCHED', 'parseFormat', 'createParser', 'analyseBuffer', 'analyseFile']
    .every(k => k in DF), DF && Object.keys(DF));

// ── the fixture builder ──────────────────────────────────────────────────────
// The message type numbers below are arbitrary. Nothing in the format requires a
// particular one — the FMT table is what gives them meaning, and that is exactly
// the property under test. Using the real numbers would imply an authority this
// fixture does not have.

const SYNC = [0xA3, 0x95];
const FMT_TYPE = 128;
const FMT_TOTAL = 89;   // 3-byte header + Type(1) Length(1) Name(4) Format(16) Columns(64)

const text = (s, n) => { const b = new Uint8Array(n); for (let i = 0; i < n && i < s.length; i++) b[i] = s.charCodeAt(i); return b; };

// `declared` is the TOTAL length of the message being declared — its own header
// included, which is the convention FMT.Length uses and the arithmetic the whole
// parser rests on. Passing the wrong number here was how this fixture first went
// wrong: FMT's own 89 is correct only for the FMT that declares FMT.
// `columns` is the comma-separated list exactly as it sits in the file, since
// that is what the field IS — joining an array here would hide a mismatch
// between how the fixture writes it and how the parser splits it.
function fmtFrame(type, name, format, columns, declared) {
  const b = new Uint8Array(FMT_TOTAL);
  b[0] = SYNC[0]; b[1] = SYNC[1]; b[2] = FMT_TYPE;
  b[3] = type; b[4] = declared;
  b.set(text(name, 4), 5);
  b.set(text(format, 16), 9);
  b.set(text(columns, 64), 25);
  return b;
}

// A data frame whose payload is written from offset 3, i.e. after the header.
function dataFrame(type, total, write) {
  const b = new Uint8Array(total);
  b[0] = SYNC[0]; b[1] = SYNC[1]; b[2] = type;
  write(new DataView(b.buffer), 3);
  return b;
}

const T = { ATT: 30, VIBE: 110, RCOU: 130, BAT: 147, MSG: 200, ERR: 201, BARO: 160 };

// Each declaration states its OWN length, and the frame builders below are sized
// to match. A mismatch is not a subtle failure — the parser would walk off into
// the middle of the next frame — which is why the two are kept adjacent.
const DEFS = {
  ATT:  fmtFrame(T.ATT,  'ATT',  'Ifff', 'TimeUS,Roll,Pitch,Yaw', 3 + 16),
  VIBE: fmtFrame(T.VIBE, 'VIBE', 'Ifff', 'TimeUS,VibeX,VibeY,VibeZ', 3 + 16),
  RCOU: fmtFrame(T.RCOU, 'RCOU', 'I5H',  'TimeUS,C1,C2,C3,C4,C5', 3 + 4 + 5 * 2),
  BAT:  fmtFrame(T.BAT,  'BAT',  'Ifff', 'TimeUS,Volt,Volt2,Curr', 3 + 16),
  ERR:  fmtFrame(T.ERR,  'ERR',  'IBB',  'TimeUS,Subsys,ECode', 3 + 4 + 1 + 1),
  MSG:  fmtFrame(T.MSG,  'MSG',  'IZ',   'TimeUS,Message', 3 + 4 + 64),
  BARO: fmtFrame(T.BARO, 'BARO', 'If',   'TimeUS,Alt', 3 + 4 + 4),
};

const att  = (us, roll, pitch, yaw) => dataFrame(T.ATT, 3 + 16, (dv, o) => { dv.setUint32(o, us, true); dv.setFloat32(o + 4, roll, true); dv.setFloat32(o + 8, pitch, true); dv.setFloat32(o + 12, yaw, true); });
const vibe = (us, x, y, z) => dataFrame(T.VIBE, 3 + 16, (dv, o) => { dv.setUint32(o, us, true); dv.setFloat32(o + 4, x, true); dv.setFloat32(o + 8, y, true); dv.setFloat32(o + 12, z, true); });
const rcou = (us, ch) => dataFrame(T.RCOU, 3 + 4 + ch.length * 2, (dv, o) => { dv.setUint32(o, us, true); ch.forEach((v, i) => dv.setUint16(o + 4 + i * 2, v, true)); });
const bat  = (us, v, v2, a) => dataFrame(T.BAT, 3 + 16, (dv, o) => { dv.setUint32(o, us, true); dv.setFloat32(o + 4, v, true); dv.setFloat32(o + 8, v2, true); dv.setFloat32(o + 12, a, true); });
const err  = (us, sub, code) => dataFrame(T.ERR, 3 + 6, (dv, o) => { dv.setUint32(o, us, true); dv.setUint8(o + 4, sub); dv.setUint8(o + 5, code); });
const baro = (us, alt) => dataFrame(T.BARO, 3 + 8, (dv, o) => { dv.setUint32(o, us, true); dv.setFloat32(o + 4, alt, true); });
const msg  = (us, s) => dataFrame(T.MSG, 3 + 4 + 64, (dv, o) => { dv.setUint32(o, us, true); new Uint8Array(dv.buffer, o + 4, 64).set(text(s, 64)); });

const join = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// A clean flight: level attitude, gentle vibration, mid-range motor outputs, a
// healthy pack. Every detector must stay SILENT on this. That negative is half
// the value of the whole fixture — a detector that fires on a good flight is
// worse than one that misses, because it teaches the reader to ignore it.
function cleanFlight() {
  const parts = [DEFS.ATT, DEFS.VIBE, DEFS.RCOU, DEFS.BAT, DEFS.MSG];
  parts.push(msg(0, 'ArduCopter V4.5.1 (abc12345)'));
  for (let i = 0; i < 100; i++) {
    const us = i * 100000;                       // 10 Hz, 10 s
    parts.push(att(us, 1 + i * 0.01, -2, 90));
    parts.push(vibe(us, 3, 4, 5));
    parts.push(rcou(us, [1500, 1500, 1500, 1500, 1500]));
    if (i % 10 === 0) parts.push(bat(us, 24.8 - i * 0.001, 24.7, 12));
  }
  return join(parts);
}

// Both readers tolerate a report that failed to parse. Not defensive padding:
// an unreadable file has no findings and no meta, and every assertion about it
// should FAIL with a readable message rather than throw a TypeError somewhere in
// the middle of the suite and hide every result after it.
const findings = (report, needle) => (report.findings || []).filter(f => f.title.toLowerCase().includes(needle.toLowerCase()));
const titles = report => (report.findings || []).map(f => `${f.severity}: ${f.title}`);

// ── 1. The clean flight ──────────────────────────────────────────────────────
r.head('a clean flight reads clean');
const clean = DF.analyseBuffer(cleanFlight());
r.ok('the file parses', clean.ok, clean.error);
r.ok('the verdict is PASS', clean.verdict === 'PASS', titles(clean));
r.ok('...and it says so with an empty findings list', clean.findings.length === 0, titles(clean));
r.ok('the firmware string is read from the log', clean.meta.firmware === 'ArduCopter V4.5.1', clean.meta.firmware);
r.ok('...and the vehicle is recognised from it', clean.meta.vehicle === 'copter', clean.meta.vehicle);
r.ok('the duration comes from the message timestamps', Math.abs(clean.meta.durationSeconds - 9.9) < 0.2, clean.meta.durationSeconds);
r.ok('frames are counted, and the FMT frames are part of the count', clean.meta.frames === 316, clean.meta.frames);
r.ok('nothing was skipped over', clean.meta.skippedBytes === 0, clean.meta.skippedBytes);

r.head('the parameter table carries the real numbers');
const vx = clean.parameters.find(p => p.message === 'VIBE' && p.column === 'VibeX');
r.ok('VIBE.VibeX has min, max and mean', vx && vx.min === 3 && vx.max === 3 && vx.mean === 3, vx);
r.ok('...and a unit', vx && vx.unit === 'm/s/s', vx && vx.unit);
// The repeat count is the point: `I5H` must expand to five uint16s. A parser
// that stopped at `5H` would report one channel and silently drop four.
r.ok('all five RCOU channels were decoded, not just the first',
  ['C1', 'C2', 'C3', 'C4', 'C5'].every(c => clean.parameters.some(p => p.message === 'RCOU' && p.column === c)),
  clean.parameters.filter(p => p.message === 'RCOU').map(p => p.column));
r.ok('the column names come from the file, not from the code',
  clean.parameters.some(p => p.column === 'Yaw') && clean.parameters.some(p => p.column === 'Curr'),
  clean.parameters.map(p => p.column));
r.ok('every frame is accounted for in the message counts',
  clean.meta.messages.find(m => m.name === 'ATT').count === 100, clean.meta.messages);

// ── 2. A planted vibration spike ─────────────────────────────────────────────
r.head('a planted vibration spike is found, and located');
// The two bands are asserted separately, because the split between "look at
// this" and "this aircraft had a problem" is a decision, and one that would
// otherwise drift silently.
const spike = z => {
  const parts = [DEFS.ATT, DEFS.VIBE, DEFS.RCOU];
  for (let i = 0; i < 50; i++) {
    parts.push(att(i * 100000, 0, 0, 90));
    parts.push(rcou(i * 100000, [1500, 1500, 1500, 1500, 1500]));
    parts.push(vibe(i * 100000, 3, 4, i === 25 ? z : 5));   // the spike is at 2.5 s
  }
  return DF.analyseBuffer(join(parts));
};
const spike45 = spike(45);
const hit45 = findings(spike45, 'vibration');
r.ok('exactly one vibration finding', hit45.length === 1, titles(spike45));
r.ok('...at the timestamp the spike was written at', hit45[0] && hit45[0].atSeconds === 2.5, hit45[0]);
r.ok('...naming the axis', hit45[0] && /VibeZ/.test(hit45[0].detail), hit45[0] && hit45[0].detail);
r.ok('...quoting the peak and the limit it broke',
  hit45[0] && /45\.0/.test(hit45[0].detail) && /30/.test(hit45[0].detail), hit45[0] && hit45[0].detail);
r.ok('a peak past twice the limit is a FAIL, and the verdict says so',
  spike(75).verdict === 'FAIL' && findings(spike(75), 'vibration')[0].severity === 'fail', titles(spike(75)));
r.ok('...while a peak just past it is a REVIEW the reader can weigh',
  spike45.verdict === 'REVIEW' && hit45[0] && hit45[0].severity === 'review', [spike45.verdict, hit45[0] && hit45[0].severity]);
r.ok('a clean flight has no vibration finding at all',
  findings(clean, 'vibration').length === 0);
// Every finding names the message it came from. The report UI uses it to point
// at the parameter block the finding is about, so it is asserted here rather
// than left to be noticed when the link goes nowhere.
r.ok('...and the finding says which message it came from', hit45[0] && hit45[0].message === 'VIBE', hit45[0] && hit45[0].message);

// ── 3. Motor saturation, and the 500 ms gate ─────────────────────────────────
r.head('motor saturation is measured by how long it HELD');
// One RCOU stream at 100 ms, channel C2 held for `ms` starting at 1.0 s.
const sat = (channelValue, ms) => {
  const parts = [DEFS.ATT, DEFS.RCOU];
  for (let i = 0; i <= 40; i++) {
    const us = i * 100000;
    const ch = [1500, 1500, 1500, 1500, 1500];
    if (i >= 10 && (i - 10) * 100 <= ms) ch[1] = channelValue;
    parts.push(att(us, 0, 0, 90));
    parts.push(rcou(us, ch));
  }
  return DF.analyseBuffer(join(parts));
};
const longRun = findings(sat(2000, 780), 'pinned');
r.ok('a 780 ms run at maximum is reported', longRun.length === 1, titles(sat(2000, 780)));
r.ok('...naming the channel', longRun[0] && /C2/.test(longRun[0].title), longRun[0] && longRun[0].title);
r.ok('...at the moment the run began, not the moment it ended',
  longRun[0] && longRun[0].atSeconds === 1.0, longRun[0] && longRun[0].atSeconds);
r.ok('...and saying how long it held',
  longRun[0] && /0\.8 s/.test(longRun[0].detail) && /above 1900/.test(longRun[0].detail), longRun[0] && longRun[0].detail);
r.ok('a 300 ms run is SILENT — a short spike is a gust, not a fault',
  findings(sat(2000, 300), 'pinned').length === 0, titles(sat(2000, 300)));
r.ok('a channel pinned LOW is caught too', findings(sat(1000, 780), 'pinned').length === 1, titles(sat(1000, 780)));
r.ok('...and it says which direction', /at minimum/.test((findings(sat(1000, 780), 'pinned')[0] || {}).title || ''),
  findings(sat(1000, 780), 'pinned')[0]);
r.ok('a channel still pinned when the log ends is reported',
  findings(sat(2000, 4000), 'end of the log').length === 1, titles(sat(2000, 4000)));
r.ok('...and a motor finding attributes itself to RCOU',
  longRun[0] && longRun[0].message === 'RCOU', longRun[0] && longRun[0].message);

// ── 4. Attitude and altitude ─────────────────────────────────────────────────
r.head('attitude is judged by the RATE, not by the angle');
// 50 ms between samples, so a 55° step is 1100 °/s. Both cases stay under the
// ±90° absolute limit, which is what makes this a test of the rate rule alone.
const attStep = stepDeg => {
  const parts = [DEFS.ATT];
  for (let i = 0; i < 40; i++) parts.push(att(i * 50000, i >= 20 ? stepDeg : 0, 0, 90));
  return DF.analyseBuffer(join(parts));
};
const fast = findings(attStep(30), 'attitude change');
r.ok('a 600 deg/s step is reported', fast.length === 1, titles(attStep(30)));
r.ok('...as a review, because that is fast but possible', fast[0] && fast[0].severity === 'review', fast[0]);
r.ok('...quoting the rate', fast[0] && /600/.test(fast[0].detail), fast[0] && fast[0].detail);
const impossible = findings(attStep(55), 'attitude change');
r.ok('an 1100 deg/s step is a FAIL', impossible.length === 1 && impossible[0].severity === 'fail', titles(attStep(55)));
// A 30° step over 100 ms is 300 °/s — ordinary for a small quad, and it must not
// be reported at all.
const gentle = DF.analyseBuffer(join([DEFS.ATT].concat(
  Array.from({ length: 40 }, (_, i) => att(i * 100000, i >= 20 ? 30 : 0, 0, 90)))));
r.ok('a 300 deg/s change is SILENT', findings(gentle, 'attitude change').length === 0, titles(gentle));

const inv = DF.analyseBuffer(join([DEFS.ATT].concat(
  Array.from({ length: 30 }, (_, i) => att(i * 50000, i === 15 ? 120 : 0, 0, 90)))));
r.ok('an aircraft past vertical is a FAIL', findings(inv, 'past vertical').length === 1, titles(inv));
r.ok('...and it decides the verdict', inv.verdict === 'FAIL', inv.verdict);

r.head('an altitude jump is caught, and a real climb is not');
const climb = alt => DF.analyseBuffer(join([DEFS.BARO].concat(
  Array.from({ length: 60 }, (_, i) => baro(i * 100000, alt(i))))));
const steady = climb(i => i * 0.5);                            // 5 m/s all the way up
const jumped = climb(i => (i < 30 ? i * 0.5 : -40 + (i - 30) * 0.5));
r.ok('a 54 m step in one sample is reported', findings(jumped, 'Altitude jumped').length === 1, titles(jumped));
r.ok('...and a steady 5 m/s climb is silent', findings(steady, 'Altitude changing').length === 0, titles(steady));

// ── 5. Power ─────────────────────────────────────────────────────────────────
r.head('the battery rules are relative, so they do not need to know the cell count');
const pack = (nominal, dip) => DF.analyseBuffer(join([DEFS.BAT].concat(
  Array.from({ length: 60 }, (_, i) => bat(i * 100000, i === 40 ? dip : nominal, nominal - 0.1, 12)))));
r.ok('a collapse to 69% of the median is a FAIL',
  findings(pack(24.8, 17), 'collapsed').length === 1, titles(pack(24.8, 17)));
r.ok('a dip to 85% is a REVIEW, not a failure',
  findings(pack(24.8, 21), 'sag').length === 1 && findings(pack(24.8, 21), 'collapsed').length === 0,
  titles(pack(24.8, 21)));
r.ok('a healthy pack is silent',
  findings(pack(24.8, 24.5), 'collapsed').length === 0 && findings(pack(24.8, 24.5), 'sag').length === 0,
  titles(pack(24.8, 24.5)));
// The SAME proportion on a 6S pack must behave identically. That is the whole
// point of measuring against the median, and it is the property an absolute
// threshold — the obvious first implementation — would break.
r.ok('...and a 6S pack dipping by the same proportion is caught the same way',
  findings(pack(24.0, 16.8), 'collapsed').length === 1, titles(pack(24.0, 16.8)));
r.ok('...while 6S nominal voltage is not itself a fault',
  pack(24.0, 24.0).findings.length === 0, titles(pack(24.0, 24.0)));

// ── 6. Firmware faults ───────────────────────────────────────────────────────
r.head('firmware errors and status text are surfaced verbatim');
const faults = DF.analyseBuffer(join([DEFS.ERR, DEFS.MSG,
  att(0, 0, 0, 90), err(150000, 5, 2),
  msg(200000, 'EKF3 IMU0 is using GPS'),
  msg(300000, 'PreArm: Battery 1 below minimum')]));
r.ok('an ERR message is a FAIL', findings(faults, 'reported errors').length === 1, titles(faults));
r.ok('...and reports the subsystem and code it carried',
  /subsystem 5, code 2/.test((findings(faults, 'reported errors')[0] || {}).detail || ''),
  findings(faults, 'reported errors')[0]);
r.ok('a status message that reads like a fault is surfaced as a review',
  findings(faults, 'status messages').length === 1, titles(faults));
r.ok('...quoting the text rather than paraphrasing it',
  /EKF3 IMU0 is using GPS/.test((findings(faults, 'status messages')[0] || {}).detail || ''),
  findings(faults, 'status messages')[0]);

// ── 7. Files that are not what they claim ───────────────────────────────────
r.head('bad input is refused loudly, never turned into a confident report');
const notALog = DF.analyseBuffer(new Uint8Array(4096).fill(0x41));
r.ok('random bytes are rejected', notALog.ok === false, notALog);
r.ok('...with an explanation a technician can act on',
  /does not look like an ArduPilot DataFlash/.test(notALog.error || ''), notALog.error);
r.ok('...and NO verdict is offered at all',
  notALog.verdict === undefined && notALog.findings === undefined, notALog);

// Frames, but no FMT: nothing declares a length, so nothing can be read. This is
// the case a naive parser answers with an empty, cheerful report.
const noFmt = join([1, 2, 3, 4, 5, 6].map(i => dataFrame(i, 3 + 4, (dv, o) => dv.setUint32(o, i, true))));
const noFmtReport = DF.analyseBuffer(noFmt);
r.ok('frames without an FMT are rejected', noFmtReport.ok === false, noFmtReport);
r.ok('...and the message says WHY, distinctly from the not-a-log case',
  /no FMT header/.test(noFmtReport.error || '') && noFmtReport.error !== notALog.error, noFmtReport.error);

r.head('a truncated file is reported, not silently completed');
const full = cleanFlight();
const cut = DF.analyseBuffer(full.slice(0, full.length - 7));
r.ok('the truncated file still parses what it has', cut.ok, cut.error);
r.ok('...a truncation finding is raised', findings(cut, 'truncated').length === 1, titles(cut));
r.ok('...as a review, since the cause may be an incomplete copy',
  (findings(cut, 'truncated')[0] || {}).severity === 'review');
r.ok('...and fewer frames are reported than the whole file',
  cut.meta && cut.meta.frames < clean.meta.frames, [cut.meta && cut.meta.frames, clean.meta.frames]);
// A file cut INSIDE the header's two sync bytes is the sharpest case: the scan
// sees a lone 0xA3 and must not call it a frame.
const cutSync = DF.analyseBuffer(full.slice(0, full.length - 1));
r.ok('...and a cut inside the sync pair does not invent a frame',
  cutSync.ok && !!cutSync.meta && cutSync.meta.frames < clean.meta.frames, cutSync.meta && cutSync.meta.frames);

// ── 8. The declaration is data, and redefinition is honoured ─────────────────
r.head('a message redefined mid-file is read with its NEW layout');
// The real-world case: a log restarted, or two flights in one file. A parser that
// cached the first VIBE layout would read the second half with the wrong column
// count — and, because the added fields are all 4-byte floats, would not even
// crash; it would quietly report the wrong axis as VibeZ.
const VIBE_V2 = fmtFrame(T.VIBE, 'VIBE', 'Ifffff', 'TimeUS,VibeX,VibeY,VibeZ,Clip0,Clip1', 3 + 4 + 5 * 4);
const vibeV2 = (us, x, y, z, c0) => dataFrame(T.VIBE, 3 + 24, (dv, o) => {
  dv.setUint32(o, us, true);
  [x, y, z, c0, 0].forEach((v, i) => dv.setFloat32(o + 4 + i * 4, v, true));
});
// The order matters and is the whole point: old-layout frames come FIRST, then
// the redefinition, then new-layout frames. Declaring the new layout before the
// first frame would make that frame the wrong length — which the frame-count
// assertion below caught the first time this was written.
const redef = DF.analyseBuffer(join([DEFS.VIBE,
  vibe(0, 1, 2, 3), VIBE_V2,
  vibeV2(200000, 4, 5, 6, 7), vibeV2(400000, 4, 5, 40, 0)]));
r.ok('the redefined file parses', redef.ok, redef.error);
r.ok('the spike in the NEW layout is still found, and still on VibeZ',
  findings(redef, 'vibration').length === 1 && /VibeZ/.test(findings(redef, 'vibration')[0].detail), titles(redef));
r.ok('...at the right time', (findings(redef, 'vibration')[0] || {}).atSeconds === 0.4);
r.ok('the extra columns the new layout declares are read, not skipped',
  findings(redef, 'clipping').length === 1, titles(redef));
// The sharper check, and the reason this case exists. A parser that kept the
// FIRST declared length (19) would step 8 bytes short of every frame after the
// redefinition — and the frame COUNT alone would not catch it, because every
// frame starts with the sync pair, so the scanner simply resynchronises and
// counts the right number of frames anyway. What it cannot hide is the 8 bytes
// it walked past: they are not part of any frame, so they show up as skipped.
// VibeX/Y/Z sit at the same offsets in both layouts, so the VALUES look right
// too — this and the clip counter are the only two tells there are.
r.ok('...and no bytes are left stranded between frames',
  redef.meta && redef.meta.skippedBytes === 0, redef.meta && redef.meta.skippedBytes);
r.ok('...and all five frames are accounted for',
  redef.meta && redef.meta.frames === 5, redef.meta && redef.meta.frames);

r.head('a declaration that does not add up is refused, not guessed at');
// FMT says 4 fields but names 5 columns. Guessing which of the two is wrong is
// exactly how a crash report ends up with a plausible-looking wrong number in it.
const badDecl = fmtFrame(170, 'FAKE', 'Ifff', 'TimeUS,A,B,C,D', 3 + 16);
const mismatch = DF.analyseBuffer(join([DEFS.ATT, badDecl, att(0, 0, 0, 90),
  dataFrame(170, 3 + 16, (dv, o) => [0, 1, 2, 3].forEach((v, i) => dv.setFloat32(o + i * 4, v, true)))]));
r.ok('the message is flagged by name', findings(mismatch, 'FAKE could not be read').length === 1, titles(mismatch));
r.ok('...and attributes itself to that message, not to a constant',
  (findings(mismatch, 'FAKE could not be read')[0] || {}).message === 'FAKE',
  findings(mismatch, 'FAKE could not be read')[0]);
r.ok('...explaining what did not add up',
  /4 fields but 5 column names/.test((findings(mismatch, 'FAKE could not be read')[0] || {}).detail || ''),
  findings(mismatch, 'FAKE could not be read')[0]);
r.ok('...and its values never reach the parameter table, where they would look real',
  !mismatch.parameters.some(p => p.message === 'FAKE'), mismatch.parameters.map(p => p.message));

const oddChar = fmtFrame(171, 'ODD', 'Iwz', 'TimeUS,A,B', 3 + 4 + 4 + 4);
const odd = DF.analyseBuffer(join([DEFS.ATT, oddChar, att(0, 0, 0, 90)]));
r.ok('an unknown type character is refused rather than given a guessed width',
  findings(odd, 'ODD could not be read').length === 1, titles(odd));
r.ok('...naming the characters it did not understand',
  /w z/.test((findings(odd, 'ODD could not be read')[0] || {}).detail || ''),
  findings(odd, 'ODD could not be read')[0]);

// The format-string reader on its own, since every decode depends on it.
r.head('the format string reader expands repeat counts correctly');
const ff = DF.parseFormat('I5H');
r.ok('I5H is two runs of six fields, not two fields',
  ff && ff.length === 2 && ff[0].n === 1 && ff[1].n === 5 && ff[1].ch === 'H', ff);
r.ok('a bare type is a repeat of one', DF.parseFormat('B')[0].n === 1);
r.ok('a repeat of zero is refused rather than silently treated as one', DF.parseFormat('0B') === null);
r.ok('an unreadable format string is refused', DF.parseFormat('') === null);

// ── 9. Streaming ─────────────────────────────────────────────────────────────
r.head('the same bytes give the same answer however they are chunked');
const whole = DF.analyseBuffer(cleanFlight());
// 1, 2 and 3 bytes are the cruel cases: they cut the header, cut the header plus
// type, and land between the two sync bytes. If the carry logic is wrong
// anywhere, those are where it shows.
[1, 2, 3, 7, 64, 4096].forEach(size => {
  const chunked = DF.analyseBuffer(cleanFlight(), size);
  r.ok(`chunked at ${size} byte${size > 1 ? 's' : ''}, the report is identical`,
    JSON.stringify(chunked) === JSON.stringify(whole),
    `frames ${chunked.meta && chunked.meta.frames} vs ${whole.meta && whole.meta.frames}`);
});
// And again with planted faults, so the comparison is not two empty reports
// matching each other.
const spiked = join([DEFS.ATT, DEFS.VIBE].concat(
  Array.from({ length: 50 }, (_, i) => [att(i * 100000, 0, 0, 90), vibe(i * 100000, 1, 1, i === 25 ? 99 : 1)]).flat()));
const spikedWhole = DF.analyseBuffer(spiked);
[3, 13, 4096].forEach(size => {
  const chunked = DF.analyseBuffer(spiked, size);
  r.ok(`...and a planted fault survives chunking at ${size}`,
    chunked.verdict === spikedWhole.verdict && findings(chunked, 'vibration').length === 1
    && chunked.meta && spikedWhole.meta && chunked.meta.frames === spikedWhole.meta.frames,
    `${chunked.verdict} / ${chunked.meta && chunked.meta.frames} frames`);
});
r.ok('...and a truncation is still seen through a chunk boundary',
  DF.analyseBuffer(full.slice(0, full.length - 7), 3).meta?.truncated === true);

// ── 10. How it ships ─────────────────────────────────────────────────────────
r.head('it is wired into the app the way the other plain script is');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const deploy = fs.readFileSync(new URL('./deploy-ghpages.mjs', import.meta.url), 'utf8');
const iData = html.indexOf('src="dataflash.js"');
const iApp = html.indexOf('src="app.js"');
r.ok('index.html loads it', iData > -1);
r.ok('...before app.js, which is the only ordering that works', iData > -1 && iData < iApp, [iData, iApp]);
r.ok('the service worker precaches it', /'\.\/dataflash\.js'/.test(sw));
r.ok('the deploy tool serves it', /^\s*'dataflash\.js',/m.test(deploy));

// The licence point, asserted rather than only commented, so a future "just
// vendor the existing parser" change has to delete a failing test to proceed.
r.ok('the GPL-3.0 parser is NOT vendored anywhere in the tree',
  !fs.readdirSync(new URL('../vendor', import.meta.url)).some(f => /dataflash|jsdataflash/i.test(f)));
r.ok('...and the reason is written down where it would be undone',
  /GPL-3\.0/.test(source) && /PUBLIC/.test(source));

// ── 11. The analyser's own pane ───────────────────────────────────────────────
r.head('the analyser is a fourth sibling pane, wired like the other three');
const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8');

r.ok('index.html ships the pane with an empty body',
  /id="log-view"/.test(html) &&
  // The first frame is the file picker, written by app.js. Anything baked in here
  // would be a second source for the same screen.
  /<div id="log-body" class="log-body"><\/div>/.test(html));
r.ok('its nav item is a plain hash link with an empty icon span',
  /<a class="nav-item" id="nav-log" href="#\/log"/.test(html) &&
  /id="nav-log"[\s\S]{0,140}<span class="nav-icon" aria-hidden="true"><\/span>/.test(html));
r.ok('the route exists, and resolves to the pane rather than the list fallthrough',
  /if \(parts\[0\] === 'log'\) return \{ name: 'log' \};/.test(appSrc));
r.ok('...and handleRoute re-reads the route after the IR-list await, like the dashboard',
  /r\.name === 'log'\)[\s\S]{0,520}currentRoute\(\)\.name !== 'log'[\s\S]{0,80}showLog\(\)/.test(appSrc));
r.ok('renderLayout hides the list for it on a phone and hands it the back button',
  /const log\s+= currentView === 'log';/.test(appSrc) &&
  /const full\s+= detail \|\| insights \|\| log;/.test(appSrc) &&
  /logView\.style\.display = log \? 'flex' : 'none';/.test(appSrc) &&
  /classList\.toggle\('view-log', log\)/.test(appSrc));

// The push is the one thing here that WRITES, so what it does to Section D is
// pinned rather than left to a comment.
r.head('pushing a report into an IR cannot destroy what is already in it');
r.ok('Section D declares the field, as its own read-only type',
  /id: 'd_logAnalysis',\s*label: 'Flight Log Analysis',\s*type: 'logAnalysis'/.test(appSrc));
r.ok('buildField renders it, and populateFieldValue fills it from the stored value',
  /field\.type === 'logAnalysis'\) \{\s*\n\s*\/\/[\s\S]{0,260}control = `<div class="log-analysis" id="\$\{id\}"><\/div>`;/.test(appSrc) &&
  /renderLogAnalysis\(fieldId, value\); return;/.test(appSrc));
r.ok('collectSectionValues carries it through instead of dropping it on a save',
  // Without this branch an ordinary Section D save would delete the report — the
  // failure mode is silent, and it fires on the NEXT save, not on the push.
  /field\.type === 'logAnalysis'\) \{[\s\S]{0,420}currentSectionData\?\.\[sectionId\]\?\.\[field\.id\][\s\S]{0,120}fieldValues\[field\.id\] = held;/.test(appSrc));
r.ok('the Summary APPENDS to the investigation text, never replaces it',
  /const existing = \(ta\.value \|\| ''\)\.replace\(\/\\s\+\$\/, ''\);/.test(appSrc) &&
  /ta\.value = existing \? existing \+ '\\n\\n' \+ block : block;/.test(appSrc));
r.ok('...and the Analysis Date is only stamped when it is empty',
  /if \(dateEl && !dateEl\.value\) dateEl\.value = stamp;/.test(appSrc));
r.ok('the push is gated on edit rights for Section D, not just on being signed in',
  /if \(!canEditSection\('sec-d'\)\) \{ showToast\('You do not have edit rights on Section D\.'\); return; \}/.test(appSrc));

// ── 12. The analyser invents no styling ──────────────────────────────────────
r.head('the analyser borrows the app\'s styling rather than starting a fifth one');
// Every rule whose selector mentions a .log-* class, pulled out of views.css. The
// promise in that file's header comment — no colour, radius or size invented, so
// the winning UI direction re-skins this screen for free — is only worth anything
// if something fails when it is broken. This is that something.
const cssRules = (css.match(/^[^\n{}]*\{[^}]*\}/gm) || []).filter(rule => /\.log-[a-z-]+/.test(rule.split('{')[0]));
r.ok('the block is there to check at all', cssRules.length >= 10, cssRules.length);
r.ok('no rule invents a colour — colour comes from a token or from the cascade',
  !cssRules.some(rule => /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\()/.test(rule)),
  cssRules.filter(rule => /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\()/.test(rule)));
r.ok('...and every colour it does set is a var()',
  (() => {
    const decls = cssRules.flatMap(rule => (rule.match(/\{[^}]*\}/) || [''])[0].replace(/[{}]/g, '').split(';'));
    const colour = decls.filter(d => /^\s*(color|background|background-color|border-color|fill|stroke)\s*:/.test(d));
    const bad = colour.filter(d => !/var\(--/.test(d) && !/:\s*(none|transparent|inherit|currentColor)\s*$/.test(d));
    return colour.length > 0 && bad.length === 0;
  })());
r.ok('no rule invents a font size in px',
  !cssRules.some(rule => /font-size:\s*[\d.]+px/.test(rule)),
  cssRules.filter(rule => /font-size:\s*[\d.]+px/.test(rule)));
r.ok('and its markup carries no inline colour either',
  !/style="[^"]*#[0-9a-fA-F]{3}/.test(appSrc));

// ── 13. The pane actually paints ─────────────────────────────────────────────
r.head('the pane renders a report, and the report it stores is the trimmed one');
// app.js is evaluated under the harness's stub DOM — which is itself half the test,
// since it proves the file still runs top to bottom. The report is handed in as
// JSON parsed INSIDE that sandbox, so the object the app sees is built from the
// sandbox's own intrinsics rather than a foreign realm's.
const REPORT = {
  verdict: 'REVIEW',
  meta: { firmware: 'ArduCopter V4.5.1', vehicle: 'copter', durationSeconds: 312.4,
          frames: 41200, skippedBytes: 0, truncated: false,
          messages: Array.from({ length: 20 }, (_, i) => ({ name: 'M' + i, count: 100 - i })) },
  findings: [
    { severity: 'review', title: 'High vibration',  atSeconds: 12.5, detail: 'VibeZ peaked at 34.2 m/s/s.', message: 'VIBE' },
    { severity: 'fail',   title: 'Motor saturated', atSeconds: 240.1, detail: 'C2 pinned high for 780 ms.', message: 'RCOU' },
    // A firmware fault has no numeric columns, so it has no parameter group. It
    // must NOT get a jump affordance, because there would be nowhere to go. It
    // carries a timestamp on purpose: without one there would be no button either
    // way, and the assertion below would pass on a broken rule.
    { severity: 'fail',   title: 'EKF failsafe',    atSeconds: 300.2, detail: 'ERR 15.', message: 'ERR' },
  ],
  parameters: [
    { message: 'VIBE', column: 'VibeZ', unit: 'm/s/s', count: 3100, min: 1.2, max: 34.2, mean: 3.1 },
    { message: 'RCOU', column: 'C2',    unit: '',      count: 6200, min: 1100, max: 1960, mean: 1500 },
  ],
};

const { T: L, byId: lById } = loadApp(`
  renderLog, logState, logSummaryText, logReportForStore,
  set allIRs(v) { allIRs = v; },
  set reportJSON(s) { logState.report = JSON.parse(s); },
  set dataflashVersion(v) { window.DataFlash = { VERSION: v }; },
`, { capture: true });
L.allIRs = [{ irNumber: 'IR470', droneId: 'DR-9' }, { irNumber: 'IR471', droneId: 'DR-10' }];
const bodyHTML = () => lById.get('log-body').innerHTML;

r.ok('with no reader present it says so, rather than showing an empty pane',
  (() => {
    L.renderLog();
    return /flight-log reader did not load/.test(bodyHTML());
  })(), bodyHTML());

r.ok('with a reader present the report paints: verdict, findings and the numbers',
  (() => {
    L.reportJSON = JSON.stringify(REPORT);
    L.dataflashVersion = '1.0.0';
    L.renderLog();
    const html = bodyHTML();
    return /Review/.test(html) &&
      /High vibration/.test(html) && /Motor saturated/.test(html) && /EKF failsafe/.test(html) &&
      /ArduCopter V4\.5\.1/.test(html) &&
      /VibeZ/.test(html) && /34\.2/.test(html) &&
      /id="log-push"/.test(html) && /id="log-target"/.test(html) &&
      /IR470 · DR-9/.test(html);
  })(), bodyHTML().slice(0, 300));

r.ok('...and only the findings whose message HAS numbers get a jump',
  (() => {
    const html = bodyHTML();
    return /data-jump="VIBE"/.test(html) && /data-jump="RCOU"/.test(html) &&
      !/data-jump="ERR"/.test(html);
  })());

r.ok('the pushed Summary is prose a human can read, not a dump of the report',
  (() => {
    const text = L.logSummaryText(JSON.parse(JSON.stringify(REPORT)), 'flight.bin', 1258291, '2026-10-01');
    return /^— Flight log analysis \(2026-10-01\) —/m.test(text) &&
      /File: flight\.bin \(1\.2 MB\) · ArduCopter V4\.5\.1/.test(text) &&
      /Verdict: REVIEW/.test(text) &&
      /• \[Review\] High vibration at 0:12\.5/.test(text) &&
      /• \[Fail\] EKF failsafe/.test(text) &&
      // The parameter table is NOT pasted in — it lives in the stored report, and
      // this field belongs to the engineer's own narrative.
      !/VibeZ/.test(text);
  })());

r.ok('...and what it stores drops the per-message ledger that grows with the log',
  (() => {
    const stored = L.logReportForStore(JSON.parse(JSON.stringify(REPORT)), 'flight.bin', 1258291);
    return stored.verdict === 'REVIEW' &&
      stored.meta.messages.length === 12 &&          // 20 in, 12 stored
      stored.findings.length === 3 &&
      stored.parameters.length === 2 &&
      stored.fileBytes === 1258291 &&
      typeof stored.pushedAt === 'string';
  })());

if (prior === undefined) delete globalThis.DataFlash; else globalThis.DataFlash = prior;
r.finish();
