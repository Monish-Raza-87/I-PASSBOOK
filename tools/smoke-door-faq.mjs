// Smoke test for the app's second open door and the FAQ behind it.
//
//   node tools/smoke-door-faq.mjs
//
// These are the only two things in the product a member of the PUBLIC can reach:
// the Report-a-problem entry on the sign-in screen, and faq.html. Everything else
// is behind a session token, so this suite exists to hold the line on the two
// properties that make them safe to leave open, plus the one that makes them
// useful:
//
//   1. THE DOOR READS NOTHING. The modal must contain a form and nothing else —
//      no ticket, no IR number, no customer name. It is a way in, not a window.
//   2. THE DOOR DOES NOT PHONE HOME. An <iframe src> fetches on page load, so a
//      src sitting in index.html would mean every app user — including the ones
//      who never open the form — sent a request to Google from inside a tool
//      holding customer data. The src is therefore set on OPEN, and this suite
//      fails if one ever appears in the markup.
//   3. THE FRAME IS NEVER THE ONLY WAY. Some phones refuse a cross-origin frame
//      outright, so the "Open in a new tab" link has to be present and always
//      visible, not a fallback that appears after a failure it cannot detect.
//
// And for the FAQ: it must be INERT. A static page that ships a script is one
// request away from being a tracking surface, and this page's whole job is to be
// trustworthy. Zero scripts, zero tables, zero third-party hosts.
//
// It parses the real files. It never restates a value.

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const indexHtml = read('../index.html');
const faqHtml = read('../faq.html');
const componentsCss = read('../components.css');
const swJs = read('../sw.js');
const deploy = read('./deploy-ghpages.mjs');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// Strip CSS and JS comments before any structural count. This file's own header
// names the very things it counts (`<iframe src>`, `script`), and a suite that
// counts its own prose is a suite that passes for the wrong reason.
const stripCss = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// HTML comments, for the same reason: index.html's own comment above the modal
// explains that the frame carries no src, and says the word.
const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, '');

const appCode = stripJs(appJs);
const indexCode = stripHtml(indexHtml);
const faqCode = stripHtml(faqHtml);
const css = stripCss(componentsCss);

// ── The door: what it is wired to ────────────────────────────────────────────
head('the customer door, in app.js');

const urlConst = (appCode.match(/const CUSTOMER_FORM_URL\s*=\s*'([^']*)'/) || [])[1];
ok('CUSTOMER_FORM_URL is a plain top-level constant',
  /^const CUSTOMER_FORM_URL\s*=\s*'[^']*';/m.test(appCode), urlConst);
// Empty is the only honest default: the app cannot know someone else's form URL,
// and a button that opens a blank frame is worse than no button at all.
ok('and it ships EMPTY, so the entry is hidden until a URL is pasted in',
  urlConst === '', JSON.stringify(urlConst));

const wire = (appCode.match(/function wireCustomerDoor\(\)\s*\{[\s\S]*?\r?\n\}\r?\n/) || [''])[0];
ok('wireCustomerDoor() exists and is a real function', wire.length > 700, wire.length);
ok('...and it returns before wiring anything when there is no URL',
  /if \(!CUSTOMER_FORM_URL\) return;/.test(wire), wire.slice(0, 200));
ok('...and it is called from the load handler, not from showAuth()',
  /wireCustomerDoor\(\);/.test(appCode) &&
  /window\.I18N\.applyStatic\(\);[\s\S]{0,400}wireCustomerDoor\(\);/.test(appCode),
  (appCode.match(/wireCustomerDoor\(\);/g) || []).length);

// The one rule that keeps this from becoming a tracking beacon. Order matters:
// the display flip must come AFTER the guard, or a device with no URL configured
// gets a visible button that opens nothing.
ok('the entry is only revealed after the URL guard',
  wire.indexOf('if (!CUSTOMER_FORM_URL) return;') < wire.indexOf("open.style.display = ''"),
  wire.indexOf('if (!CUSTOMER_FORM_URL) return;') + ' / ' + wire.indexOf("open.style.display = ''"));

// ── The src, and where it is allowed to be set ───────────────────────────────
head('the frame, and the one request it must not make');

