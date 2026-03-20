# Auth Drawer & Hamburger Menu Implementation Plan

## Problem Definition
When the mobile drawer is triggered on any of the authentication portals, it rolls down completely covering the top header. This creates a visually jarring "empty space" across the top, and traps the hamburger navigation icon behind the drawer. Without the hamburger icon, users have no clear button to click to collapse the drawer.

## Root Cause Analysis
1. In `auth-theme.css`, the `.top-controls` element (which acts as the header storing the Return to Bakery link, language toggle, theme toggle, and hamburger button) has its layer priority set to `z-index: 100`.
2. The `.mobile-drawer` class has its layer priority set much higher at `z-index: 500`.
3. As a result, the drawer forces itself over the header. The large 80px space at the top of the drawer is actually an intentional placeholder designed to frame the transparent header—but because the header is trapped behind it, it just looks like empty white space. 
4. The storefront (`index.html` and `menu.html`) features a header with `z-index: 1000`, proving that headers are designed to sit gracefully on top of open drawers across the site.

## Proposed Resolution Steps
- [x] **1. Elevate Header Layer Priority**
  - [x] Target the `auth-theme.css` file.
  - [x] Locate the `.top-controls` class.
  - [x] Modify the `z-index` property from `100` to `501` to ensure it sits above the `.mobile-drawer` (z-index 500).
- [x] **2. Verify Consistency Across Templates**
  - [x] Refresh `login.html` to confirm the hamburger animates to an "X" above the drawer.
  - [x] Check `admin-login.html`, `driver-login.html`, and `partner-login.html` to ensure the styling successfully cascades.

## Risk & Safety Assessment
- **Will this break anything?** No. 
- **Does it enforce consistency?** Yes. Bringing this layer forward will mirror the exact behavior on `index.html` and `menu.html`. The huge empty space will be perfectly filled by the transparent header, and the hamburger menu will now animate into a beautiful "X" closure icon that users can click to dismiss the drawer exactly where they opened it.
- **Is it scalable?** Yes. Since all 4 login pages point back to `auth-theme.css`, applying this single adjustment will cascade perfectly to `login.html`, `partner-login.html`, `driver-login.html`, and `admin-login.html` all at the same time.
