# 📋 IMPLEMENTATION PLAN: ORDER DETAIL MODAL

*Goal: Replace tiny inline item lists in the Master Orders table with a premium, full-screen modal overlay that displays complete order details at a glanceable size.*

---

## 🏗️ HTML Structure (`admin-dashboard.html`)

- [x] **Add modal container** at bottom of `<body>` (dark backdrop `.modal-overlay` + centered `.modal-card`)
- [x] **Modal header** — Order ID, date, close (X) button
- [x] **Modal body** — Customer/Partner name + role badge, full-size itemized table (Item | Qty | Price | Line Total), bold Order Total row
- [x] **Delivery progress bar** — Visual 4-step indicator (Pending → Baking → Out for Delivery → Delivered)
- [x] **Modal footer** — "Advance Status" button + "Print Receipt" button
- [x] **Update order table rows** — Remove inline `<ul>` items, replace with compact "View" + "Advance" buttons

---

## 🎨 Styling (`dashboard.css`)

- [x] **`.modal-overlay-bg`** — Fixed full-screen backdrop, `rgba(0,0,0,0.6)`, `backdrop-filter: blur(4px)`, fade-in transition
- [x] **`.modal-card`** — Centered card, `var(--bg-card)`, `border-radius: 16px`, `max-width: 600px`, slide-up animation
- [x] **`.order-progress-bar`** — Horizontal step indicator with active-stage highlighting
- [x] **`.modal-items-table`** — Clean full-width receipt table
- [x] **`@media print`** — Hide everything except modal content for clean receipt printing
- [x] **Mobile responsive** — Modal max-width bounded natively

---

## ⚙️ JavaScript Logic (`admin-dashboard.js`)

- [x] **`openOrderModal(orderId)`** — Lookup order from `allOrdersCache`, populate modal with details, calculate line totals + grand total, render progress bar
- [x] **`closeOrderModal()`** — Hide modal with fade-out, clicking backdrop also closes
- [x] **`printOrder()`** — Trigger `window.print()` (CSS `@media print` handles the rest)
- [x] **Update `renderOrdersTable()`** — Swap inline items for "View" + "Advance" buttons
- [x] **Wire modal "Advance Status"** — Call existing `updateOrderStatus()`, then refresh modal content

---

## ✅ Verification

- [ ] Log in as Admin in Chrome → Master Orders tab
- [ ] Table rows show "View" + "Advance" buttons (no tiny inline items)
- [ ] Click "View" → modal slides up with full order details, itemized table, total, progress bar
- [ ] Click X or backdrop → modal closes smoothly
- [ ] Click "Advance Status" inside modal → status updates, progress bar moves forward
- [ ] Click "Print Receipt" → browser print dialog with only order details visible
- [ ] Resize to mobile (375px) → modal is responsive and scrollable
