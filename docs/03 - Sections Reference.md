# 03 — Sections Reference

All 9 passbook sections defined in `SECTIONS` object in `app.js` (line 291–436).

---

## Section A — Preliminary Details & Activity Log
**ID:** `sec-a`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `a_irNumber` | IR Number | text | **Readonly** — auto-filled from IR data |
| `a_droneId` | Drone Serial No. | text | **Readonly** — auto-filled from IR data |
| `a_dateRaised` | Date Issue Raised | date | |
| `a_crmOwner` | CRM Owner | text | |
| `a_customerName` | Customer / Client Name | text | |
| `a_contactEmail` | Customer Email | email | |
| `a_contactPhone` | Customer Phone | tel | |
| `a_issueType` | Issue Type | select | Options: Hardware Damage, Software Issue, Firmware Issue, Battery Issue, Operational Query, RMA / Return, Other |
| `a_issueDesc` | Issue Description | textarea | |
| `a_activityLog` | Activity Log (Timeline) | textarea | |
| `a_overallStatus` | Overall IR Status | select | Options: Open, Pending Customer Approval, In Production, In QC, Dispatched, Closed |

> **`a_overallStatus`** is the field read by `getAllIRStatuses()` in the backend to populate the status badge on the Master Index cards.

---

## Section B — Inward Checklist (Inventory)
**ID:** `sec-b`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `b_receivedDate` | Date of Inward | date | |
| `b_receivedBy` | Received By | text | |
| `b_trackingNo` | Inward Tracking No. | text | |
| `b_checklist` | Items Received | checklist | 10 items (see below) |
| `b_inwardPhotos` | Inward Photos | file | Multiple, images/PDF |
| `b_remarks` | Inventory Remarks | textarea | |

**Checklist items** (each has Received/Missing/Damaged/N/A dropdown):
1. Air Vehicle (Drone Frame)
2. Flight Controller
3. Battery Pack (1)
4. Battery Pack (2)
5. Battery Pack (3)
6. Battery Charger
7. Remote Controller
8. Propellers Set
9. Case / Carry Bag
10. Accessories / Others

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