# 06 — UI Components & Styling

## Design Tokens (`:root` in `style.css`)

```css
--primary:       #0E62FF;    /* Indrones brand blue */
--primary-dark:  #073ba3;
--bg-1:          #0b1120;    /* Deep navy background */
--bg-2:          #111827;
--text:          #f1f5f9;    /* Light text */
--muted:         #94a3b8;    /* Muted text */
--glass:         rgba(255,255,255,0.05);
--glass-border:  rgba(255,255,255,0.10);
--glass-shadow:  0 8px 32px rgba(0,0,0,0.4);
--success:       #10b981;    /* Green */
--warning:       #f59e0b;    /* Amber */
--danger:        #ef4444;    /* Red */
--radius:        12px;
```

## Design Style: Dark Glassmorphism

- Deep navy gradient backgrounds
- Frosted glass cards (`backdrop-filter: blur`)
- Subtle borders with `rgba(255,255,255,0.10)`
- Blue accent color (`#0E62FF`) throughout
- Animations: `fadeIn`, `slideUp`, `shimmer` (loading skeletons), `loadbar` (splash)

## Key Components

### Splash Screen (`#splash-screen`)
- Fixed full-screen overlay, z-index 1000
- Video background with blue gradient overlay
- Animated logo text with gradient fill
- Progress bar at bottom
- Auto-dismisses after 2 seconds

### Auth Card (`.glass-card`)
- Centered card with blur backdrop
- Google Sign-In button with SVG icon
- Error message for non-@indrones.com accounts

### App Header (`header`)
- Sticky top bar, z-index 60
- Back button (visible in detail view only)
- Title (IR number in detail, "I-PASSBOOK" in index)
- User avatar (initial or profile photo)

### User Menu (`#user-menu`)
- Dropdown from avatar, shows name + email
- Sign Out button (clears sessionStorage, reloads)

### Search Bar (`.search-bar`)
- Full-width input with focus ring
- Filters IR list by IR number or drone ID

### IR Card (`.ir-card`)
- Glass card with left-border accent on hover
- Title (IR number), subtitle (drone + date), status badge
- Click opens passbook detail view

### Status Badges
| Class | Color | Usage |
|---|---|---|
| `.badge-open` | Green | Status "Open" |
| `.badge-pending` | Amber | Contains "pend" |
| `.badge-closed` | Gray | All others |

### Section Tabs (`.tabs-container`)
- Horizontally scrollable tab bar
- Sticky below header (top: 56px)
- Active tab: blue text + blue bottom border
- Snap scroll (`scroll-snap-type: x mandatory`)

### Form Components
- `.form-group` — standard field wrapper
- `.form-label` — field label
- `.form-input` — text/date/number/email/tel/select/textarea input
- `.file-upload-wrapper` — dashed-border drop zone for files
- `.checklist-row` — label + dropdown for checklist items

### Buttons (`.btn`)
- Primary blue button with shadow
- States: `.saving` (amber), `.saved` (green), `.error` (red)
- Scale-down on active press

### Toast (`#toast`)
- Fixed bottom-center notification
- Slides up with spring animation
- Auto-hides after 3 seconds

## Responsive Breakpoints

- **Default**: Mobile layout (full-width cards, etc.)
- **600px+**: Desktop layout — max-width 760px for content, wider glass cards