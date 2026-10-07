// Smoke test for the invite panel — User Access → Customers.
//
//   node tools/smoke-invite.mjs
//
// ── What this panel is, and the four ways it can be wrong ─────────────────────
//
// The backend half of the customer model is already held to account by
// tools/smoke-customer.mjs: it runs the REAL inviteCustomer / setCustomerCompany /
// getMyCustomer against a fake drive and checks the scope, the refusal paths and the
// text of the invitation email. What that suite cannot see is the half a human
// actually touches — the panel that calls those actions. So this file runs the real
// app.js in the harness and drives the panel itself, because the panel can be wrong in
// four ways that no backend assertion notices:
//
//   1. IT CAN CALL AN ACTION THAT IS NOT ROUTED. The name lives in two files with
//      nothing joining them; a rename on one side is a button that answers
//      "Unknown action" on a live deployment and works perfectly in every test that
//      stubs the network. This repo has already shipped that bug once, in the other
//      direction — a test double inventing an API the real platform does not have.
//      So the action names here are read back out of the POST and matched against the
//      backend's own router map.
//   2. IT CAN INVENT THE COMPANY LIST. The list has to come from the tickets, using the
//      same column the Insights filter reads, or an admin is offered a company that no
//      row will ever match and a customer who sees nothing.
//   3. IT CAN TREAT A FAILED EMAIL AS A FAILED INVITE. The account and the scope are
//      written before the mail is attempted, so `mailed:false` means "send this link by
//      hand", never "nothing happened". Getting this wrong sends the admin back to press
//      Invite again — which the backend refuses, because the account now exists.
//   4. IT CAN HAND OVER A PASSWORD. It must not. A customer sets their own, and the whole
//      point of the flow is that no temporary password is ever created for them.
//
// Driven, not read: renderCustomersTab() paints into the real #access-panels element and
// the Invite button's own recorded listener is dispatched, so what is asserted is the
// DOM the browser would have been handed and the FormData a real fetch would have sent.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
// backend.gs is CRLF in this repo while app.js is LF, and a regex written with a bare
// `\n` silently finds nothing in the CRLF file — which would read as "the action is not
// routed" rather than as "the test cannot see the file". Normalising is the difference
// between a check and a coin toss.
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const viewsCss  = read('../views.css');
const backendGs = read('../backend.gs');

// A location with the two members customerPortalLink() derives from, at a shape this
// app is really served at (GitHub Pages puts it in a subdirectory), so a link built from
// `/index.html` alone would be caught here rather than by a customer.
const LOCATION = {
  hash: '', search: '',
  origin: 'https://example.github.io',
  pathname: '/I-PASSBOOK/index.html',
  hostname: 'example.github.io', protocol: 'https:',
  href: 'https://example.github.io/I-PASSBOOK/index.html',
};

const BINDINGS = `
  document,
  renderCustomersTab, renderPeopleTab, renderAccessPanel, knownCompanies,
  customerPortalLink, customerHandoverTxt, savePeopleMatrix,
  set accessCache(v) { accessCache = v; },
  get accessCache() { return accessCache; },
  set allIRs(v) { allIRs = v; },
  get allIRs() { return allIRs; },
  set accessTab(v) { accessTab = v; },
  get accessTab() { return accessTab; },
  get custNotice() { return custNotice; },
`;

