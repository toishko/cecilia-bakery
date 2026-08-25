# Phase 9 — Polish & Accessibility

> Final pass: UX refinements, accessibility, responsive testing, animations.

---

## Text Size A−/A+

- Control in Settings (both driver and admin)
- **A−** decreases root `font-size` by 2px (minimum: 12px)
- **A+** increases root `font-size` by 2px (maximum: 24px)
- Default: 16px (or whatever the base is)
- Scales everything proportionally (since all sizes use `rem` or `em`)
- Saved to `localStorage` so it persists across sessions
- Live preview — changes apply immediately

---

## Language Persistence

- Language choice (EN/ES) saved in TWO places:
  1. `localStorage` — for immediate load without Supabase call
  2. `drivers.language` column in Supabase — so it persists across devices
- On login, check Supabase `drivers.language` and apply it
- On change, update both localStorage AND Supabase
- Admin has their own language preference (localStorage only, since they use Supabase auth)
- All receipts, exports, and notifications respect the current language

---

## Theme Persistence

- Light/dark toggle saved to `localStorage`
- On page load: check localStorage → apply `data-theme` attribute
- Respects system preference as fallback (`prefers-color-scheme: dark`)
- Smooth transition between themes (already exists in website CSS)

---

## 5-Attempt Lockout (Driver Code Entry)

- Track failed attempts in `localStorage` (key: `cecilia_code_attempts`)
- After 5 wrong codes:
  - Disable input field + submit button
  - Show: "Too many attempts. Try again in 5 minutes."
  - Show countdown timer (4:59, 4:58...)
  - Store lockout end time in localStorage
- After cooldown: reset counter, re-enable input
- Successful login: reset counter to 0

---

## Responsive Testing

### Driver Side (`driver-order.html`)
- **Phone (375px)**: primary target. Everything must work perfectly
- **Phone large (414px)**: iPhone Plus sizes
- **Tablet (768px)**: should look good, slightly more spacious
- **Desktop (1024px+)**: functional but not the primary target

### Admin Side (`admin-dashboard.html`)
- **Phone (375px)**: functional with dropdown nav
- **Tablet (768px)**: good experience, sidebar visible
- **Desktop (1024px+)**: full sidebar, spacious data tables

### Key Checks
- [ ] All tap targets ≥ 44px on mobile
- [ ] No horizontal scrolling on any screen
- [ ] Accordion sections fully usable on small screens
- [ ] Modal summary doesn't overflow on small phones
- [ ] Sidebar collapses properly on mobile
- [ ] Multi-order tabs are scrollable if many orders
- [ ] Print views work correctly
- [ ] Quick search doesn't cover content on mobile

---

## Micro-Animations

- **Card hover/tap**: subtle scale (1.01) + shadow lift
- **Accordion open/close**: smooth height transition
- **Modal slide-up**: spring animation from bottom
- **Button press**: slight scale-down (0.97) on active
- **Payment badge change**: brief pulse/glow when status changes
- **Notification**: fade-in slide-down from top
- **Page transitions**: smooth opacity fade between dashboard sections
- **Balance banner**: gentle pulse if amount > 0
- **Input focus**: border color transition + subtle glow

All animations should be:
- Subtle (not distracting)
- Fast (150-250ms)
- Respect `prefers-reduced-motion` for accessibility

---

## Input Focus/Blur (Final Check)

- All number inputs across the order form:
  - **Focus**: clear "0", show empty field, cursor ready
  - **Blur**: if empty, restore to "0"
  - **Type**: when typing, old value is replaced (not appended to "0")
- This applies to driver order form AND admin quick-adjust fields

---

## Final End-to-End Verification

Run through the complete flow:

1. **Driver logs in** with code → sees dashboard
2. **Creates order** with business name, 2 orders in batch, various products
3. **Submits** → sees confirmation + 30-min edit notice
4. **Admin sees** new order appear (with chime)
5. **Admin reviews** → adjusts quantities (+2 items at pickup)
6. **Admin sets** payment to Partial ($50 of $120)
7. **Admin confirms & sends**
8. **Driver gets** notification chime → sees order in My Orders
9. **Driver sees** correct balance ($70 outstanding)
10. **Admin prints** one copy with totals, one without
11. **Admin exports** to WhatsApp
12. **Test PWA**: add to home screen, verify standalone launch
13. **Test dark mode**: everything readable, no contrast issues
14. **Test EN/ES**: switch languages, verify all text updates
15. **Test text size**: A+/A- works, nothing breaks at max/min

