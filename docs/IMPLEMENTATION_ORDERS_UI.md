# IMPLEMENTATION_ORDERS_UI — Driver Orders Redesign

> Redesigning the Admin Dashboard 'Driver Orders' tab to use a high-density avatar list and a modern slide-out sheet (receipt view) instead of cramped tables and inline accordions.

---

## Overview
The current Driver Orders UI is boxy, heavy, and uses old-school tables for line items. Clicking an order expands it inline, causing massive layout shifts and a claustrophobic user experience, especially on mobile. We are rebuilding this using modern SaaS patterns: sleek avatar-based list rows, glassmorphic pill filters, and a beautiful slide-out sheet that displays the order as a clean, table-free receipt.

## Checklist

### Phase 1: The "Airy" List View
- [ ] Replace `All | Today | Unpaid | Partial` buttons with the glassmorphic `insights-pill` UI component.
- [ ] Remove thick red borders and huge padding from `.order-card`. Replace with faint bottom borders.
- [ ] Redesign date dividers (`YESTERDAY`) to be elegant, small, sticky left-aligned text instead of heavy pills.
- [ ] Implement Avatar row layout:
  - Left: Circular avatar with driver's initials.
  - Middle: Driver Name (bold) + Order Time (muted).
  - Right: Total Price + Payment Status Pill (`Paid` green, `Pending` grey, `Partial` yellow).
- [ ] Update `admin-dashboard.js` (`renderDriverOrders`) and `admin-dashboard.css` to generate this structure.

### Phase 2: The "Slide-Out Receipt" Sheet
- [ ] Remove inline expansion logic from the orders list.
- [ ] Build a fixed slide-out sheet (`#order-detail-sheet`) that slides from the right on Desktop and up from the bottom on Mobile.
- [ ] Implement a dynamic, frosted-glass shrinking header for the sheet.
- [ ] Redesign line items (`detailItems`) to completely remove the `<table>`. Use a pure CSS flex layout (Product name left, price right, qty muted below product).

### Phase 3: The Returns & Credit Flow
- [ ] Remove the inline "Returns & Credit" accordion from the default order view.
- [ ] Add a clean "Process Return / Credit" action button at the bottom of the receipt.
- [ ] Clicking the button opens a dedicated sub-modal or overlay specifically for adjusting credit.

## Notes & Decisions
- To maintain consistency with the Insights tab, the avatars will use the same gradient logic.
- We will reuse the `slide-up-sheet` mechanics that were built for "Pending Collection" stats, as it provides native-feeling dismiss gestures.