// `FormData` travels through `globals`, not `__T`: app.js CONSTRUCTS one in adminPost,
// so it has to be a name in the sandbox's own scope. A bare V8 context has no FormData —
// it is a host global, like `fetch` — and without it every POST would throw a
// ReferenceError that reads exactly like the panel being broken.
function boot(users, irs, opts) {
  const posts = [];
  const postReply = (opts && opts.postReply) || { status: 'ok' };
  const fetchStub = (url, init) => {
    const u = String(url);
    if (init && init.method === 'POST') { posts.push(init.body); return Promise.resolve({ json: () => Promise.resolve(postReply) }); }
    if (u.indexOf('action=listUsers') >= 0) {
      return Promise.resolve({ json: () => Promise.resolve({ status: 'ok', users: users, departments: [], apiVersion: 8 }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) });
  };
  const A = loadApp(BINDINGS, { capture: true, fetch: fetchStub,
    globals: { location: LOCATION, FormData: FormData } });
  A.T.accessCache = { users: users, departments: [], apiVersion: 8 };
  A.T.allIRs = irs;
  return { A, posts };
}

// The element the panel binds to, with the value a human would have typed into it.
function fill(A, id, value) { const e = A.T.document.getElementById(id); e.value = value; return e; }
const post = fd => { const o = {}; for (const [k, v] of fd.entries()) o[k] = v; return o; };

const STAFF = [
  { email: 'ravi@indrones.com', name: 'Ravi Singh', status: 'active', isAdmin: false, departments: [], customerOf: '' },
  { email: 'crm@indrones.com',  name: 'CRM',        status: 'active', isAdmin: true,  departments: [], customerOf: '' },
];
const CUSTOMER = { email: 'ops@acme.in', name: 'Asha Rao', status: 'active', isAdmin: false, departments: [], customerOf: 'Acme Survey', lastLoginAt: '01-Oct-2026 09:12' };

const IRS = [
  { irNumber: 'IR107', customerName: 'Acme Survey' },
  { irNumber: 'IR204', customerName: 'FarmVista Solutions' },
  { irNumber: 'IR310', customerName: 'Acme Survey' },     // a repeat, and must be listed once
  { irNumber: 'IR388', customerName: '  SkyHarvest  ' },   // leading/trailing space a human typed
  { irNumber: 'IR389', customerName: '' },                // a row with nobody named
];

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the panel calls actions the backend actually routes');
// ═══════════════════════════════════════════════════════════════════════════════
// Read out of the backend's own router map, not a second list written here. The POST
// map specifically: `listUsers` appears in the GET map too, and matching that one would
// have asserted the wrong half of the file while looking like it passed.
const doPost = (backendGs.match(/function doPost\(e\)[\s\S]*?\n\}\n/) || [''])[0];
const authedRoutes = (doPost.match(/var authed = \{[\s\S]*?\n {4}\};/) || [''])[0];
r.ok('the authed POST router was found in backend.gs', authedRoutes.length > 100, authedRoutes.length);
r.ok('inviteCustomer is routed on the authed map, so only an admin can reach it',
  /inviteCustomer:\s*function \(\) \{ return inviteCustomer\(params, email\); \}/.test(authedRoutes));
r.ok('setCustomerCompany is routed there too',
  /setCustomerCompany:\s*function \(\) \{ return setCustomerCompany\(params, email\); \}/.test(authedRoutes));

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the company list is derived from the tickets, never invented');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A } = boot(STAFF.concat([CUSTOMER]), IRS);
  const got = A.T.knownCompanies();
  r.ok('every company named on a ticket is offered, each once, sorted, and trimmed',
    JSON.stringify(got) === JSON.stringify(['Acme Survey', 'FarmVista Solutions', 'SkyHarvest']),
    got);
  r.ok('a company a customer is already scoped to is offered even with no ticket in the list',
    (() => {
      const b = boot(STAFF.concat([CUSTOMER]), []).A.T.knownCompanies();
      return b.length === 1 && b[0] === 'Acme Survey';
    })());
  // The field name is the join between this list and the Insights filter — two
  // independent readings of "which company", which must never drift apart.
  const appCode = read('../app.js');
  r.ok('...from the same `customerName` column the Insights filter reads',
    /if \(ir && ir\.customerName\) seen\.add\(String\(ir\.customerName\)\.trim\(\)\)/.test(appCode) &&
    /if \(ir\.customerName\) customers\.add\(String\(ir\.customerName\)\)/.test(appCode));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the invite posts the three fields the backend reads, and nothing else');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A, posts } = boot(STAFF, IRS);
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderCustomersTab();

  r.ok('the panel rendered its markup into the real panel element',
    /Invite a customer/.test(panel.innerHTML) && /access-cust-invite/.test(panel.innerHTML));
  r.ok('the dropdown carries every known company, and offers "Other company" as an escape hatch',
    /<option value="Acme Survey">/.test(panel.innerHTML) &&
    /<option value="FarmVista Solutions">/.test(panel.innerHTML) &&
    /Other company \(type it\)/.test(panel.innerHTML));
  r.ok('...and Other is NOT preselected while there are companies to pick',
    /<option value=""\s*>Other company/.test(panel.innerHTML));

  A.T.document.getElementById('access-cust-company').value = 'Acme Survey';
  fill(A, 'access-cust-email', '  Ops@Acme.IN  ');
  fill(A, 'access-cust-name', '  Asha Rao  ');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));

  r.ok('the click made exactly one POST', posts.length === 1, posts.length);
  const body = posts.length ? post(posts[0]) : {};
  r.ok('...carrying action=inviteCustomer', body.action === 'inviteCustomer', body.action);
  r.ok('...with the email lower-cased and trimmed, so it matches the store key',
    body.email === 'ops@acme.in', body.email);
  r.ok('...with the name trimmed', body.name === 'Asha Rao', body.name);
  r.ok('...and with the company, which is what decides the rows they see',
    body.company === 'Acme Survey', body.company);
  r.ok('...and NOTHING that looks like a credential — the customer chooses their own',
    !/password|temp|code/i.test(Object.keys(body).join(',')), Object.keys(body));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('"Other company" is a real path, not a decoration');
