# Phase 10A — PWA Improvements

> Hardening pass for the existing PWA infrastructure. Covers service worker
> lifecycle, manifests, offline resilience, render performance, i18n
> correctness, and install-experience polish. Push notification hardening
> is tracked separately in
> [IMPLEMENTATION_PUSH_NOTIFICATIONS.md](IMPLEMENTATION_PUSH_NOTIFICATIONS.md)
> (Phase 10B).

---

## Checklist

- [x] 1. Version the SW cache and clean old caches on activate
- [x] 2. Fix icon `purpose` field in all three manifests
- [x] 3. Unify service worker registration across all pages
- [x] 4. Create `/offline.html` fallback page
- [x] 5. Update SW fetch handler to serve offline fallback
- [x] 6. Replace update-banner inline `display:none` duplication with CSS class
- [x] 7. Add `screenshots` array to all three manifests
- [x] 8. Standardize `apple-mobile-web-app-status-bar-style` + safe-area padding
- [x] 9. Preload critical Google Font files
- [x] 10. Add `order-confirmation.html` to vite.config.js (or create stub page)
- [x] 11. Fix broken notification audio in admin-dashboard.html
- [x] 12. Add dark-mode-aware `theme-color` meta tags
- [x] 13. Audit and fix ALL Spanish strings (accents, tildes, ¿/¡ punctuation)
- [x] 14. Verification pass (light/dark, EN/ES, mobile, install flow)

---

## 1. Version the SW cache and clean old caches on activate

### Problem
`sw.js` uses a static cache name `'cecilia-cache'`. The `activate` handler
calls `clients.claim()` but never deletes stale cache entries. Every deploy
adds new responses into the same cache — old assets accumulate forever.

### What to change

**File: `sw.js`**

Replace the static cache name with a versioned one. Bump the version string
on every release (the Vite version-stamp plugin already generates a build
timestamp — we can use a manually bumped string here since `sw.js` is not
processed by Vite).

```js
// Top of sw.js
const CACHE_VERSION = 'v2';                     // bump on each release
const CACHE_NAME = `cecilia-cache-${CACHE_VERSION}`;
```

Update the `activate` handler to delete all caches that don't match the
current name:

```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('cecilia-cache-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});
```

### Gotchas
- Keep the `self.skipWaiting()` in the `install` handler so the new SW
  activates immediately.
- The cache filter uses `startsWith('cecilia-cache-')` so it won't
  accidentally delete caches from other origins.

---

## 2. Fix icon `purpose` field in all three manifests

### Problem
All three manifests (`manifest.json`, `manifest-website.json`,
`manifest-admin.json`) declare `"purpose": "any maskable"` on a single icon
entry. Per the W3C Web App Manifest spec, `"any maskable"` on **one** entry
tells the UA that the **same** image works for both modes — but maskable
icons need content within the inner 80% safe-zone circle, which normal
icons typically don't follow. Chrome DevTools flags this as a warning.

### What to change

**Files: `manifest.json`, `manifest-website.json`, `manifest-admin.json`**

Replace the current two-icon array with four entries — two `"any"`, two
`"maskable"`:

