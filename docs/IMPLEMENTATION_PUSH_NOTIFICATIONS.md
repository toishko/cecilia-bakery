# Phase 10B — Push Notification Hardening

> The push notification infrastructure is **already fully implemented**
> across both the driver and admin portals. This phase is an audit and
> hardening pass — not a fresh implementation.
>
> **Current state:**
> - `VAPID_PUBLIC_KEY` defined in both `admin-dashboard.js` and `driver-order.js`
> - `subscribeToPush()` function exists in both JS files (~100 lines each)
> - `PushManager.subscribe()` with VAPID key conversion, stale-key detection,
>   and retry logic is already wired
> - Subscriptions are saved to `push_subscriptions` table in Supabase via upsert
> - Supabase Edge Function `send-push-notification/index.ts` handles server-side
>   push delivery with `web-push` library
> - `sw.js` has full `push` and `notificationclick` event handlers
>
> This doc covers edge cases, resilience improvements, and cleanup.

---

## Checklist

- [ ] 1. Audit subscription lifecycle for edge cases
- [ ] 2. Add push subscription cleanup on logout
- [ ] 3. Wire the Settings notification toggle to push subscription state
- [ ] 4. Handle subscription renewal on SW update
- [ ] 5. Add push notification opt-in UI (first-time prompt)
- [ ] 6. Deduplicate identical `subscribeToPush()` code
- [ ] 7. Verify Edge Function error handling
- [ ] 8. Verification pass

---

## 1. Audit subscription lifecycle for edge cases

### Problem
The current `subscribeToPush()` handles the happy path and VAPID key
mismatches, but there are edge cases around expired subscriptions, revoked
permissions, and browser reinstalls.

### What to audit / fix

**Files: `admin-dashboard.js`, `driver-order.js`**

Check and handle these scenarios in `subscribeToPush()`:

1. **Permission revoked after initial grant**: After subscribing, the user
   may revoke notification permission in browser settings. The subscription
   endpoint becomes invalid, but the Supabase record still exists.
   - **Fix**: Before upserting, check `Notification.permission === 'granted'`.
     If denied, remove the Supabase record for this endpoint.

2. **Multiple devices / browsers**: A driver or admin may log in from
   multiple devices. Each creates a separate push subscription. This is
   **correct behavior** — Supabase upserts on `(user_type, user_id, endpoint)`.
   - **Verify**: The unique constraint includes `endpoint`, so multiple
     device subscriptions coexist. No fix needed here.

3. **Subscription expiry**: The Web Push spec allows subscriptions to expire.
   When `pushManager.getSubscription()` returns `null` after previously
   returning a subscription, we should re-subscribe.
   - **Verify**: The existing code already handles this (the `if (!sub)`
     branch creates a new subscription). No fix needed.

### Gotchas
- The `subscribeToPush()` function is called on every login. If it fails
  silently, the user won't know push is broken. The existing toast error
  messages are good — verify they actually render in production.

---

## 2. Add push subscription cleanup on logout

### Problem
When a driver or admin logs out, their push subscription remains in
Supabase. If a different user logs in on the same device/browser, the old
subscription could receive notifications for the wrong user.

### What to change

**File: `admin-dashboard.js` — `handleLogout()` function**

Before signing out, delete the push subscription record:

```js
async function handleLogout() {
  try {
    // Clean up push subscription
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && currentUser) {
        // Remove from Supabase
        await sb.from('push_subscriptions').delete()
          .eq('user_type', 'admin')
          .eq('user_id', currentUser.id)
          .eq('endpoint', sub.endpoint);
        // Unsubscribe locally
        await sub.unsubscribe();
      }
    }
  } catch (e) { console.warn('Push cleanup on logout:', e); }

  try {
    await sb.auth.signOut();
  } catch (e) { console.error(e); }
  // ... rest of existing logout logic
}
```

**File: `driver-order.js` — logout handler**

Same pattern but with `user_type: 'driver'` and `currentDriver.id`:

```js
// Inside the logout handler
if ('serviceWorker' in navigator && 'PushManager' in window) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && currentDriver) {
      await sb.from('push_subscriptions').delete()
        .eq('user_type', 'driver')
        .eq('user_id', currentDriver.id)
        .eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { console.warn('Push cleanup on logout:', e); }
}
```

### Gotchas
- Wrap in try/catch — logout should never fail because of push cleanup.
- If the Supabase delete fails (e.g., network down), the stale record will
  eventually cause a `410 Gone` response when the Edge Function tries to
  push, which should trigger cleanup on the server side (see item 7).

---

## 3. Wire the Settings notification toggle to push subscription state

