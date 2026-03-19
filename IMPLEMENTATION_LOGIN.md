# Split Portal Login Implementation Plan

This document outlines the step-by-step implementation plan for the Split Portal login approach for Cecilia Bakery. This setup separates the login experiences for **Customers**, **Wholesale Partners**, **Drivers**, and **Administrators** using **Supabase** as the backend authentication and database provider.

## Overview of the Portals

1.  **Customer Portal (`/login.html`)**: The standard login page for retail customers. Linked from the main navigation header.
2.  **Partner Portal (`/partner-login.html`)**: A dedicated page for Wholesale Partners. Linked from the footer.
3.  **Driver Portal (`/driver-login.html`)**: A dedicated page for delivery drivers to log in and manage bulk orders. Linked from the footer (or a private link).
4.  **Admin Portal (`/admin-login.html`)**: A hidden login page solely for bakery staff to manage menus, orders, roles, and user accounts. Not linked anywhere on the public-facing site.

---

## Phase 1: Planning and Setup (Completed)

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

## Phase 2: Building the Public UI (HTML & CSS)
*(Note: All login pages will use the centralized, premium dark-card layout designed for the Partner Portal, and all will include the English/Spanish and Light/Dark mode toggles in the top right.)*

- [ ] **Build Customer Login/Signup Page (`/login.html`)**
    - [ ] Add Input fields: Name, Email, Password, and Phone Number (Optional).
    - [ ] Implement the premium centralized card layout and top-right toggles.
- [ ] **Build Partner Portal Page (`/partner-login.html`)**
    - [ ] Add Input fields: Business Name, Contact Name, Email, Password, and Phone Number (Required).
    - [ ] Create an "Apply for Account" state vs "Log In" state.
    - [ ] Implement the premium centralized card layout and top-right toggles.
- [ ] **Build Driver Portal Page (`/driver-login.html`)**
    - [ ] Add Input fields: Name, Email, Password, and Phone Number (Required).
    - [ ] Change title to "Driver Login".
    - [ ] Implement the premium centralized card layout and top-right toggles.
- [ ] **Build Admin Login Page (`/admin-login.html`)**
    - [ ] Add Input fields: Email and Password only.
    - [ ] Change title to "Admin".
    - [ ] Replace the layout monogram with the actual bakery logo.
    - [ ] Implement the premium centralized card layout and top-right toggles.

---

## Phase 3: Implementing Authentication Logic (JavaScript)

- [ ] **Initialize Supabase**: Connect the Vite project to the Supabase backend using the `supabase-js` client.
- [ ] **Handle Customer Login & Signup**: Add javascript to authenticate the user, append the 'customer' role into the database profile, and redirect to the homepage.
- [ ] **Handle Partner Login & Signup**: Add javascript to authenticate the user, append the 'partner' role, store Business variables, and redirect to `/partner-dashboard.html`.
- [ ] **Handle Driver Login & Signup**: Add javascript to authenticate the user, append the 'driver' role, and redirect to `/bulk-orders.html`.
- [ ] **Handle Admin Login**: Add javascript to authenticate the existing admin user, verify the 'admin' role, and redirect to `/admin-dashboard.html`.

---

## Phase 4: Route Protection and Dashboards

- [ ] **Create the Partner Dashboard (`/partner-dashboard.html`)**
    - [ ] Build the UI to display past orders and profile details (No ordering logic yet).
    - [ ] Add JavaScript to verify the user has the 'partner' role or redirect to login.
- [ ] **Create the Driver Bulk Order Page (`/bulk-orders.html`)**
    - [ ] Build the UI for placing and managing bulk orders.
    - [ ] Add JavaScript to verify the user has the 'driver' role or redirect to login.
- [ ] **Create the Admin Dashboard (`/admin-dashboard.html`)**
    - [ ] Build the UI tabs: Permissions Management, Photo Uploader, and Product Editor.
    - [ ] Add JavaScript to verify the user has the 'admin' (or manager) role or forcefully redirect to the homepage.
- [ ] **Universal Auth State**: Add a listener to the main site navigation to check if a Customer is logged in, changing the "Log In" button to a "Log Out" or "My Account" toggle.

---

## Phase 5: Testing

- [ ] **Test Customer Flow**: Sign up, log in, redirect to homepage, verify auth state in navigation, log out.
- [ ] **Test Partner Flow**: Sign up with business details, log in, view partner dashboard, log out.
- [ ] **Test Driver Flow**: Sign up, log in, access bulk ordering, log out.
- [ ] **Test Admin Flow**: Log in as admin, access management dashboard, test permissions setting, log out.
- [ ] **Test Security Boundaries**: Verify roles cannot access each other's dashboards by manipulating URLs.
