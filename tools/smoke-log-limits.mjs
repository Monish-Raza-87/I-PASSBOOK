// The Log limits panel, and the airframe picker that uses it.
//
//   node tools/smoke-log-limits.mjs
//
// Three properties, each of which would be a silent fault in production:
//
// 1. THE PANEL IS ADMIN-ONLY, at the point where it writes. A hidden button is not
//    a gate — the backend refuses the write too (smoke-backend pins that), and this
//    pins the client half so a non-admin never fills in a form that cannot save.
//
// 2. A BLANK FIELD SAVES AS NOTHING. This is the one that would ground aircraft:
//    `Number('')` is 0, so a naive read of the inputs writes 0 into every limit the
//    admin left alone, and a 0 A current limit fails every flight ever recorded. The
//    assertion below is the whole reason alCaptureFields exists.
//
// 3. THE PICKER REACHES THE SCORER. A picker that repaints a label but never hands
//    the profile to the reader is worse than no picker — it would LOOK like the log
//    was judged as an S25 while every airframe got the same numbers.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

// The reader is a separate plain script, loaded before app.js exactly as index.html
// loads it, and it is what `window.DataFlash` resolves to. Without it every
// logRules() here would find nothing and return undefined — the app's own
// "not loaded yet" branch, which would let this suite pass while testing nothing.
const DATAPLASH_SRC = fs.readFileSync(new URL('../dataflash.js', import.meta.url), 'utf8');

// The panel's fields are read straight out of the DOM, so the fixture has to BE the
// DOM: the harness's stub document returns [] for every selector, and the patch has
// to happen inside the sandbox's realm (a test-realm `globalThis.document` is a
// different object entirely). `preload` runs in the sandbox before app.js, which is
// where `document` is still the harness's own object.
const AL_INPUTS = [];
const { T, byId } = loadApp(`
  normaliseAnalyserConfig, applyAnalyserConfig, logRules, renderAnalyserLimitsBody,
  get analyserConfig() { return analyserConfig; }, set analyserConfig(v) { analyserConfig = v; },
  alCaptureFields, alSetProfile, saveAnalyserLimits, logModelSelectHTML,
  get logState() { return logState; },
  get _alDraft() { return _alDraft; }, set _alDraft(v) { _alDraft = v; },
  get _alProfile() { return _alProfile; }, set _alProfile(v) { _alProfile = v; },
  isAdmin, ADMIN_EMAILS, logScoreHTML,
  get currentUser() { return currentUser; }, set currentUser(v) { currentUser = v; },
`, {
  capture: true,
  globals: { __alInputs: AL_INPUTS },
  // A transport that answers rather than rejects, so the admin save path can run to
  // its end. It also makes the harness define FormData, which saveSentinel builds.
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'error' }) }),
  preload: DATAPLASH_SRC + `
    document.querySelectorAll = function (sel) {
      return String(sel).indexOf('input[data-key]') >= 0 ? __alInputs : [];
    };
  `,
});

const { ok, head, finish } = makeReporter();

// isAdmin() reads currentUser.email and compares it to ADMIN_EMAILS — so the suite
// sets the SAME state the sign-in path sets, and the real gate does the deciding.
// Assigning `T.isAdmin` would only shadow the binding and test nothing.
const setAdmin = on => {
  T.currentUser = on ? { email: T.ADMIN_EMAILS[0] } : { email: 'nobody@example.com' };
};

head('the config is shape-checked before it is ever believed');

