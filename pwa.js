// I-PASSBOOK install prompt.
//
// Loaded by both index.html (the one app with the employee and customer doors) and
// customer.html (the standalone portal link every invitation already points at).
// It is deliberately dependency-free and self-contained: one small banner, no CSS
// file, so the two very different pages cannot drift on how "install" looks.
//
// What it does:
//   • captures Chrome/Edge/Samsung's `beforeinstallprompt` and offers Install;
//   • on iOS Safari, where that event does not exist, says Share → Add to Home Screen;
//   • never shows inside the installed app (standalone), and remembers a dismissal
//     for 30 days;
//   • stays out of automated browser tests (`navigator.webdriver`).
(function () {
  'use strict';

  var DISMISS_KEY = 'ipb_install_dismissed_until';
  var DISMISS_DAYS = 30;
  var BANNER_ID = 'ipb-install-banner';

  function standalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  // Chrome/Firefox/Edge on iOS are WebKit shells: Add to Home Screen there creates a
  // browser bookmark, not a standalone app. Safari is the only installer on iOS.
  function isIosNonSafari() {
    return isIos() && /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  }

  function isMobile() {
    try {
      return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        Math.min(window.screen.width, window.screen.height) <= 820;
    } catch (e) { return false; }
  }

  function dismissed() {
    try {
      var until = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return until > Date.now();
    } catch (e) { return false; }
  }

  function rememberDismissal() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000));
    } catch (e) { /* storage blocked: the banner simply comes back next visit */ }
  }

  function hide() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function button(label, style, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('style', style);
    b.addEventListener('click', onClick);
    return b;
  }

  function show(ios, installed) {
    if (!document.body || document.getElementById(BANNER_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = BANNER_ID;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', installed ? 'Open the installed app' : 'Install I-PASSBOOK');
    wrap.setAttribute('style', [
      'position:fixed',
      'left:50%',
      'transform:translateX(-50%)',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 86px)',
      'width:min(430px, calc(100vw - 24px))',
      'box-sizing:border-box',
      'z-index:50',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'padding:10px 12px',
      'border:1px solid rgba(255,255,255,.16)',
      'border-radius:14px',
      'background:#171717',
      'color:#f5f5f4',
      'font-family:inherit',
      'font-size:14px',
      'line-height:1.35',
      'box-shadow:0 12px 34px rgba(0,0,0,.28)'
    ].join(';'));

    var text = document.createElement('div');
    text.setAttribute('style', 'flex:1;min-width:0');
    var strong = document.createElement('b');
    strong.textContent = installed ? 'Open the installed app' : 'Install I-PASSBOOK';
    strong.setAttribute('style', 'display:block;font-size:14px');
    var note = document.createElement('span');
    note.setAttribute('style', 'display:block;color:#cfcfcb;font-size:12px;margin-top:2px');
    note.textContent = installed
      ? 'You are in the browser. Open I-PASSBOOK from your home screen for the app view.'
      : (ios
        ? (isIosNonSafari()
          ? 'Open this page in Safari, then Share → Add to Home Screen.'
          : 'On iPhone: tap Share, then Add to Home Screen.')
        : 'Opens from your home screen, like an app.');
    text.appendChild(strong);
    text.appendChild(note);

    var action = button(installed || ios ? 'Got it' : 'Install', [
      'border:0',
      'border-radius:10px',
      'padding:8px 14px',
      'background:#ffd54a',
      'color:#171717',
      'font-family:inherit',
      'font-size:13px',
      'font-weight:600',
      'cursor:pointer',
      'white-space:nowrap'
    ].join(';'), function () {
      if (ios || installed) {
        rememberDismissal();
        hide();
        return;
      }
      if (!window.__ipbInstallPrompt) return;
      var prompt = window.__ipbInstallPrompt;
      window.__ipbInstallPrompt = null;
      hide();
      try {
        prompt.prompt();
        if (prompt.userChoice && prompt.userChoice.then) {
          prompt.userChoice.then(function () { /* the OS keeps its own answer */ });
        }
      } catch (e) { /* prompt already used: nothing to do */ }
    });

    var close = button('×', [
      'border:0',
      'background:transparent',
      'color:#cfcfcb',
      'font-family:inherit',
      'font-size:20px',
      'line-height:1',
      'cursor:pointer',
      'padding:2px 4px'
    ].join(';'), function () {
      rememberDismissal();
      hide();
    });
    close.setAttribute('aria-label', 'Dismiss install prompt');

    wrap.appendChild(text);
    wrap.appendChild(action);
    wrap.appendChild(close);
    document.body.appendChild(wrap);
  }

  function eligible() {
    return !standalone() && !dismissed() && !navigator.webdriver &&
      !/HeadlessChrome/i.test(navigator.userAgent || '') && isMobile();
  }

  // Attached at evaluation, not at DOMContentLoaded: the event can fire early on a
  // fast connection, and a listener added after it has gone is a prompt nobody sees.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__ipbInstallPrompt = e;
    if (eligible()) show(false, false);
  });
  window.addEventListener('appinstalled', function () {
    rememberDismissal();
    hide();
  });

  function boot() {
    // Registration is idempotent; index.html already does it, customer.html may not.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration('./').then(function (reg) {
        if (!reg) return navigator.serviceWorker.register('./sw.js');
      }).catch(function () { /* install still works without an SW on http */ });
    }

    if (!eligible()) return;

    // Installed already, but this window is the browser. Say it once, because a
    // shortcut created by "Add to Home screen" can look exactly like this.
    if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps().then(function (apps) {
        if (apps && apps.length) show(false, true);
      }).catch(function () { /* unsupported or refused */ });
    }

    // iOS never fires the event above. Say it once, after the page has settled.
    if (isIos()) setTimeout(function () { show(true, false); }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
