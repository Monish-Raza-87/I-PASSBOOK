// Smoke test for the installable mobile app layer.
//
//   node tools/smoke-mobile.mjs
//
// The web app has always been a PWA, but it is also a staff tool, a customer portal and
// four standalone pages. This suite pins the mobile-app additions that are invisible
// until they are wrong: the manifest that gives the installed icon its identity, the
// install prompt on both pages that mount the app, the service-worker shell entry, and
// the customer portal's offline report draft.

import fs from 'node:fs';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const manifest = JSON.parse(read('../manifest.json'));
const indexHtml = read('../index.html');
const customerHtml = read('../customer.html');
const swJs = read('../sw.js');
const pwaJs = read('../pwa.js');
const portalJs = read('../portal.js');
const deploy = read('./deploy-ghpages.mjs');

r.head('the installed app has one identity and a scope');

r.ok('the manifest names the app, its start page and its scope',
  manifest.name === 'I-PASSBOOK Indrones' &&
  manifest.start_url === './index.html' &&
  manifest.scope === './' &&
  manifest.id === './' &&
  manifest.display === 'standalone');

r.ok('it declares the app shortcuts that open the customer portal',
  Array.isArray(manifest.shortcuts) &&
  manifest.shortcuts.some(s => /customer\.html\?route=support\/new/.test(s.url)) &&
  manifest.shortcuts.some(s => /customer\.html\?route=support\/history/.test(s.url)));

r.ok('the installed web app is declared, so a browser tab can tell it is installed',
  Array.isArray(manifest.related_applications) &&
  manifest.related_applications.some(a => a.platform === 'webapp' && /manifest\.json$/.test(a.url)));

r.ok('the icons stay the two the app already ships',
  manifest.icons.map(i => i.src).join(',') === 'assets/icon-192.png,assets/icon-512.png');

r.head('both pages that mount the app can install and resume it');

r.ok('index.html loads the install layer before app.js',
  indexHtml.indexOf('src="pwa.js"') > -1 &&
  indexHtml.indexOf('src="pwa.js"') < indexHtml.indexOf('src="app.js"'));

r.ok('customer.html is a standalone entry too: manifest, iOS tags and the install layer',
  /rel="manifest" href="manifest\.json"/.test(customerHtml) &&
  /apple-touch-icon/.test(customerHtml) &&
  /apple-mobile-web-app-capable/.test(customerHtml) &&
  /viewport-fit=cover/.test(customerHtml) &&
  /src="pwa\.js"/.test(customerHtml));

r.ok('the install prompt is standalone-aware, iOS-aware, dismissible and test-safe',
  /display-mode: standalone/.test(pwaJs) &&
  /beforeinstallprompt/.test(pwaJs) &&
  /appinstalled/.test(pwaJs) &&
  /Add to Home Screen/.test(pwaJs) &&
  /ipb_install_dismissed_until/.test(pwaJs) &&
  /navigator\.webdriver/.test(pwaJs) &&
  /HeadlessChrome/.test(pwaJs));

r.ok('both doors declare the Android install capability',
  /name="mobile-web-app-capable"/.test(indexHtml) &&
  /name="mobile-web-app-capable"/.test(customerHtml));

r.ok('iOS Chrome is told to use Safari, because Add to Home Screen there is a bookmark',
  /isIosNonSafari/.test(pwaJs) &&
  /Open this page in Safari/.test(pwaJs));

r.ok('a browser tab that is already installed is told to open the home-screen app',
  /getInstalledRelatedApps/.test(pwaJs) &&
  /Open the installed app/.test(pwaJs));

r.ok('the install layer is served, precached and cannot fall out of the deploy',
  /'pwa\.js'/.test(deploy) &&
  /'\.\/pwa\.js'/.test(swJs));

r.head('the portal survives a lost connection');

r.ok('the service worker falls back to the page the device actually opened',
  /caches\.match\(req, \{ ignoreSearch: true \}\)/.test(swJs) &&
  /caches\.match\('\.\/index\.html'\)/.test(swJs));

r.ok('the report form keeps a draft, restores it, and clears it on a successful submit',
  /ipbc_report_draft_v1/.test(portalJs) &&
  /readReportDraft/.test(portalJs) &&
  /writeReportDraft/.test(portalJs) &&
  /restoreReportDraft/.test(portalJs) &&
  /localStorage\.removeItem\(DRAFT_KEY\)/.test(portalJs) &&
  /Re-attach any evidence files/.test(portalJs));

r.ok('...and an app shortcut can name a customer route without a hash',
  /new URLSearchParams\(location\.search\)\.get\('route'\)/.test(portalJs));

r.ok('...and the mobile install layer never writes the customer session keys',
  !/ipbc_session|ipbc_user/.test(pwaJs));

r.finish();
