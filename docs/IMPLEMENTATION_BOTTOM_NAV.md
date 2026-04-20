# IMPLEMENTATION_BOTTOM_NAV — Mobile App-Style Bottom Navigation

> Replace the hamburger dropdown menu with a persistent iOS/Android-style bottom tab bar on mobile,
> with a "Bottom Action Sheet" for groups that have sub-sections.

---

## Overview

The current mobile navigation used a hamburger icon that toggled a dropdown menu.
We replaced it with a persistent bottom tab bar (like iOS tab bars).

**Phase 1 (Complete):** Bottom tab bar with 4 main tabs + sub-tab pills at top of sections.
**Phase 2 (In Progress):** Replace sub-tab pills with a "Bottom Action Sheet" — a glassmorphic
slide-up menu that appears when tapping tabs with multiple sub-sections (Orders, Manage, Settings).

---

## Tab Architecture

### Bottom Bar (4 tabs, always visible on mobile)

| Tab | Icon | Label (EN/ES) | Behavior |
|-----|------|---------------|----------|
| Dashboard | `bar-chart-3` | Dashboard / Resumen | Direct → `overview` |
| Orders | `inbox` | Orders / Pedidos | Opens action sheet (Driver Orders, Online, History) |
| Manage | `layout-grid` | Manage / Gestionar | Opens action sheet (Drivers, Products, New Order, Wholesale) |
| Config | `settings` | Config / Config | Opens action sheet (Settings, Staff) |

### Action Sheet Items

**Orders sheet:**
| Icon | Label (EN) | Label (ES) | Section | Badge |
|------|-----------|-----------|---------|-------|
| `truck` | Driver Orders | Pedidos Conductores | `incoming` | Active driver order count |
| `globe` | Online Orders | Pedidos en Línea | `online-orders` | Active online order count |
| `clock` | History | Historial | `history` | — |

**Manage sheet:**
| Icon | Label (EN) | Label (ES) | Section | Badge |
|------|-----------|-----------|---------|-------|
| `users` | Drivers | Conductores | `drivers` | — |
| `package` | Products | Productos | `products` | — |
| `plus-circle` | New Order | Nuevo Pedido | `new-order` | — |
| `building-2` | Wholesale | Mayoreo | `wholesale` | Pending wholesale count |

**Config sheet:**
| Icon | Label (EN) | Label (ES) | Section | Badge |
|------|-----------|-----------|---------|-------|
| `settings` | Settings | Configuración | `settings` | — |
| `shield` | Staff | Personal | `staff` | — |

---

## Phase 2 Checklist — Bottom Action Sheet

### CSS
- [x] Add `.action-sheet-overlay` (dark backdrop, fade-in)
- [x] Add `.action-sheet` (glassmorphic card, slide-up from bottom)
- [x] Add `.action-sheet-item` (large tappable buttons with icons)
- [x] Add `.action-sheet-badge` for count badges
- [x] Support light/dark mode
- [x] Smooth open/close animations (transform + opacity)

### HTML
- [x] Remove all `.sub-tabs` containers from section HTML
- [x] Add single action sheet overlay + container to the page

### JS
- [x] Change bottom nav click: Dashboard = direct, others = open sheet
- [x] Dynamically populate sheet items based on which tab was tapped
- [x] Sheet item click → close sheet + navigate to section
- [x] Backdrop click → close sheet
- [x] Update badges inside sheet items (driver count, online count, wholesale count)
- [x] Re-tapping same bottom tab while sheet is open → close sheet

### Testing
- [x] Light mode + dark mode
- [x] EN + ES strings
- [x] All 10 sections still load correctly
- [x] Badges update in real-time inside sheet
- [x] Desktop sidebar completely unaffected
- [x] Sheet dismisses on backdrop tap
- [x] Drag-to-dismiss: swipe sheet down to close (GPU translate3d, velocity-based, 60px threshold)
- [x] Background scroll locked when sheet is open (scroll-locked class, position:fixed pattern, scroll position saved/restored)
- [x] Tight bottom padding (8px) — base safe-area padding not needed as bottom nav is hidden via scroll-lock

---

## Notes & Decisions

- **No FAB**: The user explicitly said no floating action button for now.
- **Desktop untouched**: Only mobile viewports (≤768px) and PWA standalone get the bottom nav.
- **Dashboard tab is direct**: No sheet for Dashboard since it only maps to `overview`.
- **Sheet replaces sub-tab pills**: The horizontal pills at top of sections are removed in favor of the slide-up sheet.
