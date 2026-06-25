# 02 — Architecture & Data Flow

## High-Level Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Google Apps      │────▶│  Google Sheets   │
│  (PWA SPA)   │◀────│  Script Backend   │◀────│  + Google Drive  │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │
      │ Auth via
      ▼
┌─────────────┐
│ Google       │
│ Identity     │  (GIS — @indrones.com only)
│ Services     │
└─────────────┘
```

## App Screens

### 1. Splash Screen
- Plays `assets/Indrones Intro v2.mp4` for ~2 seconds
- Blue gradient overlay with "I-PASSBOOK" branding
- Fades out, then checks auth state

### 2. Auth Screen
- Google Sign-In button (GIS One Tap)
- Domain restriction: only `@indrones.com` emails
- Dev bypass: `localhost` + `?dev=1` → auto-creates "Dev Tester" user
- Stores user in `sessionStorage` as `ipb_user`

### 3. Main App — Two Views
- **Master Index** (default) — lists all IRs, search by IR# or drone ID
- **Passbook Detail** — opens when an IR card is tapped, shows 9 tabbed sections

## Data Flow

### Fetching IR List (`listIRs`)
```
Browser → GET GAS_URL?action=listIRs
       → GAS reads IR Repository Sheet ("Form Responses" tab)
       → GAS also reads APP_DATA for status (sec-a → a_overallStatus)
       → Returns { status: "ok", records: [...] }
```

### Fetching Passbook Data (`getPassbook`)
```
Browser → GET GAS_URL?action=getPassbook&irNumber=IR409
       → GAS reads APP_DATA tab for all rows matching IR409
       → Returns { status: "ok", sections: { "sec-a": {...}, ... } }
```

### Saving a Section (`saveSection`)
```
Browser → POST GAS_URL with FormData:
           action=saveSection, irNumber, sectionId, savedBy, fields (JSON), files (JSON)
       → If files: uploads to Google Drive → IR###/Section X folder
       → Upserts row in APP_DATA tab
       → Returns { status: "ok", message: "..." }
```

## APP_DATA Sheet Structure

| Column | Content |
|---|---|
| A | IR Number (e.g., "IR409") |
| B | Section ID (e.g., "sec-a") |
| C | Saved By (email) |
| D | Fields (JSON object) |
| E | Last Updated (timestamp) |

Each section save = one row. Upsert by matching IR Number + Section ID.

## Demo Mode

When GAS is unreachable (CORS error, network failure), the app falls back to `getDemoIRs()` which returns 5 hardcoded sample records (IR405–IR409). This keeps the UI visible for development/review.