{
  const junk = T.normaliseAnalyserConfig({
    profiles: {
      S25: { curFail: 50, curReview: 35, attTrack: 'lots', 'bad key!': 1, pwmSpread: 250 },
      'not a name!': { curFail: 50 },
      'has/slash': { curFail: 50 },
    },
    models: ['S25', 'S75', '', 'x'.repeat(80), 42],
  });
  ok('a profile whose name is not a name is dropped',
    Object.keys(junk.profiles).join(',') === 'S25', Object.keys(junk.profiles));
  ok('a field whose key is not an identifier is dropped',
    !('bad key!' in junk.profiles.S25), Object.keys(junk.profiles.S25));
  ok('a non-numeric value is dropped rather than coerced to NaN',
    !('attTrack' in junk.profiles.S25), junk.profiles.S25.attTrack);
  ok('the good values beside them survive',
    junk.profiles.S25.curFail === 50 && junk.profiles.S25.pwmSpread === 250, junk.profiles.S25);
  ok('a model name that is not a name is dropped, and the good ones are kept',
    junk.models.join(',') === 'S25,S75', junk.models);
  ok('a profile that exists becomes pickable even if the model list forgot it',
    T.normaliseAnalyserConfig({ profiles: { S99: {} }, models: [] }).models.indexOf('S99') === 0);
  ok('nonsense in gives an empty config out, never a throw',
    JSON.stringify(T.normaliseAnalyserConfig('no')) === JSON.stringify({ profiles: {}, models: [] }));

  // `__default__` is the reserved profile every airframe inherits from. It starts
  // with an underscore, which the ordinary name test rejects — so a bare regex here
  // silently DELETES the shared default on every save while the panel and the scorer
  // both go on believing it is there. Nothing else in the suite would notice: the
  // reader's own tests call resolveRules directly and never pass through this.
  const def = T.normaliseAnalyserConfig({ profiles: { __default__: { attTrack: 15 } }, models: ['S25'] });
  ok('the reserved shared-default profile SURVIVES the shape check',
    !!def.profiles.__default__ && def.profiles.__default__.attTrack === 15, def.profiles);
  ok('...and is not offered as a model, because it is not an airframe',
    def.models.join(',') === 'S25', def.models);
}

head('a blank field saves as NOTHING — never as zero');

{
  T._alDraft = { profiles: { S25: {} }, models: ['S25'] };
  T._alProfile = 'S25';

  AL_INPUTS.length = 0;
  AL_INPUTS.push(
    { dataset: { key: 'curReview' }, value: '35' },
    { dataset: { key: 'curFail' }, value: '50' },
    { dataset: { key: 'pwmSpread' }, value: '' },
    { dataset: { key: 'attTrack' }, value: '   ' },
    { dataset: { key: 'scoreWobble' }, value: '5' },
  );
  T.alCaptureFields();

  const p = T._alDraft.profiles.S25;
  ok('a filled field is stored as a number', p.curReview === 35 && p.curFail === 50, p);
  ok('an EMPTY field is stored as NOTHING, not as 0 — a 0 A limit would fail every flight',
    !('pwmSpread' in p), Object.keys(p));
  ok('...and neither is a field holding only whitespace',
    !('attTrack' in p), Object.keys(p));
  ok('...while the good values beside the blanks still land',
    p.scoreWobble === 5, p);

  AL_INPUTS.push({ dataset: { key: 'voltCellFail' }, value: '0' });
  T.alCaptureFields();
  ok('a zero is still a zero if someone actually types one',
    T._alDraft.profiles.S25.voltCellFail === 0, T._alDraft.profiles.S25);
  AL_INPUTS.length = 0;
}

head('the limits the scorer gets come from the chosen airframe');

{
  T.analyserConfig = T.normaliseAnalyserConfig({
    profiles: {
      S25: { curReview: 35, curFail: 50, curHoldMs: 5000 },
      S75: { curReview: 40, curFail: 60, curHoldMs: 5000 },
    },
    models: ['S25', 'S75'],
  });
  T.logState.model = 'S75';
  const rules = T.logRules();
  ok('the resolved rules carry the chosen airframe\'s numbers',
    rules.curReview === 40 && rules.curFail === 60, [rules.curReview, rules.curFail]);
  ok('...and say which profile they came from', rules.airframe === 'S75' && rules.profile === 'S75');

  T.logState.model = '';
  const d = T.logRules();
  ok('with no airframe chosen, no airframe limit is applied',
    !('curReview' in d) && !('curFail' in d), [d.curReview, d.curFail]);

  T.logState.model = 'S99';
  const orphan = T.logRules();
  ok('an airframe that no longer exists does not silently borrow another\'s limits',
    !('curReview' in orphan), orphan.curReview);
  T.logState.model = '';
}

head('the picker offers every configured model, and survives one being deleted');

