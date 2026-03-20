# 📋 IMPLEMENTATION PLAN: Staff Dashboard Permission Lockdown

New staff members currently see all tabs and data on their first login because the permissions fallback defaults to `true`. This plan flips that to a "zero permissions by default" model and adds a clear UX flow for new staff.

---

## Proposed Changes

### 1. Default to Zero Permissions

#### [MODIFY] [staff-dashboard.js](file:///Users/toishko/Desktop/Websites%20/cecilia-bakery/staff-dashboard.js)

**Current behavior (Line 40):**
```js
: (profile.staff_permissions || {});
```
When `staff_permissions` is `null`, the empty object `{}` causes all checks like `!window.staffPermissions.can_view_orders` to evaluate as `undefined` → falsy → but the tabs still render because they aren't removed.

**Fix:** Replace the fallback with an explicit all-`false` default:
```js
: (profile.staff_permissions || {
    can_view_orders: false,
    can_advance_orders: false,
    can_cancel_orders: false,
    can_approve_partners: false,
    can_manage_users: false,
    can_view_analytics: false
});
```

---

### 2. "Awaiting Permissions" Empty State

#### [MODIFY] [staff-dashboard.js](file:///Users/toishko/Desktop/Websites%20/cecilia-bakery/staff-dashboard.js)

After computing `staffPermissions`, check if **every** permission is `false`. If so:
- Hide the sidebar navigation entirely.
- Replace the main content area with a friendly full-page message:

> **"Your staff account is active!"**
> An administrator hasn't assigned your permissions yet. Please contact your admin to get started.

This will also hide the Overview tab's data widgets so no metrics leak.

---

### 3. Hide Overview Widgets Based on Permissions

#### [MODIFY] [staff-dashboard.html](file:///Users/toishko/Desktop/Websites%20/cecilia-bakery/staff-dashboard.html)

Add `id` attributes to the overview widget cards for "Orders Today" and "Pending Approvals" so `staff-dashboard.js` can remove them if the user lacks `can_view_orders` or `can_approve_partners` permissions respectively.

#### [MODIFY] [staff-dashboard.js](file:///Users/toishko/Desktop/Websites%20/cecilia-bakery/staff-dashboard.js)

Extend the permission-gating block (Lines 47-53) to also hide:
- "Pending Approvals" widget if `!can_approve_partners`
- "Orders Today" widget if `!can_view_orders`
- "Active Users" widget if `!can_manage_users`

---

### 4. Welcome Banner with Staff Name

#### [MODIFY] [staff-dashboard.js](file:///Users/toishko/Desktop/Websites%20/cecilia-bakery/staff-dashboard.js)

- Fetch `full_name` alongside `role` and `staff_permissions` from the `profiles` query (already fetches `*` implicitly via `.single()`—just need to extract it).
- Update `page-title` text to `"Welcome, [Name]"` on load.

---

## Verification Plan

### Manual Verification (Browser Testing)

1. **Log in as the Staff account** (`toishkosmf+staff@gmail.com` / `St@ff!Bkry9$2026`) at `http://localhost:5173/staff-login.html`.
2. **Expect:** The "Awaiting Permissions" message should display. No sidebar tabs, no data widgets should be visible.
3. **Log in as Admin** (`toishkosmf+admin@gmail.com` / `Adm!n#Bkry9$2026`) in an incognito window at `http://localhost:5173/admin-login.html`.
4. **Go to User Directory**, find the staff user, and toggle on "View Orders" permission, click Save.
5. **Refresh the Staff browser tab.**
6. **Expect:** The "Awaiting Permissions" screen is gone. The sidebar now shows "Overview" and "Master Orders" only. The Overview widgets only show "Orders Today" (not Revenue, not Pending Approvals, not Active Users).