---

## Checklist
- [x] Text size A−/A+ control (saved, live preview)
- [x] Language persistence (localStorage + Supabase)
- [x] Theme persistence (localStorage + fallback)
- [x] 5-attempt lockout with countdown
- [x] Responsive testing: phone, tablet, desktop (both sides)
- [x] Micro-animations (all listed above)
- [x] Input focus/blur behavior verified
- [x] `prefers-reduced-motion` respected
- [x] Final end-to-end flow tested
- [x] Dark mode contrast check
- [x] EN/ES completeness check
- [x] Removed duplicate "Ordered: $0" sub-text from admin dashboard "Collected Today" stat block.
- [x] Bump PWA Service Worker cache version to flush stale HTML from local testing.
- [x] Restore hidden spacer in `admin-dashboard.html`'s 'Collected Today' block to keep the UI perfectly aligned and straight.
- [x] Fix "Overview" title off-center in mobile header — changed `.mobile-section-name` from `flex:1; text-align:center` to `position:absolute; left:0; right:0; text-align:center` so it centers across the full viewport regardless of logo/button widths.
- [x] Sync local `sw.js` back to `v39` (stale local had `v38`) and commit `version.json` timestamp update.
- [x] Fix background scroll-through when "Total Ordered Value" sheet is open — iOS ignores `overflow:hidden` on body; added `position:fixed` + `overscroll-behavior:none` to `scroll-locked`, save/restore scroll position on open/close.
- [x] Fix bottom nav tabs showing on top of the Total Ordered Value sheet overlay — hide bottom nav when `scroll-locked` is active.
- [x] Fix "Unpaid" quick action tile not filtering Orders — updated selector from stale `.filter-tab` to `#driver-orders-filter .insights-pill[data-filter=unpaid]`.
- [x] Fix FAB needs-attention pill showing green "Pending" — pill was styled with payment class but displayed order-status label; now shows payment label (Not Paid/Paid/Partial) so color matches text.
- [x] Add iOS-style drag-to-dismiss on the Total Ordered Value sheet — swipe down on handle/header or when content is scrolled to top; 80px threshold; overlay fades proportionally.
- [x] Polish drag-to-dismiss: GPU-accelerated `translate3d` + `will-change`, velocity-based fast-flick dismiss (0.5px/ms), rubber-band resistance past threshold, 200ms animations, reduced threshold to 60px.
- [x] Fix jittery sheet open animation — apply `scroll-locked` (position:fixed reflow) before animation while sheet is off-screen, double `requestAnimationFrame` to let reflow settle, then trigger CSS slide-up. Also switched all `.action-sheet` transforms to `translate3d` with `will-change:transform` for GPU compositing.
- [x] Add iOS-style drag-to-dismiss on the Pending Collection sheet — same pattern as ordered sheet (GPU accel, velocity, rubber-band, scroll-lock save/restore, smooth open with double rAF).
- [x] Fix excessive bottom space in FAB queue sheet — reduced padding-bottom from 76px (for now-hidden bottom nav) to 20px + safe-area; queue sheet auto-sizes to content with 88vh cap.
- [x] Fix FAB queue sheet still too tall — override `flex:1` to `flex:none` on `#queue-sheet-overlay .order-sheet-content` so content doesn't stretch.
- [x] Change Driver Orders default filter from "All" to "Today" — moved `active` class from "All" pill to "Today" pill.
- [x] Change Overview revenue filter default from "This Month" to "Today" — moved `selected` attribute on the `#revenue-filter` dropdown.
- [x] Remove "Drivers Active" stat from the today-snapshot strip on the overview.
- [x] Fix pending sheet drag-dismiss intercepting upward scroll — defer drag lock to touchmove direction check; only commits to dismiss if first movement is downward at scrollTop=0.
- [x] Dashboard tab click scrolls to top of page — added `window.scrollTo` on `overview` section switch.
- [x] Driver Orders filter always resets to "Today" on navigation — reset pill state in `showSection` before `loadIncomingOrders`.
- [x] Fix ordered sheet bottom blank space — added `height:auto` + `flex:none` override on content, same as queue sheet fix.
- [x] Fix pending sheet still closing on scroll — previous fix checked `items.scrollTop` but the scroll container is the `sheet` element itself; fixed to check `sheet.scrollTop`.
- [x] Bump SW const CACHE_VERSION = 'v42'; — PWA discards stale cache and picks up all recent CSS/JS sheet padding + drag fixes.
- [x] Fix PWA standalone sheet blank bottom space — in standalone mode `env(safe-area-inset-bottom)` is ~34px; removed extra 20px base padding inside `@media(display-mode:standalone)`, now uses `max(8px, env(safe-area-inset-bottom))`. Bumped cache to v42.
- [x] Fix PWA sheet max-height — `100vh` in black-translucent standalone = full screen (956px), not visible viewport (894px). Subtracted safe-area insets: `calc((100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)) * 0.88)`. Added `box-sizing: border-box`. Bumped cache to v42.
- [x] Fix sheet bottom blank space root cause (confirmed via Safari Web Inspector) — BLANK SPACE was 46px: sheet padding-bottom 34px (safe-area) + capture-section 8px + content div 4px. Removed stacked internal padding; only 34px safe-area remained. Bumped cache to v43.
- [x] Reduce sheet padding-bottom to 8px — user confirmed 34px safe-area still felt excessive. Removed safe-area padding from base sheet; overrode per-sheet for data sheets (ordered, queue, pending, order-detail) and nav sheet to 8px. Bumped cache to v44.
- [x] Fix Orders nav sheet option cutoff — tight 8px padding broke navigation sheet where bottom nav IS visible. Restored base sheet to `calc(20px + env(safe-area-inset-bottom))`; applied 8px override only to data sheets (ordered, queue, pending, order-detail, nav action sheet). Bumped cache to v45.
- [x] Fix background scroll when Orders nav sheet is open — `_openActionSheet()` was missing scroll-lock; added same `scroll-locked` pattern (save scrollY, position:fixed body, restore on close). Bumped cache to v46.
- [x] Fix today-drivers-active null TypeError — element was removed but JS still tried to update it; added null guard. 
- [x] Insights page defaults to "All" on every navigation — reset pills and call `loadInsights('all_time')` inside `showSection`. Moved `active` class to `all_time` pill in HTML. Bumped cache to v47.
- [x] Orders nav sheet — blank space + no drag-to-dismiss — added `padding-bottom: 8px` CSS override for `#action-sheet-overlay`; added drag-to-dismiss touch handler `initActionSheetDrag()` (same pattern as ordered/pending sheets: velocity, threshold 60px, GPU translate3d). Bumped cache to v48.

