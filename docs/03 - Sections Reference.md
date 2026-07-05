# 03 — Sections Reference

All 9 passbook sections defined in `SECTIONS` object in `app.js` (line 291–436).

---

## Section A — Preliminary Details & Activity Log
**ID:** `sec-a`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `a_irNumber` | IR Number | text | **Readonly** — auto-filled from IR data |
| `a_droneId` | Drone Serial No. | text | **Readonly** — auto-filled from IR data |
| `a_dateRaised` | Date of Incident | date | 🔒 **CR-only** · Auto-filled from Form Responses "Date of Incident" (Col I) |
| `a_crmOwner` | Customer Relations Manager | text | 🔒 **CR-only** · Auto-filled from Form Responses SPOC (Col F) |
| `a_customerName` | Customer / Client Name | text | 🔒 **CR-only** · Auto-filled from Form Responses "Who's Reporting?" (Col L) |
| `a_contactEmail` | Customer Email | email | 🔒 **CR-only** · Auto-filled from Form Responses email (Col P) |
| `a_contactPhone` | Customer Phone | tel | 🔒 **CR-only** · Auto-filled from the phone portion of "Who's Reporting?" (Col L) |
| `a_issueType` | What Support Is Required? | text | 🔒 **CR-only** · Auto-filled from Form Responses "What Support Is Required?" (Col G) |
| `a_issueDesc` | Issue Description | textarea | 🔒 **CR-only** · Auto-filled from Form Responses "Please Describe Your Problem..." (Col H) |
| `a_activityLog` | Activity Log (Timeline) | activityTable | 🔒 **CR-only** · Dynamic table: Day #, Date, Activity, Remark |
| `a_overallStatus` | IR Status | select | 🔒 **CR-only** · Auto-filled from Form Responses "Issue Status" (Col D). Options: Open, Hold, Close, Inward, Visual Inspection, QC Investigation, Production, QC, Flight Test, PDI, Approval, Delivered, Remote Support, Other |

### Authorization — Section A (ALL fields restricted to CR team)
**Entire Section A** is editable only by authorized Customer Relations personnel:
- `monish.raza@indrones.com`
- `ravi@indrones.com`
- `adhik.nair@indrones.com`

All other users see every Section A field as **disabled** with a 🔒 icon. This is enforced both:
- **Frontend**: fields rendered with `disabled` attribute, "Add Row" button disabled
- **Backend** (`backend.gs`): `saveSection()` preserves existing values for all `sec-a` field IDs when `savedBy` is not in `AUTHORIZED_CR_EMAILS`

### Auto-Population from the IR Repository
Fields are pre-filled from the IDS/CR/007 sheet's **"Form Responses"** tab when an IR is opened:

| Section A Field | Form Responses Column | Config Key |
|---|---|---|
| `a_irNumber` | Col B — IR Number | `IR_REPO_IR_COL` |
| `a_droneId` | Col K — Mention the Drone Serial No (S250XX) | `IR_REPO_ID_COL` |
| `a_dateRaised` | Col I — Date of Incident | `IR_REPO_INCIDENT_COL` |
| `a_crmOwner` | Col F — SPOC | `IR_REPO_SPOC_COL` |
| `a_customerName` | Col L — Who's Reporting? | `IR_REPO_REPORTER_COL` |
| `a_contactEmail` | Col P — Email Address | `IR_REPO_EMAIL_COL` |
| `a_issueType` | Col G — What Support Is Required? | `IR_REPO_SUPPORT_COL` |
| `a_issueDesc` | Col H — Please Describe Your Problem... | `IR_REPO_DESC_COL` |
| `a_overallStatus` | Col D — Issue Status | `IR_REPO_STATUS_COL` |

### Activity Log Table Format
| Column | Field Class | Content |
|---|---|---|
| Day # | `.act-day` | Auto-incrementing number, readonly |
| Date | `.act-date` | Date picker, first row defaults to IR filing date |
| Activity Description | `.act-activity` | Free text |
| Remark | `.act-remark` | Free text |

- Starts with 5 empty rows
- "Add Row" button appends new row with next day number
- Data saved as JSON array: `[{dayCount, date, activity, remark}, ...]`
- Backward compatible: old textarea string data loads into first row's activity field