{
  T.analyserConfig = T.normaliseAnalyserConfig({ profiles: {}, models: ['S25', 'S75', 'STRIVER'] });
  T.logState.model = 'S75';
  const html = T.logModelSelectHTML();
  ok('every model is in the dropdown', /S25/.test(html) && /S75/.test(html) && /STRIVER/.test(html));
  ok('the chosen one is the selected option', /value="S75" selected/.test(html), html);
  ok('the shared default is always offered, so an unnamed airframe can still be scored',
    /Default \(all models\)/.test(html));

  // A model removed from the config while a device still remembers it: the picker
  // must still be able to SHOW it, or the dropdown would read "Default" while the
  // remembered name was what actually scored the log.
  T.logState.model = 'GONE';
  const orphanHtml = T.logModelSelectHTML();
  ok('a remembered model that is no longer configured is still selectable, and labelled',
    /value="GONE" selected/.test(orphanHtml) && /no longer configured/.test(orphanHtml), orphanHtml);
  T.logState.model = '';
}

head('the panel is admin-only at the point of writing');

{
  AL_INPUTS.length = 0;
  // A non-admin with a full draft in hand: the save must do NOTHING but say so.
  setAdmin(false);
  T.analyserConfig = { profiles: {}, models: ['S25'] };
  T._alDraft = { profiles: { S25: { curFail: 50 } }, models: ['S25'] };
  T._alProfile = 'S25';

  T.saveAnalyserLimits();
  ok('a non-admin save does not quietly write the config through',
    T.analyserConfig.profiles.S25 === undefined, T.analyserConfig);
  ok('...and the app agrees it was talking to a non-admin', T.isAdmin() === false);

  // ...and the same call by an admin DOES land, or the test above would pass for a
  // broken save function rather than for a working gate.
  setAdmin(true);
  ok('an admin is recognised', T.isAdmin() === true);
  // The draft carries a shared default as well as an airframe, because that is what
  // the panel always has (it creates `__default__` on open) — and the two must both
  // come out the far side of the save.
  T._alDraft = { profiles: { __default__: { attTrack: 15 }, S25: { curFail: 50 } },
                 models: ['S25'] };
  T._alProfile = 'S25';
  T.saveAnalyserLimits();
  ok('an admin\'s save is applied to the live config',
    T.analyserConfig.profiles.S25 && T.analyserConfig.profiles.S25.curFail === 50, T.analyserConfig);
  ok('...and the shared default survived the save, rather than being dropped by the shape check',
    T.analyserConfig.profiles.__default__ && T.analyserConfig.profiles.__default__.attTrack === 15,
    T.analyserConfig.profiles);
  setAdmin(false);
}

head('the panel says what a BLANK field will actually use');

{
  // The panel and the scorer must not disagree on screen. Once a shared default
  // exists, an empty model field is NOT "no limit set" — the log would be scored
  // against the default, so a placeholder saying otherwise is the exact confusion
  // this panel exists to remove.
  T.analyserConfig = T.normaliseAnalyserConfig({
    profiles: { __default__: { curReview: 35, curFail: 50, hdopFail: null } },
    models: ['S25'],
  });
  T._alDraft = T.normaliseAnalyserConfig(T.analyserConfig);
  T._alProfile = 'S25';
  T.renderAnalyserLimitsBody();
  const html = byId.get('al-body').innerHTML;
  // Read the placeholder off the field's OWN tag, so the assertion names which
  // field it is about. A page-wide /inherited/ would pass on any one of them.
  const phFor = (src, key) => {
    const m = src.match(new RegExp(`data-key="${key}"[^>]*?placeholder="([^"]*)"`));
    return m ? m[1] : '(field missing)';
  };
  ok('a field the SHARED DEFAULT sets is named as inherited, with its value',
    phFor(html, 'curReview') === 'inherited: 35' && phFor(html, 'curFail') === 'inherited: 50',
    [phFor(html, 'curReview'), phFor(html, 'curFail')]);
  ok('a field the shared default REMOVED says so, rather than showing the built-in it no longer uses',
    phFor(html, 'hdopFail') === 'no limit set', phFor(html, 'hdopFail'));
  ok('a field the shared default leaves alone still shows the built-in figure',
    phFor(html, 'hdopReview') === 'default 1.5', phFor(html, 'hdopReview'));

  // On the Default chip itself there is nothing above it, so the built-in figure is
  // still the honest answer.
  T._alProfile = '__default__';
  T.renderAnalyserLimitsBody();
  const dflt = byId.get('al-body').innerHTML;
  ok('the Default chip falls back to ArduPilot\'s published figure for what it has not set',
    phFor(dflt, 'hdopReview') === 'default 1.5', phFor(dflt, 'hdopReview'));
  ok('...and what it HAS been set to is shown as the value, not as a placeholder',
    /data-key="curReview"[^>]*?value="35"/.test(dflt), dflt.match(/data-key="curReview".*?\/>/));
  T._alProfile = '';
}

