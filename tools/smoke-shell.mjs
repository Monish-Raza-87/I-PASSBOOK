// Smoke test for the index.html ⇄ app.js DOM contract.
//
//   node tools/smoke-shell.mjs
//
// app.js runs as a plain end-of-body <script> and captures a set of element ids
// into top-level `const`s the moment it evaluates. Every one of those ids must
// exist in index.html at parse time, or the whole app fails to boot — silently,
// because there is no bundler and no type checker to catch it.
//
// This test derives the required ids FROM app.js rather than listing them, so it
// catches a rename on either side, and it pins the tab/pane shape that the
// Frappe pivot's routing and access-gating depend on.

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const viewsCss = read('../views.css');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── Every parse-time getElementById must resolve ──────────────────────────────
head('parse-time element ids');
const parseTimeIds = [...appJs.matchAll(/\nconst\s+(\w+)\s*=\s*document\.getElementById\(['"]([^'"]+)['"]\)/g)]
  .map(m => ({ name: m[1], id: m[2] }));

ok('app.js captures ids at parse time', parseTimeIds.length >= 12, parseTimeIds.length);

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const missing = parseTimeIds.filter(x => !htmlIds.has(x.id));
ok('every captured id exists in index.html', missing.length === 0, missing);

// ── The section strip ─────────────────────────────────────────────────────────
head('the section strip');
const tabs = [...html.matchAll(/<div class="tab[^"]*"([^>]*)>/g)].map(m => m[1]);
const tabSection = attr => (attr.match(/data-section="([^"]+)"/) || [])[1];
const tabIds = tabs.map(tabSection).filter(Boolean);
const sectionTabs = tabIds.filter(id => id !== 'sec-intake');

ok('exactly 9 section tabs', sectionTabs.length === 9, sectionTabs);
ok('the 📋 Report tab is present and marked data-intake',
  /data-section="sec-intake"[^>]*data-intake="1"/.test(html), tabs);
ok('the intake tab is first, so the report reads as the cover page',
  tabIds[0] === 'sec-intake', tabIds);
ok('the intake tab carries no section pane in SECTIONS\' shape (it is not savable)',
  !/\n\s*'sec-intake':/.test(appJs));

// The gating fallback must skip the intake tab or it would always win it: the
// intake pane is never hidden, so it is always "the first visible tab".
ok('the active-tab fallback excludes the intake tab',
  /querySelector\('\.tab:not\(\[style\*="display: none"\]\):not\(\[data-intake\]\)'\)/.test(appJs));

head('section panes');
const SECTION_IDS = (appJs.match(/const SECTION_IDS = \[([^\]]+)\]/) || [])[1];
const sectionIds = SECTION_IDS.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
ok('SECTION_IDS has 9 entries', sectionIds.length === 9, sectionIds);

const paneIds = [...html.matchAll(/<div id="(sec-[a-z]+)" class="section-content/g)].map(m => m[1]);
ok('every SECTION_ID has a pane', sectionIds.every(s => paneIds.includes(s)), { sectionIds, paneIds });
ok('every SECTION_ID has a tab', sectionIds.every(s => tabIds.includes(s)), { sectionIds, tabIds });
ok('the intake pane exists', paneIds.includes('sec-intake'), paneIds);
ok('panes are exactly the 9 sections + the intake view',
  paneIds.length === 10 && paneIds.filter(p => p !== 'sec-intake').length === 9, paneIds);

// ── Contracts the pivot depends on ────────────────────────────────────────────
head('load-bearing contracts');
ok('app.js is a plain end-of-body script (no module/defer)',
  /<script src="app\.js"><\/script>/.test(html) && !/type="module"/.test(html));
ok('the intake pane is rendered by renderIntake(), never saved',
  /function renderIntake\(/.test(appJs) && /renderIntake\(\);/.test(appJs));
ok('saveDraft ignores non-SECTIONS panes',
  /if \(!SECTIONS\[sectionId\]\) return;/.test(appJs));
const cascade = ['tokens.css', 'base.css', 'components.css', 'views.css'].map(f => html.indexOf(f));
ok('the stylesheet cascade order is unchanged',
  cascade.every((v, i) => v >= 0 && (i === 0 || v > cascade[i - 1])), cascade);

head('new styles are token-only (no raw hex, no px font sizes)');
const intakeCss = (viewsCss.match(/\/\* ── Client's original report[\s\S]*?(?=\n\/\* ──|\Z)/) || [''])[0];
ok('intake styles present', intakeCss.includes('.intake-row'), intakeCss.slice(0, 120));
ok('no raw hex colours', !/#[0-9a-fA-F]{3,8}\b/.test(intakeCss), intakeCss.match(/#[0-9a-fA-F]{3,8}\b/g));
ok('no px font sizes', !/font-size:\s*[\d.]+px/.test(intakeCss), intakeCss.match(/font-size:\s*[\d.]+px/g));

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
