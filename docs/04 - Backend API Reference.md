# 04 — Backend API Reference

The backend is a **Google Apps Script (GAS) web app** deployed from `backend.gs`.

**Base URL:** `https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec`

---

## GET Endpoints

### `listIRs`
Fetches all IR records from the Form Responses tab.

```
GET {BASE_URL}?action=listIRs
```

**Response:**
```json
{
  "status": "ok",
  "records": [
    {
      "irNumber": "IR409",
      "droneId": "S25P014",
      "dateRaised": "01-Oct-2025",
      "summaryLink": "https://...",
      "status": "In Production"
    }
  ]
}
```

- Reads from IR Repository sheet (`Form Responses` tab)
- Merges status from APP_DATA (sec-a → `a_overallStatus`)
- Returns latest-first order (reversed)

### `getPassbook`
Fetches all saved section data for a specific IR.

```
GET {BASE_URL}?action=getPassbook&irNumber=IR409
```

**Response:**
```json
{
  "status": "ok",
  "sections": {
    "sec-a": {
      "a_irNumber": "IR409",
      "a_droneId": "S25P014",
      "a_overallStatus": "In Production",
      ...
    },
    "sec-b": { ... }
  }
}
```

---

## POST Endpoint

### `saveSection`
Saves form data + uploaded files for one section of an IR.

```
POST {BASE_URL}
Content-Type: multipart/form-data
```

**Form Fields:**

| Param | Type | Description |
|---|---|---|
| `action` | string | `"saveSection"` |
| `irNumber` | string | e.g. `"IR409"` |
| `sectionId` | string | e.g. `"sec-a"` |
| `savedBy` | string | User email |
| `fields` | JSON string | Object of field key→value pairs |
| `files` | JSON string | Array of `{fieldId, name, mimeType, base64}` objects |

**File handling:**
1. Creates `IR###/Section X` folder structure in Google Drive
2. Decodes base64 → creates file in Drive
3. Sets file to anyone-with-link view access
4. Appends `_links` field with comma-separated Drive URLs

**Upsert logic:**
- If a row with matching `irNumber + sectionId` exists → updates it
- Otherwise → appends new row

**Response:**
```json
{ "status": "ok", "message": "Section sec-a saved for IR409" }
```

---

## CONFIG Object (backend.gs)

```javascript
var CONFIG = {
  IR_REPO_SHEET_ID: '1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4',
  IR_REPO_TAB: 'Form Responses',
  IR_REPO_IR_COL: 2,    // Column B
  IR_REPO_ID_COL: 11,   // Column K
  IR_REPO_SUMLINK: 1,   // Column A
  IR_REPO_DATE_COL: 3,  // Column C
  PASSBOOK_SHEET_ID: '14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s',
  DATA_TAB: 'APP_DATA',
  DRIVE_ROOT_FOLDER_ID: '1W41jpmnmIOmoG2XFfdlurkATvFSfxN9r',
  ALLOWED_DOMAIN: 'indrones.com',
};
```

---

## Legacy Importer

`importLegacyData()` — utility function to crawl old per-IR tabs (e.g., `IR409` tab) and migrate them into the unified `APP_DATA` format. Cell mappings are hardcoded and need manual adjustment per legacy sheet format.