---

## Admin and Driver Display Zoom Resilience

### Goal
Guarantee resilient, overflow-free mobile rendering on iOS Safari with Display Zoom enabled and large dynamic text across the actively used Admin Dashboard and Driver systems down to 320px viewport width without introducing regressions or unvetted CSS.

---

### Exact Scope
- `admin-dashboard.html`
- `admin-dashboard.css`
- `admin-dashboard.js` (selector and DOM structure validation only)
- `driver-order.html`
- `driver-order.css`
- `driver-order.js` (selector and DOM structure validation only)
- `docs/IMPLEMENTATION_POLISH.md`

### Explicit Exclusions
- Customer storefront
- Menu
- Checkout
- Customer account
- Order confirmation
- Wholesale registration
- Wholesale portal
- Staff portal
- Product manager
- Receipts
- Legal pages
- Offline page
- Woosim
- APIs
- SQL
- Databases
- Authentication
- Payments
- Service workers
- Manifests
- Environment files

---

### Confirmed Existing Protections (from Commit `9b64199`)

#### Admin Dashboard (`admin-dashboard.css`)
- **Global Reset & iOS Sizing**: `*, *::before, *::after` includes `box-sizing: border-box`, `word-break: normal`, `overflow-wrap: break-word` (line 34). `body` includes `-webkit-text-size-adjust: 100%`, `text-size-adjust: 100%` (line 39).
- **Text Truncation Group**: `.oca-name`, `.driver-group-name`, `.driver-name`, `.client-name`, `.product-name`, `.item-title`, `.dash-card-title`, `.order-num-text` enforce `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal; overflow-wrap: normal;` (lines 42–53).
- **Order Card Avatar Media Queries**: `@media (max-width: 520px)` and `@media (max-width: 360px)` provide responsive padding, avatar scaling (36px), price font sizing, static `.oca-ref` positioning without transform, and flex wrapping on 360px (lines 494–542).
- **Driver Table Horizontal Scrolling**: `.driver-table-wrap` has `-webkit-overflow-scrolling: touch; overflow-x: auto;` and `.driver-table` has `min-width: 500px;` (lines 891–893).
- **Insights Pills**: `.insights-pills` has `overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;` and `.insights-pill` has `white-space: nowrap; flex-shrink: 0;` (lines 1350–1356).
- **Driver Group Settlement Cards**: `@media (max-width: 520px)` and `@media (max-width: 350px)` provide responsive wrapping, avatar scaling, and full-width settle button on extra-narrow viewports (lines 4072–4130).
- **AI Spend Monitor Grid**: Added in `11a6f61`, `.ai-simple-grid` switches to single column `grid-template-columns: 1fr` at `@media (max-width: 600px)` (lines 4194–4199).
- **Custom Range Inputs**: Added in `9383a98`, `.custom-range-inputs` switches to single column at `@media (max-width: 440px)` (lines 1194–1198).

