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
