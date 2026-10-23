// The customer portal — its markup, its styles' partner, and its one entry point.
//
// Extracted from customer.html so that the SAME portal can be mounted in two places:
// the standalone page (kept, because every invitation already emailed points at it)
// and index.html's customer mode, where a customer signs in at the app's own address
// and stays there.
//
// It is an IIFE on purpose. app.js is a classic script in the same global scope, and
// the two files both define helpers with the same short names. Wrapping this one is
// what lets them share a document without either one silently overwriting the other.
(function () {
  'use strict';

  // Injected, not written twice. The markup lives here and nowhere else, so the
  // standalone page and the app's customer mode can never drift.
  var PORTAL_HTML = String.raw`
<header class="bar">
  <div class="wrap bar-in">
    <a class="brand" href="./">
      <img src="assets/icon-mark.png" alt="">
      <b>Indrones</b><span>Customer Space</span>
    </a>
    <span class="bar-spacer"></span>
    <span class="who" id="header-who" hidden></span>
    <a class="btn js-signin" id="header-signin" href="#signin">Sign in</a>
    <button type="button" class="btn js-signout" id="signout" hidden>Sign out</button>
  </div>
</header>

<main>

  <section class="hero wrap">
    <p class="eyebrow">After-sales</p>
    <h1>Everything about your aircraft, in one place.</h1>
    <p class="lede">Raise a request, follow what we are doing about it, and read the record of
    every service we have carried out on your fleet. No phone calls to find out where things stand.</p>
    <div class="btn-row">
      <a class="btn btn-primary" id="raise" href="#" target="_blank" rel="noopener">Report a problem</a>
      <a class="btn" id="hero-cta" href="#access">Sign in to your reports</a>
    </div>
  </section>

  <!-- ── THE PORTAL ───────────────────────────────────────────────────────────
       The signed-in landing, and the shape the owner described on 2026-10-22: big
       interactive tiles for the major activities, each opening one panel below.

       Hidden until a session is proved, and every panel in it is painted fresh on
       every load. It is the only part of this page that holds anything private: one
       customer's own tickets, profile and aircraft, narrowed server-side to their
       company. Nothing here is ever read back out of storage — see the note on
       PORTAL in the script. -->
  <section id="portal" class="wrap" hidden>
    <p class="eyebrow">Customer space</p>
    <h1 id="portal-title">Your space</h1>
    <p class="lede" id="portal-sub"></p>

    <div class="tiles" id="portal-tiles">
      <button type="button" class="tile" data-panel="report">
        <span class="tile-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 6v12M6 12h12"/><circle cx="12" cy="12" r="9"/></svg></span>
        <span class="tile-name">Report an IR</span>
        <span class="tile-desc">Access customer help desk to report your issue or submit your feedback. Use the Customer Support Form, or ask the guide beside it.</span>
        <span class="tile-meta" id="tile-meta-report"></span>
      </button>

      <button type="button" class="tile" data-panel="library">
        <span class="tile-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 5.5h6a2 2 0 0 1 2 2V19a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-6a2 2 0 0 0-2 2V19a2 2 0 0 1 2-2h6z"/></svg></span>
        <span class="tile-name">Access Library</span>
        <span class="tile-desc">Flight and user manuals, checklists, logbooks, training videos and the other documents your operations need.</span>
        <span class="tile-meta" id="tile-meta-library"></span>
      </button>

      <button type="button" class="tile" data-panel="history">
        <span class="tile-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></span>
        <span class="tile-name">IR History</span>
        <span class="tile-desc">Every request your company has raised with us, under one sign-in, for the life of your fleet.</span>
        <span class="tile-meta" id="tile-meta-history"></span>
      </button>

      <button type="button" class="tile" data-panel="details">
        <span class="tile-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg></span>
        <span class="tile-name">Your details</span>
        <span class="tile-desc">The addresses we ship to, the people we call, and the aircraft we hold a UIN certificate for.</span>
        <span class="tile-meta" id="tile-meta-details"></span>
      </button>

      <button type="button" class="tile" data-panel="contact">
        <span class="tile-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 5.5h16v11H9l-5 4z"/></svg></span>
        <span class="tile-name">Discuss Your Requirement</span>
        <span class="tile-desc">A new platform, a service contract, or something you have in mind that no one has built yet — talk it through with us.</span>
        <span class="tile-meta" id="tile-meta-contact"></span>
      </button>
    </div>

    <!-- ── REPORT ───────────────────────────────────────────────────────────── -->
    <section class="panel" id="panel-report" hidden>
      <div class="panel-head"><h2>Report an IR</h2></div>
      <p class="sub">Every request reaches the service desk the moment you submit it, and gets an IR
      number the same day. Use the form below; if you are not sure which form fits, the guide under
      it narrows it down in three short questions.</p>
      <div class="panel-actions">
        <a class="btn btn-primary" id="raise-p" href="#" target="_blank" rel="noopener">Customer Support Form</a>
        <a class="btn" id="feedback-p" href="#" target="_blank" rel="noopener" aria-disabled="true">Give feedback</a>
      </div>

      <!-- THE GUIDE. A fixed conversation, not a model: every answer is a sentence we
           wrote, and the last choice on every branch is a person. It cannot invent a
           promise, and it costs nothing to run because nothing leaves the browser. -->
      <div class="bot" id="bot">
        <div class="bot-log" id="bot-log" aria-live="polite"></div>
        <div class="bot-choices" id="bot-choices"></div>
        <p class="bot-note">A guide with fixed answers — it can point you to the right form, your
        ticket list or a manual. It cannot raise a request or change one.</p>
      </div>
    </section>

    <!-- ── LIBRARY ──────────────────────────────────────────────────────────── -->
    <section class="panel" id="panel-library" hidden>
      <div class="panel-head"><h2>Access Library</h2><span class="lib-n" id="lib-count"></span></div>
      <p class="sub">Documents by platform, plus the training videos. Everything here is a link to a
      file the service desk maintains, so it is always the current version.</p>
      <div id="lib-body"></div>
    </section>

    <!-- ── DETAILS ──────────────────────────────────────────────────────────── -->
    <section class="panel" id="panel-details" hidden>
      <div class="panel-head"><h2>Your details</h2></div>
      <p class="sub">Keep these right and we will never have to ask you twice — not at a dispatch,
      and not in the middle of a breakdown. Only your own company can see this page.</p>

      <div class="detail-block">
        <h3>Ship-to addresses</h3>
        <div id="addr-rows"></div>
        <p class="detail-empty" id="addr-empty" hidden>No address on file yet. Add the one we should ship to.</p>
        <button type="button" class="btn" id="addr-add">Add an address</button>
      </div>

      <div class="detail-block">
        <h3>People we contact</h3>
        <div id="cont-rows"></div>
        <p class="detail-empty" id="cont-empty" hidden>No contact on file yet. Add the person we should call.</p>
        <button type="button" class="btn" id="cont-add">Add a person</button>
      </div>

      <div class="panel-actions">
        <button type="button" class="btn btn-primary" id="profile-save">Save details</button>
        <span class="msg" id="profile-msg" aria-live="polite"></span>
      </div>

      <div class="detail-block">
        <h3>Your aircraft</h3>
        <p class="sub" style="margin-bottom:6px">The UIN is the registration number your aircraft
        flies under, and the certificate is the DGCA document for it. Both are issued to you — tell
        the service desk if a serial is missing or a certificate is out of date.</p>
        <ul class="fleet" id="fleet-list"></ul>
        <p class="detail-empty" id="fleet-empty" hidden>No aircraft is registered against your
        company yet. The service desk adds it from the serial numbers on your tickets.</p>
      </div>
    </section>

    <!-- ── CONTACT ──────────────────────────────────────────────────────────── -->
    <section class="panel" id="panel-contact" hidden>
      <div class="panel-head"><h2>Discuss Your Requirement</h2></div>
      <p class="sub">A payload that does not exist yet, a fleet that needs to fly further, a service
      contract, or simply a question you have been carrying for a while — tell us, and we will give
      you a straight answer from the people who build and fly these machines.</p>
      <div class="panel-actions">
        <a class="btn btn-primary" id="contact-call" href="tel:+919594160160">Call the desk</a>
        <a class="btn" id="contact-wa" href="https://wa.me/918655366232" target="_blank" rel="noopener">WhatsApp us</a>
        <a class="btn" href="https://indrones.com/" target="_blank" rel="noopener">indrones.com</a>
        <a class="btn" href="https://indrones.com/videos/" target="_blank" rel="noopener">Watch our drones</a>
      </div>
      <div class="cr-card" id="cr-card" hidden></div>
      <p class="card-note" style="margin-top:14px">Your Customer Relations contact is for anything
      about a live ticket. For a new requirement, the desk line above is the faster door.</p>
    </section>

    <!-- ── IR HISTORY ──────────────────────────────────────────────────────────
         This is '#reports', unchanged, now the panel behind the IR History tile. The id
         and the markup inside it are exactly what they were: the ticket list, the empty
         state and the single-ticket view are all the same code paths as before. -->
    <section id="reports" class="panel" hidden>
    <div class="reports-head">
      <h2>IR History</h2>
      <span class="bar-spacer"></span>
    </div>
    <p class="sub" id="reports-sub"></p>

    <div id="reports-list">
      <ul class="tickets" id="ticket-list"></ul>

      <div class="aside" id="reports-empty" hidden>
        <h3>No requests are showing for your account</h3>
        <p>Every request raised under <b id="empty-company"></b> should be listed here. If
        you have raised one and it is missing, tell the service desk — the company name
        typed into the form has to match the one we hold on your account, and we will put
        that right straight away.</p>
        <a class="btn btn-primary" id="raise-3" href="#" target="_blank" rel="noopener">Report a problem</a>
      </div>
    </div>

    <div id="report-one" hidden>
      <button type="button" class="btn" id="back-to-list">&#8592; All reports</button>
      <div id="one-body"></div>
    </div>
    </section>
  </section>

  <section id="access" class="wrap">
    <div class="split">
      <div>
        <h2>How access works</h2>
        <p class="sub">This space is for customers who have bought from us. There is no public
        sign-up — an account is created for you when your aircraft is handed over, so that the
        record you see is only ever your own.</p>
        <ol class="steps">
          <li><b>We onboard you</b><span>When your order is delivered, we set you up in the portal and send an invitation to your official email address.</span></li>
          <li><b>You sign in with a code</b><span>On your own space, enter your email address and press Continue. We email you a 6-digit code; enter it and you are in. There is no password to remember.</span></li>
          <li><b>You use it from then on</b><span>Every request, every report, every dispatch note for your fleet — under one sign-in, for the life of the aircraft.</span></li>
        </ol>
      </div>
      <div class="aside">
        <!-- Two states, and only one is ever shown. A customer who is already signed in must
             not be offered "Sign in" again — it is the one thing on this page that reads as a
             contradiction, and it is below the fold on a phone, where the header has already
             dropped the account name for room. -->
        <div class="aside-block" id="access-visitor">
          <h3>Already have an account?</h3>
          <p>Sign in with your email address. We will send you a code that stays good for 8
          hours, so you do not have to remember a password every morning.</p>
          <a class="btn btn-primary js-signin" href="#signin">Sign in</a>
          <p>Not onboarded yet? Raise a request below and the service desk will set you up.</p>
        </div>
        <div class="aside-block" id="access-member" hidden>
          <h3>You are signed in</h3>
          <p>Showing the reports for <b id="access-member-who"></b>. If this is not you, sign out
          before you leave the device.</p>
          <button type="button" class="btn js-signout">Sign out</button>
        </div>
      </div>
    </div>
  </section>

  <section id="products" class="wrap">
    <h2>Your products</h2>
    <p class="sub">The platforms we support, and what each one carries.</p>
    <div class="cards">

      <article class="card">
        <span class="chip">DGCA Type Certified</span>
        <div>
          <h3>SIGMA25G</h3>
          <p class="tag">Survey-grade platform. Carry more, reach further, operate anywhere.</p>
        </div>
        <dl class="specs">
          <div class="spec"><dt>Max flight time</dt><dd>29 min 37 s</dd></div>
          <div class="spec"><dt>Mapping accuracy</dt><dd>±5 cm</dd></div>
          <div class="spec"><dt>Control range</dt><dd>2 km</dd></div>
          <div class="spec"><dt>Protection</dt><dd>IP53</dd></div>
          <div class="spec"><dt>Payload modes</dt><dd>6 configurations</dd></div>
          <div class="spec"><dt>Payload swap</dt><dd>Under 2 min</dd></div>
        </dl>
        <ul class="payloads">
          <li>Multispectral 5-band NDVI</li>
          <li>RGB survey 20 / 24 MP</li>
          <li>Training weight</li>
        </ul>
      </article>

      <article class="card">
        <span class="chip pending">Certification underway</span>
        <div>
          <h3>SIGMA 25 PRO</h3>
          <p class="tag">Advanced multi-payload survey and surveillance platform. Two mission sets, one airframe.</p>
        </div>
        <dl class="specs">
          <div class="spec"><dt>Max flight time</dt><dd>50 min</dd></div>
          <div class="spec"><dt>Mapping accuracy</dt><dd>±3 cm</dd></div>
          <div class="spec"><dt>Control range</dt><dd>4 km</dd></div>
          <div class="spec"><dt>Protection</dt><dd>IP53</dd></div>
          <div class="spec"><dt>Payload modes</dt><dd>4 configurations</dd></div>
          <div class="spec"><dt>Operation</dt><dd>Day and night</dd></div>
        </dl>
        <ul class="payloads">
          <li>RGB zoom up to 10×</li>
          <li>Multispectral 5-band</li>
          <li>Radiometric thermal</li>
          <li>RGB survey</li>
          <li>Training weight</li>
        </ul>
      </article>

      <article class="card">
        <span class="chip">DGCA Type Certified</span>
        <div>
          <h3>SIGMA100</h3>
          <p class="tag">Enterprise-grade platform tailored for missions. One of the few DGCA Type-Certified LiDAR drones in India.</p>
        </div>
        <dl class="specs">
          <div class="spec"><dt>Max flight time</dt><dd>75 min</dd></div>
          <div class="spec"><dt>Max take-off weight</dt><dd>8 kg</dd></div>
          <div class="spec"><dt>Protection</dt><dd>IP53</dd></div>
          <div class="spec"><dt>Payload modes</dt><dd>8 configurations</dd></div>
          <div class="spec"><dt>Payload swap</dt><dd>Under 2 min</dd></div>
          <div class="spec"><dt>Operation</dt><dd>Day and night</dd></div>
        </dl>
        <ul class="payloads">
          <li>LiDAR point cloud</li>
          <li>Radiometric thermal</li>
          <li>RGB surveillance 30× zoom</li>
          <li>Oblique penta 3D</li>
          <li>Multispectral 5-band</li>
          <li>RGB survey</li>
          <li>Speaker</li>
          <li>Training weight</li>
        </ul>
      </article>

    </div>
  </section>

  <section id="support" class="wrap">
    <div class="split">
      <div>
        <h2>What happens when you raise a request</h2>
        <p class="sub">Every request gets an IR number the moment it reaches us, and it is worked
        through the same ten stages every time. You can watch it move.</p>
        <ol class="steps">
          <li><b>Open</b><span>Your report has reached the service desk and is waiting to be taken up.</span></li>
          <li><b>Inward</b><span>The aircraft or component is on its way to us, and we log it in when it arrives.</span></li>
          <li><b>Inspection</b><span>We look over the unit and record its condition as received.</span></li>
          <li><b>Investigation</b><span>Our engineers find the cause and write up what they found.</span></li>
          <li><b>Production</b><span>The repair or replacement is carried out.</span></li>
          <li><b>Quality Test</b><span>The work is tested before it leaves us.</span></li>
          <li><b>PDI / Dispatch</b><span>Final checks, packing, and the dispatch note to you.</span></li>
          <li><b>Delivered</b><span>It is back with you. The request is closed.</span></li>
        </ol>
        <p class="card-note">Two of the ten are not steps in that sequence: <b>On Hold</b> means work
        is paused — usually waiting on a part or on your approval — and <b>Remote Support</b> means
        we are helping you without the unit coming in.</p>
      </div>

      <div class="aside">
        <h3>Reach the service desk</h3>
        <p>Use the form that matches what you need. Both go straight to the desk, and both give you
        a record you can point back to.</p>
        <a class="btn btn-primary" id="raise-2" href="#" target="_blank" rel="noopener">Report a problem</a>
        <a class="btn" id="feedback" href="#" target="_blank" rel="noopener" aria-disabled="true">Give feedback</a>
        <p>The form is made with Google Forms. If this device is not already signed in to a Google
        account, Google will ask you to sign in first — that is Google asking, not Indrones.</p>
        <div class="contact">
          <div><span class="k">Phone</span><span class="v">+91 9594 160 160</span></div>
          <div><span class="k">Email</span><span class="v">info@indrones.com</span></div>
        </div>
      </div>
    </div>
  </section>

</main>

<footer class="foot wrap">
  <div class="row">
    <span>Indrones Customer Space</span>
    <a href="#library" data-open-panel="library">Products</a>
    <a href="#contact" data-open-panel="contact">Support</a>
    <a href="./faq.html">Help &amp; FAQ</a>
    <a href="https://indrones.com/" target="_blank" rel="noopener">indrones.com</a>
  </div>
</footer>

<!-- ── THE SIGN-IN SHEET ───────────────────────────────────────────────────────
     ONE door, two steps: an email address, then the 6-digit code we mail to it.

     There used to be a second door here — a first-time / forgotten-password path
     that asked the visitor to choose a password. It is gone, and its removal is
     the fix rather than a simplification: a customer account has no password at
     all, so the app no longer issues one, and a screen offering to set one sent a
     newly invited customer down a road the backend had already closed.

     What is here is the app OWN actions — the same login call the customer door on
     index.html uses — so this page adds no auth machinery and stores nothing but
     the session it is given. -->
<div class="sheet" id="signin" hidden>
  <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="signin-title">
    <button type="button" class="sheet-x" id="signin-close" aria-label="Close">&#10005;</button>

    <h2 id="signin-title">Sign in to your reports</h2>
    <p class="msg" id="signin-msg" aria-live="polite"></p>

    <div class="field">
      <label for="signin-email">Your email address</label>
      <input id="signin-email" type="email" inputmode="email" autocomplete="email"
             autocapitalize="off" spellcheck="false" placeholder="you@company.com">
    </div>

    <div class="field" id="code-field" hidden>
      <label for="signin-code">The 6-digit code we emailed you</label>
      <input id="signin-code" type="text" inputmode="numeric" autocomplete="one-time-code"
             maxlength="6" placeholder="000000">
    </div>

    <!-- Only while a code is outstanding. The button is the WHOLE resend feature: the
         backend re-mails the SAME code, so this adds a second chance, not a second code.
         It sits under the code field and starts disabled for 60 seconds, because that is
         the server's own gap; a button that fires into it would only produce a refusal. -->
    <div class="resend-row" id="resend-line" hidden>
      <button type="button" class="btn btn-resend" id="signin-resend" disabled>Resend code</button>
      <span class="resend-note" id="resend-note" aria-live="polite"></span>
    </div>

    <button type="button" class="btn btn-primary" id="signin-go">Continue</button>

    <p class="sheet-note" id="signin-note"></p>
    <p class="sheet-note">Looking for the service desk app? It is on the <a href="./index.html">same page as this one</a>, behind the Employee door.</p>
  </div>
</div>
`;
  // ── The two form URLs, in ONE place each ───────────────────────────────────
  // Both are the SHARE link (`/d/e/…/viewform`), not the editor link, which opens
  // for nobody but its owner. They are set as hrefs here rather than written into
  // the markup so there is never a second copy to drift.
  //
  // The support form is the desk's existing intake — the same form the app's own
  // sign-in screen already links to, so a request raised here lands exactly where
  // every other one does. Nothing about it changes.
  const SUPPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScKxygN_FWBo_pD-uc9g6y5fPx4Mc0BB7pyA8Vy2BPTXAkJlw/viewform';

  // The customer feedback form — a DIFFERENT form from the one above, on its own
  // Google Form id, which is the whole reason it has its own constant here. Empty
  // would mark the button disabled rather than open nothing, because a button that
  // opens nothing is worse than no button.
  const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc0S3JVIFhOAL4-HweZ3gA6DM2cvQGXYT84lzWXI-qTiwVimA/viewform';

  const wire = (id, url) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!url) { el.setAttribute('aria-disabled', 'true'); return; }
    el.href = url;
    el.removeAttribute('aria-disabled');
  };
  wire('raise', SUPPORT_FORM_URL);
  wire('raise-2', SUPPORT_FORM_URL);
  wire('raise-3', SUPPORT_FORM_URL);
  wire('raise-p', SUPPORT_FORM_URL);
  wire('feedback', FEEDBACK_FORM_URL);
  wire('feedback-p', FEEDBACK_FORM_URL);

  // ══════════════════════════════════════════════════════════════════════════════
  //  THE SIGNED-IN HALF
  // ══════════════════════════════════════════════════════════════════════════════
  // Everything above is the same for every visitor. Below, one customer's own tickets
  // are painted — and the two properties that keep that safe are worth stating before
  // the code, because both are easy to undo by accident.
  //
  // 1. THIS PAGE KEEPS ITS OWN STORAGE KEYS. Not `ipb_session` / `ipb_user`. A shared
  //    machine is the case that matters: a staff member signs in here, a customer signs
  //    in on the same browser, and a shared key would have the second inherit the first's
  //    session, or the first's list. The `ipbc_` prefix is the whole mechanism, and
  //    smoke-portal fails if this file ever names one of the app's own keys.
  //
  // 2. THE TICKET LIST IS NEVER READ FROM STORAGE. It is fetched on every load, and the
  //    only things this page stores are the session token and the account facts the header
  //    needs. What is stored on a device outlives the sign-out that was meant to remove it;
  //    a cached list of somebody's tickets sitting in a browser on a shared machine is
  //    exactly the leak the scope exists to prevent.
  const PORTAL = {
    // The same deployment the staff app talks to. Written here because this page loads no
    // shared script — the two form URLs above are duplicated for the same reason — and
    // smoke-portal pins this copy to the one in app.js, so a moved backend is a failing
    // test rather than a portal that signs nobody in.
    GAS_URL: 'https://script.google.com/macros/s/AKfycbzwiZyj_eO2P-5lddbUhs-ZJBSSwt6qLa8RKCOPkyysR4d35_ahtPXfijfyejQXatfT/exec',
    // The app's own keys are `ipb_session` and `ipb_user`. These are deliberately not them.
    SESSION_KEY: 'ipbc_session',
    USER_KEY:    'ipbc_user',
  };

  const REACH = 'Could not reach the service desk. Check your connection and try again.';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const msgOf = r => (r && r.message) ? r.message : 'Something went wrong. Please try again.';

  // ── The session, and only the session ────────────────────────────────────────
  function token() {
    try { return localStorage.getItem(PORTAL.SESSION_KEY) || ''; } catch (e) { return ''; }
  }
  function saveSession(t, me) {
    try {
      localStorage.setItem(PORTAL.SESSION_KEY, t);
      localStorage.setItem(PORTAL.USER_KEY, JSON.stringify(me || {}));
    } catch (e) { /* private mode — the session still works for this visit */ }
  }
  function forget() {
    try {
      localStorage.removeItem(PORTAL.SESSION_KEY);
      localStorage.removeItem(PORTAL.USER_KEY);
    } catch (e) { /* nothing to clear */ }
  }

  // ── Talking to the backend ───────────────────────────────────────────────────
  // Two thin wrappers, and no interceptor: this page has no other backend traffic, so the
  // token is attached in the two places that make a request rather than in a global patch
  // nobody can see. A reply that is not JSON — Apps Script's content hop occasionally
  // returns an HTML error page — fails the parse and is reported as unreachable, which is
  // what it is.
  function apiGet(action, params) {
    const q = new URLSearchParams(Object.assign({ action: action }, params || {}));
    if (token()) q.set('sessionToken', token());
    return fetch(PORTAL.GAS_URL + '?' + q.toString(), { cache: 'no-store' })
      .then(r => r.json())
      .catch(() => ({ status: 'error', message: REACH }));
  }
  function apiPost(action, fields) {
    const fd = new FormData();
    fd.append('action', action);
    Object.keys(fields || {}).forEach(k => fd.append(k, fields[k]));
    if (token()) fd.append('sessionToken', token());
    // NOT retried. Every POST from this page either spends a credential (a login or reset
    // code is burned by its first look) or revokes one — see the note on
    // CREDENTIAL_SPENDING_ACTIONS in app.js for the day a retry on one of these broke the
    // Google door. The app learned that lesson; this page starts with it.
    return fetch(PORTAL.GAS_URL, { method: 'POST', body: fd })
      .then(r => r.json())
      .catch(() => ({ status: 'error', message: REACH }));
  }
  const isUnauthorized = r => /^unauthorized/i.test(String((r && r.message) || ''));

  // What the sign-in audit line records. Same shape and the same coarse OS/browser split
  // as the app's deviceLabel(), with one addition: the words "customer portal", so the
  // desk reading the audit can tell a sign-in from this page apart from one in the staff
  // app without guessing. The portal sends NO version — that field records the APP BUILD a
  // device runs, and the backend keeps the last known value when it is absent. Inventing
  // one here would put a fiction in the admin's Versions list.
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
             : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'Mac'
             : /Linux/i.test(ua) ? 'Linux' : 'unknown OS';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera'
             : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
             : /Safari\//.test(ua) ? 'Safari' : 'unknown browser';
    return os + ' · ' + br + ' · customer portal';
  }

  // ── The ten stages, and the retired words for some of them ───────────────────
  // The app owns every ticket's stage. These ten are its vocabulary, and the fold below is
  // the same one app.js applies, kept here for the same reason it exists there: the store
  // still holds words the app has stopped using, and a customer must not be shown a stage
  // that the desk no longer has. A second copy is a risk, so it is a short list and
  // smoke-portal pins it to app.js's own table.
  const STATUS_LEGACY = {
    'hold':              'On Hold',
    'visual inspection': 'Inspection',
    'qc investigation':  'Investigation',
    'qc':                'Quality Test',
    'flight test':       'Quality Test',
    'pdi':               'PDI/Dispatch',
    'approval':          'PDI/Dispatch',
    'close':             'Delivered',
  };
  const stageLabel = s => {
    const v = String(s == null ? '' : s).trim();
    return STATUS_LEGACY[v.toLowerCase()] || v;
  };
  // Done, paused, or in hand — the only three things a customer needs from a badge.
  const stageClass = s => {
    const v = stageLabel(s);
    if (v === 'Delivered') return 'done';
    if (v === 'On Hold')   return 'hold';
    return '';
  };

  // ── The sheet's grid → the handful of columns this page shows ─────────────────
  // Deliberately NOT the app's fifty-column intake model. A customer needs their own words
  // and the state of the job; every column added here is a column that has to be argued for
  // again, and the app's own mapper is the one that model lives in.
  //
  // Needles are matched case-insensitively because the Form's question text is typed by
  // hand, and the header is whatever it currently says. The IR number and its shape rule are
  // the same as app.js's, so a row the desk typed that is not a ticket is skipped rather than
  // drawn as one.
  const IR_NUMBER_RE = /^IR\s*-?\s*\d+$/i;
  function colIndex(headers, needle) {
    const n = needle.toLowerCase();
    return headers.findIndex(h => String(h).toLowerCase().includes(n));
  }
  function rowsFromGrid(grid) {
    if (!grid || !grid.length) return [];
    const h = (grid[0] || []).map(x => String(x).trim());
    const i = n => colIndex(h, n);
    const cell = (row, idx) => (idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '');
    const c = {
      ir:    i('ir number'),
      date:  i('timestamp'),
      drone: i('drone serial no'),
      issue: i('what support'),
      desc:  i('please describe'),
      where: i('incident location and weather'),
      evN:   i('evidence: attach files'),
      evQ:   i('evidence: attach screenshot'),
    };
    const out = [];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const ir = cell(row, c.ir);
      if (!ir || !IR_NUMBER_RE.test(ir)) continue;
      out.push({
        ir: ir,
        // The same normalisation the backend's own irKey() uses to match a ticket to its
        // store row: the IR Number cell is free text, so "IR 107" and "IR107" are one
        // ticket and the store always spells it the second way.
        key: ir.toUpperCase().replace(/\s+/g, ''),
        date: cell(row, c.date),   drone: cell(row, c.drone),
        issue: cell(row, c.issue), desc: cell(row, c.desc),
        where: cell(row, c.where),
        evN: cell(row, c.evN),     evQ: cell(row, c.evQ),
      });
    }
    return out.reverse();   // latest first, the order the app's own list uses
  }

  const OVERVIEW_KEY = 'sec-a';      // the app's id for one ticket's Overview record
  const DESK_FIELDS = [
    { id: 'a_crmOwner',     label: 'Your point of contact' },
    { id: 'a_contactPhone', label: 'Phone we hold for you' },
    { id: 'a_siteLocation', label: 'Site location' },
  ];

  // ── State ────────────────────────────────────────────────────────────────────
  let ME = null;        // { email, customerOf, name } — from the backend, never from storage
  let TICKETS = [];     // this customer's rows, as the sheet displays them
  let STAGE = {};       // irNumber → { status, assignee, updatedAt } from the app's store
  let STAGE_OK = false; // false when that read failed — see paintList()

  // ── The portal (v110) ────────────────────────────────────────────────────────
  // ONE read answers the whole landing: the company's profile, the shared library
  // and the CR contact. `PORTAL_DATA` is null until that read succeeds, and when it
  // is null the Save button is DISABLED — a form built from a failed read would post
  // empty lists over a profile that is really there, and the customer would lose
  // their addresses by pressing Save on a blank page.
  let PORTAL_DATA = null;
  let PROFILE = { addresses: [], contacts: [], fleet: [] };
  const CR_FALLBACK_WA = '918655366232';   // the desk's public WhatsApp, already on this page

  // ── Boot ──────────────────────────────────────────────────────────────────────
  async function boot() {
    if (!token()) return;                 // signed out: nothing to paint, nothing to ask for

    const me = await apiGet('getMyCustomer');
    if (!me || me.status !== 'ok') {
      // An expired session is the one failure that must clear itself, or every later
      // request carries a dead token and the customer sees the same error forever.
      // Anything else is a real failure and is shown in words.
      if (isUnauthorized(me)) { forget(); setSignedOut(); return; }
      showSignin(msgOf(me));
      return;
    }
    if (!me.customerOf) { showStaff(me); return; }

    ME = me;
    setSignedIn(me);
    // The landing opens on their tickets, and the profile and the library are fetched
    // BESIDE that read rather than after it: two cold Apps Script executions in
    // parallel is one wait, two in sequence is two.
    await Promise.all([loadTickets(), loadPortal()]);
  }

  // ── The portal's one read ─────────────────────────────────────────────────────
  async function loadPortal() {
    const res = await apiGet('getCustomerPortal');
    if (!res || res.status !== 'ok') {
      if (isUnauthorized(res)) { forget(); setSignedOut(); return; }
      PORTAL_DATA = null;
      paintPortal();
      return;
    }
    PORTAL_DATA = res;
    PROFILE = res.profile || { addresses: [], contacts: [], fleet: [] };
    paintPortal();
  }

  // Everything the five tiles say, and the four panels they open. One function, called
  // on every load and after every save, so a number in a tile can never disagree with
  // the panel behind it.
  function paintPortal() {
    const profile = PORTAL_DATA && PORTAL_DATA.profile;
    const lib     = (PORTAL_DATA && PORTAL_DATA.library) || [];
    const cr      = (PORTAL_DATA && PORTAL_DATA.cr) || {};

    $('portal-title').textContent = ME && ME.customerOf ? ME.customerOf : 'Your space';
    $('portal-sub').textContent = ME
      ? 'Signed in as ' + ME.email + '. Everything below is your company\'s own record — nothing here is shared with another customer.'
      : '';

    $('tile-meta-history').textContent = TICKETS.length
      ? TICKETS.length + ' IR' + (TICKETS.length === 1 ? '' : 's') + ' on file' : '';
    $('tile-meta-library').textContent = lib.length
      ? lib.length + ' item' + (lib.length === 1 ? '' : 's') : '';
    $('tile-meta-report').textContent = 'Support form · feedback';
    $('tile-meta-details').textContent = profile
      ? (profile.addresses.length + profile.contacts.length + profile.fleet.length)
        + ' record' + ((profile.addresses.length + profile.contacts.length + profile.fleet.length) === 1 ? '' : 's')
      : '';
    $('tile-meta-contact').textContent = cr.name ? 'Your contact: ' + cr.name : 'Call · WhatsApp · website';

    renderLibrary();
    if (profile) { PROFILE = profile; renderDetails(); renderFleet(); }
    renderContact();
  }

  // ── Which tile is open ────────────────────────────────────────────────────────
  // There is no "closed" state: the landing always shows one panel, so the page never
  // sits under five tiles with nothing chosen. `openPanel` is the ONLY place that
  // decides visibility, so `#reports` cannot be shown by loadTickets() while another
  // panel is up.
  const PANEL_IDS = {
    report:  'panel-report',
    library: 'panel-library',
    history: 'reports',
    details: 'panel-details',
    contact: 'panel-contact'
  };
  function openPanel(name) {
    if (!PANEL_IDS[name]) name = 'history';
    Object.keys(PANEL_IDS).forEach(k => {
      const el = document.getElementById(PANEL_IDS[k]);
      if (el) el.hidden = (k !== name);
    });
    const tiles = document.querySelectorAll('#portal-tiles .tile');
    for (let i = 0; i < tiles.length; i++) {
      tiles[i].setAttribute('aria-pressed', tiles[i].dataset.panel === name ? 'true' : 'false');
    }
  }

  async function loadTickets() {
    openPanel('history');
    $('reports-list').hidden = false;
    $('report-one').hidden = true;
    $('reports-sub').textContent = 'Signed in as ' + ME.email + '.';

    const res = await apiGet('listIRs');
    if (!res || res.status !== 'ok') {
      if (isUnauthorized(res)) { forget(); setSignedOut(); return; }
      $('ticket-list').innerHTML = '<li><p class="error-box">' + esc(msgOf(res)) + '</p></li>';
      return;
    }
    TICKETS = rowsFromGrid(res.grid);

    // The stages come from the app's OWN store, not from the sheet's status column. That
    // column is the customer's own report of the state when they wrote it; the app has
    // owned every stage since v68, and one ticket nobody has allotted reads Open. This is
    // one read for the whole list, and the backend hands a customer only their own rows —
    // three fields each.
    const st = await apiGet('getPassbook', { irNumber: '__IRS__' });
    STAGE_OK = !!(st && st.status === 'ok' && st.sections);
    STAGE = (STAGE_OK && st.sections.__IRS__) ? st.sections.__IRS__ : {};

    paintList();
  }

  // '' is not a stage. A ticket the app holds no row for reads Open — that is the app's own
  // rule, derived rather than stored, and the portal shows the same word for the same state.
  const stageOf = key => {
    const row = STAGE[key];
    return (row && row.status) ? stageLabel(row.status) : 'Open';
  };
  const assigneeOf = key => {
    const row = STAGE[key];
    return (row && row.assignee) ? String(row.assignee) : '';
  };

  function paintList() {
    const list = $('ticket-list');
    const empty = $('reports-empty');
    list.innerHTML = '';
    $('empty-company').textContent = ME.customerOf;

    if (!TICKETS.length) { empty.hidden = false; return; }
    empty.hidden = true;

    // When that one store read failed, the LIST is still true — it is the customer's own
    // report, straight from the sheet — but the STAGES are unknown, and painting them all
    // as "Open" would be a confident lie about every ticket at once. So they are left off
    // and the fact is stated.
    const note = STAGE_OK ? null :
      'We could not read the current stage of your requests just now. What is below is the record of what you reported.';

    TICKETS.forEach(t => {
      const st = stageOf(t.key);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ticket';
      b.innerHTML =
        '<span class="ticket-top">' +
          '<span class="ticket-ir">' + esc(t.ir) + '</span>' +
          (STAGE_OK ? '<span class="pill ' + stageClass(st) + '">' + esc(st) + '</span>' : '') +
        '</span>' +
        '<span class="ticket-when">' + esc(t.date) + (t.drone ? ' · ' + esc(t.drone) : '') + '</span>' +
        (t.issue ? '<span class="ticket-issue">' + esc(t.issue) + '</span>' : '') +
        (t.desc  ? '<span class="ticket-desc">'  + esc(t.desc)  + '</span>' : '');
      b.addEventListener('click', () => openTicket(t));
      li.appendChild(b);
      list.appendChild(li);
    });

    if (note) list.insertAdjacentHTML('afterbegin', '<li><p class="error-box">' + esc(note) + '</p></li>');
  }

  // ══ THE FOUR PANELS ═══════════════════════════════════════════════════════════
  // ── The library ──────────────────────────────────────────────────────────────
  // Grouped by platform, because a pilot looking for the SIGMA100 checklist does not
  // want it in one alphabetical list with the battery logbook. `General` is where
  // anything filed without a SKU goes — never hidden, because that is where the desk's
  // first document will land.
  const libNorm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // The platforms in the order the owner named them. Anything the desk files under a
  // spelling this list does not carry still renders — it sorts after these, before the
  // General bucket. A SKU list that DROPS an unknown spelling would delete documents
  // from the page.
  const PORTAL_ORDER = ['SIGMA25G', 'SIGMA 25 PRO', 'SIGMA100'];
  const PORTAL_ORDER_N = PORTAL_ORDER.map(libNorm);
  const ytId = url => {
    const m = String(url || '').match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/);
    return m ? m[1] : '';
  };

  function renderLibrary() {
    const body  = $('lib-body');
    const items = (PORTAL_DATA && PORTAL_DATA.library) || [];
    $('lib-count').textContent = items.length
      ? items.length + ' item' + (items.length === 1 ? '' : 's') : '';

    if (!items.length) {
      body.innerHTML = '<p class="detail-empty">Nothing has been filed here yet. Manuals, ' +
        'checklists and training videos will appear here as the service desk adds them — ' +
        'if you need one today, ask the desk on WhatsApp and it will be sent to you.</p>';
      return;
    }

    const groups = {};
    items.forEach(it => {
      // TRAINING VIDEOS ARE ONE SHELF, NOT ONE PER AIRCRAFT. The owner, 2026-10-22:
      // "Training videos are going to be stored in a folder irrespective of SKUs."
      // A `sku` on a video entry is therefore ignored, never honoured — otherwise the
      // same flight video would appear once per model on the day it was filed twice,
      // which is the opposite of the single folder he described.
      const k = it.kind === 'video' ? 'Training videos' : (it.sku || 'General');
      (groups[k] = groups[k] || []).push(it);
    });
    const rank = k => {
      if (k === 'Training videos') return 1000;          // the one shelf after every aircraft
      const i = PORTAL_ORDER_N.indexOf(libNorm(k));
      return i >= 0 ? i : (libNorm(k) === 'GENERAL' ? 999 : 500);
    };
    const keys = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    body.innerHTML = keys.map(k => {
      const rows = groups[k];
      return '<div class="lib-group">' +
        '<h3>' + esc(k) + '<span class="lib-n">' + rows.length + '</span></h3>' +
        '<ul class="lib-list">' + rows.map(it => {
          const id = it.kind === 'video' ? ytId(it.url) : '';
          const host = (function () { try { return new URL(it.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
          return '<li><a class="lib-item' + (id ? ' video' : '') + '" href="' + esc(it.url) +
            '" target="_blank" rel="noopener noreferrer">' +
            (id ? '<img src="https://img.youtube.com/vi/' + esc(id) + '/hqdefault.jpg" alt="" loading="lazy">' : '') +
            '<b>' + esc(it.label) + '</b>' +
            '<span>' + (it.kind === 'video' ? 'Training video' : 'Document') + (host ? ' · ' + esc(host) : '') + '</span>' +
            '</a></li>';
        }).join('') + '</ul></div>';
    }).join('');
  }

  // ── Your details: addresses and contacts ─────────────────────────────────────
  // The rows are edited in place and posted as one list on Save. Nothing saves itself:
  // a half-typed address is worse than the old one, and an autosave on every keystroke
  // against a store that costs a third of a second per operation is a store that
  // flickers for every letter typed.
  const ADDR_KEYS = ['label', 'text'];
  const CONT_KEYS = ['name', 'role', 'phone', 'email'];
  const ADDR_PH   = ['Label — head office, warehouse…', 'Full address with PIN code'];
  const CONT_PH   = ['Name', 'Role — operations, pilot…', 'Phone', 'Email'];

  function detailRow(kind, keys, ph, row, i) {
    return '<div class="detail-row">' + keys.map((k, j) =>
      '<input type="text" data-k="' + k + '" value="' + esc(row[k] || '') +
      '" placeholder="' + esc(ph[j] || '') + '" aria-label="' + esc(ph[j] || k) +
      '" autocomplete="off">').join('') +
      '<button type="button" class="detail-del" data-del="' + kind + '" data-i="' + i +
      '" aria-label="Remove this row">Remove</button></div>';
  }

  function renderDetails() {
    const a = PROFILE.addresses || [];
    const c = PROFILE.contacts || [];
    $('addr-rows').innerHTML = a.map((r, i) => detailRow('addr', ADDR_KEYS, ADDR_PH, r, i)).join('');
    $('cont-rows').innerHTML = c.map((r, i) => detailRow('cont', CONT_KEYS, CONT_PH, r, i)).join('');
    $('addr-empty').hidden = a.length > 0;
    $('cont-empty').hidden = c.length > 0;

    // A failed read leaves the form EMPTY, so pressing Save would send two empty lists
    // and delete the profile. The button is the thing that has to know.
    const ok = !!(PORTAL_DATA && PORTAL_DATA.profile);
    $('profile-save').disabled = !ok;
    if (!ok) $('profile-msg').textContent = 'Your details could not be loaded, so saving is turned off — reload the page, and tell the desk if it keeps happening.';
  }

  // What is typed, not what was loaded. A row with every box blank is not sent: the
  // backend drops empty rows anyway, and sending them would be a request that says
  // "delete this" with nothing typed in its place.
  function collectRows(sel, keys) {
    const out = [];
    document.querySelectorAll(sel + ' .detail-row').forEach(row => {
      const one = {}, has = keys.some(k => {
        const el = row.querySelector('[data-k="' + k + '"]');
        one[k] = el ? el.value.trim() : '';
        return !!one[k];
      });
      if (has) out.push(one);
    });
    return out;
  }

  // ── Your aircraft, and the UIN certificate ───────────────────────────────────
  function renderFleet() {
    const list = $('fleet-list');
    const f    = PROFILE.fleet || [];
    const certified = ((PORTAL_DATA && PORTAL_DATA.certified) || []).map(libNorm);
    $('fleet-empty').hidden = f.length > 0;

    list.innerHTML = f.map(x => {
      const isCert = certified.indexOf(libNorm(x.model)) >= 0;
      return '<li>' +
        '<span class="sn">' + esc(x.sn || '—') + '</span>' +
        '<span class="uin">' + esc(x.model || '') + '</span>' +
        (x.uin
          ? '<span class="uin">UIN <b>' + esc(x.uin) + '</b></span>'
          : (isCert ? '<span class="uin">UIN not on file</span>' : '')) +
        (x.cert
          ? '<a class="cert" href="' + esc(x.cert) + '" target="_blank" rel="noopener noreferrer">Download UIN certificate &#8599;</a>'
          : (isCert ? '<span class="cert none">Certificate not on file</span>' : '')) +
        '</li>';
    }).join('');
  }

  // ── The CR contact ───────────────────────────────────────────────────────────
  // The person, from the store — never a name written into this page, because this
  // file is published. If nothing is configured yet the card is simply absent and the
  // desk's own buttons above it still work.
  function renderContact() {
    const cr   = (PORTAL_DATA && PORTAL_DATA.cr) || {};
    const card = $('cr-card');
    if (!cr.name && !cr.email && !cr.whatsapp) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML =
      '<span class="cr-role">Your Customer Relations contact</span>' +
      '<span class="cr-name">' + esc(cr.name || 'Customer Relations') + '</span>' +
      '<div class="cr-acts">' +
        (cr.whatsapp ? '<a class="btn" href="https://wa.me/' + esc(cr.whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
        (cr.email ? '<a class="btn" href="mailto:' + esc(cr.email) + '">Email</a>' : '') +
      '</div>' +
      '<p class="card-note">Reach them when a ticket is stuck or something needs a decision at our end. For a new requirement, the desk line above is the faster door.</p>';

    if (cr.whatsapp) {
      const wa = $('contact-wa');
      if (wa) wa.href = 'https://wa.me/' + cr.whatsapp;
    }
  }

  // ── The guide, under the report buttons ──────────────────────────────────────
  // A fixed tree with written answers. It cannot raise a request, cannot promise a
  // date, and every branch ends with a door that a person answers.
  const BOT = {
    start: {
      say: 'What can I help you with?',
      choices: [['Raise a request', 'raise'], ['Check one of my tickets', 'status'],
                ['Find a manual or checklist', 'manual'], ['Talk to a person', 'person']]
    },
    raise: {
      say: 'Use the Customer Support Form above — it is the same form every request comes through, so it gets an IR number the same working day. If you are reporting a fault, have the UAS serial number and, if you have one, the flight log to hand; both save a round trip.',
      choices: [['Open the support form', 'form'], ['Back', 'start']]
    },
    status: {
      say: 'Your ticket list is one panel down — every IR carries the stage it has reached, from Open through to Delivered. Open it and press a ticket to see what the desk has recorded.',
      choices: [['Open IR History', 'history'], ['Back', 'start']]
    },
    manual: {
      say: 'Manuals, checklists and training videos are in the Access Library, grouped by platform. If something you need is missing, the desk can send it to you directly.',
      choices: [['Open the Access Library', 'library'], ['Back', 'start']]
    },
    person: {
      say: 'For anything about a live ticket, your Customer Relations contact is in the Discuss Your Requirement tile — WhatsApp or email, and it reaches a person. For a new requirement, call the desk line.',
      choices: [['Open your contact', 'contact'], ['Back', 'start']]
    }
  };
  function botShow(key) {
    const step = BOT[key] || BOT.start;
    const log  = $('bot-log');
    const div  = document.createElement('p');
    div.className = 'bot-say';
    div.textContent = step.say;
    log.innerHTML = '';
    log.appendChild(div);
    const box = $('bot-choices');
    box.innerHTML = '';
    step.choices.forEach(([label, go]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.addEventListener('click', () => {
        if (go === 'form')  { window.open(SUPPORT_FORM_URL, '_blank', 'noopener'); return; }
        if (go === 'history') { openPanel('history'); $('reports').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (go === 'library') { openPanel('library'); $('panel-library').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (go === 'contact') { openPanel('contact'); $('panel-contact').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        botShow(go);
      });
      box.appendChild(b);
    });
  }

  // ── One ticket ────────────────────────────────────────────────────────────────
  async function openTicket(t) {
    $('reports-list').hidden = true;
    $('report-one').hidden = false;
    $('one-body').innerHTML = '<p class="sub">Loading ' + esc(t.ir) + '…</p>';

    const rec = await apiGet('getPassbook', { irNumber: t.ir });
    let desk = {};
    if (rec && rec.status === 'ok' && rec.sections && rec.sections[OVERVIEW_KEY]) {
      desk = rec.sections[OVERVIEW_KEY] || {};
    }
    // A ticket outside this account's company THROWS on the backend rather than answering
    // empty, so a refusal arrives as an error, and an unreachable store arrives as one too.
    // Either way it is shown in words — and the customer's OWN report, already fetched from
    // the sheet, still renders underneath it. This must never look like an empty ticket.
    const problem = (rec && rec.status !== 'ok') ? msgOf(rec) : '';

    const st = STAGE_OK ? stageOf(t.key) : '';
    const who = STAGE_OK ? assigneeOf(t.key) : '';

    const row = (k, v, long) => v
      ? '<div class="record-row"><span class="k">' + esc(k) + '</span>' +
        '<p class="v' + (long ? ' long' : '') + '">' + v + '</p></div>'
      : '';
    const txt = v => esc(v).replace(/\n/g, '<br>');

    // Evidence cells hold one or more uploaded file links, sometimes with stray text. Only
    // the customer's OWN uploads are here, and the app shows them the same way to the desk —
    // so they are links, with the one caveat that matters said out loud: Drive decides who
    // may open them, and this page cannot find out whether it did.
    const evidence = v => {
      const parts = String(v || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
      if (!parts.length) return '';
      return parts.map((p, i) => /^https?:\/\//i.test(p)
        ? '<a href="' + esc(p) + '" target="_blank" rel="noopener noreferrer" title="' + esc(p) + '">Evidence file ' + (i + 1) + ' ↗</a>'
        : txt(p)).join('<br>');
    };

    const deskRows = DESK_FIELDS.map(f => row(f.label, txt(desk[f.id] || ''))).join('');

    $('one-body').innerHTML =
      '<div class="record">' +

        (problem
          ? '<p class="error-box">' + esc(problem) + '</p>'
          : '') +

        '<div class="record-block">' +
          '<div class="record-head">' +
            '<span class="ticket-ir">' + esc(t.ir) + '</span>' +
            (st ? '<span class="pill ' + stageClass(st) + '">' + esc(st) + '</span>' : '') +
          '</div>' +
          row('Being worked on by', esc(who)) +
          row('Drone serial no.', esc(t.drone)) +
          row('Raised on', esc(t.date)) +
        '</div>' +

        '<div class="record-block">' +
          '<h3>What you reported</h3>' +
          row('Support required', esc(t.issue)) +
          row('Description', txt(t.desc), true) +
          row('Location and weather', txt(t.where), true) +
          row('Evidence — incident files', evidence(t.evN)) +
          row('Evidence — UAV forecast', evidence(t.evQ)) +
        '</div>' +

        (deskRows
          ? '<div class="record-block"><h3>Recorded by the service desk</h3>' + deskRows + '</div>'
          : '') +

        // ── The one-tap rating, ONLY on a closed ticket ─────────────────────────
        // A rating of work still in hand is an opinion about the delay, not about the
        // repair — so the stars exist only once the desk has marked it Delivered. The
        // stored answer is painted from `STAGE`, so a customer who reloads sees what
        // they said rather than being asked again.
        (st === 'Delivered'
          ? (function () {
              const rec = STAGE[t.key] || {};
              const had = Number(rec.rating || 0);
              return '<div class="rate" data-ir="' + esc(t.key) + '">' +
                '<p>' + (had ? 'You rated this ' + had + ' out of 5.' : 'How did we do on this one?') + '</p>' +
                '<div class="rate-row">' + [1, 2, 3, 4, 5].map(n =>
                  '<button type="button" class="rate-star" data-stars="' + n +
                  '" aria-pressed="' + (had >= n) + '" aria-label="' + n + ' out of 5">&#9733;</button>').join('') +
                '</div>' +
                '<p class="rate-msg" id="rate-msg"></p>' +
                '</div>';
            })()
          : '') +

        '<p class="card-note">Evidence files open in Google Drive, which decides for itself who ' +
        'may read them — if it asks you to sign in, that is Google asking and not Indrones. ' +
        'Anything else on your ticket is written by the desk, so if something looks wrong here, ' +
        'tell the service desk rather than assume it is lost.</p>' +
      '</div>';

    $('report-one').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Header state ──────────────────────────────────────────────────────────────
  // Three places on this page say who you are: the header, the hero's second button and
  // the aside in "How access works". They are swapped together, in one function each, so
  // a state can never be updated in two of them and forgotten in the third — the failure
  // that had a signed-in customer still being offered "Sign in to your reports".
  function setSignedOut() {
    ME = null; TICKETS = []; STAGE = {}; STAGE_OK = false;
    PORTAL_DATA = null;
    PROFILE = { addresses: [], contacts: [], fleet: [] };
    $('portal').hidden = true;
    $('reports').hidden = true;
    $('report-one').hidden = true;
    $('reports-list').hidden = false;
    $('ticket-list').innerHTML = '';
    $('header-signin').hidden = false;
    $('signout').hidden = true;
    $('header-who').hidden = true;
    $('header-who').textContent = '';
    $('hero-cta').textContent = 'Sign in to your reports';
    $('hero-cta').setAttribute('href', '#access');
    $('access-visitor').hidden = false;
    $('access-member').hidden = true;
    $('access-member-who').textContent = '';
    $('access').hidden = false;
  }
  function setSignedIn(me) {
    $('header-signin').hidden = true;
    $('signout').hidden = false;
    $('header-who').hidden = false;
    $('header-who').textContent = me.customerOf || me.email || '';
    // Signed in, the hero's second button stops being a way to sign in — there are already
    // reports a screen below, and a button offering to sign you in when you are is the one
    // thing on this page that contradicts itself.
    $('hero-cta').textContent = 'Your space';
    $('hero-cta').setAttribute('href', '#portal');
    $('access-visitor').hidden = true;
    $('access-member').hidden = false;
    $('access-member-who').textContent = me.customerOf || me.email || '';
    // The portal is the signed-in page. "How access works" is about getting one, so it
    // has no business under a customer who already has one.
    $('portal').hidden = false;
    $('access').hidden = true;
  }

  // A staff account that signs in here is not an error, it is a wrong door — and the useful
  // answer is the other door, not an empty list that looks like a bug.
  function showStaff(me) {
    setSignedIn(me);
    // A staff account has no company, so there is nothing to tile — the tiles are hidden
    // and the one panel that says where to go is shown in their place.
    $('portal-tiles').hidden = true;
    openPanel('history');
    $('reports-list').hidden = true;
    $('report-one').hidden = true;
    $('reports-sub').innerHTML = 'This is a service-desk account, so there are no customer ' +
      'reports to show here. <a href="./index.html">Open the service desk app &#8594;</a>';
  }

  // ── Sign out ──────────────────────────────────────────────────────────────────
  function signOut() {
    const t = token();
    forget();
    setSignedOut();
    // Revoke it on the server too, so the token is dead everywhere and not merely gone from
    // this browser. Fired and not awaited: the page is already signed out, and a failure here
    // must not keep somebody staring at a screen that has done what they asked.
    if (t) apiPost('logout', { sessionToken: t });
  }

  // ── The sign-in sheet ──────────────────────────────────────────────────────────
  // ONE door, two steps: an email address, then the code we mail to it. There is no
  // password door and no "first time here" here any more, by the owner's instruction of
  // 2026-10-22 — a customer has no password at all, so a set-password path was a second
  // way in that nobody needed and that told a first-time visitor to do something the
  // backend no longer expects.
  //
  // `resent` counts the times this screen has asked for the code again. Three asks,
  // then the person talks to Customer Relations. The backend holds the real cap; this
  // one exists so the LINK stops before a fourth press is spent on nothing.
  const RESEND_MAX    = 3;
  const RESEND_GAP_MS = 60 * 1000;      // the backend's own gap — never fire into it

  let flow = { step: 1, busy: false, resent: 0, resentAt: 0 };

  function showSignin(message) {
    flow = { step: 1, busy: false, resent: 0, resentAt: 0 };
    $('signin').hidden = false;
    $('signin-code').value = '';
    paintFlow();
    setMsg(message || '', 'err');
    setTimeout(() => { if (!$('signin-email').value) $('signin-email').focus(); }, 30);
  }
  function hideSignin() { $('signin').hidden = true; }

  function setMsg(text, kind) {
    const el = $('signin-msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  const goLabel = () => flow.step === 1 ? 'Continue' : 'Sign in';

  function paintFlow() {
    const second = flow.step === 2;

    $('signin-title').textContent = second ? 'Enter your code' : 'Log in to your I-PASSBOOK account';
    $('code-field').hidden = !second;
    $('signin-email').readOnly = second;
    $('signin-go').textContent = goLabel();
    $('signin-go').disabled = false;

    // The words are the app's own customer door, word for word — the two screens are
    // the same door reached from two places, and a person who sees both should not have
    // to wonder whether they are the same account.
    $('signin-note').textContent = second
      ? 'Enter the 6-digit code we emailed you. It stays valid for 8 hours, so one email a day is enough.'
      : 'Use your official email registered with us while onboarding as a customer. We email you a 6-digit code — there is no password to remember.';

    paintResend();
  }

  // ── "Send the code again" ─────────────────────────────────────────────────────
  // Shown only while a code is outstanding, because at step 1 the button in the middle
  // of the sheet already sends one.
  //
  // Three things can be true of the button, and each says so plainly:
  //   • it is waiting out the backend's 60-second gap, with the seconds counting down;
  //   • it is live;
  //   • it is gone, and the person now needs a human — with the address to write to
  //     filled in from the portal's own configuration, never typed into this file.
  function crLine() {
    const cr = (PORTAL_DATA && PORTAL_DATA.cr) || {};
    const bits = [];
    if (cr.email)    bits.push(cr.email);
    if (cr.whatsapp) bits.push('WhatsApp ' + cr.whatsapp);
    // NOBODY'S NAME. The owner on 2026-10-22: "do not mention CR name but just
    // Indrones Customer Relations and its email, whatsapp number." A named person
    // leaves when they leave, and the page would then point at someone who has gone.
    return 'This code has been sent three times. Write to Indrones Customer Relations' +
           (bits.length ? ' — ' + bits.join(' · ') : '') + ' and they will get you in.';
  }

  // The one address the page may print when someone needs a human. Read from the
  // portal configuration, never typed here: this repository is public.
  function crEmail() {
    const cr = (PORTAL_DATA && PORTAL_DATA.cr) || {};
    return cr.email || 'Indrones Customer Relations';
  }

  function paintResend() {
    // Step 1 sends from the main button, so the resend row has nothing to add there.
    const show = flow.step === 2;
    $('resend-line').hidden = !show;
    if (!show) return;

    const btn = $('signin-resend');
    const note = $('resend-note');

    if (flow.resent >= RESEND_MAX) {
      btn.hidden = true;
      note.textContent = crLine();
      note.className = 'resend-note resend-stop';
      return;
    }

    btn.hidden = false;
    note.className = 'resend-note';
    const waitMs = flow.resentAt ? (flow.resentAt + RESEND_GAP_MS) - Date.now() : 0;
    if (waitMs > 0) {
      btn.disabled = true;
      btn.textContent = 'Resend in ' + Math.ceil(waitMs / 1000) + 's';
      note.textContent = '';
    } else {
      btn.disabled = false;
      btn.textContent = 'Resend code';
      note.textContent = flow.resent ? 'Sent again · ' + flow.resent + ' of ' + RESEND_MAX : '';
    }
  }

  // A one-shot ticker, not an interval: it only has to wake the button up once, and an
  // interval left running behind a closed sheet is a timer nobody owns.
  function tickResend() {
    if (flow.step !== 2 || flow.resent >= RESEND_MAX) return;
    const waitMs = flow.resentAt ? (flow.resentAt + RESEND_GAP_MS) - Date.now() : 0;
    if (waitMs > 0) { paintResend(); setTimeout(tickResend, Math.min(waitMs + 50, 1000)); }
    else paintResend();
  }

  async function resendCode() {
    if (flow.busy || flow.step !== 2 || flow.resent >= RESEND_MAX) return;
    if ($('signin-resend').disabled) return;
    const email = $('signin-email').value.trim().toLowerCase();
    if (!email) { setMsg('Enter your email address first.', 'err'); return; }

    setBusy(true);
    try {
      // THE SAME CODE, MAILED AGAIN — which is what the owner asked for, 2026-10-22:
      // "When a code is sent and resend button is clicked, the same code is to be sent
      // again." So this call carries `resend`, and the backend re-mails the digits that
      // are already out instead of issuing a second code that would retire the first.
      const res = await apiPost('login', { email: email, device: deviceLabel(), resend: true });
      if (res && res.status === 'ok' && res.otpRequired) {
        if (res.codeSent === false) {
          // The server's 60-second gap is still running. Restart the visible countdown
          // rather than pretending a mail went out.
          flow.resentAt = Date.now();
          setMsg('That code went out a moment ago — give it a minute to arrive.', 'ok');
        } else {
          flow.resent = Math.min(RESEND_MAX, flow.resent + 1);
          flow.resentAt = Date.now();
          setMsg('We sent you the same code again. The earlier mail works too.', 'ok');
        }
      } else if (res && res.tooMany) {
        flow.resent = RESEND_MAX;
        setMsg(msgOf(res) || crLine(), 'err');
      } else {
        setMsg(msgOf(res) || 'Could not send just now — wait a minute and press it again.', 'err');
      }
    } catch (e) {
      setMsg('Could not reach us just now. Check your connection and try again.', 'err');
    } finally {
      setBusy(false);
      paintResend();
      if (flow.resent < RESEND_MAX) setTimeout(tickResend, 1000);
    }
  }

  function setBusy(on) {
    flow.busy = !!on;
    $('signin-go').disabled = !!on;
    $('signin-go').textContent = on ? 'Working…' : goLabel();
  }

  async function submitSignin() {
    if (flow.busy) return;

    const email = $('signin-email').value.trim().toLowerCase();
    const code  = $('signin-code').value.trim();

    if (!email) { setMsg('Enter your email address.', 'err'); return; }
    if (flow.step === 2 && !code) { setMsg('Enter the 6-digit code we emailed you.', 'err'); return; }

    setBusy(true);
    try {

      // ── The daily door ──
      // No `password` key at all: the backend reads that absence as the passwordless door.
      const fields = { email: email, device: deviceLabel() };
      if (code) fields.code = code;

      const res = await apiPost('login', fields);

      if (res && res.status === 'ok' && res.sessionToken) {
        saveSession(res.sessionToken, { email: email, customerOf: (res.access && res.access.customerOf) || '' });
        hideSignin();
        await boot();
        $('reports').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (res && res.status === 'ok' && res.otpRequired) {
        flow.step = 2;
        flow.resent = 0;
        // Every arrival at the code step starts the server's own 60-second gap. Even
        // when codeSent is false (a live code was reused), the resend must not fire
        // immediately into a throttle that would only answer "give it a minute".
        flow.resentAt = Date.now();
        paintFlow();
        setTimeout(tickResend, 1000);
        if (res.codeSent === false) {
          // TWO different situations answer with codeSent:false, and this screen cannot
          // tell them apart — so it names both rather than guessing. One: a code sent
          // earlier today is still live (it is reused, never reissued). Two: the address
          // has no usable account, which is also what an account still on its
          // first-time password looks like. The old wording assumed the second and sent
          // a person with a perfectly good code in their inbox off to reset a password
          // they did not need.
          setMsg('No new code was sent to ' + email + '. Either one from earlier today is ' +
                 'still valid — check your inbox and spam folder — or this address is not ' +
                 'registered with us. If you were never set up, write to ' + crEmail() + '.', 'err');
        } else {
          setMsg('We emailed a 6-digit code to ' + email + '.', 'ok');
        }
        $('signin-code').focus();
        return;
      }
      if (res && res.status === 'ok' && res.mustChangePassword) {
        setMsg('This account is not ready for code sign-in yet. Write to ' + crEmail() +
               ' and they will finish setting it up.', 'err');
        return;
      }
      setMsg(msgOf(res), 'err');
    } finally {
      setBusy(false);
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────
  // In ONE function, called from mount() and nowhere else.
  //
  // It used to run as this file was EVALUATED, which was invisible while the portal
  // owned the whole document — the markup had already been parsed by then. Mounted, the
  // document is empty at evaluation time, so the first `$('signin-close')` is null and
  // the throw takes `window.CustomerPortal` down with it: the portal then never appears
  // at all, and the only symptom is a blank page.
  function wirePortal() {
    document.querySelectorAll('.js-signin').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); showSignin(''); }));

    $('signin-close').addEventListener('click', hideSignin);
    $('signin').addEventListener('click', e => { if (e.target === $('signin')) hideSignin(); });
    $('signin-go').addEventListener('click', submitSignin);
    $('signin-resend').addEventListener('click', e => { e.preventDefault(); resendCode(); });
    document.querySelectorAll('.js-signout').forEach(el => el.addEventListener('click', signOut));
    $('back-to-list').addEventListener('click', () => {
      $('report-one').hidden = true;
      $('reports-list').hidden = false;
      $('reports').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });


    // Enter submits from anywhere in the card, which is how a form behaves — and this is a
    // card of one or two fields and a button, so a customer reaching for Enter is certain.
    $('signin').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submitSignin(); }
      if (e.key === 'Escape') hideSignin();
    });

    // ── The portal's own wiring ───────────────────────────────────────────────────
    document.querySelectorAll('#portal-tiles .tile').forEach(tile =>
      tile.addEventListener('click', () => openPanel(tile.dataset.panel)));

    // Add / remove a row. The index is position in the CURRENT lists, and renderDetails()
    // is what puts them back on screen — so an add or a remove is one re-render, and no
    // state exists anywhere else.
    function addRow(kind) {
      if (kind === 'addr') { PROFILE.addresses = (PROFILE.addresses || []).concat([{ label: '', text: '' }]); }
      else                 { PROFILE.contacts  = (PROFILE.contacts  || []).concat([{ name: '', role: '', phone: '', email: '' }]); }
      renderDetails();
    }
    $('addr-add').addEventListener('click', () => addRow('addr'));
    $('cont-add').addEventListener('click', () => addRow('cont'));

    $('panel-details').addEventListener('click', e => {
      const b = e.target.closest ? e.target.closest('.detail-del') : null;
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.del === 'addr') PROFILE.addresses.splice(i, 1);
      else                          PROFILE.contacts.splice(i, 1);
      renderDetails();
    });

    $('profile-save').addEventListener('click', async () => {
      const msg = $('profile-msg');
      const btn = $('profile-save');
      // The lists are read from the DOM, then BOTH are posted: the backend replaces the
      // pair together, so sending one and not the other would empty what was not sent.
      const addresses = collectRows('#addr-rows', ADDR_KEYS);
      const contacts  = collectRows('#cont-rows', CONT_KEYS);
      btn.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Saving…';
      const res = await apiPost('saveCustomerProfile', {
        addresses: JSON.stringify(addresses),
        contacts:  JSON.stringify(contacts)
      });
      btn.disabled = false;
      if (res && res.status === 'ok') {
        PROFILE = res.profile || PROFILE;
        paintPortal();
        $('profile-msg').className = 'msg ok';
        $('profile-msg').textContent = 'Saved. The desk sees this on your next ticket.';
      } else {
        msg.className = 'msg err';
        msg.textContent = msgOf(res);
      }
    });

    // A rating, once. The stars are painted from the stored value, so a reload shows the
    // answer the customer already gave instead of asking again.
    $('one-body').addEventListener('click', async e => {
      const b = e.target.closest ? e.target.closest('.rate-star') : null;
      if (!b) return;
      const box = b.closest('.rate');
      if (!box) return;
      const ir = box.dataset.ir;
      const stars = Number(b.dataset.stars);
      const out = $('rate-msg');
      if (out) { out.textContent = 'Saving…'; }
      const res = await apiPost('rateIR', { irNumber: ir, stars: String(stars) });
      if (res && res.status === 'ok') {
        if (STAGE[ir]) STAGE[ir].rating = stars;
        const all = box.querySelectorAll('.rate-star');
        for (let i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', Number(all[i].dataset.stars) <= stars ? 'true' : 'false');
        }
        if (out) out.textContent = 'Thank you — recorded.';
      } else if (out) {
        out.textContent = msgOf(res);
      }
    });

    botShow('start');

    // The footer's two links used to LEAVE — they were `customer.html#products` and
    // `customer.html#support`, addresses into this same page. They now open the panel
    // that answers them. Navigation away from the portal is the one thing a link in
    // its own footer must not do: the customer came here to stay.
    document.querySelectorAll('a[data-open-panel]').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        openPanel(a.getAttribute('data-open-panel'));
      });
    });

    // A link from the invitation email may carry them straight to the sheet.
    if (location.hash === '#signin' && !token()) showSignin('');
  }

  // The caller decides WHEN. Everything above is definitions; nothing touches the
  // document until mount() runs.
  window.CustomerPortal = {
    mount: function (root) {
      if (!root) return;
      root.innerHTML = PORTAL_HTML;
      wirePortal();   // now that the markup is really in the document
      boot();
    }
  };
})();
