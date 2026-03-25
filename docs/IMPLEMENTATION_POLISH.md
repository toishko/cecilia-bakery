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
- [ ] Text size A−/A+ control (saved, live preview)
- [ ] Language persistence (localStorage + Supabase)
- [ ] Theme persistence (localStorage + fallback)
- [ ] 5-attempt lockout with countdown
- [ ] Responsive testing: phone, tablet, desktop (both sides)
- [ ] Micro-animations (all listed above)
- [ ] Input focus/blur behavior verified
- [ ] `prefers-reduced-motion` respected
- [ ] Final end-to-end flow tested
- [ ] Dark mode contrast check
- [ ] EN/ES completeness check