```json
"icons": [
  { "src": "/assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "/assets/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

**New assets needed:** `assets/icon-maskable-192.png` and
`assets/icon-maskable-512.png`. These are the same logo but with extra
padding so the content sits within the inner 80% circle. Use
[maskable.app](https://maskable.app/editor) to generate them from the
existing logo.

### Gotchas
- Until the maskable icons are created, you can temporarily use the existing
  icons for both entries. The fix is still correct — separating `any` and
  `maskable` removes the spec warning.
- All three manifests must be updated identically.

---

## 3. Unify service worker registration across all pages

### Problem
`index.html` and `menu.html` skip SW registration on `localhost`:
```js
if (!('serviceWorker' in navigator) || location.hostname.includes('localhost')) return;
```
`driver-order.html` and `admin-dashboard.html` always register:
```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```
During local dev on driver/admin pages, the SW caches stale assets and
causes debugging pain.

### What to change

**Files: `driver-order.html` (lines 300–305), `admin-dashboard.html`
(lines 474–479)**

Replace the SW registration block with the same localhost-skip pattern used
by `index.html` and `menu.html`:

```js
// ── Service Worker ──
if ('serviceWorker' in navigator && !location.hostname.includes('localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```

### Gotchas
- The `subscribeToPush()` calls in `admin-dashboard.js` and
  `driver-order.js` already gate on `navigator.serviceWorker.ready`, so
  they will simply not fire on localhost. No changes needed there.
- Do NOT touch the SW registration in `index.html` or `menu.html` — those
  are already correct.

---

## 4. Create `/offline.html` fallback page

### Problem
When the network fails and a resource isn't cached, the SW returns
`undefined` from `caches.match()` and the user sees a raw browser error.

### What to change

**New file: `offline.html`**

A minimal, self-contained page (all CSS inline — it must work without any
external resources). Should match the bakery brand:

- Dark background (`#0E0507`) with Cecilia brand red accent
- Centered message: "You're offline" / "Estás sin conexión"
- Sub-text: "Check your connection and try again"
- A "Try Again" button that calls `window.location.reload()`
- Uses system fonts (no Google Fonts dependency — those may not be cached)
- Light/dark mode support via `prefers-color-scheme`
- Bilingual: detects `navigator.language` to pick EN or ES

**File: `vite.config.js`**

Add `offline.html` to the Rollup inputs:

```js
input: {
  main: resolve(__dirname, 'index.html'),
  menu: resolve(__dirname, 'menu.html'),
  driverOrder: resolve(__dirname, 'driver-order.html'),
  adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
  offline: resolve(__dirname, 'offline.html'),
},
```

### Gotchas
- The page must be **completely self-contained** — no external CSS, JS, or
  font files. It's the one page that's always available.
- Pre-cache `offline.html` in the SW install event (see item 5).

---

## 5. Update SW fetch handler to serve offline fallback

### Problem
The current fetch handler catches network errors and tries `caches.match()`,
but if that also returns `undefined`, the user gets nothing.

### What to change

**File: `sw.js`**

1. Pre-cache `offline.html` during install:

```js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add('/offline.html'))
  );
  self.skipWaiting();
});
```

2. Update the fetch handler to fall back to `offline.html` for navigation
   requests:

```js
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Only serve offline page for navigation requests (HTML pages)
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        })
      )
  );
});
```

### Gotchas
- Non-navigation requests (images, CSS, API calls) still return `undefined`
  if not cached — that's correct. Only HTML pages get the offline fallback.
- The `caches.open(CACHE_NAME)` in install means `offline.html` is in the
  **versioned** cache. When the cache name bumps, it gets re-cached.

---

## 6. Replace update-banner inline `display:none` duplication with CSS class

### Problem
Both `driver-order.html` (line 284) and `admin-dashboard.html` (line 458)
have the update banner with a double `display:none` in inline styles:
```html
style="display:none;...display:none;align-items:center;..."
```
The first `display:none` hides the banner. The second is a leftover that
creates a fragile pattern — `showUpdateBanner()` sets `display = 'flex'`,
but the duplicate makes the inline style string unpredictable.

### What to change

**Files: `driver-order.html`, `admin-dashboard.html`**

1. Add a CSS class for the banner hidden/visible states. Add to
   `driver-order.css` and `admin-dashboard.css`:

```css
.update-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  background: linear-gradient(135deg, #C8102E, #a00d24);
  color: #fff;
  padding: 12px 16px;
  font-family: 'Outfit', sans-serif;
  font-size: .88rem;
  font-weight: 500;
  display: none;          /* hidden by default */
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .2);
  cursor: pointer;
}

.update-banner.visible {
  display: flex;
}
```

2. In the HTML, remove ALL inline styles from the banner `<div>` and use
   the class instead:

```html
<div id="update-banner" class="update-banner" onclick="window.location.reload()">
```

3. In the inline `<script>`, update `showUpdateBanner()`:

```js
function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('visible');
}
```

4. Update the close button to use `classList.remove('visible')` instead of
   setting `style.display`.

### Gotchas
- The banner's close button `onclick` currently sets
  `style.display='none'` — change it to
  `classList.remove('visible')`.
- Both HTML files must be updated identically.

---

## 7. Add `screenshots` array to all three manifests

### Problem
Chrome and Edge show a rich install preview (with screenshots) when a PWA
manifest includes a `screenshots` array. Without it, users get a generic
install prompt. This is especially valuable for the customer-facing menu
PWA.

### What to change

**Files: `manifest.json`, `manifest-website.json`, `manifest-admin.json`**

Add a `screenshots` array. Each manifest gets contextual screenshots:

**manifest-website.json** (customer menu):
```json
"screenshots": [
  {
    "src": "/assets/screenshots/menu-wide.png",
    "sizes": "1280x720",
    "type": "image/png",
    "form_factor": "wide",
    "label": "Menu — Desktop View"
  },
  {
    "src": "/assets/screenshots/menu-narrow.png",
    "sizes": "750x1334",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Menu — Mobile View"
  }
]
```

**manifest.json** (driver portal):
```json
"screenshots": [
  {
    "src": "/assets/screenshots/driver-wide.png",
    "sizes": "1280x720",
    "type": "image/png",
    "form_factor": "wide",
    "label": "Driver Portal — Order Form"
  },
  {
    "src": "/assets/screenshots/driver-narrow.png",
    "sizes": "750x1334",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Driver Portal — Dashboard"
  }
]
```

**manifest-admin.json** (admin dashboard):
```json
"screenshots": [
  {
    "src": "/assets/screenshots/admin-wide.png",
    "sizes": "1280x720",
    "type": "image/png",
    "form_factor": "wide",
    "label": "Admin Dashboard — Overview"
  },
  {
    "src": "/assets/screenshots/admin-narrow.png",
    "sizes": "750x1334",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Admin Dashboard — Mobile"
  }
]
```

**New assets needed:**
Create directory `assets/screenshots/` and capture 6 screenshots:
- `menu-wide.png` (1280×720), `menu-narrow.png` (750×1334)
- `driver-wide.png` (1280×720), `driver-narrow.png` (750×1334)
- `admin-wide.png` (1280×720), `admin-narrow.png` (750×1334)

### Gotchas
- `form_factor` must be `"wide"` or `"narrow"` — Chrome requires at least
  one of each for the richest install UI.
- Screenshots should show the app in its best state (light mode, populated
  data, no errors).

---

## 8. Standardize `apple-mobile-web-app-status-bar-style` + safe-area padding

### Problem
`admin-dashboard.html` uses `"default"` (white status bar).
`driver-order.html` uses `"black-translucent"` (content extends under bar).
`index.html` and `menu.html` both use `"black-translucent"`. The admin page
is the outlier.

### What to change

**File: `admin-dashboard.html` (line 18)**

Change:
```html
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```
To:
```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**File: `admin-dashboard.css`**

Add safe-area padding to the layout containers that sit under the status
bar. The mobile header and sidebar brand area need top padding:

```css
/* iOS safe area — status bar overlap */
.mobile-header {
  padding-top: max(12px, env(safe-area-inset-top));
}

.sidebar-brand {
  padding-top: max(20px, env(safe-area-inset-top));
}
```

**File: `driver-order.css`**

Verify safe-area padding already exists on the dashboard header and login
card. If missing, add:

```css
.dash-header {
  padding-top: max(12px, env(safe-area-inset-top));
}

.login-card {
  padding-top: max(20px, env(safe-area-inset-top));
}
```

### Gotchas
- `env(safe-area-inset-top)` returns `0px` on non-notch devices, so the
  `max()` function gracefully falls back to the default padding.
- Test on an iPhone with a notch/Dynamic Island to verify content isn't
  hidden behind the status bar.

---

## 9. Preload critical Google Font files

### Problem
Both app pages load Cormorant Garamond + Outfit via standard `<link>` tags.
`display=swap` prevents invisible text, but the fonts are still
render-blocking CSS (the stylesheet itself blocks). Preloading the CSS
request and the most critical font files speeds up first paint.

### What to change

**Files: `driver-order.html`, `admin-dashboard.html`, `index.html`,
`menu.html`**

Add a `preload` hint for the Google Fonts CSS **before** the existing
`<link>` tag:

```html
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;0,700;1,400;1,600&family=Outfit:wght@300;400;500;600&display=swap" as="style">
```

This tells the browser to start downloading the CSS immediately, before
the parser reaches the `<link rel="stylesheet">`.

### Gotchas
- Do NOT remove the existing `<link rel="stylesheet">` — the preload is
  an optimization hint, not a replacement.
- `index.html` and `menu.html` already have `preconnect` hints — keep
  those. The `preload` adds to them.
- Self-hosting fonts through Vite is a more robust long-term solution but
  is more complex. The preload approach gets 80% of the benefit with
  minimal change. Self-hosting can be a future phase.

---

## 10. Add `order-confirmation.html` to vite.config.js (or create stub)

### Problem
Both `index.html` (line 5234) and `menu.html` (line 5567) reference
`order-confirmation.html` in the WhatsApp checkout flow:
```js
window.location.href = `order-confirmation.html?id=${orderId.split('-')[0]}`;
```
But the file does not exist, and it's not in `vite.config.js` inputs.

### What to change

**New file: `order-confirmation.html`**

Create a simple confirmation page that:
- Reads the order ID from the URL query parameter `?id=...`
- Shows a success message: "Your order has been received!" / "¡Tu pedido
  ha sido recibido!"
- Displays the order ID for reference
- Has a "Back to Menu" link
- Matches the website theme (uses same CSS variables, Cormorant Garamond +
  Outfit, light/dark mode)
- Links to `manifest-website.json`
- Is fully self-contained (inline styles, or a small `<style>` block)

**File: `vite.config.js`**

Add to Rollup inputs:

```js
input: {
  main: resolve(__dirname, 'index.html'),
  menu: resolve(__dirname, 'menu.html'),
  driverOrder: resolve(__dirname, 'driver-order.html'),
  adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
  orderConfirmation: resolve(__dirname, 'order-confirmation.html'),
},
```

### Gotchas
- This page is referenced from the **public website** checkout flow, so it
  must use `manifest-website.json`, not the driver manifest.
- Keep it simple — it's a confirmation page, not a full dashboard.
- Add `offline.html` at the same time (see item 4) to keep the config
  update as one commit.

---

## 11. Fix broken notification audio in admin-dashboard.html

### Problem
`admin-dashboard.html` (line 453–455) has an `<audio>` element with a
truncated base64 data URI:
```html
<source src="data:audio/wav;base64,UklGRl9vT19teleXBlfm10LQBAAAASUREWAEAAQCAkAAAbvAAAAAAHDAdoAAAA=" type="audio/wav">
```
This is not valid WAV data. The audio element is never used anyway — the
`playNotification()` function in `admin-dashboard.js` (line 461) already
uses the **Web Audio API** to generate a chime programmatically.

### What to change

**File: `admin-dashboard.html`**

Remove the broken `<audio>` element entirely (lines 452–455):
```html
<!-- REMOVE THIS BLOCK -->
<audio id="notification-sound" preload="auto">
  <source src="data:audio/wav;base64,UklGRl9vT19..." type="audio/wav">
</audio>
```

The Web Audio API chime in `admin-dashboard.js` is the real implementation
and works correctly. No replacement needed.

### Gotchas
- Grep for `notification-sound` in `admin-dashboard.js` to ensure nothing
  references this element by ID. If anything does, remove that reference
  too (it would be dead code since the audio is invalid anyway).

---

## 12. Add dark-mode-aware `theme-color` meta tags

### Problem
All pages use a single static `<meta name="theme-color" content="#C8102E">`.
The browser's address bar / status bar stays red regardless of the user's
color scheme preference.

### What to change

**Files: `index.html`, `menu.html`, `driver-order.html`,
`admin-dashboard.html`**

Replace the single `theme-color` meta tag with two media-query variants:

```html
<meta name="theme-color" content="#FAFAF8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0E0507" media="(prefers-color-scheme: dark)">
```

These match the `--bg` values from the existing design token system:
- Light: `#FAFAF8`
- Dark: `#0E0507`

### Gotchas
- The `theme_color` in the three manifest files should stay as `#C8102E`
  (the brand red). The manifest theme-color is the default when the browser
  doesn't support the media-query variant in the meta tag.
- **index.html and menu.html**: per ISSUES_GUIDE rule 10, only change the
  `<meta name="theme-color">` line. Do not modify anything else.
- The JS theme toggle switches `data-theme` but doesn't update the meta
  tag dynamically. For an enhanced approach, add a small snippet to
  `toggleTheme()` — but this is optional polish, not required.

---

## 13. Audit and fix ALL Spanish strings

### Problem
Several `data-es` strings in `driver-order.html` are missing proper
accents, tildes, and opening punctuation marks (`¿`, `¡`).
`admin-dashboard.html` is mostly correct but needs a secondary audit.

### What to change

**File: `driver-order.html` — confirmed fixes:**

| Line | Current `data-es` | Corrected |
|------|------|------|
| 36 | `Ingresa tu codigo para continuar` | `Ingresa tu código para continuar` |
| 39 | `Tu codigo` | `Tu código` |
| 72 | `Configuracion` | `Configuración` |
| 81 | `Listo para hacer un pedido?` | `¿Listo para hacer un pedido?` |
| 94 | `Aun no hay pedidos` | `Aún no hay pedidos` |
| 107 | `Aun no hay pedidos` | `Aún no hay pedidos` |
| 113 | `Configuracion` | `Configuración` |
| 123 | `Tamano de Texto` | `Tamaño de Texto` |
| 155 | `Cerrar Sesion` | `Cerrar Sesión` |

**Full audit steps:**
1. Grep `data-es=` in `driver-order.html` — review every single string
2. Grep `data-es=` in `admin-dashboard.html` — review every single string
3. Grep `data-es-placeholder=` in both files
4. Check JS files (`driver-order.js`, `admin-dashboard.js`) for any
   hardcoded Spanish strings in template literals

**Common Spanish accent rules to check:**
- `ó` in: código, sesión, configuración, confirmación, información
- `á` in: está, aún, artículos
- `ñ` in: tamaño, año, español
- `í` in: artículos, aquí, también
- `¿` at start of questions
- `¡` at start of exclamations

### Gotchas
- Do NOT change the English (`data-en`) values.
- Do NOT change the inner text content if it's the English default —
  only change `data-es` attributes.
- After making changes, test by switching to Spanish to verify rendering.

---

## 14. Verification pass

After all fixes are applied, verify:

### Service Worker
- [ ] Deploy → open DevTools → Application → Service Worker shows new version
- [ ] Application → Cache Storage shows `cecilia-cache-v2` (no old caches)
- [ ] Go offline (DevTools Network → Offline) → navigate to uncached page →
      see `/offline.html` instead of browser error

### Manifests
- [ ] DevTools → Application → Manifest → no warnings about icon purpose
- [ ] All three manifests show correct `start_url` and screenshots
- [ ] Chrome install prompt shows screenshots (desktop Chrome)

### iOS PWA
- [ ] All four pages show `black-translucent` status bar
- [ ] No content hidden behind notch/Dynamic Island
- [ ] Add to Home Screen works on iOS Safari

### Update Banner
- [ ] Deploy a version change → banner appears → click dismiss → gone
- [ ] No duplicate `display:none` in DOM inspector

### Offline Page
- [ ] Offline page shows in both EN and ES (based on `navigator.language`)
- [ ] "Try Again" button reloads
- [ ] Page looks correct in light and dark system theme

### Spanish Strings
- [ ] Switch to ES in driver portal → all strings have correct accents
- [ ] Switch to ES in admin portal → all strings have correct accents
- [ ] No `?` without `¿`, no `!` without `¡`

### Theme Color
- [ ] Light mode → browser bar matches `#FAFAF8`
- [ ] Dark mode → browser bar matches `#0E0507`

### Order Confirmation
- [ ] Complete a WhatsApp checkout → lands on `order-confirmation.html`
- [ ] Page shows order ID, back-to-menu link, correct theme

### Audio
- [ ] Admin dashboard → new order arrives → Web Audio chime plays
- [ ] No console errors about broken audio element
