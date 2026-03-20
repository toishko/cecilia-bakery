# 🛠️ Admin Dashboard Phase 2.5 — Staff System, Analytics & QoL

> **Status:** ✅ Completed
> **Depends on:** Phase 2 Admin Dashboard (complete)  
> **Affects:** `admin-dashboard.html`, `admin-dashboard.js`, `dashboard.css`, `auth-theme.css`, Supabase `profiles` table, new `staff-login.html`, new `staff-dashboard.html`

---

## 🅰️ Staff Role System — Configurable Permissions

### Database Changes (Supabase SQL)

- [x] **Add `staff` as a valid role** in the `profiles` table (currently supports: `customer`, `partner`, `driver`, `admin`)
- [x] **Create `staff_permissions` JSONB column** on the `profiles` table for staff users. Default:
  ```json
  {
    "can_view_orders": true,
    "can_advance_orders": true,
    "can_cancel_orders": false,
    "can_approve_partners": false,
    "can_manage_users": false,
    "can_view_analytics": false
  }
  ```
- [x] **RLS policies** — Staff can read their own permissions. Only admins can update any user's role or permissions.

### Admin Dashboard — Role Management UI

- [x] **User Directory: Role Dropdown** — Replace the static role badge in each user row with an interactive `<select>` dropdown (Admin only). Options: `customer`, `partner`, `driver`, `staff`. Selecting a new role triggers `UPDATE profiles SET role = '...' WHERE id = '...'`.
- [x] **Staff Permission Toggles** — When a user's role is set to `staff`, show an expandable panel of toggle switches beneath their row:
  - View Orders
  - Advance Orders
  - Cancel Orders
  - Approve Partners
  - Manage Users
  - View Analytics
- [x] **Save Permissions Button** — Writes the toggled permission flags as JSONB to the `staff_permissions` column.

### Staff Login & Dashboard

- [x] **[NEW] `staff-login.html`** — Dedicated login page for staff, styled identically to `admin-login.html` but branded "Staff Portal."
- [x] **[NEW] `staff-dashboard.html`** — A filtered clone of the admin dashboard. On load, fetches the staff user's `staff_permissions` JSONB and dynamically hides/shows tabs:
  - If `can_view_orders = false` → hide Master Orders tab
  - If `can_approve_partners = false` → hide Partner Approvals tab
  - If `can_manage_users = false` → hide User Directory tab
  - If `can_view_analytics = false` → hide Overview/Analytics tab
  - Settings tab always visible (for password changes only)
- [x] **[NEW] `staff-dashboard.js`** — Auth verification checks: `role === 'staff'`. Fetch permissions on load and conditionally render UI.

---

## 🅱️ Analytics & Insights — Owner Command Center

### Overview Tab Upgrade (`admin-dashboard.html`)

- [x] **Date Range Picker** — Add a date range input at the top of the Overview tab. All widgets and charts react to the selected range (Today / This Week / This Month / Custom).
- [x] **Enhanced Stat Cards** — Upgrade the 3 existing widgets to 4–6 cards:
  - Revenue Today / Selected Period
  - Total Orders (selected period)
  - Average Order Value
  - New Customers This Period
  - Orders by Status (mini pie/donut)
- [x] **Revenue Chart** — Line chart (Chart.js) showing daily revenue over the selected date range. X-axis = dates, Y-axis = dollars.
- [x] **Order Volume Chart** — Bar chart showing order count per day/week.
- [x] **Top-Selling Items** — Horizontal bar chart ranking items by total quantity sold. Parsed from the `items` JSONB column across all orders.

### JavaScript Logic (`admin-dashboard.js`)

- [x] **`fetchAnalyticsData(startDate, endDate)`** — Single Supabase query fetching orders within range. Aggregates revenue, counts, and item breakdowns client-side.
- [x] **`renderCharts(data)`** — Initialize/update Chart.js instances. Destroy old charts before re-rendering to prevent memory leaks.
- [x] **`updateStatCards(data)`** — Populate the enhanced widget values.
- [x] **Date picker event listener** — On change, re-fetch and re-render everything.

### Dependencies

- [x] **Add Chart.js** via CDN link in `admin-dashboard.html` `<head>`:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  ```

---

## 🅲️ Quality-of-Life Fixes

- [x] **Cancelled Filter Button** — Add a "Cancelled" filter pill to the Master Orders filter bar (alongside Pending, Baking, Out for Delivery, Delivered, All).
- [x] **Empty State Design** — When tables have zero rows, show a friendly message with an icon instead of a blank table body:
  - Orders: "No orders yet — they'll appear here in real-time."
  - Users: "No users match your search."
- [x] **Order Table: Show Item Count** — Add a small "(3 items)" label next to the customer name in the table row so admins can gauge order size without opening the modal.

---

## ✅ Verification Plan

### Automated

- [x] `node -c admin-dashboard.js` — Syntax check
- [x] `node -c staff-dashboard.js` — Syntax check
- [x] Vite dev server loads without errors

### Browser Testing

- [x] Admin can change a user's role from the User Directory
- [x] Setting a user to `staff` reveals permission toggles
- [x] Staff login page authenticates staff users only
- [x] Staff dashboard hides tabs based on saved permissions
- [x] Date range picker updates all charts and stat cards
- [x] Charts render correctly with real order data
- [x] Cancelled filter button filters orders correctly
- [x] Empty states display when tables have no data
- [x] All existing features (modal, advance, cancel, chime, search, export) still work

---

## 📦 Implementation Order

1. **Database first** — Add staff role + permissions column + RLS
2. **Admin UI** — Role dropdown + permission toggles in User Directory
3. **Staff pages** — `staff-login.html` + `staff-dashboard.html` + `staff-dashboard.js`
4. **Analytics** — Chart.js integration + date picker + stat cards + charts
5. **QoL fixes** — Cancelled filter, empty states, item count badge
6. **Full verification pass**
