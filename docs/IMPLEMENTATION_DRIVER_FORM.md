# Phase 2 — Driver Order Form

> File: `driver-order.html`  
> Single-page app with multiple screens managed via JavaScript.

---

## Design Requirements

- **Match website theme**: Same CSS variables (`--red`, `--bg`, `--bg-card`, `--tx`, etc.)
- **Fonts**: Cormorant Garamond for headings, Outfit for body text
- **Light/dark mode**: Full support using `[data-theme]` attribute
- **Glassmorphic cards**: `backdrop-filter: blur(12px)`, semi-transparent backgrounds, soft shadows
- **Mobile-first**: Designed for phone use. Big tap targets (44px minimum)
- **No prices shown anywhere** — drivers only see product names and quantities
- **Keep it simple**: Easy for drivers, not cluttered. Modern but not overdone
- **In-app notifications**: Custom glassmorphic toast system replaces all browser `alert()` calls

---

## Screen 1: Code Entry

### Layout
- Centered card with Cecilia Bakery logo at top
- Single input field: "Enter your code"
- "Enter" button below
- Language toggle (EN/ES) in corner

### Behavior
- On submit: query `drivers` table for matching code (case-insensitive)
- If found + `is_active = true` → save driver session, go to Dashboard
- If found + `is_active = false` → show "This account has been disabled. Contact the bakery."
- If not found → show "Code not recognized. Try again or contact the bakery."
- **5-attempt lockout**: after 5 wrong codes, disable input for 5 minutes. Show countdown timer.
- Login goes **directly to dashboard** — driver never sees the landing page or menu

### Session
- Store driver ID in `localStorage` so they don't have to re-enter code every time
- "Log out" option in Settings

---

## Screen 2: Driver Dashboard

### Navigation
- **Hamburger menu** with animated 3-bar → X transform (matches home page pattern)
- Sticky header + nav dropdown — accessible from anywhere on the page while scrolling
- Menu auto-closes and icon resets when switching sections
- Sections:
  - 📋 **Overview** (default landing)
  - ➕ **New Order**
  - 📦 **My Orders**
  - ⚙️ **Settings**

### Overview Page
- **Driver name** displayed at top ("Welcome, Carlos")
- **Outstanding Balance banner**: "Balance: $340.00" — sum of all unpaid + remaining partial amounts
  - Color-coded: green if $0, yellow if partial exists, red if significant amount owed
- **Recent orders** (last 5): each showing business name, date, item count, payment badge
- **Quick "New Order" button** — large, prominent