> **`a_overallStatus`** is the field read by `getAllIRStatuses()` in the backend to populate the status badge on the Master Index cards.

---

## Section B — Inward Checklist (Inventory)
**ID:** `sec-b`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `b_inwardDate` | Inward Date | date | |
| `b_inwardBy` | Inward By (Name) | text | Person who performed the inward |
| `b_stNo` | Stock Transfer (ST) No. | text | Assigned by Inventory |
| `b_inwardTable` | Particulars Received | inwardTable | 11-row table: Particular, Model/Value (dropdown or free text), Qty |
| `b_remarks` | Remarks | textarea | |
| `b_signInward` | Digital Signature — Inward Performed By | esignature | Email + timestamp; locked after signing |
| `b_signInventory` | Digital Signature — Inventory (ST No. Assigner) | esignature | Email + timestamp; locked after signing |

### Particulars table (`b_inwardTable`)
Saved as an object keyed by particular name: `{ "Air Vehicle": { model, qty }, ... }`.
11 particulars from the IDS master Inward Checklist:

| # | Particular | Input | Option group |
|---|---|---|---|
| 1 | Air Vehicle | dropdown | `airframe` |
| 2 | Battery | dropdown | `battery` |
| 3 | Charger | dropdown | `charger` |
| 4 | Radio Controller | dropdown | `rc` |
| 5 | Payload | dropdown | `payload` |
| 6 | Propeller | dropdown | `airframe` |
| 7 | Base | dropdown | `base` |
| 8 | Bag With Foam | dropdown | `airframe` |
| 9 | Tripod/Bipod | free text | — |
| 10 | Center Pole | free text | — |
| 11 | Toolkit-Box And Accessories | free text | — |

### Dropdown option groups (admin-customizable)
Defaults defined in `INWARD_OPTIONS_DEFAULTS` (`app.js`); admins
(`monish.raza@indrones.com`, `customer.relations@indrones.com`) edit them via the
**⚙ Manage Dropdown Options** button shown on the inward table. Overrides persist
to GAS under irNumber `__CONFIG__` / sectionId `inward-options` (shared) and to
`localStorage` (per-device fallback). `loadInwardOptions()` runs at app start.

| Group | Used by | Default options |
|---|---|---|
| `airframe` | Air Vehicle, Propeller, Bag With Foam | Sigma 25 Geo (S25G), Sigma 25 Pro (S25P), Sigma 75 (S75), Sigma 100 (S100), Fujin, Fighter, Talon, Striver, DID NOT COME |
| `battery` | Battery | 4S3P, 6S3P, 6S2P, 4S4P, LiPo 22000 mAh, LiPo 16000 mAh, 6S4P, DID NOT COME |
| `charger` | Charger | D2, Ultra Power, Hota, Sky RC, ISDT K2, DID NOT COME |
| `rc` | Radio Controller | Skydroid T12, Siyi MK15, Siyi MK32, DID NOT COME |
| `payload` | Payload | ADTI 24 mp, View Pro A609, Siyi A8 Mini, Share 5 Angle, Sony A6000, DID NOT COME |
| `base` | Base | Emlid RS2, Spectra SP85, Spectra SP60, DID NOT COME |

### E-signatures (`esignature` type)
Saved as `{ signedBy, signedAt, history: [{ signedBy, signedAt }, ...] }`.
- Signing captures the signed-in user's **email + full ISO timestamp** (displayed as `DD Month YYYY, HH:MM:SS`).
- Once signed, the field is **locked** — not editable, not deletable.
- An authorized user (inward admin / CR / the original signer) may **Override & Re-sign**; the previous value is pushed into `history`, which is shown on the block (and as a hover tooltip on the signed cell).
- `esignatureState` is reset each time a passbook is opened (`openPassbook`) and populated from saved data by `populateFieldValue`.

---

## Section C — IQC Inspection
**ID:** `sec-c`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `c_iqcDate` | Inspection Date | date | |
| `c_iqcBy` | IQC Inspector | text | |
| `c_externalDmg` | External Damage Observed | textarea | |
| `c_electricalDmg` | Electrical / PCB Damage | textarea | |
| `c_iqcPhotos` | IQC Inspection Photos | file | Multiple |
| `c_iqcObservation` | Overall IQC Observation | textarea | |
| `c_iqcResult` | IQC Result | select | Pass – Proceed to Tech Analysis / Fail – Return to Customer / Partial – Proceed with caution |

