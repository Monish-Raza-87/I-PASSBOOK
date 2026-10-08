# 11 — LetsTranzact Integration (Inward & Dispatch)

The owner raised this on 2026-10-08 as one line in a longer queue —
**"LetsTranzact ERP compatibility for inward/dispatch."** This file is the scope
for it.

> **⚠ STATE 2026-10-08 — SCOPED, NOT BUILT.** Nothing here is implemented. The
> first step is not code and it is not mine: it is one export template out of
> LetsTranzact (see **What we need from the desk**, below). Until that exists,
> every mapping in this file is a guess about a system none of us has seen, and it
> is written down as a guess rather than as a design.

---

## What "compatible" can mean, and which meaning is worth having

There are three different things this phrase could be asking for, and they cost
very different amounts.

| # | Reading | What it would mean | Cost |
|---|---|---|---|
| 1 | **The export fits their import** | The app already produces a PDF per section. Add a CSV/XLSX export whose columns are the columns LetsTranzact's Inward and Dispatch import templates expect, so a person downloads and uploads instead of retyping. | **Small.** The data is already structured; this is a second renderer, exactly like `faq.html` beside the in-app FAQ. |
| 2 | **The two systems keep each other current** | A record entering LetsTranzact appears in the app and vice versa, so neither is typed twice. | **Large, and probably impossible here.** See the constraint below. |
| 3 | **The field names line up** | I-PASSBOOK's Inward and Dispatch sections are renamed/reordered to match LetsTranzact's vocabulary, so staff describe one process rather than two. | **Small, but a real change to the desk's own words.** Only worth doing once #1 has proved the mapping. |

**Reading 1 is the one worth building.** It kills the retyping, it needs no
integration permission from anybody, and — the reason it is the right first move —
it is the only one of the three that can be *verified*: if the file imports into
LetsTranzact without a single correction, the mapping is right, and if it does not,
the error message says which column is wrong. Readings 2 and 3 have no such test.

---

## The hard constraint on reading 2

**The backend cannot call out to a third party.** `UrlFetchApp` is forbidden in
`backend.gs` — asserted twice in `tools/smoke-backend.mjs` — because it broke Google
sign-in once. Apps Script therefore cannot reach a LetsTranzact API, whatever that
API looks like.

That does not make reading 2 impossible, but it moves all of it to the desktop: a
person or a scheduled script outside this repo would do the fetching, and this app
would only ever be the thing that stores the result. That is a different project
with a different owner, and it should not be started on the strength of one line in
a queue.

---

## What the desk already has, field by field

The two sections LetsTranzact cares about exist and are fully specified already —
`docs/03 - Sections Reference.md` is the authority. The fields, as the app stores
them:

**Inward — Section B (`sec-b`), "Inward Checklist (Inventory)"**

| Key | Label |
|---|---|
| `b_inwardDate` | Inward Date |
| `b_inwardBy` | Inward By (Name) |
| `b_stNo` | Stock Transfer (ST) No. |
| `b_inwardTable` | Particulars Received |
| `b_inwardPhotos` | Inward Photos |
| `b_remarks` | Remarks |

**Dispatch — Sections G, H and I**

| Key | Label | Section |
|---|---|---|
| `g_basicReport` | Flight Test Report | G |
| `g_flightLogs` | Data Check — Flight Logs | G |
| `g_postProcessing` | Data Check — Post-Processing | G |
| `g_dataCheckRemarks` | Data Check Remarks | G |
| `h_pdiDocs` | PDI Report | H |
| `h_pdiRemarks` | PDI Remarks | H |
| `h_dispatchChecklist` | Cross Check — received (B) vs packed for dispatch | H |
| `h_pdiResult` | PDI Result | H |
| `g_partDispatch` | Dispatch | I |
| `i_dispatchDate` | Dispatch Date | I |
| `i_courier` | Courier / Transporter | I |
| `i_courierTrackId` | Courier Tracking ID | I |
| `i_clientReceivedDate` | Client Received the Courier Date | I |
| `i_dispatchPhotos` | Attachments | I |
| `i_remarks` | Logistics Remarks | I |

Three of these read as though they were written for exactly this job, and they are
worth naming because they are the ones a mapping would hinge on:

- **`b_stNo` — the Stock Transfer number.** If LetsTranzact's inward entry is keyed
  on an ST/GRN number, this is the join key between the two systems, and it is the
  one field that would let anyone reconcile the two records years later.
- **`h_dispatchChecklist` — "received (B) vs packed for dispatch".** The app already
  cross-checks the inward list against the dispatch list. That is the same check a
  GRN-versus-dispatch reconciliation performs.
- **`i_courierTrackId`** — the outward key. A dispatch entry that carries a real
  tracking number is the one a customer can be answered from.

---

## What we need from the desk

Four things, in this order, and the first is the only one that blocks anything:

1. **One export from LetsTranzact**, either module, however it comes — a CSV, an
   XLSX, or a screenshot of the import screen with its column headings visible. The
   column headings ARE the specification. Everything in the mapping table above is
   guesswork until this arrives.
2. **Which direction matters more** — inward, or dispatch? They are separate modules
   in most ERPs and they may not be equally painful. If only one is built first, it
   should be the one where a person is retyping the most.
3. **Who types it now, and how often.** The value of reading 1 is proportional to the
   number of entries per week, and I cannot estimate that from here.
4. **Does LetsTranzact reject unknown columns**, or ignore them? This decides whether
   the export must be exactly their shape or may carry our fields alongside. It is a
   five-second question for whoever administers it and it changes the design.

---

## What I would build, once (1) arrives

A **one-way export**, matching the shape of the two renderers the FAQ already has
(`faq-content.js` → the in-app pane and the standalone `faq.html`), because the
failure mode to avoid is the same one:

- **One source of truth for the mapping.** A single table, `field → their column`.
  Not a second copy of the section definitions, and not column headings typed into a
  template string, because two copies of a mapping drift and the drift is invisible
  until an import fails in front of the person who needed it.
- **A visible, checkable output.** One button on the Inward section, one on Dispatch,
  producing the file for that IR. Not a bulk "export everything" — the desk does not
  want a spreadsheet, it wants to stop retyping the entry it is looking at.
- **A smoke suite that holds the mapping to the section definitions**, so a field
  renamed in `app.js` fails a test rather than silently exporting a blank column.
- **No new backend action.** This is a READ of data the app already has in the
  browser, so it needs no `API_VERSION` bump and no paste from the owner. That is
  deliberate: the cheapest useful version of this is the one that ships without
  waiting on anything.

**What I would not build:** any write back into LetsTranzact, any credential for it
stored anywhere in this repo, and any claim of "integration" for what is a file.
If the desk ends up typing less, that is the whole win, and it can be described
honestly in one sentence.
