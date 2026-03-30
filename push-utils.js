// push-utils.js — shared push subscription utilities
// Used by both admin-dashboard.js and driver-order.js
// M1: Production-safe logger — silences debug logs on production
const __DEV__ = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const _log = __DEV__ ? console.log.bind(console) : () => {};


const VAPID_PUBLIC_KEY = 'BPK9nQfqIXaf-kc5HHJ5G6trkWxjAX9MzeYwLTUfcnk4jWVYVO6gpzXS-d0tNgGTmHp0ntzYe3xRKT0Ud3t5a3Q';

/**
 * Subscribe to Web Push notifications.
 * Safe to call multiple times — upserts the subscription in Supabase.
 *
 * @param {object} sb — Supabase client instance
 * @param {string} userType — 'admin' or 'driver'
 * @param {string} userId — Supabase user/driver ID
 * @param {string} lang — 'en' or 'es'
 * @param {function} showToast — toast function (message, type)
 */
export async function subscribeToPush(sb, userType, userId, lang, showToast) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    _log('Push not supported in this browser');
    return;
  }
  if (!sb) return;

  try {
    // Wait for SW — 15 seconds (iOS PWA can be slow on first load)
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout (15s)')), 15000))
    ]);

    _log('Service Worker ready, checking push subscription...');

    // Request notification permission first
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      _log('Notification permission:', perm);
      if (perm !== 'granted') {
        console.warn('Notification permission denied');
        return;
      }
    } else if (Notification.permission === 'denied') {
      console.warn('Notifications are blocked in browser settings');
      return;
    }

    // Convert VAPID key
    const urlBase64 = VAPID_PUBLIC_KEY;
    const padding = '='.repeat((4 - urlBase64.length % 4) % 4);
    const base64 = (urlBase64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const applicationServerKey = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) applicationServerKey[i] = rawData.charCodeAt(i);

    // Check existing subscription
    let sub = await reg.pushManager.getSubscription();

    if (sub) {
      // Verify the existing subscription matches our current VAPID key
      try {
        const existingKey = sub.options?.applicationServerKey;
        if (existingKey) {
          const existingKeyArray = new Uint8Array(existingKey);
          const keysMatch = existingKeyArray.length === applicationServerKey.length &&
            existingKeyArray.every((val, i) => val === applicationServerKey[i]);
          if (!keysMatch) {
            console.warn('VAPID key mismatch — unsubscribing stale subscription');
            await sub.unsubscribe();
            sub = null;
          }
        }
      } catch (keyCheckErr) {
        console.warn('Could not verify existing sub key, re-subscribing:', keyCheckErr);
        try { await sub.unsubscribe(); } catch (_) {}
        sub = null;
      }
    }

    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
        _log('Push subscription created');
      } catch (subErr) {
        // If subscribe fails (e.g., stale registration), try unsubscribe + retry once
        console.warn('Subscribe failed, attempting cleanup + retry:', subErr.message);
        const oldSub = await reg.pushManager.getSubscription();
        if (oldSub) {
          await oldSub.unsubscribe();
          _log('Unsubscribed stale registration');
        }
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
        _log('Push subscription created (retry succeeded)');
      }
    } else {
      _log('Existing push subscription found (VAPID key verified)');
    }

    // Save subscription to Supabase
    const subJson = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_type: userType,
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth
    }, { onConflict: 'user_type,user_id,endpoint' });

    if (error) {
      console.error('Push sub save error:', error);
      if (showToast) showToast(lang === 'es' ? 'Error guardando notificaciones push' : 'Error saving push notification subscription', 'error');
    } else {
      _log('✅ Push subscription saved for', userType, userId);
    }
  } catch (e) {
    console.error('Push subscription failed:', e.message || e);
    if (showToast) showToast(lang === 'es' ? 'Error configurando notificaciones' : 'Error setting up notifications — please reload', 'error');
  }
}

/**
 * Unsubscribe from Web Push and clean up Supabase record.
 *
 * @param {object} sb — Supabase client instance
 * @param {string} userType — 'admin' or 'driver'
 * @param {string} userId — Supabase user/driver ID
 */
export async function unsubscribeFromPush(sb, userType, userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from('push_subscriptions').delete()
        .eq('user_type', userType)
        .eq('user_id', userId)
        .eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
      _log('Push subscription cleaned up for', userType, userId);
    }
  } catch (e) {
    console.warn('Push unsubscribe error:', e);
  }
}
