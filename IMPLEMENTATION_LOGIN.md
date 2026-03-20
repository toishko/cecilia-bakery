# Split Portal Login Implementation Plan

This document outlines the step-by-step implementation plan for the Split Portal login approach for Cecilia Bakery. This setup separates the login experiences for **Customers**, **Wholesale Partners**, **Drivers**, and **Administrators** using **Supabase** as the backend authentication and database provider.

## Overview of the Portals

1.  **Customer Portal (`/login.html`)**: The standard login page for retail customers. Linked from the main navigation header.
2.  **Partner Portal (`/partner-login.html`)**: A dedicated page for Wholesale Partners. Linked from the footer.
3.  **Driver Portal (`/driver-login.html`)**: A dedicated page for delivery drivers to log in and manage bulk orders. Linked from the footer (or a private link).
4.  **Admin Portal (`/admin-login.html`)**: A hidden login page solely for bakery staff to manage menus, orders, roles, and user accounts. Not linked anywhere on the public-facing site.

---

## Phase 0: Environment Security ✅ (Completed)

- [x] **Create `.env` file** in the project root: Stores the Supabase Project URL and Anon Key as environment variables. This file **never** gets committed to GitHub.
    - Variable names must be prefixed with `VITE_` so Vite can expose them to the browser safely.
    - `VITE_SUPABASE_URL=https://your-project.supabase.co`
    - `VITE_SUPABASE_ANON_KEY=your-anon-key-here`
- [x] **Create `.gitignore` file** in the project root: Ensures `.env` (and other sensitive/unnecessary files) are never pushed to GitHub.
    - Must include: `.env`, `.env.local`, `node_modules/`, `dist/`
- [x] **Verify `.env` is ignored**: Run `git status` and confirmed `.env` does not appear as a tracked or staged file.
- [x] **Removed `node_modules/` from Git tracking**: Ran `git rm -r --cached node_modules/` so previously tracked dependency files are de-indexed.
- [x] **`supabase-client.js` uses `import.meta.env`**: Reads keys from `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY` — never hardcoded strings.

---

## Phase 1: Planning and Setup ✅ (Completed)

- [x] **Define User Roles**: Four distinct roles identified: Customer, Partner, Driver, and Admin.
- [x] **Choose an Authentication Provider**: **Supabase** (Provides PostgreSQL Database + Auth + Role Management).
- [x] **Design the Forms (Registration Requirements)**:
    - **Customers**: Name, Email, Password, Phone Number (Optional).
    - **Partners**: Business Name, Contact Name, Email, Password, Phone Number (Required). 
    - **Drivers**: Name, Email, Password, Phone Number (Required).
    - **Admins**: No public registration form; accounts will be manually created in the Supabase dashboard for security.
- [x] **Determine the "Logged-In" Destinations**:
    - **Customers**: Redirects to the homepage (`/index.html`).
    - **Partners**: Redirects to a dashboard to view past orders and account details, but without ordering capabilities yet (`/partner-dashboard.html`).
    - **Drivers**: Redirects to a bulk order page where they can actively create/manage their orders (`/bulk-orders.html`).
    - **Admins**: Redirects to a management page to set manager permissions, update product photos, and add/edit products (`/admin-dashboard.html`).

---

## Phase 2: Building the Public UI (HTML & CSS) ✅ (Completed)
*(Note: All login pages will use the centralized, premium dark-card layout designed for the Partner Portal, and all will include the English/Spanish and Light/Dark mode toggles in the top right.)*

- [x] **Build Customer Login/Signup Page (`/login.html`)**
    - [x] Add Input fields: Name, Email, Password, and Phone Number (Optional).
    - [x] Implement the premium centralized card layout and top-right toggles.
- [x] **Build Partner Portal Page (`/partner-login.html`)**
    - [x] Add Input fields: Business Name, Contact Name, Email, Password, and Phone Number (Required).
    - [x] Create an "Apply for Account" state vs "Log In" state.
    - [x] Implement the premium centralized card layout and top-right toggles.
- [x] **Build Driver Portal Page (`/driver-login.html`)**
    - [x] Add Input fields: Name, Email, Password, and Phone Number (Required).
    - [x] Change title to "Driver Login".
    - [x] Implement the premium centralized card layout and top-right toggles.
- [x] **Build Admin Login Page (`/admin-login.html`)**
    - [x] Add Input fields: Email and Password only.
    - [x] Change title to "Admin".
    - [x] Replace the layout monogram with the actual bakery logo.
    - [x] Implement the premium centralized card layout and top-right toggles.

---

## Phase 3a: Database Schema Setup ✅ (Completed)

- [x] **Create the `profiles` table**: Stores every user's role and shared identity info. Links to Supabase's built-in `auth.users` table via `id` (UUID).
    - Columns: `id` (uuid, PK, FK → auth.users), `role` (text: `'customer'`, `'partner'`, `'driver'`, `'admin'`), `full_name` (text), `phone` (text), `created_at` (timestamptz).
- [x] **Create the `partner_details` table**: Stores wholesale-specific data for partner accounts.
    - Columns: `id` (uuid, PK, FK → profiles), `business_name` (text), `contact_name` (text), `status` (text: `'pending'`, `'approved'`, `'rejected'`), `applied_at` (timestamptz).
- [x] **Create the `orders` table** *(stub for future use)*: A placeholder table for tracking customer and driver orders.
    - Columns: `id` (uuid, PK), `user_id` (uuid, FK → profiles), `role` (text), `status` (text), `created_at` (timestamptz).
