# Phase 7 — PWA (Progressive Web App)

> Makes the site installable as a home screen app on iOS and Android.

---

## What PWA Does

- Driver or admin visits the page → browser prompts "Add to Home Screen"
- Once added, the page opens **full screen** — no URL bar, no browser chrome
- Looks and feels like a native app
- Custom app icon + splash screen with Cecilia Bakery logo

---

## manifest.json

```json
{
  "name": "Cecilia Bakery",
  "short_name": "Cecilia",
  "description": "Cecilia Bakery — Driver & Admin Portal",
  "start_url": "/driver-order.html",
  "scope": "/",
  "display": "standalone",
  "background_color": "#FAFAF8",
  "theme_color": "#C8102E",
  "icons": [
    { "src": "/assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Notes
- `start_url` defaults to driver form — since most users will be drivers
- Admin can still navigate to `admin-dashboard.html` or add it separately
- `display: standalone` removes all browser UI
- `theme_color` matches the bakery's red brand color

---

## Service Worker (`sw.js`)

Basic caching strategy:
- **Cache static assets** (HTML, CSS, JS, fonts, logo) on install
- **Network-first** for Supabase API calls (always get fresh data)
- **Fallback** for offline: show cached pages if available

This is NOT for offline ordering (that's deferred). It's just for:
- Faster page loads after first visit
- Smooth PWA install experience

---

## App Icons

- Generate from the existing Cecilia Bakery logo (`assets/logo.png`)
- **192x192** — standard icon
- **512x512** — splash screen icon
- Both saved to `assets/`

---

## iOS Specifics

- Add `<meta name="apple-mobile-web-app-capable" content="yes">`
- Add `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
- Add `<link rel="apple-touch-icon" href="/assets/icon-192.png">`
- iOS doesn't fully support `manifest.json` for splash screens, but the home screen icon + fullscreen mode work

---

## Separate Entry Points

| User | Adds to Home Screen | Opens to |
|------|---------------------|----------|
| Driver | `driver-order.html` | Code entry → Dashboard |
| Admin | `admin-dashboard.html` | Login → Admin Dashboard |

Both work as standalone apps. Each can be added separately.

---

## Checklist
- [x] Create `manifest.json`
- [x] Create `sw.js` (basic caching)
- [x] Add manifest + service worker registration to `driver-order.html`
- [x] Add manifest + service worker registration to `admin-dashboard.html`
- [x] Generate app icons (192px, 512px)
- [x] Add iOS meta tags
- [ ] Verify "Add to Home Screen" on iOS Safari
- [ ] Verify "Add to Home Screen" on Android Chrome
- [x] Verify standalone display mode works