ok('the src is set by script, and only inside show()',
  /frame\.setAttribute\('src', embed\)/.test(wire) &&
  (wire.match(/setAttribute\('src'/g) || []).length === 1,
  (wire.match(/setAttribute\('src'/g) || []).length);
ok('...and only when it is not already set, so reopening keeps a half-typed form',
  /if \(!frame\.getAttribute\('src'\)\)/.test(wire), 'reopen guard');
ok('...and `embedded=true` is appended to the stored URL, never stored in it',
  /'embedded=true'/.test(wire) && !/embedded=true/.test(urlConst),
  { appended: (wire.match(/'embedded=true'/g) || []).length, inConstant: /embedded=true/.test(urlConst) });
ok('...and the query is joined with the right separator when the URL has one already',
  /includes\('\?'\)/.test(wire), 'separator guard');

const frameTag = (indexCode.match(/<iframe[^>]*id="customer-door-frame"[^>]*>/) || [''])[0];
ok('the iframe in index.html carries NO src attribute',
  frameTag.length > 40 && !/\ssrc\s*=/.test(frameTag), frameTag);
ok('...and no src anywhere else in the markup points at Google',
  !/src\s*=\s*"https?:\/\/(docs\.google|forms\.gle)/.test(indexCode), 'scanned index.html');
ok('...and it is lazy, so opening the door is what triggers the load',
  /loading="lazy"/.test(frameTag), frameTag);

// ── The frame is never the only path ─────────────────────────────────────────
head('the escape hatch beside the frame');

ok('the "Open in a new tab" link is real markup, not built on failure',
  /id="customer-door-tab"[^>]*target="_blank"/.test(indexCode), 'anchor check');
ok('...and it is not hidden by default',
  !/id="customer-door-tab"[^>]*style="display:none"/.test(indexCode), 'display check');
ok('...and it points somewhere real — the script sets its href from the same constant',
  /tab\.href = CUSTOMER_FORM_URL;/.test(wire), 'href assignment');
ok('...and it is a plain link, never window.open (which phones block)',
  !/window\.open\(/.test(wire), (wire.match(/window\.open\(/g) || []).length);
ok('...and it opens with noopener, so the form cannot reach back into the app',
  /rel="noopener noreferrer"/.test(indexCode), 'rel check');

// ── The door reads nothing ───────────────────────────────────────────────────
// The strongest assertion here: the modal's own markup must not mention a ticket.
// A future "your recent reports" panel would fail this, and that is the point —
// it is a decision, not an accident, and it should need a deliberate edit here.
const doorHtml = (indexCode.match(/<div class="customer-door" id="customer-door"[\s\S]*?\n  <\/div>/) || [''])[0];
ok('the door modal exists in index.html', doorHtml.length > 400, doorHtml.length);
ok('...and the modal contains a form frame, nothing else',
  /<iframe/.test(doorHtml) && /customer-door-note/.test(doorHtml), 'shape');
ok('...and it names no IR, no customer and no ticket anywhere inside it',
  !/IR-|irNumber|ir-number|ticket #/i.test(doorHtml), doorHtml.slice(0, 160));
ok('...and the note says where the form is hosted and when it loads',
  /hosted by Google/.test(doorHtml) && /until you open/i.test(doorHtml), 'note text');

// ── Escaping it, four ways ───────────────────────────────────────────────────
head('closing the door');

ok('the close button is wired', /close\.addEventListener\('click', hide\)/.test(wire), 'close handler');
ok('the dimmed ground closes it, and a tap inside the card does not',
  /e\.target === door/.test(wire), 'backdrop handler');
ok('Escape closes it', /e\.key === 'Escape'/.test(wire), 'key handler');
ok('...and Escape only fires while it is open, so it does not swallow keys elsewhere',
  /door\.style\.display !== 'none'/.test(wire), 'open guard');
ok('the page behind is frozen while it is open, and released on close',
  (wire.match(/document\.body\.style\.overflow/g) || []).length === 2,
  (wire.match(/document\.body\.style\.overflow/g) || []).length);
ok('focus goes into the dialog, and back to where it came from',
  /prevFocus/.test(wire) && /\.focus\(\)/.test(wire) &&
  (wire.match(/prevFocus/g) || []).length >= 3, (wire.match(/prevFocus/g) || []).length);
ok('the card is a dialog with a label, so a screen reader announces it',
  /role="dialog"/.test(indexHtml) && /aria-modal="true"/.test(indexHtml) &&
  /aria-labelledby="customer-door-title"/.test(indexHtml), 'aria check');

// ── The CSS the door ships with ──────────────────────────────────────────────
head('the door, styled');

const rule = (sel) => {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return (css.match(re) || [])[1] || '';
};
const overlay = rule('.customer-door');
ok('.customer-door is a fixed full-screen overlay above the app', /position:\s*fixed/.test(overlay) &&
  /inset:\s*0/.test(overlay) && /z-index:\s*var\(--z-modal\)/.test(overlay), overlay);
ok('...and it is dimmed in both themes, from a token-free literal (an overlay is always dark)',
  /background:\s*rgb\(0 0 0/.test(overlay) &&
  /\[data-theme="dark"\]\s*\.customer-door\s*\{[^}]*rgb\(0 0 0/.test(css), 'dark override');
const card = rule('.customer-door-card');
ok('the card is sized by HEIGHT, so the frame has something to fill',
  /height:\s*88vh/.test(card) && !/(^|;)\s*min-height/.test(card), card);
ok('...and the iframe fills it rather than collapsing to zero',
  /height:\s*100%/.test(rule('.customer-door-body iframe')), rule('.customer-door-body iframe'));
ok('...and a phone gets the full height with no rounding',
  /@media \(max-width: 640px\)[\s\S]{0,200}height:\s*100%/.test(css), 'mobile rule');
ok('every colour in it comes from a token, never a one-theme literal',
  !/#[0-9a-fA-F]{3,8}\b/.test(overlay + card), (overlay + card).match(/#[0-9a-fA-F]{3,8}/g));

// ── The FAQ page ─────────────────────────────────────────────────────────────
head('faq.html is inert');

ok('it is a complete standalone document',
  /^<!doctype html>/i.test(faqHtml) && /<\/html>\s*$/.test(faqHtml), faqHtml.length);
ok('it has a viewport meta — without it a phone lays it out at 980px',
  /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(faqHtml), 'viewport');
ok('it runs NO script at all',
  !/<script/i.test(faqCode) && !/\son[a-z]+\s*=\s*"/i.test(faqCode),
  { script: /<script/i.test(faqCode), inline: (faqCode.match(/\son[a-z]+\s*=\s*"/gi) || []).length });
ok('...and no javascript: link', !/javascript:/i.test(faqCode), 'js href scan');
ok('...and it loads nothing from any third party',
  !/(src|href)\s*=\s*"https?:\/\//i.test(faqCode),
  (faqCode.match(/(src|href)\s*=\s*"https?:\/\/[^"]*"/gi) || []));
ok('...and it carries no form, so it cannot collect anything',
  !/<form|<input|<textarea/i.test(faqCode), 'input scan');
ok('...and its footer says so, in words',
  /runs no scripts, sends nothing and records nothing/i.test(faqCode), 'footer claim');

head('faq.html is readable');

ok('there is NO table on it — a readable table means sideways scrolling on a phone',
  !/<table/i.test(faqCode), 'table scan');
ok('every jump link lands on a heading that exists',
  (() => {
    const ids = new Set((faqHtml.match(/id="([a-z][\w-]*)"/g) || []).map(s => s.slice(4, -1)));
    const targets = (faqHtml.match(/href="#([\w-]+)"/g) || []).map(s => s.slice(7, -1));
    return targets.length >= 8 && targets.every(t => ids.has(t));
  })(), (faqHtml.match(/href="#[\w-]+"/g) || []).filter(t => !faqHtml.includes('id="' + t.slice(7, -1) + '"')));
ok('the app is one tap away from it', /href="index\.html"/.test(faqCode), 'back link');
ok('it defines a complete light palette on bare :root, before any dark block',
  (() => {
    const bare = (faqHtml.split(':root {')[1] || '').split('}')[0];
    const dark = faqHtml.indexOf('prefers-color-scheme: dark');
    return /--bg:/.test(bare) && /--fg:/.test(bare) && /--surface:/.test(bare) &&
      faqHtml.indexOf('--bg:') < dark;
  })(), 'token order');
ok('...and the two dark blocks re-point the SAME tokens, so neither theme shows a hole',
  (() => {
    const bare = (faqHtml.split(':root {')[1] || '').split('}')[0];
    const names = (bare.match(/--[\w-]+(?=\s*:)/g) || []);
    const themeBlock = (faqHtml.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) || [])[1] || '';
    const themed = (themeBlock.match(/--[\w-]+(?=\s*:)/g) || []);
    return names.length >= 10 && themed.length >= 10 &&
      themed.every(n => names.includes(n));
  })(), 'dark token coverage');
ok('...and the two dark blocks cover the same tokens, so the toggle and the OS agree',
  (() => {
    const setOf = s => new Set((s.match(/--[\w-]+(?=\s*:)/g) || []));
    const media = (faqHtml.match(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/) || [])[1] || '';
    const attr = (faqHtml.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) || [])[1] || '';
    const a = setOf(media), b = setOf(attr);
    return a.size >= 10 && a.size === b.size && [...a].every(n => b.has(n));
  })(), 'dark-block parity');

head('faq.html answers are true');

// The answers quote numbers the code owns. If a constant moves and the page does
// not, this page starts lying to the people least able to check it.
ok('the code lifetime it quotes (8h30m / 510 min) matches the backend',
  /eight and a half hours/i.test(faqCode) && /LOGIN_OTP_TTL_MIN\s*=\s*510/.test(read('../backend.gs')),
  'backend LOGIN_OTP_TTL_MIN');
ok('the five-attempt burn it quotes matches the backend',
  /five wrong attempts/i.test(faqCode) && /CODE_MAX_ATTEMPTS\s*=\s*5/.test(read('../backend.gs')),
  'backend CODE_MAX_ATTEMPTS');
ok('the fifteen-minute lockout it quotes matches the backend',
  /fifteen minutes/i.test(faqCode) && /LOGIN_LOCK_MS\s*=\s*15 \* 60 \* 1000/.test(read('../backend.gs')),
  'backend LOGIN_LOCK_MS');
ok('the overdue thresholds it quotes match the app',
  /more than 1 day/i.test(faqCode) && /more than 3 days/i.test(faqCode) &&
  /more than 7 days/i.test(faqCode) && /more than 14 days/i.test(faqCode) &&
  /IR_OVERDUE_DAYS = \{ Urgent: 1, High: 3, Medium: 7, Low: 14 \}/.test(appCode),
  'IR_OVERDUE_DAYS');
ok('...including the default it quotes for a ticket with no priority',
  /no priority is treated as 14 days/.test(faqCode) &&
  /IR_OVERDUE_DEFAULT_DAYS = 14/.test(appCode), 'IR_OVERDUE_DEFAULT_DAYS');
ok('the log analyser claim is the one the code makes — read locally, never uploaded',
  /never leaves the machine/i.test(faqCode), 'privacy claim');
ok('it promises no privacy policy and no analytics, which is what the app is',
  !/privacy policy/i.test(faqCode) && /no analytics, no tracking/i.test(faqCode), 'scope claim');

// ── Where the page is reachable from ─────────────────────────────────────────
head('the FAQ is reachable, and it ships');

ok('the sign-in screen links to it', /id="auth-faq-link"[^>]*href="faq\.html"/.test(indexCode),
  'sign-in link');
ok('...and it is NOT hidden with the Report button — the FAQ needs no URL to exist',
  /id="auth-faq-link"[^>]*href="faq\.html"/.test(indexCode) &&
  !/id="auth-faq-link"[^>]*style="display:none"/.test(indexCode), 'faq link visibility');
ok('...and both entries sit on the same quiet line, styled',
  /\.auth-doors\s*\{/.test(css) && (css.match(/\.auth-doors\s*\{/g) || []).length === 1,
  (css.match(/\.auth-doors\s*\{/g) || []).length);
ok('the FAQ is in the service worker SHELL, so it opens with no signal',
  /'\.\/faq\.html'/.test(swJs), 'sw.js SHELL');
ok('...and in the deploy list, so it is actually published',
  /'faq\.html'/.test(deploy), 'deploy SERVED');
ok('the other static pages stay OUT of the shell — review pages are not app screens',
  !/inspector\.html|plan\.html/.test(stripJs(swJs)), 'sw.js scan (comments stripped)');
ok('the sidebar carries it too, so a signed-in person can reach it',
  /id="nav-faq"[^>]*href="faq\.html"/.test(indexCode), 'sidebar link');
ok('...and opens it in a new tab, so a half-filled form is never lost to a question',
  /<a class="nav-item" id="nav-faq"[^>]*target="_blank"[^>]*rel="noopener"/.test(indexCode),
  (indexCode.match(/<a class="nav-item" id="nav-faq"[\s\S]{0,300}?<\/a>/) || [''])[0].slice(0, 140));
ok('...and its glyph comes from the ONE icon set, not a literal <svg> in the markup',
  /#nav-faq \.nav-icon/.test(appCode) && /\n  help:\s+'<circle/.test(appCode) &&
  !/id="nav-faq"[\s\S]{0,200}<svg/.test(indexCode), 'icon wiring');
ok('...and its label is its own key, not shared with the sign-in card',
  /'nav\.help':/.test(read('../i18n.js')) && /'door\.faq':/.test(read('../i18n.js')),
  'separate keys');

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exitCode = fails ? 1 : 0;
