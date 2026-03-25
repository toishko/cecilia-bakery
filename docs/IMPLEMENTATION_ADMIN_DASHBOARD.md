# Phase 3 — Admin Dashboard

> File: `admin-dashboard.html`  
> Single-page app with sidebar/dropdown navigation.

---

## Auth & Login Screen

### Login Page
- Centered card with Cecilia Bakery logo
- Email + password fields (existing Supabase auth)
- "Login" button
- Error messages for wrong credentials
- Language toggle (EN/ES) in corner
- Light/dark theme applied

### After Login
- Role check: only admin/staff users can access
- Non-admin users → show "Access denied" message
- Login goes **directly to dashboard** — no landing page or menu
- Session persists via Supabase auth session
- "Log out" in Settings

---

## Navigation

### Desktop
- **Sidebar**: always visible on left side
- Sections with icons:
  - 📊 Overview (default)
  - 📥 Incoming Orders
  - 🚗 Drivers
  - 📦 Order History
  - ⚙️ Settings

### Mobile
- **Dropdown menu** (same accordion pattern as homepage mobile menu)
- Tap to expand → pick a section → collapses
- Current section name shown in the header

---

## Overview Page (Default Landing)

What admin sees when they open the dashboard:

- **Today's Orders**: count of orders submitted today
- **Today's Revenue**: total amount from today's orders
- **Outstanding Unpaid**: sum of all unpaid + partial remaining amounts across ALL drivers (clamped to $0.00 minimum per order, never negative)
- **Recent Orders**: last 5 orders (cards with driver name, business, time, payment badge)
- **Quick Action**: link to "View All Orders"

---

## Incoming Orders Page

### Live Feed
- Uses **Supabase Realtime** subscription on `driver_orders`
- New orders appear automatically without page refresh
- **Notification sound** (chime) when new order arrives

### Quick Filter Tabs
- **All** | **Today** | **Unpaid** | **Partial**
- Filters apply instantly

### Order Cards
- **Every order is its own separate card** — even if a driver submitted 3 orders in one batch, they show as 3 separate cards. Never merged.
- Each card shows:
  - Driver name
  - Business name (if provided)
  - Item count
  - Submission time
  - Payment badge: 🔴 Not Paid / 🟢 Paid / 🟡 Partial
  - Status badge: Pending / Confirmed / Sent
- Cards are clickable → expand to full Order Detail

### Order Detail (Expanded View)

#### Line Items
- Table showing: Product Name, Original Qty, Adjusted Qty (if changed), Effective Qty
- If admin adjusted: shows "(+2 added at pickup)" note next to item

#### Totals
- **Totals toggle: ON by default**
- Switch to turn off → hides all prices and grand total (packing slip view)
- Each order has its **own individual toggle** (not a global toggle for all orders)
- When totals are ON: shows unit price, line total (qty × price), grand total
- Prices come from `price_at_order` in `driver_order_items` (frozen at time of order)

#### Date/Time Display (Smart Labels)
- If `pickup_date` is null → "Date Ordered: Mar 24, 2026"
- If `pickup_date` is filled → "Pickup Date: Mar 28, 2026"
- If `pickup_time` is null → "Time Ordered: 4:30 PM"
- If `pickup_time` is filled → "Pickup Time: 7:00 AM"

#### System Order Number
- Visible to admin (e.g., "#1047")
- Visible to driver ONLY in their order history (not during ordering)
- Admin can use this to reference orders when talking to drivers

#### Driver's Own Reference
- Displayed if the driver entered one (e.g., "My Order #3")

#### Quick-Adjust Quantities
- When driver arrives and takes extra pieces, admin can adjust:
  - Each quantity field is **editable** — tap the number, change it
  - System automatically calculates the difference and logs it:
    - `adjusted_quantity` = new value
    - `adjustment_note` = "(+2 added at pickup)" or "(-1 removed)"
    - `adjusted_at` = timestamp
  - Total recalculates based on adjusted quantities
- Quick-adjust is available BEFORE confirming AND during the rest of the day after confirming

