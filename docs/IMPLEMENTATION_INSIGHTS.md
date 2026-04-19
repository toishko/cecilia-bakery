# IMPLEMENTATION_INSIGHTS — Dedicated Analytics Tab

> A dedicated "Insights" tab added to the mobile bottom nav and desktop sidebar, providing deep-dive analytics separated from the quick-glance dashboard Overview.

---

## Overview
The Overview tab shows abbreviated totals ($68.1k, $49.3k, $18.8k) for at-a-glance monitoring. The new Insights tab provides the full breakdown: donut charts for revenue channels, a driver leaderboard, and detailed financial data — all filterable by time period.

## Checklist

### Phase 1 — Foundation
- [x] Create `section-insights` HTML structure
- [x] Add 5th bottom nav tab (Insights, `pie-chart` icon, between Orders and Manage)
- [x] Add sidebar nav item for desktop (below Overview)
- [x] Register `insights` in `_sectionGroupMap` and `_lastSectionInGroup`
- [x] Add `loadInsights()` to `showSection()` switch
- [x] Add to `__adminRefresh` map

### Phase 2 — Revenue Breakdown Donut Chart
- [x] SVG donut chart: Driver Routes vs Wholesale vs Online (ordered value)
- [x] Color-coded segments with legend labels + percentages
- [x] Center text showing abbreviated total
- [x] Time period filter (addEventListener-based)

### Phase 3 — Collection Breakdown Donut Chart
- [x] Second donut chart for Gross Revenue (collected amounts)
- [x] Same style/pattern as Revenue Breakdown

### Phase 4 — Driver Leaderboard
- [x] Ranked list of drivers by total sales volume
- [x] Medal icons for top 3 (🥇🥈🥉)
- [x] Each row: rank, name, total amount, order count
- [x] Sorted highest first
- [x] Uses `getDriverName()` + `driversCache` (auto-loaded if empty)

### Phase 5 — Stat Card Rewiring
- [x] "Total Ordered Value" card tap → navigate to Insights
- [x] "Gross Revenue" card tap → navigate to Insights
- [x] "Pending Collection" card tap → keep existing slide-up sheet
- [x] Remove unused `openOrderedSheet()`, `openRevenueSheet()`, `_openStatSheet()`, `closeStatSheet()`
- [x] Remove ordered/revenue sheet overlay HTML
- [x] Remove stat-sheet CSS (hero, rows, etc.)

### Phase 6 — Polish & Verify
- [x] Mobile test at 390×844
- [x] 5-tab nav renders correctly
- [x] Donut charts render with real Supabase data
- [x] Driver leaderboard renders with 10+ drivers
- [ ] Desktop sidebar link works
- [ ] Time filter switching verified
- [ ] EN/ES language support
- [ ] Pull-to-refresh works on Insights

### Phase 8 — Filterable "Total Ordered Value" Sheet
- [x] Add inline time-period pills (Today / Week / Month / All) inside the sheet header, below the subtitle
- [x] Decouple sheet data from `_channelBreakdown` cache — make `openOrderedSheet()` fetch its own data for the selected period
- [x] Add `driver_id` to the `loadOverview` driver_orders query so per-driver breakdown data is available
- [x] Make the "Driver Orders" channel row tappable — expands to show per-driver breakdown (name, invoiced, collected, owed)
- [x] Per-driver rows sorted by highest invoiced first; use `getDriverName()` + initials avatar
- [x] Animate the expand/collapse of per-driver rows
- [x] Switching time pills re-queries Supabase and re-renders the entire sheet content
- [x] EN/ES support for all new labels
- [x] CSS for time pills inside sheet, expandable driver rows
- [x] Remove "WHAT HAPPENED TO THIS MONEY?" section (Collected/Still Owed bar + rows) — redundant with FAB queue and Unpaid quick action tile

### Phase 7 — Ultra-Premium UI Pass (Design Overhaul)
- [x] Fix: prevent $0 categories from rendering a dot due to `stroke-linecap="round"`
- [x] Add SVG `<defs>` with rich gradients (e.g., `brandRed` gradient)
- [x] Add a frosted background "track" ring for the donut to anchor it
- [x] Apply colored drop-shadow glow (bloom) to the main SVG path
- [x] Programmatically add small gaps between segments when drawing the donut arcs

## Notes & Decisions
- Insights tab placed in center position (3rd of 5) — the natural "hero" position on 5-tab bars.
- Dashboard tab remains direct-to-Overview (no action sheet).
- Insights tab is also direct (no action sheet) — single section, no sub-pages.
- Donut charts built with pure SVG + CSS — no external chart library needed.
- Desktop sidebar: Insights placed between Order History and Settings.
- *2026-04-19:* Initial implementation complete. `driver_name` column doesn't exist in `driver_orders` table — using `driver_id` + `getDriverName()` from `driversCache` instead.
- *2026-04-19:* Supabase client must be referenced as module-scoped `sb`, not `window.__supabase`.
- *2026-04-19:* Phase 8 — "Total Ordered Value" sheet decoupled from `_channelBreakdown` cache. Sheet now fetches its own data so pill switching doesn't require a full Overview reload.
- *2026-04-19:* Removed "WHAT HAPPENED TO THIS MONEY?" (Collected/Still Owed) section from sheet — info already accessible via FAB queue and Unpaid quick action tile. Keeps the sheet focused on invoiced values only.