head('the pack fields say where they belong, because a cell count is not a limit');

{
  // The pack describes ONE aircraft. Two things follow that a shared limit does not
  // have: there is nothing above it to inherit, and it must not be set on Default at
  // all — the scorer refuses the shared layer for these (smoke-log-rules pins that),
  // so a panel offering "inherited: 4" would be promising something the reader
  // deliberately does not do, and a Default chip holding a cell count would invite
  // exactly the 4S-on-a-6S mistake.
  T.analyserConfig = T.normaliseAnalyserConfig({
    profiles: { __default__: { attTrack: 15 }, S100: { cellsSeries: 6, packMah: 40000 } },
    models: ['S100'],
  });
  T._alDraft = T.normaliseAnalyserConfig(T.analyserConfig);
  T._alProfile = 'S100';
  T.renderAnalyserLimitsBody();
  const html = byId.get('al-body').innerHTML;
  const phFor = (src, key) => {
    const m = src.match(new RegExp(`data-key="${key}"[^>]*?placeholder="([^"]*)"`));
    return m ? m[1] : '(field missing)';
  };
  ok('the panel offers the pack fields at all — they are part of the same list',
    phFor(html, 'cellsSeries') !== '(field missing)' && phFor(html, 'packMah') !== '(field missing)');
  ok('an unrecorded pack reads as unrecorded, NOT as "no limit set" — it is a fact, not a limit',
    phFor(html, 'cellsSeries') === 'not recorded', phFor(html, 'cellsSeries'));
  ok('...and an airframe that HAS declared its pack shows the number as the value',
    /data-key="cellsSeries"[^>]*?value="6"/.test(html), html.match(/data-key="cellsSeries".*?\/>/));
  ok('...and a shared default above it is NOT offered as an inherited value',
    !/inherited/.test(phFor(html, 'packMah')), phFor(html, 'packMah'));
  ok('...while an ordinary limit beside it still inherits from the shared default',
    phFor(html, 'attTrack') === 'inherited: 15', phFor(html, 'attTrack'));

  T._alProfile = '__default__';
  T.renderAnalyserLimitsBody();
  const dflt = byId.get('al-body').innerHTML;
  ok('on the Default chip a pack field says where it belongs instead of pretending to apply',
    phFor(dflt, 'cellsSeries') === 'set this on each model', phFor(dflt, 'cellsSeries'));
  T._alProfile = '';
}

head('the score panel says what was and was NOT measured');

{
  const report = {
    verdict: 'REVIEW',
    score: {
      total: 88,
      airframe: 'S25',
      profile: 'S25',
      parts: [
        { id: 'vibeX', label: 'X vibration', score: 100, band: 'green', detail: 'peak 5.0 m/s²' },
        { id: 'gps', label: 'GPS quality', score: 40, band: 'amber', detail: 'worst HDop 1.8' },
      ],
      checklist: [{ id: 'clipping', label: 'Accelerometer clipping', detail: '3 clips.', needsTick: true }],
      open: [{ id: 'err', label: 'ERR subsystem codes', detail: 'No rule yet.' }],
    },
  };
  const html = T.logScoreHTML(report);
  ok('the total is shown', /88/.test(html), html.slice(0, 120));
  ok('the profile it was judged against is named', /S25/.test(html));
  ok('every scored area is listed with its own score', /X vibration/.test(html) && /GPS quality/.test(html));
  ok('the headline band is DERIVED from the areas, not invented — amber here, because one area is',
    /badge-pending/.test(html), html.match(/badge-\w+/g));
  ok('an item needing a human tick is shown as such', /Accelerometer clipping/.test(html));
  ok('an area with no rule is shown in its own block, not folded into the score',
    /ERR subsystem codes/.test(html) && /Shown, not scored/.test(html));
  ok('a report with no score renders nothing rather than an empty frame',
    T.logScoreHTML({ verdict: 'PASS' }) === '');
}

finish();