#### Driver Order System (`driver-order.css`)
- **Global Reset & iOS Sizing**: `*, *::before, *::after` includes `box-sizing: border-box`, `word-break: normal`, `overflow-wrap: break-word` (line 33). `body` includes `-webkit-text-size-adjust: 100%`, `text-size-adjust: 100%` (line 39).
- **Text Truncation Group**: `.client-card-name`, `.client-name`, `.driver-title`, `.driver-name`, `.product-name`, `.order-num`, `.stat-label` enforce `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal; overflow-wrap: normal;` (lines 43–53).
- **Order Tabs Base Overflow**: `.order-tabs` already possesses `overflow-x: auto; display: flex; gap: 6px;` (line 409) which keeps tabs on a single row.
- **Insights Pills**: `.insights-pills` has `overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;` and `.insights-pill` has `white-space: nowrap; flex-shrink: 0;` (lines 1906–1934).

---

### Confirmed Missing Protections & Structural Differences

#### Admin Dashboard (`admin-dashboard.css`)
*Note: The Admin Dashboard layout is already substantially protected from commit `9b64199`. Only minor label-containment safeguards remain:*
1. **Bottom Navigation Labels**: `.bottom-nav-item` is missing `min-width: 0;`. The label element `.bottom-nav-item > span[data-en]` lacks text containment (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;`). On 320px Display Zoom with Spanish localization (e.g. "Estadísticas"), long label text can expand the flex item. Note: The targeted selector `.bottom-nav-item > span[data-en]` must be used instead of `.bottom-nav-item span` to avoid altering `.bottom-nav-badge` notification counters.
2. **Insights Date Range Badge**: `.insights-date-range-badge` / `#insights-date-range-text` lacks text containment (`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;`) when custom date ranges with long date strings are displayed on narrow screens.

#### Driver Order System (`driver-order.css` & `driver-order.js`)
1. **Order Tabs Resilience**:
   - While `.order-tabs` already has `overflow-x: auto;`, `.order-tab` and `.order-tab-add` are MISSING `flex-shrink: 0;`. When multiple order tabs exist (Order 1, Order 2, etc.), tabs shrink and compress.
   - `.order-tabs` is missing momentum scrolling and scrollbar suppression: `-webkit-overflow-scrolling: touch; scrollbar-width: none;` and `.order-tabs::-webkit-scrollbar { display: none; }`.
   - `.order-tab-add` is missing `white-space: nowrap; flex-shrink: 0;`.
2. **Driver Bottom Navigation Labels**:
   - `.bottom-nav-item` is missing `min-width: 0;`.
   - `.bottom-nav-item > span[data-en]` is missing `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;`.
3. **Driver Order Card Structure Audit & Ref Placement Differences**:
   - **DOM Structure Comparison**:
     - In Admin (`admin-dashboard.js`), the order card structure is:
       `[ .oca-avatar ] -> [ .oca-body ] -> [ .oca-ref ] -> [ .oca-right ]`
     - In Driver (`driver-order.js`), `renderSingleOcaCard()` places `${refHtml}` **before** `${avatarHtml}`:
       `[ .oca-ref ] -> [ .oca-avatar ] -> [ .oca-body ] -> [ .oca-right ]`
     - In Driver batch headers (`renderOrderCard()`), no `.oca-ref` exists, but a `.oca-chevron` is appended:
       `[ .oca-avatar ] -> [ .oca-body ] -> [ .oca-right ] -> [ .oca-chevron ]`
     - In Driver direct sales (`renderDriverSaleCard()`), neither avatar nor `.oca-ref` exists:
       `[ .oca-body ] -> [ .oca-right ]`
   - **Problem**: In `driver-order.css` (lines 778–789), `.oca-ref` is styled as `position: absolute; left: 50%; transform: translateX(-50%);`. On mobile viewports <= 520px (and especially 320px Display Zoom), this absolute badge directly overlaps customer names in `.oca-body` and prices in `.oca-right`.
   - **Safety Requirement**: Because Driver renders `${refHtml}` before `.oca-avatar`, directly applying Admin's `position: static` without flex ordering would place `.oca-ref` to the left of the avatar.
   - **Targeted CSS-Only Solution**:
     - At `@media (max-width: 520px)`:
       - `.oca-card`: `padding: 12px 4px; gap: 8px;`
       - `.oca-card.oca-child`: `padding-left: 20px;` *(preserves visual nesting of child orders inside an expanded batch)*
       - `.oca-card > .oca-avatar`: `order: 1; width: 36px; height: 36px; font-size: 0.78rem; margin-right: 8px; flex-shrink: 0;`
       - `.oca-card > .oca-avatar-stack`: `order: 1; margin-right: 8px; flex-shrink: 0;`
       - `.oca-card > .oca-body`: `order: 2; flex: 1; min-width: 0;`
       - `.oca-card > .oca-ref`: `order: 3; position: static; transform: none; font-size: 0.76rem; padding: 2px 6px; margin: 0 4px; align-self: center; flex-shrink: 0;`
       - `.oca-card > .oca-right`: `order: 4; margin-left: auto; flex-shrink: 0;`
       - `.oca-card > .oca-chevron`: `order: 5; margin-left: 4px; flex-shrink: 0; align-self: center;`
       - `.oca-card .oca-name`: `font-size: 0.9rem;`
       - `.oca-card .oca-price`: `font-size: 0.88rem;`
     - At `@media (max-width: 360px)`:
       - `.oca-card`: `flex-wrap: wrap; gap: 4px;`
       - `.oca-card > .oca-body`: `flex: 1 1 calc(100% - 48px);`
       - `.oca-card > .oca-ref`: `margin-left: 44px; margin-top: 2px; align-self: center;`
       - `.oca-card > .oca-right`: `margin-left: auto; flex-direction: row; align-items: center; gap: 6px;`
       - `.oca-card .oca-pill`: `margin-top: 0;`
     - **Verification across all 5 card types**:
       1. *Normal `.oca-card` with ref*: Avatar (order 1) -> Body (order 2) -> Ref (order 3) -> Price/Pill (order 4).
       2. *`.oca-card.oca-child` with ref*: Inherits same order rules cleanly while maintaining its `20px` left indentation.
       3. *`.oca-card.batch-header`*: Avatar / Avatar Stack (order 1) -> Body (order 2) -> Price/Pill (order 4) -> Chevron (order 5).
       4. *Direct sale `.oca-card`*: Body (order 2) -> Price/Pill (order 4).
       5. *Batch-header chevron*: Stays anchored at order 5 on the right.

---

### Separate Minimal JavaScript Proposal (Optional / Requiring Approval)

To completely eliminate the DOM ordering disparity between Admin and Driver:
- **Proposal**: In `driver-order.js` within `renderSingleOcaCard()`, move `${refHtml}` from before `${avatarHtml}` (line 2144) to immediately after `<div class="oca-body">...</div>` (line 2150).
- **Benefit**: Aligns Driver’s DOM structure identically with Admin’s `[ .oca-avatar ] -> [ .oca-body ] -> [ .oca-ref ] -> [ .oca-right ]`, removing the need for CSS `order` declarations.
- **Status**: *Documented for review only. Not part of Phase A or Phase B CSS changes.*

---

### Implementation Phases

#### Phase A — Admin Safeguards (`admin-dashboard.css`)
- Target Selectors:
  - `.bottom-nav-item`: Add `min-width: 0;`
  - `.bottom-nav-item > span[data-en]`: Add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;`
  - `.insights-date-range-badge`: Add `max-width: 100%; min-width: 0;`
  - `#insights-date-range-text`: Add `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`

#### Phase B — Driver Resilience (`driver-order.css`)
- Target Selectors:
  - `.order-tabs`: Add `-webkit-overflow-scrolling: touch; scrollbar-width: none;`
  - `.order-tabs::-webkit-scrollbar`: Add `display: none;`
  - `.order-tab`: Add `flex-shrink: 0;`
  - `.order-tab-add`: Add `flex-shrink: 0; white-space: nowrap;`
  - `.bottom-nav-item`: Add `min-width: 0;`
  - `.bottom-nav-item > span[data-en]`: Add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;`
  - `@media (max-width: 520px)`:
    - `.oca-card`: `padding: 12px 4px; gap: 8px;`
    - `.oca-card.oca-child`: `padding-left: 20px;`
    - `.oca-card > .oca-avatar`: `order: 1; width: 36px; height: 36px; font-size: 0.78rem; margin-right: 8px; flex-shrink: 0;`
    - `.oca-card > .oca-avatar-stack`: `order: 1; margin-right: 8px; flex-shrink: 0;`
    - `.oca-card > .oca-body`: `order: 2; flex: 1; min-width: 0;`
    - `.oca-card > .oca-ref`: `order: 3; position: static; transform: none; font-size: 0.76rem; padding: 2px 6px; margin: 0 4px; align-self: center; flex-shrink: 0;`
    - `.oca-card > .oca-right`: `order: 4; margin-left: auto; flex-shrink: 0;`
    - `.oca-card > .oca-chevron`: `order: 5; margin-left: 4px; flex-shrink: 0; align-self: center;`
    - `.oca-card .oca-name`: `font-size: 0.9rem;`
    - `.oca-card .oca-price`: `font-size: 0.88rem;`
  - `@media (max-width: 360px)`:
    - `.oca-card`: `flex-wrap: wrap; gap: 4px;`
    - `.oca-card > .oca-body`: `flex: 1 1 calc(100% - 48px);`
    - `.oca-card > .oca-ref`: `margin-left: 44px; margin-top: 2px; align-self: center;`
    - `.oca-card > .oca-right`: `margin-left: auto; flex-direction: row; align-items: center; gap: 6px;`
    - `.oca-card .oca-pill`: `margin-top: 0;`

#### Phase C — Optional Maintenance / CSS Deduplication (`driver-order.css`)
*Note: Strictly deferred until Phase A and Phase B have been implemented, tested, and verified.*
- Consolidate duplicate blocks in `driver-order.css`:
  - Lines 879–902 (duplicate of lines 845–869 for `.oca-right`, `.oca-price`, `.oca-pill`, `.oca-edit`)
  - Lines 911–918 (duplicate of lines 870–877 for dark mode pill overrides)

---

### Minimal Verification Checklist
1. **Viewport 320px (Simulating iPhone SE / iOS Display Zoom)**:
   - Admin bottom nav: 5 tabs visible, labels truncated with ellipsis without pushing items off-screen; badges (`.bottom-nav-badge`) display numbers accurately.
   - Insights custom date range badge stays contained within header.
   - Driver bottom nav: 5 tabs (including center FAB) aligned evenly with no overflow; labels truncated cleanly.
   - Driver order tabs: Multiple tabs scroll horizontally smoothly without shrinking or clipping.
   - Driver order cards (`#all-orders`): `.oca-ref` badges render cleanly between name and price without colliding with customer name or price; cards wrap cleanly on 320px.
   - Batch header cards: Avatar, batch label, date, total price, and chevron render with correct spacing and alignment.
   - Direct sale cards: Direct sale label and amount render without avatar or reference artifacts.
   - Expanded batch child orders remain visibly indented from their batch header.
2. **Viewport 390px (Standard Mobile Viewport)**:
   - All cards, pills, avatars, and badges retain balanced spacing and typography.
   - Expanded batch child orders remain visibly indented from their batch header.
   - Dark mode contrast and styles remain intact.
3. **No Regressions on Desktop / Tablet**:
   - Sidebar layouts and desktop sheets function without alteration.
4. **Administrator iPhone Verification**:
   - Final visual confirmation on actual device.

---

### Constraints
- No changes outside Admin and Driver files.
- Strictly CSS rules addition; no HTML or JavaScript changes in Phase A or B.
- Do not duplicate existing rules or break existing functionality from `9b64199`.
- Preserve the `mobile-layout-resilience` branch intact.