// ═══════════════════════════════════════════════════════════════════════════════
{
  // The case this exists for: the first sale, where the customer has no ticket yet and
  // the dropdown therefore has nothing in it at all.
  const { A, posts } = boot(STAFF, []);
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderCustomersTab();
  r.ok('with no companies known, "Other company" is preselected and its field is shown in markup',
    /<option value=""\s*selected>Other company/.test(panel.innerHTML) &&
    !/id="access-cust-company-new"[^>]*\shidden/.test(panel.innerHTML),
    (panel.innerHTML.match(/<input type="text" id="access-cust-company-new"[^>]*>/) || [])[0]);

  A.T.document.getElementById('access-cust-company').value = '';
  fill(A, 'access-cust-company-new', '  Brand New Farms  ');
  fill(A, 'access-cust-email', 'first@brandnew.example');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  const body = posts.length ? post(posts[0]) : {};
  r.ok('a company typed by hand is what is sent, trimmed', body.company === 'Brand New Farms', body.company);
}
{
  // ...and with a company to pick, the typed field must NOT win. A leftover value in a
  // hidden input silently overriding the dropdown is the classic way this breaks.
  const { A, posts } = boot(STAFF, IRS);
  A.T.renderCustomersTab();
  A.T.document.getElementById('access-cust-company').value = 'FarmVista Solutions';
  fill(A, 'access-cust-company-new', 'stale text from a moment ago');
  fill(A, 'access-cust-email', 'ops@farmvista.example');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  const body = posts.length ? post(posts[0]) : {};
  r.ok('a stale value in the hidden field does not override the chosen company',
    body.company === 'FarmVista Solutions', body.company);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('a missing email, or a missing company, is refused before any call');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A, posts } = boot(STAFF, IRS);
  A.T.renderCustomersTab();
  A.T.document.getElementById('access-cust-company').value = 'Acme Survey';
  fill(A, 'access-cust-email', '');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  r.ok('no email means no request at all, rather than a request the backend refuses',
    posts.length === 0, posts.length);

  fill(A, 'access-cust-email', 'ops@acme.in');
  A.T.document.getElementById('access-cust-company').value = '';
  A.T.document.getElementById('access-cust-company-new').value = '';
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  r.ok('no company means no request either', posts.length === 0, posts.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('an unsent invitation is a next step, never a failed onboarding');
// ═══════════════════════════════════════════════════════════════════════════════
// The backend writes the scope and the account BEFORE it tries to send, and its own
// message says the account is real either way. The panel must say the same thing, or an
// admin reads "failed" and presses Invite again — which is refused, because the account
// now exists — and concludes the panel is broken.
{
  const { A, posts } = boot(STAFF, IRS, { postReply: {
    status: 'ok', email: 'ops@acme.in', company: 'Acme Survey', mailed: false,
    message: 'Account created for ops@acme.in, scoped to Acme Survey. The invitation email could NOT be sent — give the customer the portal link and this email address, and have them press "First time here?".',
  } });
  const panel = A.T.document.getElementById('access-panels');
  // The admin is ON this tab — which matters, because the roster refresh that follows the
  // invite repaints whatever tab is active. Left at the default 'people', the notice would
  // be wiped by the very refresh this test exists to check it survives.
  A.T.accessTab = 'customers';
  A.T.renderCustomersTab();
  A.T.document.getElementById('access-cust-company').value = 'Acme Survey';
  fill(A, 'access-cust-email', 'ops@acme.in');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));

  const html = panel.innerHTML;
  r.ok('the notice survives the roster refresh that follows it',
    /ops@acme\.in|invitation email/.test(html), html.slice(0, 120));
  r.ok('it does NOT read as a failure — the account exists',
    !/Could not invite/.test(html), 'no failure wording');
  r.ok('it says the account WAS created, in the backend\'s own words',
    /Account created for ops@acme\.in/.test(html));
  r.ok('...and gives the manual next step rather than leaving the admin to guess',
    /Copy what to send them/.test(html) && /Copy the portal link/.test(html));
  r.ok('...and the wording is amber, not the green of a clean invite',
    /acc-invite-warn/.test(html) && !/acc-invite-ok/.test(html));
  r.ok('the notice remembers the address and company the copy button needs',
    A.T.custNotice && A.T.custNotice.email === 'ops@acme.in' && A.T.custNotice.company === 'Acme Survey',
    A.T.custNotice);

  // 4. No password, on any path, ever.
  r.ok('no password is shown for a customer — there is none to show',
    !/tempPassword|Temporary password|cred-pw/.test(html),
    (html.match(/[^\n]*[Pp]assword[^\n]*/) || [])[0]);
  r.ok('...and the panel never even asks the backend for one',
    !/tempPassword/.test(read('../app.js').match(/function renderCustomersTab[\s\S]*?\n\}\n/)[0]));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('a backend refusal is reported as one, and paints no success');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A } = boot(STAFF, IRS, { postReply: {
    status: 'error', message: 'An account already exists for ops@acme.in. Use "Set company" to give it a scope, or reset its password.' } });
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderCustomersTab();
  A.T.document.getElementById('access-cust-company').value = 'Acme Survey';
  fill(A, 'access-cust-email', 'ops@acme.in');
  A.T.document.getElementById('access-cust-invite').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  r.ok('an error reply paints no invite notice at all', !/acc-invite-/.test(panel.innerHTML));
  r.ok('...and the button is usable again rather than stuck on "Inviting…"',
    A.T.document.getElementById('access-cust-invite').textContent.indexOf('Invite customer') >= 0,
    A.T.document.getElementById('access-cust-invite').textContent);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('changing an existing customer\'s company is a scope change, and posts as one');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A, posts } = boot(STAFF.concat([CUSTOMER]), IRS);
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderCustomersTab();
  r.ok('the existing customer is listed with the company they are scoped to',
    /ops@acme\.in/.test(panel.innerHTML) && /value="Acme Survey"/.test(panel.innerHTML));
  r.ok('...and the panel states that clearing a scope would widen access, not narrow it',
    /give them\s*<strong>every<\/strong> IR/.test(panel.innerHTML.replace(/\s+/g, ' ')),
    (panel.innerHTML.match(/Clearing the scope[^<]*/) || [])[0]);
  // The per-row Save is bound through querySelectorAll on the panel, which the stub DOM
  // does not implement — so its action name is read from the source, and the ACTION it
  // names is the one asserted against the router above.
  r.ok('the row\'s Save posts setCustomerCompany with the row\'s own email',
    /adminPost\('setCustomerCompany', \{ email: b\.dataset\.email, company: company \}\)/.test(read('../app.js')));
  r.ok('...and it refuses an emptied field rather than sending a scope-clear',
    /if \(!company\) \{ showToast\('Type the company this customer should see/.test(read('../app.js')));
  r.ok('no setCustomerCompany POST is made by merely rendering the tab', posts.length === 0, posts.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the People tab cannot manage a customer, and says so instead of pretending');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A, posts } = boot(STAFF.concat([CUSTOMER]), IRS);
  A.T.accessCache = { users: STAFF.concat([CUSTOMER]), departments: [{ key: 'qa', name: 'Quality' }], apiVersion: 8 };
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderPeopleTab();
  const html = panel.innerHTML;

  r.ok('a customer is badged with their scope rather than looking like a colleague',
    /acc-badge-cust/.test(html) && /customer · Acme Survey/.test(html));
  // Two staff × one department = two ticks. The customer contributes none, which is the
  // assertion: a tick in that row would be an offer the app cannot honour.
  r.ok('...and their row has NO department ticks to click',
    (html.match(/acc-dept-tick/g) || []).length === 2, (html.match(/acc-dept-tick/g) || []).length);
  r.ok('...and it says where to manage them instead',
    /Manage it in the <em>Customers<\/em> tab/.test(html) ||
    /Customers<\/em> tab/.test(html));

  // The dangerous half: an empty tick set for a customer must never be written as
  // "departments: []", which would be a silent write to an account this grid cannot see.
  A.T.savePeopleMatrix();
  const acts = posts.map(p => post(p).action);
  r.ok('saving the grid posts nothing for a customer', acts.indexOf('setUserDepartments') === -1, acts);
  r.ok('...and with nothing genuinely changed it posts nothing at all',
    acts.length === 0, acts);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the portal link is built from where this app is served, not from a constant');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A } = boot(STAFF, IRS);
  r.ok('the link sits beside the app, so a Pages subdirectory is kept',
    A.T.customerPortalLink() === 'https://example.github.io/I-PASSBOOK/customer.html',
    A.T.customerPortalLink());
  const txt = A.T.customerHandoverTxt('ops@acme.in', 'Acme Survey');
  r.ok('the handover text names the link, the address and the one button to press',
    txt.indexOf('https://example.github.io/I-PASSBOOK/customer.html') > 0 &&
    txt.indexOf('ops@acme.in') > 0 && /First time here\?/.test(txt));
  r.ok('...and carries no password of any kind', !/[Pp]assword:/.test(txt), txt.split('\n').filter(l => /assword/.test(l)));
  r.ok('...and matches the door the invitation email names',
    /First time here\?/.test(backendGs));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the tab is reachable, and the panel renderer knows it');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const appCode = read('../app.js');
  r.ok('the strip offers a Customers tab',
    /data-tab="customers">Customers<\//.test(appCode));
  r.ok('...and renderAccessPanel has a branch for it, so tapping it paints something',
    /else if \(accessTab === 'customers'\) renderCustomersTab\(\);/.test(appCode));
  const { A } = boot(STAFF, IRS);
  const panel = A.T.document.getElementById('access-panels');
  A.T.accessTab = 'customers';
  panel.innerHTML = '';
  A.T.renderAccessPanel();
  r.ok('...which is what the tab switch actually calls', /Invite a customer/.test(panel.innerHTML));
  r.ok('the modal is still opened only for an admin', /function openAccessModal\(\) \{\s*\n\s*if \(!isAdmin\(\)\)/.test(appCode));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the classes the panel leans on are real styles, and the strip survives a phone');
// ═══════════════════════════════════════════════════════════════════════════════
r.ok('the customer badge has a colour of its own, from tokens, not the admin blue',
  /\.acc-badge-cust\s*\{[^}]*var\(--surface-green-2\)[^}]*var\(--ink-green-7\)/.test(viewsCss),
  (viewsCss.match(/\.acc-badge-cust[^}]*\}/) || [])[0]);
r.ok('the two invite outcomes are styled, and the amber one is amber',
  /\.acc-invite-ok, \.acc-invite-warn\s*\{[^}]*var\(--ink-green-6\)/.test(viewsCss) &&
  /\.acc-invite-warn\s*\{[^}]*var\(--ink-amber-8\)/.test(viewsCss));
// Five labels do not fit a phone. The strip WRAPS, and must not scroll: a tab strip
// that scrolls hides its own tabs, which is how "Customers" first shipped — measured
// clean at every width and invisible on the 414px screenshot. And a flexible tab would
// SHRINK and clip its own label before anything wrapped — the same trap the IR list's
// SIDE column fell into.
//
// Wrapping is also what puts this strip back inside reach of tools/render-check.mjs.
// That tool deliberately exempts an element whose ancestor scrolls sideways — correct
// for the board and the chart axis, which scroll on purpose — and a scrolling tab strip
// claimed the same exemption, so every width "passed" while two tabs sat off the edge.
// A wrapped strip has no ancestor to claim it, so the tab that does not fit is now
// reported as an element past the edge, at the width where it happens.
r.ok('the tab strip wraps, so every tab is on screen at once, and it does not scroll',
  /\.access-tabs \{[^}]*flex-wrap: wrap/.test(viewsCss) &&
  !/\.access-tabs \{[^}]*overflow-x/.test(viewsCss));
r.ok('...and each tab refuses to shrink, so its label cannot be clipped before it wraps',
  /\.access-tab \{[\s\S]{0,400}?flex: 0 0 auto;/.test(viewsCss) &&
  /\.access-tab \{[\s\S]{0,400}?white-space: nowrap;/.test(viewsCss));

// The invite row's placeholders are its only labels, and the shared 160px minimum cut
// both mid-word on a 414px phone. Pinning the wider minimum is not enough on its own:
// `.access-add-row .form-input` is TWO class selectors, so a bare `.access-cust-field`
// rule of the same shape silently loses and the fields go back to being clipped with
// nothing failing. The selector is asserted at equal specificity, for that reason.
r.ok('the invite row\'s two fields are wide enough that neither placeholder is cut',
  /\.access-add-row \.access-cust-field \{[^}]*min-width: 240px/.test(viewsCss));

// The other strip assertion lives in smoke-ui.mjs, which lists every tab with an
// explicit branch. Its list has to gain 'customers' or that check quietly stops
// covering the tab this suite just added.
r.ok('smoke-ui.mjs names the new tab, so its "every tab has a branch" check stays true',
  /'customers'/.test(read('./smoke-ui.mjs')),
  (read('./smoke-ui.mjs').match(/\[[^\]]*'depts'[^\]]*\]/) || [])[0]);

r.ok('the modal and its panel body are built by the app, so this tab lives inside it',
  /<div class="access-body" id="access-panels">/.test(read('../app.js')));

r.finish();
