# I-PASSBOOK Project Milestone Log
*Last Updated: 2026-09-30*

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

## 4. Future Roadmap (Planned)

### Log Analysis Visualization
- **3D Flight Simulation**: Integration of `Three.js` to visualize the flight path during identified "Alert" periods.
- **Intelligence Loop**: Building a database of known failure patterns to move from "Manual Alerting" to "AI-Driven Diagnostics."

---
*End of Log*
