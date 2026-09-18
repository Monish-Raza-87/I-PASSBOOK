// Smoke test for the chosen polish level.
//
//   node tools/smoke-polish.mjs
//
// The polish level is NOT a build flag, a config value or a class on <html>: it
// is a block at the end of views.css, and the owner picked it from a preview
// (tools/build-polish-preview.mjs). That has two failure modes nothing else in
// this repo would catch:
//
//   1. The block only works because it is LAST and at EQUAL specificity. Every
//      rule in it restates a selector that already exists earlier. Move the
//      block, or reorder the stylesheet links, and the polish silently stops
//      applying — no error, just a plainer app.
//   2. The preview and the app can drift. The owner chose "Noticeable" by
//      looking at the preview, so what ships has to be what they approved. If
//      someone edits the preview's Noticeable rules, this suite fails until the
//      app follows — or until the deviation is declared, with a reason.
//
// So it parses both real files and compares them. It never restates values.

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const viewsCss = read('../views.css');
const componentsCss = read('../components.css');
const baseCss = read('../base.css');
const tokensCss = read('../tokens.css');
const paletteCss = read('../palette.css');
const swJs = read('../sw.js');
const preview = read('../tools/build-polish-preview.mjs');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── Strip comments, then parse rules (one level of @media included) ──────────
// Comments must go first: this file's own header mentions selectors and the word
// "Noticeable", and a naive scan reads them as rules.
const decomment = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rules(css) {
  const out = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    // Find this rule's body, and whether a nested block follows (an at-rule).
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    const inner = css.slice(re.lastIndex, i - 1);
    if (/^@/.test(sel)) {
      // An at-rule has no declarations of its own — recurse for its contents.
      out.push(...rules(inner));
      re.lastIndex = i;
      continue;
    }
    out.push({ sel, body: inner.trim() });
  }
  return out;
}

