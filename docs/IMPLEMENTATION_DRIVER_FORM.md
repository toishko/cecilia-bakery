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
- **Dropdown menu** (like the homepage mobile accordion) — tap to expand, pick a section, collapses
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
- **Date**: date picker, left BLANK by default (not pre-filled with today)
- **Time**: time picker, left BLANK by default
- **My Order #**: text input, placeholder "Your reference number (optional)"

### Quick Search
- Search bar at very top of product list area
- As driver types (e.g., "pina"), filters products across ALL sections to show only matches
- Clear button to reset filter
- Sections with no matching products are hidden

### Product Sections (Accordion Layout)
Each section has a header you tap to expand/collapse. Matches the layout from the original code:

**Redondo** (special 4-column layout per row):
| Product | Inside | No Tkt | Top | No Tkt |
|---------|--------|--------|-----|--------|
| Piña | +/- | +/- | +/- | +/- |
| Guava | +/- | +/- | +/- | +/- |
| Dulce De Leche | +/- | +/- | — | — |

**Plain** (standard 2-column: Qty, No Ticket):
| Product | Qty | No Ticket |
|---------|-----|-----------|
| Plain | +/- | +/- |
| Raisin | +/- | +/- |

**Tres Leche**: Tres Leche, Tres Hershey, Cuatro Leche, TL Strawberry, TL Piña

**Piezas**: Red Velvet, Carrot Cake, Cheesecake, Pudin, Piña, Guava, Chocoflan, Flan

**Piezas Frostin**: Guava, Piña, Dulce De Leche, Chocolate

**Happy Birthday** (two sub-sections):
- **BIG**: Piña, Guava, Dulce De Leche, Chocolate, Strawberry
- **SMALL**: Piña, Guava, Dulce De Leche, Chocolate, Strawberry

**Cuadrao**: Pudin, Plain, Raisin, Maiz

**Basos**: Tres Leche, Cuatro Leche, Hershey

### Section Badges
- Each section header shows count of products with values > 0
- Green when active, muted when zero

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
- [ ] Create `driver-order.html` with base structure
- [ ] Implement design system (CSS variables, fonts, glassmorphic cards, light/dark)
- [ ] **Screen 1**: Code entry with validation + lockout
- [ ] **Screen 2**: Dashboard with dropdown nav
- [ ] **Screen 2a**: Overview (balance, recent orders, new order button)
- [ ] **Screen 2b**: My Orders (history, payment badges, system order #)
- [ ] **Screen 2c**: Settings (language default, text size, theme, logout)
- [ ] **Screen 3**: Order form header fields (business, date, time, ref)
- [ ] **Screen 3a**: Quick search
- [ ] **Screen 3b**: All product sections with correct layouts
- [ ] **Screen 3c**: Input UX (focus/blur, +/-, highlights)
- [ ] **Screen 3d**: Multi-order (tabs, add/delete orders)
- [ ] **Screen 4**: Summary modal (left/right navigation, per-order display)
- [ ] **Screen 5**: Submit to Supabase + confirmation
- [ ] **Screen 5a**: 30-min edit window (edit + add new orders)
- [ ] EN/ES language toggle throughout
- [ ] Light/dark theme throughout
- [ ] Add to `vite.config.js`
- [ ] Full flow browser verification
