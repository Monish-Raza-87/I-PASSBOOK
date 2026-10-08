// Rebuilds faq.html from faq-content.js.
//
//   node tools/build-faq.mjs            rewrite faq.html in place
//   node tools/build-faq.mjs --check    fail if it is out of date, write nothing
//
// ── Why this exists ────────────────────────────────────────────────────────────
// There is ONE FAQ, and it is faq-content.js. Two things render it:
//
//   app.js               #/faq — the view inside the app, where the answers are
//                        collapsed rows in the app's own skin
//   tools/build-faq.mjs  faq.html — the same answers as a standalone page
//
// The standalone page is not redundant. It is linked from the SIGN-IN screen, and
// the person who most needs to read "how do I get in" is the one who cannot get in —
// there is no shell to put them in yet. So the page stays, and it is GENERATED, so
// a sentence changed in one place cannot end up true in the app and stale on the
// page the signed-out customer is reading.
//
// ── What is generated, and what is not ──────────────────────────────────────────
// Only the region between the two BUILD:FAQ markers inside <body>. Everything above
// it — the page's own token set, its two dark blocks, its typesetting — is
// hand-authored IN faq.html and is left exactly as it is found. Those markers are
// the contract: a hand edit inside them is overwritten on the next run, and a hand
// edit outside them survives.
//
//   node tools/build-faq.mjs --check
//
// is what smoke-door-faq.mjs runs, so a stale page fails the build rather than
// quietly going out of date.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = path.join(ROOT, 'faq.html');
const CONTENT = path.join(ROOT, 'faq-content.js');

const BEGIN = '<!-- BUILD:FAQ:BEGIN -->';
const END = '<!-- BUILD:FAQ:END -->';

// ── Read the content ──────────────────────────────────────────────────────────
// Evaluated in a bare context with only `window` supplied, which is exactly the
// shape the file is written for: it is a classic script that assigns to window,
// precisely so this tool and the browser can read the same object without a module
// system. No DOM, no globals, no side door.
function loadContent() {
  const src = fs.readFileSync(CONTENT, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'faq-content.js' });
  const C = sandbox.window.FAQ_CONTENT;
  if (!C || !Array.isArray(C.sections) || !C.sections.length) {
    throw new Error('faq-content.js did not define window.FAQ_CONTENT.sections');
  }
  return C;
}

// ── The page body ─────────────────────────────────────────────────────────────
// `html` fields are raw inner markup, authored in faq-content.js, carrying a <strong>
// and one external link; `q`, `title` and the jump labels are plain text and are
// escaped here, because plain text rendered as markup is how a question mark in a
// heading becomes a broken document.
const esc = s => String(s == null ? '' : s)
  .replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function blocksHTML(blocks) {
  return (blocks || []).map(b => {
    if (b.t === 'callout') {
      return `    <div class="callout${b.ok ? ' ok' : ''}">\n`
        + (b.ct ? `      <span class="ct">${esc(b.ct)}</span>\n` : '')
        + `      <p>\n${indent(b.html)}\n      </p>\n    </div>\n`;
    }
    if (b.t === 'ul') {
      return `    <ul>\n`
        + (b.items || []).map(li => `      <li>${li}</li>\n`).join('')
        + `    </ul>\n`;
    }
    return `    <p>\n${indent(b.html)}\n    </p>\n`;
  }).join('\n');
}

// The stored markup keeps the author's own line breaks so the two renderers show
// the same words; indenting them is only so the generated file is readable.
const indent = html => String(html == null ? '' : html)
  .split('\n')
  .map(l => '      ' + l.trim())
  .join('\n');

function bodyHTML(C) {
  const out = [];
  out.push('<header class="masthead">');
  out.push('  <div class="wrap">');
  out.push(`    <p class="eyebrow">${esc(C.eyebrow)}</p>`);
  out.push(`    <h1>${esc(C.title)}</h1>`);
  if (C.standfirst) out.push(`    <p class="standfirst">\n${indent(C.standfirst)}\n    </p>`);
  out.push('  </div>');
  out.push('</header>');
  out.push('');
  out.push('<div class="wrap">');
  out.push('');
  out.push('  <nav class="jump" aria-label="Jump to a section">');
  for (const j of C.jump || []) out.push(`    <a href="#${esc(j.id)}">${esc(j.title)}</a>`);
  out.push('  </nav>');

  for (const sec of C.sections) {
    out.push('');
    out.push(`  <section id="${esc(sec.id)}">`);
    out.push(`    <h2>${esc(sec.title)}</h2>`);
    for (const item of sec.items || []) {
      out.push('');
      out.push(`    <h3>${esc(item.q)}</h3>`);
      out.push(blocksHTML(item.blocks).replace(/\n$/, ''));
    }
    out.push('  </section>');
  }

  out.push('');
  out.push('  <footer class="end">');
  for (const p of C.footer || []) out.push(`    <p>\n${indent(p)}\n    </p>`);
  out.push('  </footer>');
  out.push('');
  out.push('</div><!-- .wrap -->');
  return out.join('\n') + '\n';
}

// ── Splice it into the page ───────────────────────────────────────────────────
const page = fs.readFileSync(PAGE, 'utf8');
const beginAt = page.indexOf(BEGIN);
const endAt = page.indexOf(END);
if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
  console.error('faq.html carries no ' + BEGIN + ' … ' + END + ' region, so there is');
  console.error('nothing to build into. Restore the markers and run this again.');
  process.exitCode = 1;
  process.exit();
}

const C = loadContent();
const head = page.slice(0, beginAt + BEGIN.length);
const tail = page.slice(endAt);
const next = head + '\n' + bodyHTML(C) + tail;
const changed = next !== page;

if (process.argv.includes('--check')) {
  if (changed) {
    console.error('faq.html is OUT OF DATE relative to faq-content.js.');
    console.error('Run:  node tools/build-faq.mjs');
    process.exitCode = 1;
  } else {
    const qs = C.sections.reduce((n, s) => n + s.items.length, 0);
    console.log(`faq.html is up to date — ${C.sections.length} sections, ${qs} questions.`);
  }
} else {
  if (changed) fs.writeFileSync(PAGE, next, { encoding: 'utf8', newline: '' });
  const qs = C.sections.reduce((n, s) => n + s.items.length, 0);
  console.log(`${changed ? 'rebuilt' : 'unchanged'} faq.html — ${C.sections.length} sections, ${qs} questions.`);
}