- [x] **Enable Row Level Security (RLS)** on all tables so that users can only read and write their own rows.
- [x] **Create RLS Policies**:
    - `profiles`: Users can SELECT, INSERT, and UPDATE their own row (`auth.uid() = id`).
    - `partner_details`: Partners can SELECT their own row; INSERT allowed on signup.
    - `orders`: Users can only SELECT their own orders.
- [x] **Create a `handle_new_user` trigger function**: `on_auth_user_created` is live — auto-inserts a blank profile row on every new signup.
- [x] **Manually create the Admin account** in the Supabase Dashboard → Authentication → Users (email + password). SQL UPDATE set `role` to `'admin'` in `profiles` table. ✅ Verified via browser test — admin login works.

> 📝 **Future notes from schema review:**
> - The `orders.role` column mirrors `profiles.role` — consider dropping it later and joining to `profiles` directly to avoid data duplication.
> - Admin-level RLS policies (so admins can read/manage all records) will be needed in Phase 4 when the Admin Dashboard is built — will use a custom JWT claim check.

---

## Phase 3b: Implementing Authentication Logic (JavaScript) ✅ (Completed)

- [x] **Create `supabase-client.js`**: A single shared module that initializes the Supabase client with the Project URL and Anon Key. All other auth scripts import from this one file.
- [x] **Handle Customer Login & Signup (`customer-auth.js`)**:
    - [x] On signup: call `supabase.auth.signUp()`, then upsert `role: 'customer'` and `full_name` + optional `phone` into `profiles`.
    - [x] On login: call `supabase.auth.signInWithPassword()`, verify role is `'customer'`, redirect to `index.html`.
    - [x] Display inline error/success feedback messages on the form (no page reloads).
    - [x] Link `customer-auth.js` into `login.html`.
- [x] **Handle Partner Login & Signup (`partner-auth.js`)**:
    - [x] On signup ("Apply"): call `supabase.auth.signUp()`, upsert `role: 'partner'` into `profiles`, insert a `partner_details` row with `business_name`, `contact_name`, `phone`, and `status: 'pending'`.
    - [x] On login: call `supabase.auth.signInWithPassword()`, verify role is `'partner'`, redirect to `partner-dashboard.html`.
    - [x] Display inline error/success feedback messages on the form.
    - [x] Link `partner-auth.js` into `partner-login.html`.
- [x] **Handle Driver Login & Signup (`driver-auth.js`)**:
    - [x] On signup: call `supabase.auth.signUp()`, upsert `role: 'driver'` and `full_name` + required `phone` into `profiles`.
    - [x] On login: call `supabase.auth.signInWithPassword()`, verify role is `'driver'`, redirect to `bulk-orders.html`.
    - [x] Display inline error/success feedback messages on the form.
    - [x] Link `driver-auth.js` into `driver-login.html`.
- [x] **Handle Admin Login (`admin-auth.js`)**:
    - [x] On login: call `supabase.auth.signInWithPassword()`, fetch the user's profile, verify `role === 'admin'` — if not, immediately sign out and show an "Access Denied" error.
    - [x] On success: redirect to `admin-dashboard.html`.
    - [x] Display inline error/success feedback messages on the form.
    - [x] Link `admin-auth.js` into `admin-login.html`.

---

## Phase 4: Route Protection and Dashboards ✅ (Completed)

- [x] **Create the Partner Dashboard (`/partner-dashboard.html`)**
    - [x] Build the UI to display past orders and profile details (+ bulk ordering).
    - [x] Add JavaScript to verify the user has the 'partner' role or redirect to login.
- [x] **Create the Driver Bulk Order Page (`/bulk-orders.html`)**
    - [x] Build the UI for placing and managing bulk orders.
    - [x] Add JavaScript to verify the user has the 'driver' role or redirect to login.
- [x] **Create the Admin Dashboard (`/admin-dashboard.html`)**
    - [x] Build the UI tabs: Permissions Management, User Directory, Orders, Partner Approvals, Driver Management, and Analytics.
    - [x] Add JavaScript to verify the user has the 'admin' (or manager) role or forcefully redirect to the homepage.
- [x] **Universal Auth State**: `auth-state.js` listens for auth changes, toggles "Log In" button to greeting/sign-out. Active on `index.html` and `menu.html`.

---

## Phase 5: Testing ✅ (Completed — 2026-03-20)

- [x] **Test Customer Flow**: Log in → redirected to homepage with greeting `hi, Sarah Customer`. Auth state verified in navigation.
- [x] **Test Partner Flow**: Log in → redirected to `partner-dashboard.html`. Dashboard loaded with 3 orders shown.
- [x] **Test Driver Flow**: Log in → redirected to `driver-dashboard.html`. Product catalog and order management visible.
- [x] **Test Admin Flow**: Log in → redirected to `admin-dashboard.html`. Dashboard overview, pending approvals, and user directory functional.
- [x] **Test Security Boundaries**: Customer credentials on admin portal → "Access Denied. This portal is restricted to administrators." User signed out automatically.

> 🐛 **Bugs found and fixed during testing:**
> - `partner-dashboard.js` queried `partner_details.profile_id` — should be `.id` (FK column). Fixed.
> - `auth-state.js` selected `name` from profiles — should be `full_name`. Fixed.
> - `customer-auth.js` did not verify role on login (all other portals did). Added role verification.