### Problem
Both driver and admin Settings have a "Notifications" toggle. Currently
it only controls the **in-app audio chime** (`notificationsEnabled`).
Turning it off does NOT unsubscribe from push notifications — the device
still receives background pushes.

### What to change

**Files: `admin-dashboard.js`, `driver-order.js`**

When the notification toggle is turned **OFF**:
1. Set `notificationsEnabled = false` (existing behavior — controls chime)
2. Unsubscribe from push and delete the Supabase record

When turned **ON**:
1. Set `notificationsEnabled = true`
2. Call `subscribeToPush()` to re-subscribe

```js
// In the notification toggle handler
notificationToggle.addEventListener('change', async (e) => {
  notificationsEnabled = e.target.checked;
  localStorage.setItem('cecilia_notif_enabled', notificationsEnabled);

  if (!notificationsEnabled) {
    // Unsubscribe from push
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const userId = /* currentUser.id or currentDriver.id */;
          const userType = /* 'admin' or 'driver' */;
          await sb.from('push_subscriptions').delete()
            .eq('user_type', userType)
            .eq('user_id', userId)
            .eq('endpoint', sub.endpoint);
          await sub.unsubscribe();
        }
      }
    } catch (e) { console.warn('Push unsubscribe:', e); }
  } else {
    // Re-subscribe
    const userId = /* currentUser.id or currentDriver.id */;
    const userType = /* 'admin' or 'driver' */;
    await subscribeToPush(userType, userId);
  }
});
```

### Gotchas
- The existing `notificationsEnabled` flag must continue to control the
  audio chime separately — push subscription and audio are now linked
  through the same toggle, but the chime logic must still check
  `notificationsEnabled`.
- Consider showing a brief toast: "Push notifications disabled" /
  "Notificaciones push desactivadas" so the user knows it took effect.

---

## 4. Handle subscription renewal on SW update

### Problem
When the service worker updates (new `CACHE_VERSION` from Phase 10A),
the `activate` event fires. If the browser decided to reset the push
subscription during the SW lifecycle, the old subscription in Supabase
becomes stale.

### What to change

**File: `admin-dashboard.js`, `driver-order.js`**

After the service worker fires `controllerchange` (indicating a new SW
took over), re-run `subscribeToPush()`:

```js
// Add after SW registration (in the inline <script> or at the top of the JS module)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // New SW activated — re-verify push subscription
    // (subscribeToPush is safe to call multiple times — it upserts)
    if (typeof subscribeToPush === 'function' && currentUser) {
      subscribeToPush('admin', currentUser.id);
    }
  });
}
```

### Gotchas
- `controllerchange` fires when a waiting SW becomes active. This is the
  right event — not `statechange`.
- The `subscribeToPush` function already handles existing subscriptions
  gracefully (upserts if already subscribed), so calling it again is safe.
- For drivers, use `currentDriver` instead of `currentUser`.

---

## 5. Add push notification opt-in UI (first-time prompt)

### Problem
Currently, `subscribeToPush()` calls `Notification.requestPermission()`
directly when the dashboard loads. On iOS Safari 16.4+, the permission
prompt can only be triggered by a user gesture. On other browsers, showing
the prompt immediately on load without context leads to lower grant rates.

### What to change

**Files: `admin-dashboard.html`, `driver-order.html`**

Add a one-time opt-in banner that appears on first login if notification
permission is still `'default'`:

```html
<div id="push-opt-in" class="push-opt-in" style="display:none">
  <div class="push-opt-in-text">
    <strong data-en="Enable Notifications" data-es="Activar Notificaciones"></strong>
    <span data-en="Get notified about order updates" data-es="Recibe notificaciones sobre pedidos"></span>
  </div>
  <button class="push-opt-in-btn" id="push-opt-in-btn"
    data-en="Enable" data-es="Activar">Enable</button>
  <button class="push-opt-in-dismiss" id="push-opt-in-dismiss">✕</button>
</div>
```

**Files: `admin-dashboard.js`, `driver-order.js`**

Show the opt-in banner only if `Notification.permission === 'default'` and
the user hasn't dismissed it before:

```js
function showPushOptIn() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('cecilia_push_opt_in_dismissed')) return;

  const banner = document.getElementById('push-opt-in');
  if (banner) banner.style.display = 'flex';
}

document.getElementById('push-opt-in-btn')?.addEventListener('click', async () => {
  document.getElementById('push-opt-in').style.display = 'none';
  // This is a user gesture — safe to request permission on iOS
  await subscribeToPush(userType, userId);
});

document.getElementById('push-opt-in-dismiss')?.addEventListener('click', () => {
  document.getElementById('push-opt-in').style.display = 'none';
  localStorage.setItem('cecilia_push_opt_in_dismissed', '1');
});
```

