# Phase 4 — Driver Management (Admin)

> Admin-side feature within `admin-dashboard.html` (Drivers section in sidebar).

---

## Driver List Page

### Table View
| Column | Notes |
|--------|-------|
| Name | Driver's display name |
| Code | Login code (e.g., `carlos01`) |
| Phone | Optional |
| Status | Active (green) / Disabled (gray) |
| Outstanding Balance | Sum of unpaid + partial remaining across all their orders |

- Sortable by any column
- Search bar to filter by name or code
- "**+ Add New Driver**" button at top

---

## Add New Driver

### Form Fields
- **Name** (required)
- **Code** (required, unique — show error if duplicate)
- **Phone** (optional)

### Price Table
- Shows **every product** in a table format
- Each product has a price input field (blank by default — must fill in each one)
- Grouped by section (Redondo, Plain, Tres Leche, etc.) for easy scanning
- No default prices — admin manually enters each price when creating a driver

### "Copy Prices From..." Shortcut
- Dropdown at top of price table: "Copy prices from: [Select Driver]"
- Lists all existing drivers
- When selected: pre-fills ALL price fields with that driver's prices
- Admin can then tweak individual prices as needed
- This is a one-time copy — changing the source driver's prices later does NOT affect this driver

### Save
- Validates: name required, code required + unique, all prices must be filled
- Creates `drivers` row + all `driver_prices` rows in one transaction
- Success message: "Driver added successfully"

---

## Edit Driver

### From Driver List
- Click on a driver row → opens their profile

### Editable Fields
- Name, code, phone
- **Enable/Disable toggle**:
  - Disabling: keeps ALL order history, balances, and price data intact
  - Disabled driver cannot log in (code entry shows "account disabled" message)
  - Can be re-enabled anytime

### Price Table (Editable)
- Same table as Add Driver, but pre-filled with current prices
- Admin can change any price
- **Price changes only affect FUTURE orders** — past `price_at_order` values in `driver_order_items` are frozen and never change
- "Copy Prices From..." shortcut available here too (overwrites current prices)
- Save button to apply changes

---

## Driver Profile Page

### Header
- Driver name, code, phone, status badge
- Outstanding balance: "$340.00" (prominent, color-coded)

### Balance Breakdown
- Shows all unpaid/partial orders contributing to the balance
- Each order: date, business name, order total, amount paid, remaining
- Quick links to view each order's detail

### Recent Orders
- Last 10 orders by this driver
- Clickable → goes to order detail in Incoming Orders view

### Price Table
- Current prices (view + edit)
- Same edit flow as above

---

## Checklist
- [ ] Driver list table (sortable, searchable)
- [ ] Add New Driver form (name, code, phone)
- [ ] Price table for new driver (all products, no defaults)
- [ ] "Copy Prices From..." dropdown
- [ ] Edit driver (name, code, phone, enable/disable)
- [ ] Edit driver prices (future orders only)
- [ ] Driver profile page (balance breakdown, recent orders)
- [ ] Validation (unique code, all prices filled)
- [ ] Browser verification
