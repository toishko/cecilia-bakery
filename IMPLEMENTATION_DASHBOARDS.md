# 📋 IMPLEMENTATION PLAN: ROLE-BASED DASHBOARDS & GLOBAL AUTH STATE

This document outlines the step-by-step execution plan for upgrading Cecilia Bakery's frontend to handle authenticated sessions and role-specific dashboards. Now that the four login portals (Admin, Partner, Driver, Customer) successfully authenticate and assign roles via Supabase, we need to build where those logins redirect.

**Current State**: All users can log in, but they redirect to unstyled or empty destination pages, and the public navigation bar does not reflect their authenticated status.

---

## 🎨 Design & Visual Continuity
*Goal: Ensure every dashboard feels like a natural extension of the Cecilia Bakery brand.*

- **Typography & Colors**: Use the existing `--beige`, `--gold`, `--brown`, `--blue`, and `--black` CSS variables. Stick to the `Outfit` and `Cormorant Garamond` font families.
- **Buttons & Inputs**: Reuse the `.btn-primary`, `.btn-submit`, and `.input-field` classes from `index.html` and `auth-theme.css`.
- **Global Controls**: Every dashboard **MUST** include the top-left 'Return to Bakery' link, and the top-right Language (EN/ES) and Dark Mode toggles.
- **Themes**: Dashboards must fully support the existing `data-theme="dark"` and `data-theme="light"` CSS structures.
- **Loading States (FOUC Prevention)**: Define standard UI skeletons or spinners to show while Supabase verifies the session, preventing a "Flash of Unauthenticated Content".
- **Code Reusability**: Centralize layout components (like the sidebar, header, and auth checks) into a shared `dashboard-layout.js` to keep the code DRY.

---

## 🎯 Phase 1: Global Authentication State & Navigation
*Goal: Ensure the public site (`index.html`, `menu.html`, etc.) knows when a user is logged in, replacing the "Log In" button with a User Profile / Sign Out menu.*

- [x] **1.1 Create `auth-state.js`**
  - Create a new global script that imports `supabase` from `supabase-client.js`.
  - Use `supabase.auth.onAuthStateChange()` to listen for logins/logouts.
- [x] **1.2 Update the Main Navigation Bar**
  - Add a hidden "User Dropdown" element to `index.html` and `menu.html`.
  - Write logic in `auth-state.js` to swap visibility between the "Log In" button and the User Dropdown.
- [x] **1.3 Implement Sign Out Functionality**
  - Attach a `supabase.auth.signOut()` click listener to the "Sign Out" button.
  - Redirect users back to the homepage upon logging out.
- [x] **1.4 Fetch & Display Basic Profile Data**
  - When logged in, fetch the user's `name` and `role` from the `profiles` table to visually display "Welcome back, [Name]".
- [x] **1.5 Database Security (Row Level Security - RLS)**
  - Ensure Supabase RLS policies are strictly enforced on `profiles`, `partner_details`, and `orders` tables so data cannot be accessed by circumventing client-side wrappers.

---

## 🛡️ Phase 2: The Command Center — `admin-dashboard.html`
*Goal: Build the secure interface for Admins to govern the bakery's users, partners, and master orders.*

- [x] **2.1 Protected Route Wrapper**
  - Create `admin-dashboard.js`. On load, verify the session's JWT has the `admin` role in the `profiles` table. Kick non-admins out to `index.html`.
- [x] **2.2 Layout & Sidebar**
  - Build a responsive Admin sidebar (Dashboard, Users, Partners, Orders).
- [x] **2.3 High-Level Metrics (Overview Widget)**
  - Add an "Overview" section at the top displaying key stats (e.g., "Pending Approvals", "Orders Today") before descending into detailed tables.
- [x] **2.4 Partner Approval Module**
  - Query the `partner_details` table for rows where `status = 'pending'`.
  - Build a table UI to list pending wholesale applications.
  - Add an "Approve" button that runs `UPDATE partner_details SET status = 'approved'`.
- [x] **2.5 Global User Directory**
  - Fetch all active users by querying the `profiles` table.
  - Render an interactive directory (filter by customer, partner, driver).
- [x] **2.6 Master Order Management**
  - Explicit UI module to oversee all active orders system-wide, allowing Admins to intervene or update order statuses manually if needed.

---

## 🤝 Phase 3: Wholesale Hub — `partner-dashboard.html`
*Goal: Build the secure interface for approved Partners to place bulk pastry orders.*

- [x] **3.1 Protected Route Wrapper**
  - Create `partner-dashboard.js`. Verify the session is a `partner` AND `partner_details.status = 'approved'`.
- [x] **3.2 Profile & Preferences Management**
  - Provide a section for partners to update their own contact information or delivery address in the `partner_details` table securely.
- [x] **3.3 Bulk Order Form UI**
  - Create an interface to select pastry flats/trays (e.g., Tres Leches 1/2 Sheet, Guava flat) with quantity stepping.
  - Calculate totals dynamically using JavaScript.
- [x] **3.4 Submit Order Logic**
  - Upon submission, insert a new record into the `orders` table (linked to the partner's `profile_id`).
- [x] **3.5 Order Status Tracker & Invoices**
  - Fetch the partner's previous orders from the `orders` table.
  - Render them visually with status badges (Pending, Baking, Out for Delivery, Completed).
  - Include an option to print orders or download simple receipts/invoices for accounting.

---

## 🚗 Phase 4: Delivery Dispatch — `bulk-orders.html` (Driver Dashboard)
*Goal: Build the task-list interface for drivers to process deliveries.*

- [x] **4.1 Protected Route Wrapper**
  - Create `driver-dashboard.js`. Verify the session role is `driver`. Kick others out.
- [x] **4.2 Active Dispatch List**
  - Fetch all records from the `orders` table where `delivery_status = 'pending'` or `'out_for_delivery'`.
  - Render each order as a "card" displaying the Partner Name, Address, and Order Details.
  - Format the Partner Address as a clickable external link (e.g., Google Maps `href`) for easy navigation.
- [x] **4.3 Status Update & Proof Controls**
  - Add buttons to each card: "Mark as Picked Up" and "Mark as Delivered".
  - Add an input field/modal for drivers to leave delivery notes (e.g., "Left at back door") when marking as delivered.
  - Wire buttons to run updates against the `orders` table.

---

## 👤 Phase 5: Customer Profile — `customer-dashboard.html`
*Goal: Build a simple space for regular Retail Customers to view their history and saved details.*

- [x] **5.1 Protected Route Wrapper**
  - Create `customer-dashboard.js`. Verify the session role is `customer`.
- [x] **5.2 Profile & Account Settings**
  - Display the customer's phone number, email, and joined date.
  - Include input fields for users to change their password or update profile information.
- [x] **5.3 Retail Active & Past Order Tracker**
  - Add a minimalist table fetching from the `orders` table for this specific user.
  - Clearly distinguish between active, currently-baking orders and historical, completed past orders.

---

### 📝 Next Steps Protocol
Whenever we are ready to begin, we will:
1. State clearly which **Phase** and **Item** we are starting (e.g., "Starting Phase 1.1").
2. Only write the code for that single phase.
3. Verify it works in the browser.
4. Move down the list linearly.
