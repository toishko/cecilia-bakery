# Phase 8 — Notifications

> Sound + browser push notifications for both admin and driver.

---

## Admin Notifications

### New Order Received
- **Trigger**: Supabase Realtime detects a new row in `driver_orders`
- **Sound**: Short, pleasant chime (bakery bell or soft ping)
- **Browser notification** (if permission granted):
  - Title: "New Order"
  - Body: "Carlos submitted an order (12 items)"
  - Click → jumps to Incoming Orders page
- **Visual**: badge/dot on "Incoming Orders" nav item + brief highlight animation on the new order card

### Why This Matters
- Bakeries are loud — visual-only notifications get missed
- Sound ensures the admin team knows immediately

---

## Driver Notifications

### Order Confirmed
- **Trigger**: Supabase Realtime detects `driver_orders.status` changed to `'sent'`
- **Sound**: Confirmation tone (softer than admin chime)
- **Browser notification** (if permission granted):
  - Title: "Order Confirmed"
  - Body: "Your order #1047 has been confirmed"
  - Click → jumps to My Orders page
- **Visual**: My Orders badge updates, order card appears/highlights

---

## Notification Sounds

- Use short MP3/OGG audio files (< 50KB each)
- Stored in `assets/sounds/`
- Two sounds:
  - `new-order.mp3` — for admin (new order in)
  - `order-confirmed.mp3` — for driver (order sent back)
- Play via HTML5 `Audio` API
- Handle browser autoplay restrictions: only play after first user interaction

---

## Settings: Mute/Unmute

- In Settings page (both admin and driver):
  - **"Notification Sounds"** toggle: On/Off
  - Saved to `localStorage`
  - When off: no chimes, but visual notifications still appear
- Browser notification permission is requested on first use (separate from sound toggle)

---

## Checklist
- [ ] Create/source notification audio files
- [ ] Admin: Realtime subscription for new orders → play sound + show notification
- [ ] Driver: Realtime subscription for status changes → play sound + show notification
- [ ] Browser Notification API integration (permission request, display)
- [ ] Visual badges/indicators on nav items
- [ ] Mute/unmute toggle in Settings
- [ ] Handle browser autoplay restrictions
- [ ] Verification: submit order → admin hears chime → admin confirms → driver hears chime
