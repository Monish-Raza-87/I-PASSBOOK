// Build the GOOGLE DOOR'S TRANSITIONAL PAGE as a local file, so it can be LOOKED at.
//
//   node tools/render-doorpage.mjs
//   node tools/render-themes.mjs "%TEMP%/ipassbook-render/door-ok.html" --themes light --width 400
//
// WHY THIS EXISTS. `handoffPage()` in backend.gs is the one screen in this app that
// cannot be reached any other way: it is served by HtmlService from the Apps Script
// deployment, in the middle of a Google sign-in, and only when a real Workspace
// identity has been read. Everything about it — the ground, the corner radius, the
// accent, the type — is invisible to every test in this repo and to anyone without a
// Google account to sign in with. On 2026-10-09 that cost something real: the page
// was still wearing the look the app had ABANDONED, a `#005cad` blue button and a
// rounded card, and nothing in the suite could see it. The owner could — he signed in
// and landed on a stranger's page.
//
// It runs the REAL function. `backend.gs` is evaluated in a `vm` with only the
// Apps Script APIs it touches at load faked, so what lands on disk is the exact string
// `HtmlService.createHtmlOutput()` receives — not a copy that can drift from it. Same
// approach, and the same reason, as smoke-store.mjs's fake platform.
//
// TWO FILES PER CASE. The dark branch is written out with its `@media
// (prefers-color-scheme: dark)` rewritten to `@media all`. render-themes.mjs reaches a
// theme by writing the app's stored preference and reloading, which this page has never
// heard of — it reads the media query and nothing else, because it is served from
// another origin and has no storage to read. Rewriting the query is the only way to
// photograph the branch. Note that render-themes will still print "(stamped by hand)"
// for it; that is about `data-theme`, which this page does not use.
//
// It is NOT a smoke suite (it asserts nothing, and `smoke-all.mjs` only picks up
// `smoke-*.mjs`), and it is NOT a build step. It is a camera.
import { createContext, runInContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Only what backend.gs touches while it EVALUATES. Nothing here is called at load —
// the file is declarations and constants — so these exist to turn a ReferenceError
// into a page rather than to model the platform. The one API that is called is
// `HtmlService.createHtmlOutput`, and its stub is deliberately the same shape
// smoke-store.mjs uses, minus the bookkeeping the tests need and this does not.
const ctx = { console, JSON, Object, Array, String, Number, Boolean, Date, Math, RegExp, Error };
ctx.HtmlService = {
  createHtmlOutput: (content) => ({
    _content: String(content == null ? '' : content),
    setTitle() { return this; },
    getContent() { return this._content; },
  }),
};
ctx.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }) };
ctx.SpreadsheetApp = {};
ctx.DriveApp = {};
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) };

const src = fs.readFileSync(new URL('../backend.gs', import.meta.url), 'utf8');
createContext(ctx);
runInContext(src, ctx, { filename: 'backend.gs' });

const out = path.join(os.tmpdir(), 'ipassbook-render');
fs.mkdirSync(out, { recursive: true });

// Both branches, because they are two different pages: one ends on "Continue", the
// other on a ruled red block and "Back to sign in". A page photographed only on its
// happy path is a page whose error state has been designed by nobody.
const CASES = [
  ['door-ok.html', ctx.handoffPage('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'monish.raza@indrones.com', '')],
  ['door-refused.html', ctx.handoffPage(null, '', 'That Google account has no I-PASSBOOK access. Ask an admin to provision it.')],
];

for (const [name, page] of CASES) {
  const html = page.getContent();
  fs.writeFileSync(path.join(out, name), html, 'utf8');
  fs.writeFileSync(
    path.join(out, name.replace(/\.html$/, '-dark.html')),
    html.split('@media (prefers-color-scheme: dark)').join('@media all'),
    'utf8');
  console.log(path.join(out, name));
}