### My Orders Page
- Full order history, paginated (50 per page)
- Each order card shows:
  - **System order number** (e.g., #1047) — visible HERE but not during ordering
  - **Driver's own reference** (if they entered one)
  - Business name
  - Date/time (smart label — "Date Ordered" vs "Pickup Date")
  - Item count
  - Payment badge: 🔴 Not Paid / 🟢 Paid / 🟡 Partial ($X of $Y)
- Tap to expand → see all items + quantities
- Only shows orders with `status = 'sent'` (confirmed by admin) + pending orders

### Settings Page
- **Language**: EN/ES toggle. Selected language is saved as DEFAULT (to `localStorage` AND `drivers.language` in Supabase)
- **Text size**: A−/A+ buttons. Scales root font-size. Saved to localStorage
- **Theme**: Light/Dark toggle. Saved to localStorage
- **Log out** button

---

## Screen 3: Order Form

### Header Fields (top of form, before product sections)
All optional:
- **Business / Delivery To**: text input, placeholder "Where is this order going?"
- **Date**: date picker, **defaults to today's date**
- **Time**: custom scrollable wheel-style time picker (iOS-style modal with Hour 1–12, Minute 00–55 by 5, AM/PM columns, scroll-snap selection, Confirm/Cancel buttons)
- **My Order #**: text input, placeholder "Your reference number (optional)"

### Quick Search
- Search bar at very top of product list area
- As driver types (e.g., "pina"), filters products across ALL sections to show only matches
- Clear button to reset filter
- Sections with no matching products are hidden

### Product Sections (Accordion Layout)
Each section has a header you tap to expand/collapse.

**Category headers** have a red left accent border and bold 1rem font to visually distinguish them from product rows. No badge counts — drivers review their order in the summary before submitting.

**All category names are bilingual** (EN/ES):
| English | Spanish |
|---------|---------|
| Round | Redondo |
| Plain | Plain |
| Tres Leche | Tres Leche |
| Pieces | Piezas |
| Frosted Pieces | Piezas Frostin |
| Happy Birthday — BIG | Feliz Cumpleaños — GRANDE |
| Happy Birthday — SMALL | Feliz Cumpleaños — PEQUEÑO |
| Square | Cuadrao |
| Cups | Basos |

**Round** — uses standard row layout (same as all other sections). Products with both Inside and Top are split into separate sub-rows:
| Product Row | Qty | No Tkt |
|-------------|-----|--------|
| Piña — Inside | +/- | +/- |
| Piña — Top | +/- | +/- |
| Guava — Inside | +/- | +/- |
| Guava — Top | +/- | +/- |
| Dulce De Leche | +/- | +/- |

**All other sections** — standard 2-column layout (Qty, No Ticket) with full product names (no abbreviations).

### Input UX
- **+/- buttons**: tap to increment/decrement (min 0)
- **Focus behavior**: when driver taps/clicks into the number field, clear the "0" so they type on an empty field
- **Blur behavior**: if field is empty when they leave, restore to "0"
- Highlight rows that have a value > 0 (subtle green background)

### Multi-Order Support
- **"+ Add Another Order" button** at the bottom of the form (above footer)
- Creates a new blank order form. Each order gets a tab: `Order #1`, `Order #2`, `Order #3`...
- Each order has its own: business name, date, time, driver ref, notes, product quantities
- Tab bar at top shows all orders. Tap to switch between them
- Can delete an order (with confirmation) as long as there are at least 1 left

### Footer Bar
- Fixed at bottom
- Shows: "Items: **24**" (total across current order only)
- "Continue" button → opens Summary Modal

---

## Screen 4: Summary Modal

### Layout
- Slides up from bottom (like the original code)
- Handle bar at top for visual affordance

### Navigation
- **Left/right arrows** (or swipe) to navigate between orders
- Header shows: "Order 1 of 3" with arrows
- Each order displayed independently — never merged

### Content Per Order
- Business name (if entered)
- Date/time (if entered)
- Driver reference (if entered)
- All items grouped by section, showing product name + quantity
- "No Ticket" items labeled with red tag (same as original code)
- Notes textarea per order

### Actions
- **"Go Back"** button → close modal, return to form
- **"Submit All Orders"** button → saves everything

---

## Screen 5: Submit & Confirmation

### On Submit
1. Generate a `batch_id` (UUID) for this submission
2. For each order in the batch:
   - Create a `driver_orders` row with `batch_index` (1, 2, 3...)
   - For each product with quantity > 0, create a `driver_order_items` row
   - `price_at_order` = driver's current price from `driver_prices` table (snapshot, frozen forever)
   - Calculate `total_amount` from items × prices
   - Set `editable_until` = now + 30 minutes
3. Show success screen

### Confirmation Screen
- Checkmark animation
- "Orders submitted successfully!"
- Note: "You can edit your orders for the next 30 minutes"
- "Back to Dashboard" button

### 30-Minute Edit Window
- While `editable_until > now()`:
  - Driver can go to My Orders → tap a pending order → edit quantities
  - Driver can add NEW orders to the same batch via "+ Add Another Order"
  - Driver can delete orders from the batch (with confirmation)
- After 30 minutes: orders lock. Show "This order can no longer be edited"

---

## Checklist
- [x] Create `driver-order.html` with base structure
- [x] Implement design system (CSS variables, fonts, glassmorphic cards, light/dark)
- [x] **Screen 1**: Code entry with validation + lockout
- [x] **Screen 2**: Dashboard with dropdown nav + animated hamburger
- [x] **Screen 2a**: Overview (balance, recent orders, new order button)
- [x] **Screen 2b**: My Orders (history, payment badges, system order #)
- [x] **Screen 2c**: Settings (language default, text size, theme, logout)
- [x] **Screen 3**: Order form header fields (business, date defaults to today, custom time picker, ref)
- [x] **Screen 3a**: Quick search
- [x] **Screen 3b**: All product sections with consistent standard row layouts + bilingual names
- [x] **Screen 3c**: Input UX (focus/blur, +/-, highlights)
- [x] **Screen 3d**: Multi-order (tabs, add/delete orders)
- [x] **Screen 4**: Summary modal (left/right navigation, per-order display)
- [x] **Screen 5**: Submit to Supabase + confirmation
- [x] **Screen 5a**: 30-min edit window (edit + add new orders)
- [x] EN/ES language toggle throughout (category names, labels, UI text)
- [x] Light/dark theme throughout
- [x] Add to `vite.config.js`
- [x] Full flow browser verification
- [x] Custom scrollable time picker (wheel-style modal)
- [x] In-app toast notifications (replaced browser alerts)
- [x] Full product names (no abbreviations)
- [x] Category header visual distinction (red accent border, no badge counts)
- [x] Sticky hamburger nav with animated transform
