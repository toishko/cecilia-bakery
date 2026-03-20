# 🛠️ Minor Fixes & Adjustments Tracker
*Goal: Maintain a running checklist of small bugs, UI patches, and edge-case fixes applied outside the main phased implementation plan.*

## Active Fixes
*(None right now)*

## Completed Fixes
- [x] **Admin QoL: Realtime Database Subscriptions**
  - **Issue**: Dashboard tables require a manual page reload to fetch new incoming partner applications and bakery orders.
  - **Action**: Use `supabase.channel` to subscribe to `INSERT` and `UPDATE` events on `orders` and `partner_details`, calling `fetchMasterOrders()` and `fetchPendingPartners()` on broadcast.
- [x] **Admin QoL: Audio & Browser Notifications**
  - **Issue**: Admins cannot stare at the dashboard all day looking for arriving orders.
  - **Action**: Add a "Ding!" audio clip and trigger `Notification.requestPermission()` to send a desktop alert whenever a Realtime insert occurs.
- [x] **Admin QoL: Quick Search & Export Data**
  - **Issue**: Users and Orders will rapidly grow and become unmanageable without search features, and export capabilities are required for bakery accounting.
  - **Action**: Insert a search field `<input>` and "Export CSV" buttons inside `admin-dashboard.html` that visually filter and download the cached Javascript arrays.
- [x] **Admin Session Persistence on Refresh**
  - **Issue**: Refreshing the admin dashboard sometimes kicks the user out to the login page due to a race condition where Supabase hasn't fully hydrated the local storage session before the route guard fires.
  - **Action**: Refactor the initial load check in `admin-dashboard.js` to wait for hydration or use `supabase.auth.getUser()`.
- [x] **Admin Idle Timeout (20 Mins)**
  - **Issue**: Admin sessions stay alive indefinitely if the tab is left open, creating a security risk.
  - **Action**: Implement a global JavaScript idle timer that resets on mouse movement/keypress, automatically triggering `supabase.auth.signOut()` after 20 minutes of inactivity.
- [x] **Profile Settings & Password Reset**
  - **Issue**: Admins cannot natively change their own passwords or account details from the dashboard.
  - **Action**: Add a "Settings" tab to the sidebar and implement a form calling `supabase.auth.updateUser({ password: 'new' })`.
- [x] **Mobile Sidebar Close Functionality**
  - **Issue**: Once the sidebar is open on mobile, it's difficult or impossible to close it because the toggle button may be covered, and there is no explicit 'Close' button or off-click overlay.
  - **Action**: Add an 'X' close button to the top-right of the sidebar for mobile views, and implement a dark background overlay that automatically closes the sidebar when clicked.
- [x] **Admin Dashboard Mobile Navigation**
  - **Issue**: The dashboard sidebar slides off-canvas below 900px, but there is no hamburger button in the DOM to reveal it. The "Command Center" becomes inaccessible on mobile.
  - **Action**: Add `<button class="hamburger-sidebar">` to the top header in `admin-dashboard.html` and write the JS toggle logic so mobile users can open and close the sidebar.

---
*Note: Always log small changes here before executing the code so we have a permanent record of all minor adjustments.*
