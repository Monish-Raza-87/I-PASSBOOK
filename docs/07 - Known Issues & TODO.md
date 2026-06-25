# 07 — Known Issues & TODO

## Known Issues

### Security
- ❌ **No server-side auth on GAS endpoints** — anyone with the URL can call `listIRs` and `getPassbook`
- ❌ **Client IDs in frontend** — OAuth Client ID is not a secret, but the GAS URL being public means data is accessible without auth
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files

### Functionality
- ❌ **No offline editing** — PWA caches static assets but can't function without GAS backend
- ❌ **No conflict resolution** — if two users edit the same section simultaneously, last-save-wins with no warning
- ❌ **No delete capability** — sections can be updated but never cleared/deleted
- ❌ **No IR creation from app** — new IRs must come from the Google Form → "Form Responses" tab
- ❌ **No validation** — forms have no required-field checks before save
- ❌ **No auto-calculation** — Section D cost fields (material + labour → total) are manual entry
- ❌ **No section completion tracking** — no indicator of which sections have been filled vs empty

### UX
- ⚠️ **No loading state per section** — loading saved data is silent; user sees empty forms briefly
- ⚠️ **No error recovery** — if save fails, the retry button appears but doesn't auto-retry
- ⚠️ **File previews are image-only** — PDF uploads show no preview, only images get thumbnails
- ⚠️ **No way to view uploaded files** — saved file links are stored but not rendered back in the UI
- ⚠️ **Checklist UX** — checklist items use dropdown selects instead of more intuitive checkbox UX
- ⚠️ **No confirmation dialog** — save button has no "are you sure?" for critical sections

### Technical Debt
- 🔧 **Single-file frontend** — all logic in one `app.js` file (663 lines, growing)
- 🔧 **No build pipeline** — no minification, no bundling, no tree-shaking
- 🔧 **No tests** — zero test coverage
- 🔧 **No type safety** — vanilla JS, no TypeScript or JSDoc
- 🔧 **Session-only auth** — `sessionStorage` means re-auth on every new tab
- 🔧 **Legacy importer hardcoded** — `importSingleTab()` has placeholder cell mappings

## Planned / Nice-to-Have Features

- [ ] Dashboard with IR stats (open/closed/pending counts)
- [ ] Section completion progress indicator on Master Index cards
- [ ] Push notifications for IR status changes
- [ ] Photo gallery view for saved file links
- [ ] Auto-calculation for cost fields (Section D, G)
- [ ] Form validation with required fields
- [ ] Offline-first with local storage sync queue
- [ ] Role-based access (e.g., warehouse staff see only sections B-C, pilots see G)
- [ ] Audit trail / history for section edits
- [ ] Export to PDF
- [ ] Multi-language support (Hindi + English)