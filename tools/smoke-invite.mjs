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
//   2. IT CAN INVENT THE COMPANY LIST. The list has to come from the tickets — and from
//      the ONE column the backend decides access by ("Where Do You Work?", the
//      `companyName` mapping). Not from "Who's Reporting?", which is the reporting
//      person's name and shares nothing with it. Read the wrong column and an admin is
//      offered a company that no row will ever match: the invitation mails, the customer
//      signs in, and the portal is empty with nothing on screen saying why. That is not a
//      hypothetical — it is what this panel did until 2026-10-08, and this suite was
//      passing throughout because it pinned the same wrong column.
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
  renderCustomersTab, renderPeopleTab, renderAccessPanel, knownCompanies, loadAccessData,
  customerPortalLink, customerHandoverTxt, savePeopleMatrix, companyFormToFields, companyToFields,
  blankCompanyForm, companyFormFromRecord,
  set companyForm(v) { companyForm = v; },
  get companyForm() { return companyForm; },
  // Which of the two screens the Customers tab is showing: '' for the register,
  // COMPANY_NEW or a company key for that company's own screen. It is a live binding
  // for the same reason companyForm is — a suite has to be able to put the reader on a
  // screen, and a copy of the value would leave the app on the one it was already on.
  set companyOpenKey(v) { companyOpenKey = v; },
  get companyOpenKey() { return companyOpenKey; },
  set companyView(v) { companyView = v; },
  get companyView() { return companyView; },
  set companyTab(v) { companyTab = v; },
  get companyTab() { return companyTab; },
  COMPANY_NEW,
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
  const companies = (opts && opts.companies) || [];
  const fetchStub = (url, init) => {
    const u = String(url);
    if (init && init.method === 'POST') { posts.push(init.body); return Promise.resolve({ json: () => Promise.resolve(postReply) }); }
    if (u.indexOf('action=listUsers') >= 0) {
      return Promise.resolve({ json: () => Promise.resolve({ status: 'ok', users: users, departments: [], companies: companies, apiVersion: 12 }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) });
  };
  const A = loadApp(BINDINGS, { capture: true, fetch: fetchStub,
    globals: { location: LOCATION, FormData: FormData } });
  A.T.accessCache = { users: users, departments: [], companies: companies, apiVersion: 12 };
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

// The two columns are DIFFERENT ON PURPOSE, and every fixture below has both, so an
// assertion can tell which one the panel read. A person's name in `customerName` and a
// company in `companyName` is the real shape of the intake form ("Who's Reporting?" in
// Col L, "Where Do You Work?" in Col R) — and a fixture that put the company in
// `customerName` could not have caught the bug this suite now exists to catch.
const IRS = [
  { irNumber: 'IR107', customerName: 'Asha Rao',     companyName: 'Acme Survey' },
  { irNumber: 'IR204', customerName: 'Vikram Shah',  companyName: 'FarmVista Solutions' },
  { irNumber: 'IR310', customerName: 'Asha Rao',     companyName: 'Acme Survey' },          // a repeat, and must be listed once
  { irNumber: 'IR388', customerName: 'Nisha Menon',  companyName: '  SkyHarvest  ' },        // leading/trailing space a human typed
  { irNumber: 'IR389', customerName: 'Ravi Kulkarni', companyName: '' },                     // a row with no company named
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
r.head('the company list is the REGISTER, and the IRs only ever add to it');
// ═══════════════════════════════════════════════════════════════════════════════
{
  const { A } = boot(STAFF.concat([CUSTOMER]), IRS);
  const got = A.T.knownCompanies();
  r.ok('every company named on a ticket is offered, each once, sorted, and trimmed',
    JSON.stringify(got) === JSON.stringify(['Acme Survey', 'FarmVista Solutions', 'SkyHarvest']),
    got);

  // THE BUG THIS SUITE WAS BLIND TO. The panel read `customerName`, which is the person
  // who reported the fault, so the dropdown offered staff names. Nothing failed visibly:
  // the invite was created, the mail went out, and the customer's portal was empty. This
  // assertion is the one that would have caught it — a person's name must never appear in
  // a list of companies.
  const people = IRS.map(ir => String(ir.customerName).trim()).filter(Boolean);
  r.ok('...and NO reporting person is offered, even though every ticket names one',
    people.length === IRS.length && !got.some(c => people.includes(c)), JSON.stringify({ got, people }));
  r.ok('...so the person-named column and the company column cannot be confused for each other',
    JSON.stringify(got) !== JSON.stringify([...new Set(IRS.map(ir => String(ir.customerName).trim()))].filter(Boolean).sort()));

  r.ok('a company a customer is already scoped to is offered even with no ticket in the list',
    (() => {
      const b = boot(STAFF.concat([CUSTOMER]), []).A.T.knownCompanies();
      return b.length === 1 && b[0] === 'Acme Survey';
    })());

  // The join that actually matters is with the BACKEND, not with another screen: the
  // string an admin picks here is compared against the intake grid by customerIRS() →
  // companyColumnIndex(), and if the two look at different columns the customer is scoped
  // to a value no row carries. So read the app's `companyName` needle and require the
  // backend's own needle list to contain it — the same "one name, two files" discipline
  // the routed-action check at the top of this file uses.
  const appCode = read('../app.js');
  const needle = (appCode.match(/\{\s*field:\s*'companyName'\s*,\s*needle:\s*'([^']+)'/) || [])[1] || '';
  const needles = (backendGs.match(/function companyColumnIndex[\s\S]*?var needles = \[([^\]]*)\]/) || [])[1] || '';
  const backendNeedles = needles.split(',').map(s => s.trim().replace(/^'|'$/g, '').toLowerCase()).filter(Boolean);
  r.ok('the app maps a company column, and the backend header matcher was found',
    !!needle && backendNeedles.length > 0, JSON.stringify({ needle, backendNeedles }));
  r.ok('...and the column the panel reads is one the backend scopes by',
    backendNeedles.includes(needle.toLowerCase()), JSON.stringify({ needle, backendNeedles }));
  r.ok('...which the panel reaches through `companyName`, never `customerName`',
    /if \(ir && ir\.companyName\) seen\.add\(String\(ir\.companyName\)\.trim\(\)\)/.test(appCode) &&
    !/if \(ir && ir\.customerName\) seen\.add/.test(appCode));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the register names a company, and its aliases are what makes its IRs reachable');
// ═══════════════════════════════════════════════════════════════════════════════
// A register record in the shape listUsers returns it: the canonical name plus the exact
// spellings the intake column carries. This pair is the whole v96 design — the register is
// the source of truth, but the Sheet's text is messy, so a scope matches the canonical
// name OR any alias. Without the alias half, correcting a company's name would empty the
// portal of the customer it was corrected for, silently.
const REG = [{
  key: 'acme-survey', name: 'Acme Survey Pvt Ltd', email: 'hello@acme.example', phone: '+91 90000 11111',
  city: 'Pune', state: 'Maharashtra', pincode: '411001', address: '', notes: '', updatedAt: '16-Oct-2026 09:00',
  sheets: ['Acme Survey', 'ACME SURVEY'],
  scopeCount: 1,
  contacts: [
    { id: 'c1', name: 'Asha Rao', email: 'ops@acme.in', phone: '+91 90000 22222', active: true },  // has an account
    { id: 'c2', name: 'Front desk', email: '',          phone: '+91 90000 33333', active: true },  // phone only
  ],
}];
{
  // LIST VIEW, deliberately. v99 made the register a GRID of tiles by default and kept the
  // card behind the List switch, so the card's own assertions are driven through the view
  // that still draws it — otherwise this block would be asserting on markup no reader can
  // reach. The grid has its own block below.
  const { A } = boot(STAFF.concat([CUSTOMER]), IRS, { companies: REG });
  const panel = A.T.document.getElementById('access-panels');
  A.T.companyView = 'list';
  A.T.renderCustomersTab();
  const html = panel.innerHTML;

  r.ok('the register card is rendered, with the canonical name',
    /acc-company/.test(html) && /Acme Survey Pvt Ltd/.test(html));
  r.ok('...and it SHOWS the other spellings, which is what an admin is here to check',
    /Also on IRs as:/.test(html) && /<code>Acme Survey<\/code>/.test(html) && /<code>ACME SURVEY<\/code>/.test(html));
  r.ok('...and how many accounts the company already has',
    /acc-company[\s\S]{0,400}1 account</.test(html));

  // THE THREE CONTACT STATES, none of which may look like the others. An invite on a
  // contact who already has an account is a re-invite; a contact with only a phone cannot
  // be invited at all, so it must not be offered a button that would refuse.
  r.ok('a contact whose email already has an account is offered Re-invite, not Invite',
    /ops@acme\.in[\s\S]{0,400}Re-invite/.test(html) && !/>Invite<\/button>[\s\S]{0,80}ops@acme\.in/.test(html));
  r.ok('...and it says so on the face of the card',
    /has an account/.test(html));
  r.ok('a contact with a phone but no email is offered WhatsApp and no Invite',
    /acc-co-wa[^>]*data-phone="\+91 90000 33333"/.test(html) &&
    !/acc-co-invite[^>]*data-name="Front desk"/.test(html));

  // THE BUTTONS SIT ON ONE LINE, and this is a rule, not a preference. A bare `.btn` is
  // `width: 100%` (components.css:14) — correct for a form's submit, wrong inside a
  // WRAPPING action group: each button then measures itself against the very box being
  // sized from its children, so every action resolves to the container's width and they
  // stack, one full-width button per line, with hundreds of pixels of empty space beside
  // them. This shipped on the first render and was found by looking at it, not by reading
  // the CSS: at 1280px the two buttons on one contact measured 214px each inside a 1034px
  // row. The header's own `.access-user-controls` escapes this only because it does not
  // wrap. `width: auto` is the app's existing escape (`.btn-inline`, components.css:38 —
  // note `.btn-sm` sizes height and padding, NOT width).
  //
  // ⚠ This pins the RULE; it cannot pin the pixels, and the two are not the same thing
  // (a rule can exist and lose). The pixel half is `node tools/render-themes.mjs` on
  // `tools/render-fixture.mjs`'s `access.html`, which is how this was caught.
  r.ok('...and the contact row\'s action group neutralises the full-width default of .btn',
    /\.acc-contact-how \.btn \{[^}]*width: auto/.test(viewsCss),
    (viewsCss.match(/\.acc-contact-how[^}]*\}/g) || []).join(' | '));

  // The register is the FIRST group in the dropdown and the leftovers are visibly second,
  // in their own optgroup. Both halves matter: the register has to win, and a spelling the
  // register has not been told about must still be pickable, or the panel would be unable
  // to onboard anybody its seed missed.
  r.ok('the dropdown offers the registered name, and files the stray spellings under a group',
    /<option value="Acme Survey Pvt Ltd">/.test(html) &&
    /<optgroup label="Not in the register yet">/.test(html) &&
    /<option value="Acme Survey">/.test(html));
  r.ok('...and the registered name is NOT also listed as a leftover',
    (html.match(/<optgroup label="Not in the register yet">([\s\S]*?)<\/optgroup>/) || ['', ''])[1]
      .indexOf('>Acme Survey Pvt Ltd<') < 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the register opens as a grid, and a tile answers the three questions the list could not');
// ═══════════════════════════════════════════════════════════════════════════════
// Seventy cards is a list nobody reads: the question an admin arrives with is "which of
// these has open work", and a card that leads with an address does not answer it. The
// tile leads with the counters, and the whole tile is the control that opens the company.
{
  const { A } = boot(STAFF.concat([CUSTOMER]), IRS, { companies: REG });
  const panel = A.T.document.getElementById('access-panels');
  A.T.renderCustomersTab();          // no view set: the DEFAULT has to be the grid
  const html = panel.innerHTML;

  r.ok('the default view is the grid, and it is tiles rather than cards',
    /class="co-grid"/.test(html) && /class="co-tile acc-co-open"/.test(html) && !/acc-company"/.test(html));
  r.ok('a tile carries the company name and its IR count',
    /co-tile-name">Acme Survey Pvt Ltd</.test(html) && /<b>\d+<\/b> IRs?/.test(html));
  r.ok('...and the open count, which is the reason the grid exists',
    /<b>\d+<\/b> open/.test(html));
  r.ok('the portal address is printed ONCE, not once per company',
    (html.match(/class="co-portal"/g) || []).length === 1 && (html.match(/customer\.html/g) || []).length === 1,
    (html.match(/customer\.html/g) || []).length);
  r.ok('the unmatched spellings are folded away until asked for',
    /acc-co-unreg-toggle/.test(html) && !/Make it a company/.test(html));

  // The tile IS the control, so pressing it has to move the panel to that company. Driven
  // rather than read: a data-key that is never wired is a grid of dead tiles.
  // ⚠ The tile is wired through `panels.querySelectorAll`, which the stub DOM answers
  // with `[]` — so a dispatch here would fire nothing and prove nothing. The screen is
  // driven by putting the reader on it, which is exactly the state that handler sets.
  A.T.companyOpenKey = 'acme-survey';
  A.T.companyTab = 'overview';
  A.T.renderCustomersTab();
  r.ok('the reader on a company\'s screen gets that screen, not the register',
    !/class="co-grid"/.test(panel.innerHTML), panel.innerHTML.slice(0, 120));
  const detail = panel.innerHTML;
  r.ok('...which names the company and offers the way back',
    /co-detail-name">Acme Survey Pvt Ltd/.test(detail) && /id="acc-co-back"/.test(detail));
  r.ok('...and its four views, with the IR count on the tab that lists them',
    /data-tab="overview"/.test(detail) && /data-tab="irs"/.test(detail) &&
    /data-tab="people"/.test(detail) && /data-tab="activity"/.test(detail));

  // People carries what the card used to, so an invite is still one press from the
  // company it belongs to.
  A.T.companyTab = 'people';
  A.T.renderCustomersTab();
  r.ok('the People tab still offers Re-invite on an existing account and WhatsApp on a phone-only contact',
    /ops@acme\.in[\s\S]{0,400}Re-invite/.test(panel.innerHTML) &&
    /acc-co-wa[^>]*data-phone="\+91 90000 33333"/.test(panel.innerHTML) &&
    !/acc-co-invite[^>]*data-name="Front desk"/.test(panel.innerHTML));

  // Back returns to the register. It is wired by ID, so the harness CAN press it — and it
  // has to clear the company as well, or the next repaint would put the reader straight
  // back on the screen they just left.
  A.T.companyTab = 'overview';
  A.T.renderCustomersTab();
  A.T.document.getElementById('acc-co-back').dispatch('click');
  r.ok('the back button returns to the register and forgets the company',
    A.T.companyOpenKey === '' && /class="co-grid"/.test(panel.innerHTML), A.T.companyOpenKey);
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('a company is edited on its OWN screen, not at the top of the register');
// ═══════════════════════════════════════════════════════════════════════════════
{
  // THE POST ITSELF. The form is opened BEFORE the render, so the whole block is one
  // render and therefore one click handler on Save. That is not tidiness: the stub DOM
  // hands back a node for any id it is asked for, so a control wired by a render that had
  // no form in it still collects a listener — a harness artifact, where a browser throws
  // the old node away with the markup it was in.
  const { A, posts } = boot(STAFF, IRS, { companies: REG });
  // The form lives on the company's OWN screen now, so the reader has to be on the
  // screen as well as holding a draft — the register no longer draws a form at all.
  A.T.companyForm = A.T.blankCompanyForm();
  A.T.companyOpenKey = A.T.COMPANY_NEW;
  A.T.renderCustomersTab();

  r.ok('the form carries a name field, an alias box and a Save of its own',
    !!A.T.document.getElementById('acc-co-name') && !!A.T.document.getElementById('acc-co-sheets') &&
    !!A.T.document.getElementById('acc-co-save'));

  fill(A, 'acc-co-name', '  Brand New Farms  ');
  fill(A, 'acc-co-sheets', 'Brand New Farms\nBRAND NEW FARM');
  fill(A, 'acc-co-city', 'Nashik');
  A.T.document.getElementById('acc-co-save').dispatch('click');
  await new Promise(res => setTimeout(res, 20));

  const body = posts.length ? post(posts[0]) : {};
  r.ok('Save posts exactly one action, and it is saveCompany', posts.length === 1 && body.action === 'saveCompany',
    JSON.stringify({ n: posts.length, action: body.action }));
  r.ok('...carrying the name, which the backend is what trims', String(body.name).trim() === 'Brand New Farms', body.name);
  // THE TRAP THIS PINS. A register record holds `sheets` as an ARRAY and the form holds the
  // same thing as a textarea string. Posting the draft through the record's serialiser
  // sends an empty `sheets`, which the backend reads as "no other spellings" — silently
  // un-registering every alias the company had, and taking the IRs of the very customer the
  // edit was meant to help. So the newline-joined text is what must leave, verbatim.
  r.ok('...and the alias box travels as the newline-joined spellings, NOT as an empty list',
    body.sheets === 'Brand New Farms\nBRAND NEW FARM', JSON.stringify(body.sheets));
  r.ok('...and the address fields, so the card does not lose what it just collected',
    body.city === 'Nashik', body.city);
  r.ok('...and a company being edited names its key, so the save updates rather than duplicates',
    'key' in body, Object.keys(body));
  r.ok('...and nothing secret on the wire',
    !/password|secret|token/i.test(Object.keys(body).join(',')), Object.keys(body));
}
{
  // ADDING A CONTACT ROW IS A REPAINT OF A FORM THAT IS BEING TYPED INTO. This is the
  // assertion that catches the obvious way to write it — read the fields only at save
  // time — where the name and the aliases vanish the moment the first contact is added.
  // Nothing is posted here on purpose; the POST is asserted above, on a single render.
  const { A } = boot(STAFF, IRS, { companies: REG });
  // The form lives on the company's OWN screen now, so the reader has to be on the
  // screen as well as holding a draft — the register no longer draws a form at all.
  A.T.companyForm = A.T.blankCompanyForm();
  A.T.companyOpenKey = A.T.COMPANY_NEW;
  A.T.renderCustomersTab();
  fill(A, 'acc-co-name', '  Brand New Farms  ');
  fill(A, 'acc-co-sheets', 'Brand New Farms\nBRAND NEW FARM');
  A.T.document.getElementById('acc-co-addcontact').dispatch('click');

  const afterAdd = A.T.document.getElementById('acc-co-name');
  r.ok('adding a contact row repaints the form WITHOUT losing what was typed',
    !!afterAdd && afterAdd.value === '  Brand New Farms  ', afterAdd && afterAdd.value);
  r.ok('...and it keeps the aliases, the field the whole register turns on',
    A.T.document.getElementById('acc-co-sheets').value === 'Brand New Farms\nBRAND NEW FARM');
  r.ok('...and it added exactly ONE row, not a row per repaint',
    A.T.companyForm.contacts.length === 1, A.T.companyForm.contacts.length);
  r.ok('...and the new row is a real row with its own three fields',
    !!A.T.document.getElementById('acc-c-0-name') && !!A.T.document.getElementById('acc-c-0-email') &&
    !!A.T.document.getElementById('acc-c-0-phone'));

  // The serialiser the draft leaves by, driven directly: a contact survives it, and the
  // RECORD's serialiser is a different function — posting a record's shape through the
  // form's path, or the reverse, is the mistake this pair exists to make impossible. Both
  // halves are asserted, so neither can quietly drift into the other.
  const f = A.T.companyFormToFields({
    key: '', name: 'Brand New Farms', sheetsText: 'A\nB',
    contacts: [{ name: 'Nisha Menon', email: 'nisha@brandnew.example', phone: '+91 91111 22222' }],
  });
  r.ok('the draft\'s serialiser sends the aliases as text and the contacts as a JSON string',
    f.sheets === 'A\nB' && (() => { try { return JSON.parse(f.contacts)[0].email === 'nisha@brandnew.example'; } catch (e) { return false; } })());
  const rec = A.T.companyToFields({ key: 'k', name: 'X', sheets: ['A', 'B'], contacts: [] }, ['C']);
  r.ok('...and the RECORD\'s serialiser is a different function, joining an array with the new spelling',
    rec.sheets === 'A\nB\nC', JSON.stringify(rec.sheets));
}
{
  // A REFUSAL MUST NOT COST THE TYPING. The backend refuses a duplicate slug and a missing
  // name; if the form closed on that reply, the message would be asking the admin to fix
  // text the panel had just thrown away.
  const { A } = boot(STAFF, IRS, { companies: REG, postReply: { status: 'error', message: 'A company with that name already exists' } });
  // The form lives on the company's OWN screen now, so the reader has to be on the
  // screen as well as holding a draft — the register no longer draws a form at all.
  A.T.companyForm = A.T.blankCompanyForm();
  A.T.companyOpenKey = A.T.COMPANY_NEW;
  A.T.renderCustomersTab();
  fill(A, 'acc-co-name', 'Acme Survey Pvt Ltd');
  A.T.document.getElementById('acc-co-save').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  const nameField = A.T.document.getElementById('acc-co-name');
  const saveBtn = A.T.document.getElementById('acc-co-save');
  r.ok('a refused save leaves the form open, with the text still in it',
    !!nameField && nameField.value === 'Acme Survey Pvt Ltd', nameField && nameField.value);
  r.ok('...and leaves the save button usable rather than stuck on "Saving…"',
    !!saveBtn && !saveBtn.disabled, saveBtn && saveBtn.textContent);
}
{
  // A COMPANY WITH NO NAME never reaches the backend: the register's key is derived from
  // the name, so there is nothing to file it under. The refusal is local, and the proof is
  // that no POST is made at all.
  const { A, posts } = boot(STAFF, IRS, { companies: REG });
  // The form lives on the company's OWN screen now, so the reader has to be on the
  // screen as well as holding a draft — the register no longer draws a form at all.
  A.T.companyForm = A.T.blankCompanyForm();
  A.T.companyOpenKey = A.T.COMPANY_NEW;
  A.T.renderCustomersTab();
  fill(A, 'acc-co-name', '   ');
  A.T.document.getElementById('acc-co-save').dispatch('click');
  await new Promise(res => setTimeout(res, 20));
  r.ok('a company with no name is refused locally, without a round trip',
    posts.length === 0, posts.length);
}
{
  // AN ABANDONED EDIT MUST NOT ALREADY HAVE CHANGED THE THING THE LIST RENDERS FROM. The
  // form is a DRAFT of a register record, and if it held the record's own contacts array
  // then pressing Edit and then Cancel would leave the contact the admin typed sitting in
  // the card behind the form — changed, never saved, and impossible to explain.
  const { A } = boot(STAFF, IRS, { companies: REG });
  const rec = A.T.accessCache.companies[0];
  const draft = A.T.companyFormFromRecord(rec);
  r.ok('the draft carries the record\'s aliases as the textarea text the form edits',
    draft.sheetsText === 'Acme Survey\nACME SURVEY' && draft.key === 'acme-survey' && draft.originalName === 'Acme Survey Pvt Ltd',
    JSON.stringify({ sheetsText: draft.sheetsText, key: draft.key }));
  draft.contacts.push({ id: '', name: 'Typed but never saved', email: '', phone: '', active: true });
  draft.contacts[0].name = 'Renamed in the form only';
  r.ok('...and its contacts are a COPY: typing in the form cannot edit the register behind it',
    rec.contacts.length === 2 && rec.contacts[0].name === 'Asha Rao',
    JSON.stringify(rec.contacts.map(k => k.name)));
}

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the frontend and the backend agree on what a company name IS');
// ═══════════════════════════════════════════════════════════════════════════════
// The scoping comparison happens TWICE — once in the browser, to decide whether a name is
// registered, and once in the backend, to decide which rows a customer may see. Two
// normalisations that drift apart give a customer a portal scoped by a rule the panel
// never showed the admin, which is exactly the silent failure this pair exists to prevent.
// So both sides are read out of their own source and required to match.
{
  const appCode = read('../app.js');
  const fnBody = (src, name) => {
    const m = src.match(new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
    return m ? m[0] : '';
  };
  const backendNorm = fnBody(backendGs, 'sameCompanyKey');
  r.ok('the backend has one normaliser, and it lowercases, collapses whitespace and trims',
    /toLowerCase\(\)/.test(backendNorm) && /replace\(\/\\s\+\/g, ' '\)/.test(backendNorm) && /trim\(\)/.test(backendNorm),
    backendNorm);
  const frontNorm = fnBody(appCode, 'normCompany');
  r.ok('...and the browser normalises the same three ways, in the same order',
    /toLowerCase\(\)/.test(frontNorm) && /replace\(\/\\s\+\/g, ' '\)/.test(frontNorm) && /trim\(\)/.test(frontNorm),
    frontNorm);
  // Not "the two rules look alike" but "the two rules AGREE", which is the actual claim:
  // both functions are run here, over the same awkward inputs a real intake column holds —
  // case, runs of spaces, leading and trailing whitespace, a non-breaking space, a null —
  // and their answers are compared. A regex-shape check would pass on a pair that had
  // drifted in the order of the two operations, which is precisely how they drift.
  const run = (src, name) => (new Function(src + '\nreturn ' + name + ';'))();
  const asKey = run(fnBody(backendGs, 'sameCompanyKey'), 'sameCompanyKey');
  const asNorm = run(frontNorm, 'normCompany');
  const INPUTS = ['Acme Survey', 'ACME   SURVEY', '  acme survey  ', 'Acme\nSurvey', '', null, undefined, 0];
  const pairs = INPUTS.map(v => [asKey(v), asNorm(v)]);
  r.ok('...and they answer IDENTICALLY on case, runs of spaces, leading/trailing space and null',
    pairs.every(([a, b]) => a === b), JSON.stringify(pairs));
  const pick = (src, name) => {
    const m = src.match(new RegExp('COMPANY_PLACEHOLDERS\\s*=\\s*\\[([^\\]]*)\\]'));
    return (m ? m[1] : '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  };
  const backP = pick(backendGs), frontP = pick(appCode);
  r.ok('the placeholder list exists on BOTH sides and is the same list',
    backP.length > 0 && JSON.stringify(backP) === JSON.stringify(frontP), JSON.stringify({ backP, frontP }));
  r.ok('...and it names only placeholder tokens, never an organisation',
    frontP.every(p => /^(n\/?a|nil|none|no|-{1,2}|test(ing)?|x)$/i.test(p)), frontP);
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

// ═══════════════════════════════════════════════════════════════════════════════
r.head('the register the backend carries reaches the panel');
// ═══════════════════════════════════════════════════════════════════════════════
{
  // listUsers carries `companies`, and loadAccessData used to rebuild accessCache from
  // users / departments / apiVersion ONLY — so every register record the backend sent
  // was discarded on arrival and the panel read "Companies 0" next to a register of
  // seventy. Every other check in this file writes accessCache by hand, which is exactly
  // why the whole suite stayed green through it: the bug lived in the one step none of
  // them performed.
  const { A } = boot(STAFF, IRS, { companies: REG });
  A.T.accessCache = { users: [], departments: [], companies: [], apiVersion: 0 };
  A.T.accessTab = 'customers';

  await A.T.loadAccessData();

  r.ok('listUsers\'s companies survive the load instead of being dropped',
    A.T.accessCache.companies.length === REG.length,
    'companies=' + A.T.accessCache.companies.length);

  const html = A.T.document.getElementById('access-panels').innerHTML;
  r.ok('...so the panel paints the register rather than "The register is empty"',
    /Acme Survey Pvt Ltd/.test(html) && !/The register is empty/.test(html));
}

r.finish();
