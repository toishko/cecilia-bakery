# Login Routing Implementation Plan (Option 2: Hidden Footer Approach)

## Overview
This plan outlines the steps completely rerouting how users access the newly styled authentication pages from the main Cecilia Bakery website. The primary goal is to ensure the Customer Login remains prominent and friction-free via the main navigation, while restricting access to internal business tools (Partner, Driver, Admin) to a highly subtle, clean Footer section. 

This approach minimizes clutter, eliminates customer confusion, and secures backend portals from obvious visibility.

---

## 1. Inspect Main Website Navigation
- [x] Locate the main `index.html` navigation (`<nav>`).
- [x] Find the existing "Sign In" or "Login" button within the sticky header.
- [x] Confirm or update its `href` link to point strictly to `login.html` (the Customer Portal).
- [x] Ensure language switching consistency if the navigation is localized (English/Spanish).

## 2. Introduce the Footer "Portals" Block
- [x] Locate the global footer element situated at the bottom of the `index.html` (and other main public pages if shared).
- [x] Create a new structural CSS grid/column block inside the footer titled **"Portals"** or **"For the Team"** depending on the current structure.
- [x] Add the following text links with elegant minimal styling (e.g. muted text, clean hover states):
    - [x] Partner Portal (`href="partner-login.html"`)
    - [x] Driver Access (`href="driver-login.html"`)
    - *Note: Admin Access must remain completely unlinked and hidden from the website (accessed only via direct URL `admin-login.html`).*
- [x] Add `data-en` and `data-es` attributes for responsive translation mirroring the rest of the site logic.

## 3. Apply Premium Footer Styling updates
- [x] Hook into the main website CSS (either a `styles.css` or embedded styles).
- [x] Add transition properties for hover states (e.g. `color: var(--red)` on hover) to ensure these links feel distinctly "Cecilia Bakery".
- [x] Ensure mobile layout logic gracefully stacks this footer section for small devices.

## 4. Review and Finalize Links
- [x] Check `login.html`, `partner-login.html`, `driver-login.html`, and `admin-login.html`.
- [x] Confirm that each page's "Return to Bakery" back navigation perfectly links back to `index.html` seamlessly completing the loop.
- [x] Perform a final visual layout check via browser to guarantee desktop and mobile formatting looks flawless.

> *Note: By implementing this routing plan, developers can compartmentalize traffic safely while giving staff simple entry points. No code has been modified during the generation of this document.*
