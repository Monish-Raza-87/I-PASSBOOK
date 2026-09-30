# I-PASSBOOK Project Milestone Log
*Last Updated: 2026-10-01*

This document serves as the authoritative record of architectural changes, bug fixes, and feature blueprints implemented during the recent development cycle.

## 1. Authentication & Access Control (Completed)

### Google SSO Stability (Mobile)
- **Problem**: Mobile browsers were stripping the `#sso=` fragment or delaying the redirect, causing sign-in failures and a redundant 9-second intro video.
- **Solution**: 
    - Moved handoff detection from parse-time to the active boot sequence.
    - Implemented `sessionStorage` recovery to survive accidental page reloads.
    - Forced the splash screen to hide immediately upon handoff detection, bypassing the intro video.
- **Outcome**: Seamless, instant transition from Google Account Picker to the app.

### Passwordless Transition (Phase 1)
- **Goal**: Eliminate "login friction" for daily users.
- **Implementation**: 
    - Removed the password field from the primary sign-in flow.
    - Implemented **OTP-First Login**: Users now enter their email $\rightarrow$ receive 6-digit code $\rightarrow$ enter app.
    - **Persistent Identity**: Added logic to pre-fill the email address from `localStorage`, transforming daily login into a "Verify and Enter" experience.
- **Status**: Pushed to `category-insights` branch.

---

## 2. Drone Log Analysis Hub (Blueprint & Research)

### The "Indrones Gold Standard" Diagnostic Engine
A specialized forensic tool for ArduPilot `.bin` files, integrated as a Global Hub in the Service Desk.

#### Analysis Criteria (The Rules):
- **Vibrations**: Flag any axis ($X, Y, Z$) exceeding **30**.
- **PWM Saturation**: Detect when motor outputs (`RCOUT`) hit physical limits for $\geq 500\text{ms}$.
- **Telemetry Anomalies**: Identify sudden, non-physical jumps or dips in altitude and attitude.
- **Power Rail**: Monitor for voltage brown-outs and current spikes.

#### Technical Architecture:
- **Local Parsing**: Uses a JavaScript-based binary parser (inspired by `ardulog` and `jsdataflashparser`) to process files entirely in the browser for privacy and speed.
- **IR Bridge**: Analysis results are not just viewed; they can be "Pushed" to a specific IR number via a dropdown, automatically appending the diagnostic summary to the ticket.
- **Service Desk Integration**: Moved from individual IRs to a centralized Hub to optimize performance.

## 3. Auth Shipped 2026-09-30 (Passwordless + Quick Unlock)

### The Passwordless Daily Door (now with a working backend)
- **The 2026-09-27 passwordless commits were frontend-only**: the backend still demanded a password on both steps, the code step could never submit, and first-login temp-password accounts had lost their only door. Sign-in was broken as deployed; this cycle rebuilt both ends.
- **Stage 1**: email only → the reusable 8h30m emailed code (issued or reused, uniform response that is no account-existence oracle).
- **Stage 2**: email + 6-digit code → the same gates → the same audit line → the session. No password anywhere.
- The password door survives as an opt-in mode ("Use password instead") for legacy shells and the temp-password first login.

### Quick unlock (fingerprint + pattern)
- Per-device token in `devices.json`; fingerprint via WebAuthn platform authenticator (`userVerification: required`) as the LOCAL gesture; 3×3 pattern fallback hashed client-side (SHA-256, two-draw setup).
- Unlock verifies the token pre-auth with uniform refusals + the login limiter; account gates then run; audits the method, not a code age.
- Every password path (change, reset, revoke-all) revokes the devices too.

### One active session per account ("option A")
- Chosen 2026-09-21, now implemented: `mintSession` retires every other live token of the account inside its lock. Accepted cost: signing in on the phone signs the desktop out.

### Google door on the phone (PWA)
- The account picker now opens in a NEW browser tab (`window.open`), not a top-level navigation from the standalone window — the old navigation reached Google with no usable cookie context and showed Google's own "unable to open the file at present" error.
- Diagnostic, if it still fails: try Google sign-in on the laptop. If the laptop fails too, re-publish the door deployment (New version, keep the URL ending `7uKj`).

---

## 4. In-App Update Notice + Version Reporting (2026-10-01)

### The problem the owner actually reported
He refreshed the app on his phone and it stayed on the old build. gh-pages was serving
that build the whole time — the deploy was fine, the **update mechanism** was not.
Five separate causes, all real, and the fifth is the one that would have shipped a
feature that lies:

1. Navigations went **through** GitHub Pages' ~10-minute HTTP cache.
2. A brand new `CACHE_NAME` was filled by `cache.addAll(SHELL)` — bare fetches, so
   the HTTP cache could put the *previous* build's bodies inside the new cache.
3. `skipWaiting()` + `clients.claim()` hand over to a new worker, but **nothing
   reloads the open page**, so it kept running the old `app.js`.
4. Registration was bare and nothing ever called `reg.update()`.
5. **A version probe poisons itself.** A same-origin `fetch('./sw.js')` is
   intercepted by the worker's own stale-while-revalidate branch, and the Cache API
   ignores a request's `cache:` mode — so the probe is correct exactly once, and then
   answered from a cache the worker just wrote. Fixing the *check* required excluding
   the worker's own URL.

### What shipped
- **`sw.js`**: the self-script exclusion (3a); new caches filled via
  `new Request(u, { cache: 'reload' })`; navigations revalidated with `'no-cache'`
  so the offline fallback still has an HTTP entry to fall back on. `skipWaiting` and
  `claim` are kept deliberately — a plain refresh is the habit that must keep working.
- **The banner**: an amber, in-flow notice on **both** the sign-in card and the app
  shell (a device parked at sign-in is the one that most needs telling). The probe
  reads `CACHE_NAME` out of the served `sw.js`, compares it **strictly newer** against
  `APP_VERSION`, and is throttled to one per 5 minutes with every failure silent.
- **The tap is the only thing that reloads.** It settles a pending install first
  (a reload during install would be served by the worker being replaced and land back
  on the old build), then `reg.update()`, then reload. It refuses outright while a
  save is in flight, and prompts when the User Access modal or a draft is open. A
  `controllerchange` listener is kept only as a belt — with `skipWaiting()` it fires
  at *install* time, so it could never be the trigger.
- **👥 User Access → Versions**: who is on which build, grouped off the roster the
  modal already loads. The owner asked for no broadcast and no chasing — the banner
  is the announcement, and this tab is how he checks without asking anyone.
- **`backend.gs`**: `stampSignin()` writes `appVersion` inside the `lastLoginAt` write
  that was already happening — **zero extra Drive operations**. Validated on write
  (it is stored-XSS surface: it arrives in a body and is rendered as HTML), and never
  blanked by a sign-in that cannot report one.

### Honest limits
- The fix **cannot bootstrap itself**: a device on the previous build gets to the new
  one through the *old* machinery, so that first hop per device may need a manual
  refresh. Everything after it is automatic.
- On an **installed iOS home-screen app** the tap may not take until the app is fully
  closed and reopened. If the version does not move, the banner correctly reappears.

---

## 5. Future Roadmap (Planned)

### Log Analysis Visualization
- **3D Flight Simulation**: Integration of `Three.js` to visualize the flight path during identified "Alert" periods.
- **Intelligence Loop**: Building a database of known failure patterns to move from "Manual Alerting" to "AI-Driven Diagnostics."

---
*End of Log*
