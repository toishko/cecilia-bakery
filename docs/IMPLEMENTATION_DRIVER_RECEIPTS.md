# Phase 5 — Driver Receipts & History

> Extends the driver dashboard (Screen 2 in `driver-order.html`).

---

## My Orders — Enhanced View

### What Drivers See

When admin hits "Confirm & Send", the order appears in the driver's "My Orders" section.

Each order card shows:
- **System order number** (e.g., #1047) — visible in history, NOT during ordering
- **Driver's own reference** (if entered, e.g., "My Order #3")
- **Business name** (if entered)
- **Date/time** (smart labels):
  - Blank date → "Date Ordered: Mar 24, 2026"
  - Filled date → "Pickup Date: Mar 28, 2026"
  - Blank time → "Time Ordered: 4:30 PM"
  - Filled time → "Pickup Time: 7:00 AM"
- **Item count**
- **Payment status badge**: 🔴 Not Paid / 🟢 Paid / 🟡 Partial ($X of $Y)

### Order Detail (Expanded)
- Tap a card → see all items with quantities
- If admin adjusted quantities: shows original + adjusted (e.g., "5 → 7 (+2 added at pickup)")
- **No prices shown** — drivers never see dollar amounts on individual items
- Notes (if any)

### Order Statuses
- **Pending**: submitted but not yet confirmed by admin. Driver can still edit (within 30-min window)
- **Sent**: admin has confirmed and sent. This is the "receipt" — locked, no longer editable

---

## Running Balance Banner

### Display
- Prominent banner at top of driver dashboard: **"Outstanding Balance: $340.00"**
- Shows on Overview page AND My Orders page
- Color: green ($0), yellow (some owed), red (significant amount)

### Calculation
- Sum of all orders where:
  - `payment_status = 'not_paid'` → add full `total_amount`
  - `payment_status = 'partial'` → add (`total_amount` - `payment_amount`)
  - `payment_status = 'paid'` → add $0

### Partial Payment Detail
- If driver taps the balance banner, shows breakdown:
  - Each unpaid/partial order: date, business, total, paid, remaining
  - Helps them see exactly what they owe and for which orders

---

## Notification on Confirmed Order

- When `driver_orders.status` changes to `'sent'`:
  - **Supabase Realtime** subscription detects the change
  - **Audio chime** plays (if notifications enabled in Settings)
  - Optional **browser notification** (if permission granted): "New order confirmed: #1047"
  - My Orders list updates automatically without page refresh

---

## Checklist
- [x] My Orders shows confirmed orders with all details
- [x] Order detail view (items, quantities, adjustments, smart date/time)
- [x] System order number visible in history only
- [x] Payment status badges on each order
- [x] Running balance banner (Overview + My Orders)
- [x] Balance breakdown on tap
- [x] Realtime notification when order is confirmed
- [x] Audio chime on confirmed order
- [x] End-to-end verification (submit → admin confirms → driver sees it + chime)
