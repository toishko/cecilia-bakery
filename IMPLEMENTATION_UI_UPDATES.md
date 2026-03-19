# UI Updates Implementation Plan

- [x] **1. Default Light Theme**
  - [x] Update `index.html`, `menu.html`, `login.html`, and other relevant pages where the theme initialization script runs.
  - [x] Adjust the theme logic so that if `localStorage.getItem('theme')` is null, it explicitly sets the theme to `'light'` (e.g., `document.documentElement.setAttribute('data-theme', 'light')`) without falling back to `window.matchMedia('(prefers-color-scheme: dark)')`.
  - [x] Save `'light'` into localStorage on the first visit to finalize the state.

- [x] **2. Header Control Buttons Sizing and Spacing**
  - [x] Modify `<style>` blocks in `index.html`, `menu.html`, and `login.html`.
  - [x] Standardize `.lang-btn` and `.theme-btn` classes: give them identical padding, uniform width, and text wrapping preventions so they form matching bounding boxes.
  - [x] Modify `.theme-btn` to solely rely on the Lucide icon (`moon`/`sun`) by removing the "Dark"/"Light" text (or give both buttons equal fixed dimensions like `width: 32px; height: 32px;`).
  - [x] Increase the `gap` property in the `.nav-controls` and `.mobile-drawer-controls` containers so the buttons don't look cluttered (e.g., bump gap from `5px` to `12px`).

- [x] **3. "Order Now" Specificity in Mobile Dropdown**
  - [x] In `index.html`, locate the `.mobile-drawer-links` list.
  - [x] Find the list item with `class="nav-cta"` inside the dropdown.
  - [x] Change the translation properties: `data-en="<i data-lucide='cake' class='icon'></i> Order a Custom Cake"` and `data-es="<i data-lucide='cake' class='icon'></i> Ordenar un Bizcocho"`.
  - [x] Update the inner text to reflect the English default: `<i data-lucide='cake' class='icon'></i> Order a Custom Cake`.

- [x] **4. Sign Out Button Position in Mobile Dropdown**
  - [x] In `index.html`, `menu.html`, and `login.html`, edit the `.mobile-drawer-links` unordered list.
  - [x] Move the `<li id="mobile-signout-menu">` node to be the absolute last child of the `<ul>`. (Currently, it sits *before* the CTA).

- [x] **5. Remove Category Jump Links from Menu Page Mobile Dropdown**
  - [x] Open `menu.html` and find the `<ul class="mobile-drawer-links">`.
  - [x] Remove the `<li>` items that link to in-page categories (e.g., `#cakes`, `#pastries`, `#drinks`).
  - [x] Keep only the essential global navigation links (Menu, Wholesale, Log In, User Dashboard/Home, Sign Out).

- [x] **6. Consistent Hamburger Dropdown on Customer Login**
  - [x] Inspect `login.html` and locate the `.mobile-drawer` and `.mobile-drawer-links`.
  - [x] Copy or align the structure to exactly match the simplified global mobile drawer in `index.html` and `menu.html`. Ensure it contains:
    - [x] Our Story (or Home link)
    - [x] Menu
    - [x] Wholesale
    - [x] Log In (hidden when auth)
    - [x] Home (hidden when unauth)
    - [x] Order CTA
    - [x] Sign Out (at the very bottom)

- [x] **7. Change "Dashboard" to "Home" in Mobile Header**
  - [x] In `index.html`, `menu.html`, and `login.html`, find the `<li id="mobile-user-menu">` inside the mobile drawer.
  - [x] Change the anchor tag (`#mobile-profile-link`) text and properties:
    - [x] `data-en="<i data-lucide='home' class='icon'></i> Home"`
    - [x] `data-es="<i data-lucide='home' class='icon'></i> Inicio"`
    - [x] Inner HTML to `<i data-lucide='home' class='icon'></i> Home`.
  - [x] Point the `href` attribute to `index.html` so it reliably takes customers back to the storefront instead of a non-existent dashboard.

- [x] **8. Distinct Desktop "Sign Out" Styling**
  - [x] Style the desktop "Sign Out" button as a transparent "ghost" or outline button, keeping the solid background color reserved exclusively for the primary CTA.

- [x] **9. Header Scroll Effect (Glassmorphism)**
  - [x] Add a subtle background blur (`backdrop-filter: blur(10px)`) and a very faint bottom border or shadow to the header *only* when the user scrolls down from the top.

- [x] **10. Active Page State Indication**
  - [x] Add an "active" class to the navigation links that highlights the current page (e.g., a subtle underline or a slightly bolder, distinct font color for "Menu" when the user is on `menu.html`). Apply this to both desktop and mobile navigation.

- [x] **11. Transition Animations**
  - [x] Add a soft CSS `transition` to the `body` and main containers (e.g., `transition: background-color 0.3s ease, color 0.3s ease`) so switching between light and dark modes feels smooth instead of snapping abruptly.
  - [x] Add a subtle rotation or fade animation to the sun/moon icon when toggled.

- [x] **12. Mobile Drawer UX Refinements**
  - [x] Add a semi-transparent dark overlay behind the mobile menu when it's open. Clicking the overlay should easily close the menu.
  - [x] When a user clicks a dropdown link to jump to a page section, the mobile menu should automatically close.

- [x] **13. Focus States for Accessibility**
  - [x] Ensure all buttons and links in the header and mobile menu feature a visible styling change on `:focus-visible` (e.g., an outline like `outline: 2px solid var(--red); outline-offset: 4px; border-radius: 4px;`) to support keyboard navigation.
