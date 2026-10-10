// Smoke test for the app's second open door and the FAQ behind it.
//
//   node tools/smoke-door-faq.mjs
//
// These are the only two things in the product a member of the PUBLIC can reach:
// the Report-a-problem entry on the sign-in screen, and faq.html. Everything else
// is behind a session token, so this suite exists to hold the line on the two
// properties that make them safe to leave open, plus the two that make them
// truthful.
//
//   1. THE DOOR READS NOTHING. The modal must explain itself and nothing else —
//      no ticket, no IR number, no customer name. It is a way in, not a window.
//   2. THE DOOR DOES NOT PHONE HOME — AND NOW IT CANNOT. This used to be "the
//      iframe's src is set on OPEN, never in the markup". The frame is gone
//      entirely (see 3), so the rule is stronger and simpler: there is no iframe,
//      no src, no form, nothing fetched, anywhere in the app's own front door.
//      Opening the dialog contacts nobody. That is asserted here, not promised in
//      a comment.
//   3. THE DOOR HANDS OVER TO GOOGLE'S SIGN-IN, RATHER THAN GETTING STUCK IN IT.
//      The form records the sender's email, so Google demands a sign-in, and a
//      frame cannot complete one (accounts.google.com sends X-Frame-Options:
//      DENY). So the action is a real <a target="_blank"> to the form — a
//      navigation, which costs nothing until it is tapped, and which works in a
//      tab where a frame did not.
//   4. THE DOOR SAYS SO BEFORE THE BUTTON. A customer is told they need no
//      account and then meets Google's sign-in screen. The sentence that prevents
//      that reading as a lie must exist, and must come BEFORE the action in the
//      markup, or it is read too late to help.
//
// And for the FAQ: it must be INERT. A static page that ships a script is one
// request away from being a tracking surface, and this page's whole job is to be
// trustworthy. Zero scripts, zero tables, zero third-party hosts.
//
// It parses the real files. It never restates a value.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const indexHtml = read('../index.html');
const faqHtml = read('../faq.html');
const componentsCss = read('../components.css');
const baseCss = read('../base.css');
const i18nJs = read('../i18n.js');
const swJs = read('../sw.js');
const deploy = read('./deploy-ghpages.mjs');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// Strip CSS and JS comments before any structural count. This file's own header
// names the very things it counts (`<iframe>`, `src`), and a suite that counts its
// own prose is a suite that passes for the wrong reason.
const stripCss = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// HTML comments, for the same reason: index.html's own comment above the modal
// explains why there is no frame, and says the word.
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
// Empty is the honest default — the app cannot know someone else's form URL — but a
// FILLED one has to be the right KIND of URL. The editor link (`/forms/d/<id>/edit`)
// opens for nobody but its owner, and a link that 404s is worse than no entry at
// all. So: empty, or a real published share link. Nothing else.
ok('CUSTOMER_FORM_URL is empty or a published Google Forms share link',
  urlConst === '' ||
  /^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(urlConst),
  urlConst);