#### Payment Status (Per Order)
- Three buttons: **Not Paid** / **Paid** / **Partial**
- Each order has its **own** payment status — not a bulk status for the batch
- **Payment is ALWAYS editable** — no time limit, no lock. Admin can update payment days/weeks later.
- When "Partial" is selected:
  - Amount input appears: "Amount paid: $___"
  - Saves to `payment_amount` on `driver_orders`
  - Shows remaining: "Remaining: $75.00" (clamped to $0.00 minimum, never negative)
  - Amount is clamped to order total (can't enter more than owed)
- When "Paid" is selected:
  - `payment_amount` auto-set to `total_amount`
- Payment badges reflect in both admin view AND driver's dashboard

#### Confirm & Send Flow
1. Admin reviews the order (adjusts quantities if needed, sets payment status)
2. Admin clicks **"Confirm & Send"**
3. Order `status` changes from `'pending'` → `'sent'`
4. `confirmed_at` = now
5. `admin_editable_until` = end of the same day (23:59:59)
6. The confirmed/finalized order appears in the **driver's dashboard** under "My Orders"
7. Driver gets a notification chime

#### Admin Edit Window (End of Day)
- After hitting "Confirm & Send", admin can edit **quantities** for the rest of the day
- Can change quantities until end of day
- After midnight: quantities are locked. Shows "Quantities can no longer be edited (payment still can)"
- **Payment status is NEVER locked** — always editable regardless of time
- Visual countdown showing remaining edit time (e.g., "7h 10m")

---

## Order History Page

Separate from "Incoming Orders" — this is the full historical archive.

### Display
- Table/card list of ALL past orders (not just today)
- Paginated: **50 orders per page**, "Load More" or page numbers
- Default sort: newest first

### Filters & Search
- **Date range**: from/to date pickers
- **Driver filter**: dropdown to filter by specific driver
- **Business name**: text search
- **Payment status**: All / Not Paid / Paid / Partial
- **Search by order number**: type #1047 to find it instantly
- Filters can be combined

### Order Cards
- Same format as Incoming Orders cards
- Click → expand to full order detail (same detail view with totals toggle, etc.)
- Admin can still adjust payment status on historical orders (e.g., driver pays a week later)

### Data Stored for Future Analytics
- Every order, every line item, every price, every adjustment, every payment change
- This data will power the future Production Dashboard (daily totals, weekly trends, etc.)
- Nothing is ever deleted — disabled drivers' orders remain in history

---

## Settings Page (Admin)

- **Language**: EN/ES toggle. Saved to `localStorage`
- **Text size**: A−/A+ buttons. Scales root font-size. Saved to `localStorage`
- **Theme**: Light/Dark toggle. Saved to `localStorage`
- **Notification sounds**: On/Off toggle. Saved to `localStorage`
- **Log out** button

---

## Design

- Matches website theme (same CSS variables, fonts)
- Glassmorphic cards for order detail views
- Light/dark mode
- Responsive: sidebar on desktop, dropdown on mobile/tablet
- Clean data tables for order items
- Color-coded payment badges throughout

---

## Checklist
- [x] Create `admin-dashboard.html` with base structure
- [x] Admin login screen (email/password, role check)
- [x] Sidebar navigation (desktop) + dropdown (mobile)
- [x] Overview page (stats cards, recent orders)
- [x] Incoming Orders page (live feed via Realtime)
- [x] Quick filter tabs (All / Today / Unpaid / Partial)
- [x] Order cards (separate per order, never merged)
- [x] Order detail (expandable, all line items)
- [x] Totals toggle (ON default, per-order toggle)
- [x] Smart date/time labels
- [x] System order number display
- [x] Quick-adjust quantities (editable, auto-log adjustments)
- [x] Payment status buttons (Not Paid / Paid / Partial + amount)
- [x] Confirm & Send flow
- [x] End-of-day admin edit window with countdown
- [x] Notification sound on new order
- [x] Order History page (paginated, filterable, searchable)
- [x] Admin Settings page (language, text size, theme, notifications, logout)
- [x] EN/ES + Light/Dark theme
- [x] Add to `vite.config.js`
- [x] Browser verification

---

## Post-Implementation Tweaks

Changes made during verification testing:

1. **Bug fix**: `driver-order.js` used `delivery_date`/`delivery_time` but schema has `pickup_date`/`pickup_time` — fixed, was blocking all order submissions
2. **Edit window**: Changed from 30-min to **end of day** — admin can adjust quantities for the rest of the day after confirming
3. **Payment always editable**: Payment status buttons (Not Paid / Paid / Partial) are **never disabled** — admin can update payment at any time, even weeks later
4. **Negative remaining fix**: Outstanding Unpaid stat and partial remaining display now clamped to `$0.00` minimum — prevents confusing negative values when payment exceeds total
5. **Partial amount clamp**: Can't enter a payment amount higher than the order total (auto-clamped)
6. **Stat font fix**: Changed stat-value font from `Cormorant Garamond` to `Outfit` so numeral "1" doesn't look like capital "I"
7. **Admin user created**: `admin@ceciliabakery.com` / `CeciliaAdmin2026!` (role: admin in user_metadata)