const decls = body =>
  body
    .split(';')
    .map(d => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

// ── The shipped block ────────────────────────────────────────────────────────
const MARK = 'POLISH — level: NOTICEABLE';
const markAt = viewsCss.indexOf(MARK);
ok('views.css carries a polish block, marked with its level', markAt > 0, markAt);

const blockStart = markAt > 0 ? viewsCss.lastIndexOf('/*', markAt) : -1;
const polishRaw = blockStart >= 0 ? viewsCss.slice(blockStart) : '';
const polishCss = decomment(polishRaw);
const polish = rules(polishCss);
const polishSels = [...new Set(polish.flatMap(r => r.sel.split(',').map(s => s.trim())))];

ok('the block contains rules', polish.length >= 8, polish.length);

// The block's whole argument is "it is last". A second section banner after it
// means someone appended past it, and the block is no longer the tail — which is
// exactly how the polish would start applying only sometimes.
ok('nothing was appended after the polish block',
  (polishRaw.match(/\/\* ═/g) || []).length === 1,
  (polishRaw.match(/\/\* ═[^\n]*/g) || []).slice(1));

head('the polish block is token-only, and every token resolves');

const hex = polishCss.match(/#[0-9a-fA-F]{3,8}\b/g);
ok('no raw hex colours', !hex, hex);
ok('no !important — the level is not winning by force', !/!important/.test(polishCss));

// A misspelled token name resolves to nothing in the browser, so the property
// falls back to its inherited value and the polish half-disappears.
const declared = new Set(
  [...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g), ...paletteCss.matchAll(/(--[a-z0-9-]+)\s*:/g)]
    .map(m => m[1])
);
const used = [...new Set([...polishCss.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))];
const unknown = used.filter(n => !declared.has(n));
ok('every token it uses is declared by tokens.css or palette.css', unknown.length === 0, unknown);
ok('it uses the accent role, so it follows the palette',
  used.some(n => n.startsWith('--accent')), used);
ok('it uses the elevation role, so depth is Frappe\'s, not invented',
  used.some(n => n.startsWith('--elevation-')), used);

head('the block wins because it is last, not because it is stronger');

// Every selector in the polish block must already exist EARLIER — in views.css
// above the block, or in a stylesheet that loads before views.css. That is the
// whole mechanism; a selector that exists nowhere else means the block is the
// only definition, and reordering the file would then silently drop it.
const earlier = decomment(viewsCss.slice(0, blockStart)) + '\n'
  + decomment(componentsCss) + '\n' + decomment(baseCss);
const earlierSels = new Set(rules(earlier).flatMap(r => r.sel.split(',').map(s => s.trim())));
const orphans = polishSels.filter(s => !earlierSels.has(s));
ok('every selector it restates already exists earlier in the cascade',
  orphans.length === 0, orphans);

// Equal specificity is the design; a rule that escalated itself with an id would
// make the "last" argument meaningless and could beat rules it should not.
const escalate = polish
  .filter(r => r.sel.split(',').some(s => /#/.test(s)) && !/^#/.test(r.sel.trim()))
  .map(r => r.sel);
ok('no rule escalates specificity with an id it did not inherit',
  escalate.length === 0, escalate);

head('accessibility survives the level');

// The hover slide is a STATE change, not a transition, so base.css's global
// reduced-motion rule (which only shortens transitions) cannot switch it off.
ok('the hover transform is behind prefers-reduced-motion: no-preference',
  /@media \(prefers-reduced-motion: no-preference\)/.test(polishCss) &&
  /transform/.test(polishCss), polishCss.slice(Math.max(0, polishCss.indexOf('transform') - 90),
    polishCss.indexOf('transform') + 40));
ok('the reduced-motion rule in base.css still exists to cover the transitions',
  /@media \(prefers-reduced-motion: reduce\)/.test(decomment(baseCss)));

// A cosmetic level must never repaint a status. The badges encode meaning
// (open / closed / urgent); the accent encodes taste.
const badgeSels = polishSels.filter(s => /\.(badge|prio)\b/.test(s));
ok('the level does not touch a status badge or a priority pill',
  badgeSels.length === 0, badgeSels);

head('the preview and the app agree — the owner approved what ships');

// The preview scopes its rules with a level attribute; the app cannot. So pull
// the level-scoped part off each preview selector and require the app to carry
// the same declaration.
const pvFrom = preview.indexOf('const POLISH = `');
const pvBlock = decomment(preview.slice(pvFrom, preview.indexOf('\n`;', pvFrom)));
const pvRules = rules(pvBlock.replace(/\$\{[^}]*\}/g, ''));

// The review page's own wrappers, which have no app class. Each entry either
// names the app rule that carries its intent — checked below — or is null
// because the level it belongs to has no app counterpart at all.
const CHROME = {
  '.pv-block': '.overview-panel',
  '.pv-pagehead': '#ir-banner',
  '.pv-eyebrow': null, '.pv-title': null, '.pv-sub': null,
  '.pv-stack': null, '.pv-pane': null, '.pv-label': null, '.pv-scrim': null,
  '.stage': null,
};

const wanted = [];
for (const r of pvRules) {
  const parts = r.sel.split(',').map(s => s.trim())
    .filter(s => /data-polish="(moderate|noticeable)"/.test(s));
  if (!parts.length) continue;
  for (const p of parts) {
    const app = p.replace(/^\.stage\[data-polish="[a-z]+"\]\s*/, '').trim();
    // --pv-gap / --pv-pad are the review wrapper's own layout, not app values.
    const body = decls(r.body).filter(d => !d.startsWith('--pv-'));
    if (body.length) wanted.push({ app, body });
  }
}

// A preview rule scoped to both levels lists each app selector twice; check it
// once.
const seenApp = new Set();

const pvOnly = [];
for (const w of wanted) {
  if (w.app in CHROME) { pvOnly.push(w.app); continue; }
  if (seenApp.has(w.app)) continue;
  seenApp.add(w.app);
  const rule = polish.find(x => x.sel.split(',').map(s => s.trim()).includes(w.app));
  const have = rule ? decls(rule.body) : [];
  const missing = w.body.filter(d => !have.includes(d));
  ok(`the app restates the preview's ${w.app}`, !!rule && missing.length === 0, { missing, have });
}

ok('every preview-chrome selector is a declared exception',
  pvOnly.every(s => s in CHROME), [...new Set(pvOnly)].filter(s => !(s in CHROME)));
ok('each exception names where its intent went, and that rule exists',
  Object.values(CHROME).every(v => v === null || polishSels.includes(v)),
  Object.values(CHROME).filter(v => v && !polishSels.includes(v)));

head('the level ships');

ok('views.css is in the service worker shell', /'\.\/views\.css'/.test(swJs));
ok('the cache name is versioned, so the new stylesheet reaches installed clients',
  /const CACHE_NAME = 'ipassbook-v\d+';/.test(swJs),
  (swJs.match(/CACHE_NAME = '[^']+'/) || [])[0]);

console.log(fails ? `\n${fails} FAILED` : '\nall polish assertions passed');
process.exit(fails ? 1 : 0);