Then remove the direct `Notification.requestPermission()` call from
`requestNotifPermission()` — let the opt-in UI handle it.

### Gotchas
- On iOS 16.4+ PWA, the permission prompt MUST be triggered by a user
  gesture (tap). The opt-in button provides that gesture.
- If permission is already `'granted'`, skip the banner entirely and call
  `subscribeToPush()` directly (existing behavior).
- If permission is `'denied'`, skip both — user must change it in Settings.
- Style the banner consistently with the existing toast/update-banner
  pattern.

---

## 6. Deduplicate identical `subscribeToPush()` code

### Problem
`admin-dashboard.js` (lines 515–622) and `driver-order.js` (lines 1947–2052)
contain nearly identical `subscribeToPush()` functions (~100 lines each).
Bug fixes need to be applied to both files, which is error-prone.

### What to change

**New file: `push-utils.js`**

Extract the shared push subscription logic into a standalone module:

```js
// push-utils.js
const VAPID_PUBLIC_KEY = 'BPK9nQfqIXaf-kc5HHJ5G6trkWxjAX9MzeYwLTUfcnk4jWVYVO6gpzXS-d0tNgGTmHp0ntzYe3xRKT0Ud3t5a3Q';

export async function subscribeToPush(sb, userType, userId, lang, showToast) {
  // ... shared implementation
}

export async function unsubscribeFromPush(sb, userType, userId) {
  // ... shared unsubscribe logic
}
```

**Files: `admin-dashboard.js`, `driver-order.js`**

Import from the shared module:

```js
import { subscribeToPush, unsubscribeFromPush } from './push-utils.js';
```

Remove the inline `subscribeToPush()` function and VAPID key constant from
both files.

### Gotchas
- Both JS files are already loaded as `type="module"`, so ES imports work.
- The `showToast` function signature differs slightly between admin and
  driver. Pass it as a callback parameter.
- Remove the `VAPID_PUBLIC_KEY` constant from both consumer files after
  extraction.
- Add `push-utils.js` to the Vite build if needed (Vite handles module
  imports automatically via the HTML entry points, so it should work
  without config changes).

---

## 7. Verify Edge Function error handling

### Problem
The Supabase Edge Function `send-push-notification/index.ts` sends pushes
to all subscriptions for a given user. If a subscription endpoint returns
`410 Gone` or `404 Not Found`, the stale record should be deleted from the
`push_subscriptions` table.

### What to audit

**File: `supabase/functions/send-push-notification/index.ts`**

Verify the function handles these HTTP status codes from push endpoints:
- `201` → success, do nothing
- `410 Gone` → subscription expired, DELETE from `push_subscriptions`
- `404 Not Found` → endpoint invalid, DELETE from `push_subscriptions`

If this cleanup isn't implemented, add it:

```ts
const result = await webpush.sendNotification(pushSubscription, payload);

// On error, check for stale subscriptions
if (result.statusCode === 410 || result.statusCode === 404) {
  await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', subscription.endpoint);
  console.log('Removed stale subscription:', subscription.endpoint);
}
```

### Gotchas
- `web-push` throws on non-2xx responses. Wrap in try/catch and check
  `err.statusCode`.
- Use the **service role** Supabase client for deleting subscriptions (the
  Edge Function should already have this).
- Don't fail the entire function if one subscription is stale — use
  `Promise.allSettled()` to send to all subscriptions and clean up failures.

---

## 8. Verification pass

### Push Subscription
- [ ] Log in as admin → check DevTools → Application → Push Messaging →
      subscription exists
- [ ] Log in as driver → same check
- [ ] Check Supabase `push_subscriptions` table → records exist for both
- [ ] Log out → record is deleted from Supabase + local subscription cleared

### Push Delivery
- [ ] Submit a driver order → admin receives background push notification
      (even with admin tab in background / minimized)
- [ ] Tap notification → opens admin dashboard to Incoming Orders
- [ ] Admin confirms order → driver receives push notification
- [ ] Tap notification → opens driver portal to My Orders

### Notification Toggle
- [ ] Turn off notifications in Settings → push subscription removed
- [ ] Turn on notifications in Settings → push subscription recreated
- [ ] Audio chime still respects the toggle independently

### Edge Cases
- [ ] Log in on two devices → both receive push for same event
- [ ] Revoke notification permission in browser → next login handles
      gracefully (no crash, shows opt-in banner)
- [ ] SW updates → push subscription refreshed automatically

### iOS PWA
- [ ] iOS 16.4+ in standalone mode → opt-in banner appears on first run
- [ ] Tap "Enable" → permission prompt → push works
- [ ] Background push arrives when app is in background (iOS limitations
      apply — may not work reliably, but should not crash)