ok('...and it is a SHARE link, not an editor link, which opens for nobody else',
  urlConst === '' || (/\/d\/e\//.test(urlConst) && !/\/(edit|copy|prefill)\b/.test(urlConst)),
  urlConst);

const wire = (appCode.match(/function wireCustomerDoor\(\)\s*\{[\s\S]*?\r?\n\}\r?\n/) || [''])[0];
ok('wireCustomerDoor() exists and is a real function', wire.length > 700, wire.length);
ok('...and it returns before wiring anything when there is no URL',
  /if \(!CUSTOMER_FORM_URL\) return;/.test(wire), wire.slice(0, 200));
ok('...and it is called from the load handler, not from showAuth()',
  /wireCustomerDoor\(\);/.test(appCode) &&
  /window\.I18N\.applyStatic\(\);[\s\S]{0,400}wireCustomerDoor\(\);/.test(appCode),
  (appCode.match(/wireCustomerDoor\(\);/g) || []).length);

// The one rule that keeps this from becoming a visible button that opens nothing.
// Order matters: the display flip must come AFTER the guard, or a device with no
// URL configured gets an entry that leads nowhere.
ok('the entry is only revealed after the URL guard',
  wire.indexOf('if (!CUSTOMER_FORM_URL) return;') < wire.indexOf("open.style.display = ''"),
  wire.indexOf('if (!CUSTOMER_FORM_URL) return;') + ' / ' + wire.indexOf("open.style.display = ''"));

// ── The frame is GONE, and that is the design ────────────────────────────────
head('there is no frame, and nothing to phone home with');

// The old suite's central assertion was "the src is set on OPEN, never in the
// markup". The stronger statement is now available: there is no frame at all, so
// the question of when a src loads has stopped existing. If a future edit puts one
// back, this section is what should stop it — the failure mode it prevented was
// real (a request to Google on every app user's page load), and the reason the
// frame was removed covers the rest (its sign-in button is inert).
ok('index.html contains no iframe anywhere',
  !/<iframe/i.test(indexCode), (indexCode.match(/<iframe[^>]*>/gi) || []));
ok('...and nothing in the app still refers to the removed frame',
  !/customer-door-frame/.test(indexCode + appCode), 'stale id');
ok('...and the script sets no element src, and appends no embed parameter',
  !/setAttribute\('src'/.test(wire) && !/embedded=true/.test(appCode), 'src setting');
ok('...and it never opens a window by script, which phones block',
  !/window\.open\(/.test(wire), (wire.match(/window\.open\(/g) || []).length);
ok('...and opening the dialog itself touches no URL at all',
  !/fetch\(|XMLHttpRequest|\.src\s*=/.test(wire), 'network call in wireCustomerDoor');
ok('the modal markup fetches nothing either — no src, no href to Google',
  !/\ssrc\s*=/.test(indexCode) || !/src\s*=\s*"https?:\/\//.test(indexCode),
  (indexCode.match(/src\s*=\s*"https?:\/\/[^"]*"/gi) || []));

// ── The one action, and it is a plain link ───────────────────────────────────
head('the one action, and it is a navigation');

const goTag = (indexCode.match(/<a[^>]*id="customer-door-go"[^>]*>/) || [''])[0];
ok('the action is an <a>, so it is a real link and not a script', goTag.length > 40, goTag);
ok('...and it opens in a new tab with noopener, so the form cannot reach back in',
  /target="_blank"/.test(goTag) && /rel="noopener noreferrer"/.test(goTag), goTag);
ok('...and its href comes from the ONE constant, never a second copy of the URL',
  /go\.href = CUSTOMER_FORM_URL;/.test(wire) && !/https:\/\/docs\.google\.com/.test(indexCode),
  'single source');
ok('...and the constant is the only place in the app that form URL is written',
  (appCode.match(/https:\/\/docs\.google\.com\/forms\/d\/e\//g) || []).length === 1,
  (appCode.match(/https:\/\/docs\.google\.com\/forms\/d\/e\//g) || []).length);
ok('...and it is not hidden or styled out of reach',
  !/id="customer-door-go"[^>]*style="display:none"/.test(indexCode), 'visibility');

// ── Saying it before doing it ────────────────────────────────────────────────
head('the door warns about Google\'s sign-in, before the button');

const hintAt = indexCode.indexOf('customer-door-hint');
const goAt = indexCode.indexOf('customer-door-go');
ok('the sign-in warning is in the markup, and BEFORE the action',
  hintAt > -1 && goAt > -1 && hintAt < goAt, { hintAt, goAt });
ok('...and it says Google will ask for a sign-in',
  /Google will ask you to sign in/.test(indexCode), 'warning text');
ok('...and it says whose request that is, so the app is not blamed for it',
  /Google asking, not this app/i.test(indexCode), 'attribution');
ok('...and the string exists in the i18n table too, so a translation cannot lose it',
  /'door\.signInHint':\s*'[^']*Google will ask you to sign in/.test(i18nJs), 'i18n key');
ok('...and the sentence is not filed as decoration — it sits in the flow, not a tooltip',
  !/customer-door-hint[^>]*title="/.test(indexCode), 'not a title attribute');

// ── The door reads nothing ───────────────────────────────────────────────────
// The strongest assertion here: the modal's own markup must not mention a ticket.
// A future "your recent reports" panel would fail this, and that is the point —
// it is a decision, not an accident, and it should need a deliberate edit here.
const doorHtml = (indexCode.match(/<div class="customer-door" id="customer-door"[\s\S]*?\n  <\/div>/) || [''])[0];
ok('the door modal exists in index.html', doorHtml.length > 400, doorHtml.length);
ok('...and the modal offers exactly one thing to press, plus the close cross',
  (doorHtml.match(/<a\b/g) || []).length === 1 &&
  (doorHtml.match(/<button\b/g) || []).length === 1,
  { links: (doorHtml.match(/<a\b/g) || []).length, buttons: (doorHtml.match(/<button\b/g) || []).length });
ok('...and it names no IR, no customer and no ticket anywhere inside it',
  !/IR-|irNumber|ir-number|ticket #/i.test(doorHtml), doorHtml.slice(0, 160));
ok('...and it carries no form, so it cannot collect anything',
  !/<form|<input|<textarea/i.test(doorHtml), 'input scan');
ok('...and the note says where the form is hosted and when it is contacted',
  /hosted by Google/.test(doorHtml) && /until you press the button/i.test(doorHtml), 'note text');

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
ok('...and it lands on the ACTION, not the close cross — the reason the door was opened',
  /go\.focus\(\)/.test(wire) && !/close\.focus\(\)/.test(wire), 'focus target');
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
ok('the card is sized by its own few lines of prose, not by a frame',
  !/(^|;)\s*height\s*:/.test(card) && /max-width:\s*32rem/.test(card), card);
ok('...and the old full-height phone override is gone with the frame it existed for',
  !/@media \(max-width: 640px\)[\s\S]{0,200}\.customer-door-card/.test(css), 'mobile override');
ok('...and the primary action is a real tap target, not the 32px desktop default',
  parseInt(rule('.customer-door-go').match(/height:\s*(\d+)px/)?.[1], 10) >= 40,
  rule('.customer-door-go'));
ok('...and the warning reads as secondary, so the eye still finds the button',
  /--ink-gray-7|--ink-gray-6/.test(rule('.customer-door-hint')) &&
  /--ink-gray-9/.test(rule('.customer-door-lede')), 'hierarchy');
ok('every colour in it comes from a token, never a one-theme literal',
  !/#[0-9a-fA-F]{3,8}\b/.test(overlay + card), (overlay + card).match(/#[0-9a-fA-F]{3,8}/g));
// Orphan sweep: a rule for a class that no longer exists is how this file would
// quietly rot after the frame was removed. Both of these named the old shape.
ok('no CSS is left over from the frame — no .customer-door-tab, no body iframe',
  !/\.customer-door-tab/.test(css) && !/\.customer-door-body\s+iframe/.test(css), 'orphan rules');
ok('...and no markup is left over either',
  !/customer-door-tab|door\.newTab/.test(indexCode + i18nJs), 'orphan markup/keys');

// ── The two doors on one line, and everything secondary is a button ──────────
//
// This section exists because of a bug that SHIPPED and that no test caught. It
// was not found by reading the CSS — it was found by looking at the screen, which
// is why `render-it-in-a-browser-before-judging-css` is a rule and not a
// preference. `.link-btn` is `width: 100%` (correct: every other secondary action
// on the card is a full-width bar), so when the two public doors were placed in
// the flex row below, each child claimed an entire row and the pair stacked
// instead of sitting on the line it was written for. `.link-btn` is an `<a>` in
// one place and a `<button>` in the other, and an `<a>` inherits the document's
// LEFT alignment while a `<button>` centres itself — so the two entrances also
// disagreed about where their text went.
//
// Both load-bearing rules are asserted here so the layout cannot silently go back.
head('the doors sit side by side, and the secondary actions are buttons');

// ANCHORED TO THE START OF A LINE, which is where a class DEFINITION lives. Without
// the `^`/`m` this finds the first mention of the selector anywhere — and base.css now
// mentions `.link-btn` in a ground block (`.auth-main > :not(.doors) .link-btn`) that
// sits far ABOVE the definition, so the helper read that rule's body instead and three
// assertions about the real button failed at once. A selector written at the end of a
// longer one is a consumer, not the definition.
const baseRule = (sel) => {
  const re = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  return (baseCss.match(re) || [])[1] || '';
};

const linkBtn = baseRule('.link-btn');
ok('.link-btn is a filled button, not underlined text — so "Use pattern", "Back to sign in" and the rest are things you can hit',
  /text-decoration:\s*none/.test(linkBtn) && /background:/.test(linkBtn) && /border:/.test(linkBtn),
  linkBtn.replace(/\s+/g, ' ').slice(0, 120));
ok('...and it centres its own label, which is the half an <a> gets wrong on its own',
  /justify-content:\s*center/.test(linkBtn), linkBtn.replace(/\s+/g, ' ').slice(0, 120));
ok('...and it clears the touch minimum an underlined word never did',
  parseInt(linkBtn.match(/min-height:\s*(\d+)px/)?.[1], 10) >= 40,
  linkBtn.match(/min-height:[^;]*/) || 'no min-height');
// These two entries were `.auth-doors` — a line inside the CUSTOMER's card. They are
// `.landing-foot` now: a line under BOTH cards, because the desk's open doors are the
// desk's and an employee with a problem needs them exactly as much as a customer.
// The rule moved to base.css with the rest of the landing page; the two properties
// asserted are the same two, for the same reasons.
ok('...and the public doors override its full width, or each one takes a whole row',
  /width:\s*auto/.test(baseRule('.landing-foot .link-btn')), baseRule('.landing-foot .link-btn') || 'rule missing');
ok('...and the row they override it in is a centred, wrapping flex line',
  /display:\s*flex/.test(baseRule('.landing-foot')) &&
  /justify-content:\s*center/.test(baseRule('.landing-foot')) &&
  /flex-wrap:\s*wrap/.test(baseRule('.landing-foot')), baseRule('.landing-foot'));

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
// A plain <a href> is a NAVIGATION, not a load: it makes no request until someone
// taps it, and on this page it is the point — a person who landed on the FAQ and
// nothing else still needs a way to report a fault. What must not appear is
// anything the page FETCHES by itself: a script, a stylesheet, an image, a frame.
const fetched = (faqCode.match(/<(script|link|img|iframe|source|video|audio)\b[^>]*/gi) || [])
  .flatMap(tag => (tag.match(/(?:src|href)\s*=\s*"([^"]*)"/gi) || []))
  .filter(a => /=\s*"https?:\/\//i.test(a));
ok('...and it FETCHES nothing from any third party',
  fetched.length === 0, fetched);
ok('...and the only outside link on it is the form itself, as a plain navigation',
  (() => {
    const ext = (faqCode.match(/href="(https?:\/\/[^"]+)"/g) || []).map(s => s.slice(6, -1));
    return urlConst === '' ? ext.length === 0 : (ext.length === 1 && ext[0] === urlConst);
  })(), (faqCode.match(/href="(https?:\/\/[^"]+)"/g) || []));
ok('...and that link opens in a new tab, so the FAQ is never navigated away from',
  urlConst === '' ||
  new RegExp('<a href="' + urlConst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '"[\\s\\S]{0,80}?target="_blank"').test(faqHtml),
  (faqHtml.match(/<a href="https:\/\/docs\.google\.com[\s\S]{0,200}?>/) || [''])[0].slice(0, 200));
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
// ── THE PALETTE, AND THE THREE THINGS THAT HAVE TO BE TRUE OF IT ───────────────
//
// ⚠ THIS ASSERTION USED TO SPELL ITS THREE TOKENS --bg, --fg AND --surface, which
// were the names of the page's own private palette. That palette is GONE: on
// 2026-10-10 the owner said *"Help and FAQ page's UI is not aligned with our app's UI,
// rectify it"*, and the fix was to restate the app's own INDUSTRIAL roles here instead
// of a second vocabulary for the same ideas. A check written against the old names
// would have gone on passing while the page wore a look the app had abandoned — which
// is exactly what had happened. So it now names the ROLES, which is what the question
// was always about.
//
// Everything here reads a COMMENT-STRIPPED copy: the file's comments quote token names
// in prose ("bare :root FIRST", "--accent is the role palette.css resolved"), and a
// scan that counted those would find tokens no rule ever declared.
const faqCss = faqHtml.slice(faqHtml.indexOf('<style>'), faqHtml.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every block that starts at :root, with the token names declared inside it. */
const rootBlocks = [...faqCss.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].map(m => ({
  sel: m[0].slice(0, m[0].indexOf('{')).trim(),
  names: new Set(m[1].match(/--[\w-]+/g) || [])
}));
const lightRoot = rootBlocks.find(b => b.sel === ':root');
const darkRoots = rootBlocks.filter(b => b.sel !== ':root');

// The roles this page must be able to answer for, whoever is looking at it.
const ROLE_TOKENS = ['--ind-ground', '--ind-panel', '--ind-inset', '--ind-line', '--ind-rule',
  '--ink', '--ind-muted', '--accent', '--st-danger-fg', '--st-resolved-fg'];

ok('it defines a complete light palette on bare :root, before any dark block',
  !!lightRoot && ROLE_TOKENS.every(n => lightRoot.names.has(n)) &&
  faqCss.indexOf('--ind-ground') < faqCss.indexOf('prefers-color-scheme: dark'),
  { found: lightRoot && ROLE_TOKENS.filter(n => !lightRoot.names.has(n)), blocks: rootBlocks.length });

ok('...and BOTH dark blocks re-point every one of those roles, so neither theme borrows a colour from the other',
  darkRoots.length === 2 && darkRoots.every(d => ROLE_TOKENS.every(n => d.names.has(n))),
  { darkBlocks: darkRoots.length, missing: darkRoots.map(d => ROLE_TOKENS.filter(n => !d.names.has(n))) });

// THE TWO ACCENT INVARIANTS, and they are the whole reason the accent is a role rather
// than the brand colour. #ffc400 is Indrones' yellow: it is a FILL in this product and
// it is never a word on a light ground, because it is about 1.4:1 there and no amount
// of taste makes that readable. So in the light block the accent must be an INK — a
// grey, r == g == b, no hue at all — and only where the ground is dark enough to carry
// it may it become the brand yellow itself.
const lightAccent = (faqCss.match(/:root\s*\{[^}]*--accent:\s*#([0-9a-f]{6})/i) || [])[1];
ok('...and the light accent is the INK, not a hue — the brand yellow cannot be a word on a light ground',
  (() => {
    if (!lightAccent) return false;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(lightAccent.slice(i, i + 2), 16));
    return r === g && g === b;
  })(), lightAccent ? '#' + lightAccent : 'no light accent');

ok('...and the dark accent IS the brand yellow — the one ground dark enough to carry it as text',
  (() => {
    const brand = (faqCss.match(/--ind-yellow:\s*#([0-9a-f]{6})/i) || [])[1];
    const dark = (faqCss.match(/:root\[data-theme="dark"\]\s*\{[^}]*--accent:\s*#([0-9a-f]{6})/i) || [])[1];
    return !!brand && !!dark && brand.toLowerCase() === dark.toLowerCase();
  })(), faqCss.match(/--ind-yellow:\s*#[0-9a-f]{6}[^;]*|--accent:\s*#[0-9a-f]{6}[^;]*/gi));
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
    const media = (faqHtml.match(/:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/) || [])[1] || '';
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

// The FAQ and the door are the same promise told twice. A customer reads one, then
// meets the other; if the FAQ said "no account needed, full stop" while Google
// demanded a sign-in, the app would have lied to the person least able to complain.
ok('the FAQ warns about Google\'s sign-in, in the same terms as the door',
  /Google asks you\s+to sign in to a Google account/.test(faqCode), 'faq warning');
ok('...and it says a signed-in device sees the form with no prompt, which is the truth',
  /already signed in to Google goes\s+straight to the form/i.test(faqCode), 'faq no-prompt case');
ok('...and it no longer describes a frame that does not exist',
  !/if the window gives you/i.test(faqCode) && !/opens the problem-reporting form/i.test(faqCode),
  'stale frame language');

// ── Where the page is reachable from ─────────────────────────────────────────
head('the FAQ is reachable, and it ships');

ok('the sign-in screen links to it', /id="auth-faq-link"[^>]*href="faq\.html"/.test(indexCode),
  'sign-in link');
ok('...and it is NOT hidden with the Report button — the FAQ needs no URL to exist',
  /id="auth-faq-link"[^>]*href="faq\.html"/.test(indexCode) &&
  !/id="auth-faq-link"[^>]*style="display:none"/.test(indexCode), 'faq link visibility');
// Counted in base.css, not components.css: the landing page's own rules all live in
// base.css with the rest of the landing block, and `.landing-foot` has to be declared
// exactly once or a second declaration is a second, silently competing layout.
ok('...and both entries sit on the same quiet line, styled',
  (baseCss.match(/\.landing-foot\s*\{/g) || []).length === 1,
  (baseCss.match(/\.landing-foot\s*\{/g) || []).length);
ok('the FAQ is in the service worker SHELL, so it opens with no signal',
  /'\.\/faq\.html'/.test(swJs), 'sw.js SHELL');
ok('...and in the deploy list, so it is actually published',
  /'faq\.html'/.test(deploy), 'deploy SERVED');
ok('the other static pages stay OUT of the shell — review pages are not app screens',
  !/inspector\.html|plan\.html/.test(stripJs(swJs)), 'sw.js scan (comments stripped)');
// The sidebar entry used to be a NEW TAB onto faq.html. Since 2026-10-08 it is a
// route into a pane of this app — the owner's "our FAQ page is opening in a new tab,
// that is not good for us. It has to be in our app, as per our UI and a part of our
// app." So the assertions invert: it must NOT open the standalone page, and it must
// NOT carry a target, because a second tab is exactly what was complained about.
ok('the sidebar carries it too, so a signed-in person can reach it',
  /id="nav-faq"[^>]*href="#\/faq"/.test(indexCode), 'sidebar link');
ok('...and it is a ROUTE now, not a link out to the standalone page',
  !/id="nav-faq"[^>]*href="faq\.html"/.test(indexCode) &&
  !/<a class="nav-item" id="nav-faq"[^>]*target="_blank"/.test(indexCode),
  (indexCode.match(/<a class="nav-item" id="nav-faq"[\s\S]{0,300}?<\/a>/) || [''])[0].slice(0, 140));
ok('...and its glyph comes from the ONE icon set, not a literal <svg> in the markup',
  /#nav-faq \.nav-icon/.test(appCode) && /\n  help:\s+'<circle/.test(appCode) &&
  !/id="nav-faq"[\s\S]{0,200}<svg/.test(indexCode), 'icon wiring');
ok('...and its label is its own key, not shared with the sign-in card',
  /'nav\.help':/.test(i18nJs) && /'door\.faq':/.test(i18nJs),
  'separate keys');

// ── The FAQ inside the app ────────────────────────────────────────────────────
//
// The owner, 2026-10-08: "our FAQ page is opening in a new tab, that is not good for
// us. It has to be in our app, as per our UI and a part of our app."
//
// The way to do that badly is a second copy of the answers in app.js, which drifts
// from faq.html within a month and leaves nobody able to say which is right. So the
// text lives in faq-content.js and there are two RENDERERS of it. This section pins
// the arrangement: the content file is the only source, faq.html is BUILT from it,
// and the in-app view never grows a second copy of a sentence.
head('the same answers, inside the app');

const contentJs = read('../faq-content.js');
const buildFaq = read('./build-faq.mjs');
const contentCode = stripJs(contentJs);

ok('the content is its own file, and it assigns the shape both renderers read',
  /window\.FAQ_CONTENT\s*=\s*\{/.test(contentCode) &&
  /"sections":/.test(contentCode) && /"jump":/.test(contentCode),
  Object.keys(JSON.parse(contentCode.slice(contentCode.indexOf('{'), contentCode.lastIndexOf('}') + 1)) || {}));

ok('index.html loads it BEFORE app.js, which renders from it on the way in',
  indexHtml.indexOf('faq-content.js') > -1 &&
  indexHtml.indexOf('faq-content.js') < indexHtml.indexOf('src="app.js"'),
  { content: indexHtml.indexOf('faq-content.js'), app: indexHtml.indexOf('src="app.js"') });

ok('app.js renders #/faq from window.FAQ_CONTENT rather than carrying the answers',
  /window\.FAQ_CONTENT/.test(appCode) &&
  // The check that matters: not one of the questions is written into app.js. If a
  // future edit pastes the text in, this is what fails.
  !/How do I get an account\?/.test(appCode) &&
  !/Never share it/.test(appCode),
  'answer text found in app.js');

ok('the pane is a fifth sibling, empty in the markup, filled at runtime',
  /<div id="faq-view">/.test(indexCode) &&
  /<div id="faq-body" class="faq-body"><\/div>/.test(indexHtml) &&
  // The nine sections are what the shell suites count by this literal, and the pane
  // is not one of them.
  !/id="faq-view"[\s\S]{0,300}section-content/.test(indexHtml), 'pane markup');

ok('the route exists, and resolves to the pane rather than the list fallthrough',
  /if \(parts\[0\] === 'faq'\) return \{ name: 'faq' \};/.test(appCode));

ok('renderLayout gives it the screen and the list fold, like the other two panes',
  /const faq\s+= currentView === 'faq';/.test(appCode) &&
  /const full\s+= detail \|\| insights \|\| log \|\| faq;/.test(appCode) &&
  /faqView\.style\.display = faq \? 'flex' : 'none';/.test(appCode) &&
  /classList\.toggle\('view-faq', faq\)/.test(appCode));

ok('the nav marks it active, so the pane is not a dead tap',
  /\['nav-faq', 'faq'\]/.test(appCode), 'markActiveNav');

// The one way this view could break the router: a jump link written as an anchor.
// `href="#getting-in"` is not a scroll inside a hash-routed app — it is a ROUTE, and
// the unknown-hash fallthrough would throw the reader back to the IR list. The jump
// strip is buttons for that reason, and this is the assertion that keeps it so.
ok('the jump strip is buttons, never anchors — an href would be read as a ROUTE',
  /data-faq-jump=/.test(appCode) &&
  /jumpToFaqSection\(jump\.dataset\.faqJump\)/.test(appCode) &&
  !/faq-jump-item[^`]*href=/.test(appCode), 'jump wiring');

ok('the in-app view never links back out to the standalone page',
  /href="index\\\.html"\/g, 'href="#\/tickets"'/.test(appCode) &&
  !/faq\.html/.test(appCode), 'no link out');

ok('it says so, not nothing, if the content file is missing',
  /The Help &amp; FAQ content did not load\./.test(appCode), 'empty state');

// The trap that actually fired. base.css's topbar is `#workspace header` — a
// DESCENDANT selector, scoped that way after the landing page's own <header> silently
// became a white sticky 56px band. This pane is inside #workspace, so a <header> in
// the FAQ markup inherits the same band: the first build of this view rendered as a
// 56px sticky white strip with the standfirst spilling out of it. Measured, not
// guessed — and this is the assertion that keeps it from coming back, because nothing
// else in the app would notice a markup element inheriting a container's chrome.
ok('the FAQ head is NOT a <header> — it is inside #workspace, where that means topbar',
  (() => {
    // HTML comments stripped first: the comment above that <div> explains this very
    // trap and names the element in prose, and a suite that counts its own prose is a
    // suite that passes for the wrong reason.
    const body = stripHtml(appCode.slice(
      appCode.indexOf('function renderFaq()'), appCode.indexOf('faqBuilt = true;')));
    return body.length > 400 && !/<header[\s>]/.test(body) && /<div class="faq-head">/.test(body);
  })(), 'faq-head element');

ok('...and the same for the footer, which is not a <footer> inside the analyser either',
  /<footer class="faq-foot">/.test(appCode) && !/#workspace footer\s*\{/.test(indexCode + css),
  'faq-foot element');

ok('the footer\'s back link is re-pointed at the IR list, by the router, on the way in',
  /const faqInAppLinks = html => String\(html\)\.replace\(\/href="index\\\.html"\/g, 'href="#\/tickets"'\)/.test(appCode) &&
  /faqInAppLinks\(p\)/.test(appCode), 'back link');

// ── faq.html is BUILT, and it is current ──────────────────────────────────────
head('faq.html is generated from the same file, and is up to date');

ok('faq.html carries the BUILD region, so the tool has somewhere to write',
  faqHtml.indexOf('BUILD:FAQ:BEGIN') > -1 && faqHtml.indexOf('BUILD:FAQ:END') > -1 &&
  // …and the tool is looking for exactly those markers.
  /BUILD:FAQ:BEGIN/.test(buildFaq) && /BUILD:FAQ:END/.test(buildFaq), 'markers');

const faqCheck = spawnSync(process.execPath,
  [new URL('./build-faq.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--check'],
  { encoding: 'utf8' });
ok('build-faq.mjs --check exits clean, so the page matches the content file',
  faqCheck.status === 0, (faqCheck.stdout + faqCheck.stderr).trim());
// A check that cannot fail is not a check. This one reports what it found, so a
// silent no-op would be visible here.
ok('...and it is a real check, not a no-op',
  /up to date/.test(faqCheck.stdout) && /\d+ questions/.test(faqCheck.stdout),
  faqCheck.stdout.trim());

// Every question in the content file must reach BOTH renderers. Counting them in the
// generated page against the content file is the cheap version of "the two agree",
// and it is the failure that would actually happen: a question added to the app and
// not to the page, or the reverse.
ok('every question in the content file is in the generated page',
  (() => {
    const C = JSON.parse(contentCode.slice(contentCode.indexOf('{'), contentCode.lastIndexOf('}') + 1));
    const asked = C.sections.reduce((n, s) => n + s.items.length, 0);
    const onPage = (faqCode.match(/<h3>/g) || []).length;
    const ids = new Set((faqHtml.match(/<section id="([^"]+)"/g) || []).map(s => s.slice(13, -1)));
    return asked === onPage && ids.size === C.sections.length &&
      C.sections.every(s => ids.has(s.id));
  })(), (faqCode.match(/<h3>/g) || []).length);

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exitCode = fails ? 1 : 0;
