# Cecilia Bakery — Master Driver System

> **This is your master reference.** Follow this checklist top to bottom.  
> Tell me which phase to work on by referencing the phase file name.  
> `[ ]` not started · `[/]` in progress · `[x]` complete  

---

## Phase 1 — Supabase Schema → [IMPLEMENTATION_SUPABASE.md](docs/IMPLEMENTATION_SUPABASE.md)
- [x] `drivers` table
- [x] `driver_prices` table
- [x] `driver_orders` table
- [x] `driver_order_items` table
- [x] RLS policies
- [x] Realtime enabled
- [x] Test data inserted
- [x] Verified

## Phase 2 — Driver Order Form → [IMPLEMENTATION_DRIVER_FORM.md](docs/IMPLEMENTATION_DRIVER_FORM.md)
- [ ] Code entry screen (logo, input, validation, lockout)
- [ ] Driver dashboard (dropdown nav, overview, my orders, settings)
- [ ] Order form (all product sections, +/- inputs, quick search)
- [ ] Multi-order support (tabs, add/delete orders)
- [ ] Summary modal (left/right navigation)
- [ ] Submit + 30-min edit window (edit + add new orders)
- [ ] EN/ES + light/dark theme
- [ ] Verified

## Phase 3 — Admin Dashboard → [IMPLEMENTATION_ADMIN_DASHBOARD.md](docs/IMPLEMENTATION_ADMIN_DASHBOARD.md)
- [ ] Admin login screen (email/password, role check)
- [ ] Sidebar/dropdown nav
- [ ] Overview page (today's stats)
- [ ] Incoming orders (live feed, filters: All/Today/Unpaid/Partial)
- [ ] Order detail (per-order totals toggle, smart date/time labels)
- [ ] Quick-adjust quantities at pickup
- [ ] Payment status per order (Not Paid / Paid / Partial + amount)
- [ ] Confirm & Send → pushes to driver dashboard
- [ ] 30-min admin edit window
- [ ] Order History page (paginated, filterable, searchable)
- [ ] Admin Settings (language, text size, theme, notifications, logout)
- [ ] Verified

## Phase 4 — Driver Management → [IMPLEMENTATION_DRIVER_MANAGEMENT.md](docs/IMPLEMENTATION_DRIVER_MANAGEMENT.md)
- [ ] Driver list (sortable, searchable, balance column)
- [ ] Add driver (name, code, phone + full price table)
- [ ] Copy prices from another driver
- [ ] Edit/disable driver (keeps history)
- [ ] Driver profile (balance breakdown, orders, price table)
- [ ] Price changes only affect future orders
- [ ] Verified

## Phase 5 — Driver Receipts & History → [IMPLEMENTATION_DRIVER_RECEIPTS.md](docs/IMPLEMENTATION_DRIVER_RECEIPTS.md)
- [ ] My Orders shows confirmed orders from admin
- [ ] Order detail (items, adjustments, payment badge, system order #)
- [ ] Running balance banner (both overview + my orders)
- [ ] Notification chime on confirmed order
- [ ] End-to-end verified

## Phase 6 — Export, Print & Share → [IMPLEMENTATION_EXPORT_PRINT.md](docs/IMPLEMENTATION_EXPORT_PRINT.md)
- [ ] Print with totals
- [ ] Print without totals (packing slip)
- [ ] PDF download
- [ ] WhatsApp share
- [ ] Verified

## Phase 7 — PWA → [IMPLEMENTATION_PWA.md](docs/IMPLEMENTATION_PWA.md)
- [ ] manifest.json + service worker
- [ ] Driver + Admin PWA start URLs
- [ ] App icons (192px, 512px)
- [ ] Add to Home Screen verified

## Phase 8 — Notifications → [IMPLEMENTATION_NOTIFICATIONS.md](docs/IMPLEMENTATION_NOTIFICATIONS.md)
- [ ] Admin chime (new order)
- [ ] Driver chime (confirmed order)
- [ ] Browser Notification API
- [ ] Mute/unmute toggle
- [ ] Verified

## Phase 9 — Polish & Accessibility → [IMPLEMENTATION_POLISH.md](docs/IMPLEMENTATION_POLISH.md)
- [ ] Text size A−/A+
- [ ] Language + theme persistence
- [ ] 5-attempt lockout
- [ ] Responsive testing
- [ ] Micro-animations
- [ ] Final end-to-end verification
