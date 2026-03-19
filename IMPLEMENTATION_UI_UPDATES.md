# UI Updates Implementation Plan

- [ ] **1. Default Light Theme**
  - [ ] Update `index.html`, `menu.html`, `login.html`, and other relevant pages where the theme initialization script runs.
  - [ ] Adjust the theme logic so that if `localStorage.getItem('theme')` is null, it explicitly sets the theme to `'light'` (e.g., `document.documentElement.setAttribute('data-theme', 'light')`) without falling back to `window.matchMedia('(prefers-color-scheme: dark)')`.
  - [ ] Save `'light'` into localStorage on the first visit to finalize the state.

- [ ] **2. Header Control Buttons Sizing and Spacing**
  - [ ] Modify `<style>` blocks in `index.html`, `menu.html`, and `login.html`.
  - [ ] Standardize `.lang-btn` and `.theme-btn` classes: give them identical padding, uniform width, and text wrapping preventions so they form matching bounding boxes.
  - [ ] Modify `.theme-btn` to solely rely on the Lucide icon (`moon`/`sun`) by removing the "Dark"/"Light" text (or give both buttons equal fixed dimensions like `width: 32px; height: 32px;`).
  - [ ] Increase the `gap` property in the `.nav-controls` and `.mobile-drawer-controls` containers so the buttons don't look cluttered (e.g., bump gap from `5px` to `12px`).

- [ ] **3. "Order Now" Specificity in Mobile Dropdown**
  - [ ] In `index.html`, locate the `.mobile-drawer-links` list.
  - [ ] Find the list item with `class="nav-cta"` inside the dropdown.
  - [ ] Change the translation properties: `data-en="<i data-lucide='cake' class='icon'></i> Order a Custom Cake"` and `data-es="<i data-lucide='cake' class='icon'></i> Ordenar un Bizcocho"`.
  - [ ] Update the inner text to reflect the English default: `<i data-lucide='cake' class='icon'></i> Order a Custom Cake`.

- [ ] **4. Sign Out Button Position in Mobile Dropdown**
  - [ ] In `index.html`, `menu.html`, and `login.html`, edit the `.mobile-drawer-links` unordered list.
  - [ ] Move the `<li id="mobile-signout-menu">` node to be the absolute last child of the `<ul>`. (Currently, it sits *before* the CTA).

- [ ] **5. Remove Category Jump Links from Menu Page Mobile Dropdown**
  - [ ] Open `menu.html` and find the `<ul class="mobile-drawer-links">`.
  - [ ] Remove the `<li>` items that link to in-page categories (e.g., `#cakes`, `#pastries`, `#drinks`).
  - [ ] Keep only the essential global navigation links (Menu, Wholesale, Log In, User Dashboard/Home, Sign Out).

- [ ] **6. Consistent Hamburger Dropdown on Customer Login**
  - [ ] Inspect `login.html` and locate the `.mobile-drawer` and `.mobile-drawer-links`.
  - [ ] Copy or align the structure to exactly match the simplified global mobile drawer in `index.html` and `menu.html`. Ensure it contains:
    - [ ] Our Story (or Home link)
    - [ ] Menu
    - [ ] Wholesale
    - [ ] Log In (hidden when auth)
    - [ ] Home (hidden when unauth)
    - [ ] Order CTA
    - [ ] Sign Out (at the very bottom)

- [ ] **7. Change "Dashboard" to "Home" in Mobile Header**
  - [ ] In `index.html`, `menu.html`, and `login.html`, find the `<li id="mobile-user-menu">` inside the mobile drawer.
  - [ ] Change the anchor tag (`#mobile-profile-link`) text and properties:
    - [ ] `data-en="<i data-lucide='home' class='icon'></i> Home"`
    - [ ] `data-es="<i data-lucide='home' class='icon'></i> Inicio"`
    - [ ] Inner HTML to `<i data-lucide='home' class='icon'></i> Home`.
  - [ ] Point the `href` attribute to `index.html` so it reliably takes customers back to the storefront instead of a non-existent dashboard.