---

## Section D — Technical Support Analysis
**ID:** `sec-d`

| Field ID | Label | Type |
|---|---|---|
| `d_techDate` | Analysis Date | date |
| `d_techBy` | Tech Support Engineer | text |
| `d_rootCause` | Root Cause | textarea |
| `d_repairScope` | Recommended Repair Scope | textarea |
| `d_matCostEstimate` | Material Cost Estimate (₹) | number |
| `d_labourCost` | Labour Cost Estimate (₹) | number |
| `d_totalEstimate` | Total Estimate (₹) | number |
| `d_crStatus` | Cost Report (CR) Status | select: Not Sent / Sent – Awaiting Approval / Approved by Customer / Rejected by Customer |
| `d_crDate` | CR Sent / Approval Date | date |
| `d_techPhotos` | Analysis Photos / Reports | file |
| `d_notes` | Additional Notes | textarea |

---

## Section E — Production (Rework)
**ID:** `sec-e`

| Field ID | Label | Type |
|---|---|---|
| `e_prodStart` | Production Start Date | date |
| `e_prodEnd` | Production End Date | date |
| `e_prodBy` | Production Technician | text |
| `e_reworkItems` | Rework / Replacement Items | textarea |
| `e_partNos` | Part Numbers Used | textarea |
| `e_prodPhotos` | Rework Photos | file |
| `e_prodRemarks` | Production Remarks | textarea |

---

## Section F — Quality Control (QC)
**ID:** `sec-f`

| Field ID | Label | Type |
|---|---|---|
| `f_qcDate` | QC Date | date |
| `f_qcBy` | QC Inspector | text |
| `f_qcChecklist` | QC Checklist / Test Results | textarea |
| `f_qcResult` | QC Result | select: Pass / Fail / Conditional Pass |
| `f_qcPhotos` | QC Test Evidence | file |
| `f_qcRemarks` | QC Remarks | textarea |

---

## Section G — Flight Test
**ID:** `sec-g`

| Field ID | Label | Type |
|---|---|---|
| `g_ftDate` | Flight Test Date | date |
| `g_ftPilot` | Test Pilot | text |
| `g_ftDuration` | Test Duration (mins) | number |
| `g_ftConditions` | Test Conditions | textarea |
| `g_ftObservation` | Flight Test Observations | textarea |
| `g_ftResult` | Flight Test Result | select: Pass / Fail / Conditional Pass |
| `g_actualMatCost` | Actual Material Cost (₹) | number |
| `g_actualLabour` | Actual Labour Cost (₹) | number |
| `g_actualTotal` | Actual Total Cost (₹) | number |
| `g_ftPhotos` | Flight Test Photos / Video | file |

---

## Section H — Pre-Delivery Inspection (PDI)
**ID:** `sec-h`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `h_pdiDate` | PDI Date | date | |
| `h_pdiBy` | PDI Inspector | text | |
| `h_pdiChecklist` | PDI Checklist | checklist | 8 items (see below) |
| `h_pdiResult` | PDI Result | select | Pass – Ready to Dispatch / Fail – Return to QC |
| `h_pdiPhotos` | PDI Photos | file | |
| `h_pdiRemarks` | PDI Remarks | textarea | |

**Checklist items** (each has ✔ Received / ✘ Missing / ⚠ Damaged / N/A):
1. Physical Condition – OK
2. All Parts Present
3. Battery Fully Charged
4. Firmware Updated
5. Calibration Done
6. Accessories Packed
7. Documentation Included
8. Branding / Labels Intact

---

## Section I — Logistics & Dispatch
**ID:** `sec-i`

| Field ID | Label | Type |
|---|---|---|
| `i_dispatchDate` | Dispatch Date | date |
| `i_dispatchBy` | Dispatched By | text |
| `i_courier` | Courier / Transporter | text |
| `i_awbNo` | AWB / Docket No. | text |
| `i_stNo` | Stock Transfer (ST) No. | text |
| `i_deliveryAddr` | Delivery Address | textarea |
| `i_estDelivery` | Expected Delivery Date | date |
| `i_dispatchPhotos` | Dispatch / Packing Photos | file |
| `i_remarks` | Logistics Remarks | textarea |