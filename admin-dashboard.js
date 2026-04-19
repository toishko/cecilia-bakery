/* ═══════════════════════════════════
   SUPABASE INIT
   ═══════════════════════════════════ */
// M1: Production-safe logger — silences debug logs on production
const __DEV__ = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const _log = __DEV__ ? console.log.bind(console) : () => {};

const SUPABASE_URL = 'https://dykztphptnytbihpavpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w';
import { subscribeToPush as _subscribeToPush, unsubscribeFromPush } from './push-utils.js';

// ── Push Notification Trigger ──
// Calls the Edge Function to send push notifications to admins/drivers
async function triggerPushNotification(type, table, record, old_record) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ type, table, record, old_record })
    });
    const result = await res.json();
    _log('Push notification result:', result);
  } catch (e) {
    console.warn('Push notification trigger failed:', e);
  }
}

let sb = null;
try {
  const supabaseLib = window.supabase;
  if (supabaseLib && supabaseLib.createClient) {
    sb = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY);
    _log('Admin: Supabase client initialized');
  } else {
    console.error('Supabase JS not loaded');
  }
} catch (e) { console.error('Supabase init failed:', e); }

/* ═══════════════════════════════════
   STATE
   ═══════════════════════════════════ */
let currentUser = null;
let lang = localStorage.getItem('cecilia_admin_lang') || 'en';
let notificationsEnabled = localStorage.getItem('cecilia_admin_notifications') !== 'false';
let currentSection = 'overview';
let incomingOrders = [];
let historyOrders = [];
let historyPage = 0;
const PAGE_SIZE = 50;
let realtimeChannel = null;
let driversCache = [];

// Cached channel breakdown for stat sheet drill-downs
let _channelBreakdown = {
  driverGross: 0, driverCollected: 0, driverOutstanding: 0,
  wholesaleGross: 0, wholesaleCollected: 0, wholesaleOutstanding: 0,
  onlineGross: 0, onlineCollected: 0
};

// Track orders that were edited by staff (via realtime, session-only)
const _staffEditedOrders = new Set();

/* ── Seen / Unseen Order Tracking ── */
const _SEEN_DRIVER_KEY = 'cecilia_seen_driver_orders';
const _SEEN_ONLINE_KEY = 'cecilia_seen_online_orders';

function _getSeenSet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function _saveSeenSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function markDriverOrderSeen(orderId) {
  const seen = _getSeenSet(_SEEN_DRIVER_KEY);
  if (seen.has(orderId)) return;
  seen.add(orderId);
  _saveSeenSet(_SEEN_DRIVER_KEY, seen);
  updateIncomingBadge();
  // Remove unseen animation from card
  const card = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
  if (card) card.classList.remove('order-unseen');
  // Also update needs attention if on overview
  if (currentSection === 'overview') renderNeedsAttention();
}

function markOnlineOrderSeen(orderId) {
  const seen = _getSeenSet(_SEEN_ONLINE_KEY);
  if (seen.has(orderId)) return;
  seen.add(orderId);
  _saveSeenSet(_SEEN_ONLINE_KEY, seen);
  updateOnlineOrdersBadge();
  // Remove unseen animation from card
  const card = document.getElementById('online-order-' + orderId);
  if (card) card.classList.remove('order-unseen');
}

function markAllOnlineOrdersSeen() {
  const seen = _getSeenSet(_SEEN_ONLINE_KEY);
  let changed = false;
  _cachedOnlineOrders.forEach(o => {
    if (!seen.has(o.id)) { seen.add(o.id); changed = true; }
  });
  if (changed) {
    _saveSeenSet(_SEEN_ONLINE_KEY, seen);
    updateOnlineOrdersBadge();
    if (currentSection === 'overview') renderNeedsAttention();
  }
}

function isDriverOrderSeen(orderId) {
  if (_getSeenSet(_SEEN_DRIVER_KEY).has(orderId)) return true;
  // If payment/status was already changed from defaults, admin already interacted
  const order = incomingOrders.find(o => o.id === orderId);
  if (order && (order.status !== 'pending' || order.payment_status !== 'not_paid')) return true;
  return false;
}

function isOnlineOrderSeen(orderId) {
  if (_getSeenSet(_SEEN_ONLINE_KEY).has(orderId)) return true;
  // If order isn't in active cache, it's completed/cancelled = seen
  const order = _cachedOnlineOrders.find(o => o.id === orderId);
  if (!order) return true;
  // If status changed from pending, admin already interacted
  if (order.delivery_status !== 'pending') return true;
  return false;
}

/* ═══════════════════════════════════
   SCREEN MANAGEMENT
   ═══════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

window.showSection = showSection;

/* ── Section → Group mapping for bottom nav ── */
const _sectionGroupMap = {
  overview: 'dashboard',
  incoming: 'orders', 'online-orders': 'orders', history: 'orders',
  insights: 'insights',
  drivers: 'manage', products: 'manage', 'new-order': 'manage', wholesale: 'manage',
  settings: 'settings', staff: 'settings'
};

/* Track last-visited section per group so re-tapping restores it */
const _lastSectionInGroup = {
  dashboard: 'overview',
  orders: 'incoming',
  insights: 'insights',
  manage: 'drivers',
  settings: 'settings'
};

/* ── Action Sheet configuration ── */
const _actionSheetConfig = {
  orders: {
    titleEn: 'Orders', titleEs: 'Pedidos',
    items: [
      { icon: 'truck', en: 'Driver Orders', es: 'Pedidos Conductores', section: 'incoming', badgeId: 'as-incoming-badge' },
      { icon: 'globe', en: 'Online Orders', es: 'Pedidos en Línea', section: 'online-orders', badgeId: 'as-online-badge' },
      { icon: 'clock', en: 'History', es: 'Historial', section: 'history' }
    ]
  },
  manage: {
    titleEn: 'Manage', titleEs: 'Gestionar',
    items: [
      { icon: 'users', en: 'Drivers', es: 'Conductores', section: 'drivers' },
      { icon: 'package', en: 'Products', es: 'Productos', section: 'products' },
      { icon: 'plus-circle', en: 'New Order', es: 'Nuevo Pedido', section: 'new-order' },
      { icon: 'building-2', en: 'Wholesale', es: 'Mayoreo', section: 'wholesale', badgeId: 'as-wholesale-badge' }
    ]
  },
  settings: {
    titleEn: 'Config', titleEs: 'Configuración',
    items: [
      { icon: 'settings', en: 'Settings', es: 'Configuración', section: 'settings' },
      { icon: 'shield', en: 'Staff', es: 'Personal', section: 'staff' }
    ]
  }
};

let _actionSheetOpenGroup = null; // tracks which group sheet is open

function _openActionSheet(group) {
  const config = _actionSheetConfig[group];
  if (!config) return;
  _actionSheetOpenGroup = group;

  const overlay = document.getElementById('action-sheet-overlay');
  const titleEl = document.getElementById('action-sheet-title');
  const itemsEl = document.getElementById('action-sheet-items');

  // Set title
  titleEl.textContent = lang === 'es' ? config.titleEs : config.titleEn;

  // Build items
  itemsEl.innerHTML = config.items.map(item => {
    const isActive = currentSection === item.section ? ' active-section' : '';
    const label = lang === 'es' ? item.es : item.en;
    const badgeHtml = item.badgeId
      ? `<span class="action-sheet-badge" id="${item.badgeId}" style="display:none">0</span>`
      : '';
    return `<button class="action-sheet-item${isActive}" data-section="${item.section}">
      <i data-lucide="${item.icon}"></i>
      <span class="action-sheet-item-label">${label}</span>
      ${badgeHtml}
    </button>`;
  }).join('');

  // Render Lucide icons inside sheet
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [itemsEl] });

  // Wire item clicks
  itemsEl.querySelectorAll('.action-sheet-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      _closeActionSheet();
      showSection(section);
    });
  });

  // Update badges
  _updateActionSheetBadges();

  // Highlight the correct bottom nav tab
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === group);
  });

  // Close any open order/queue sheets first
  if (typeof closeOrderSheet === 'function') closeOrderSheet();
  if (typeof closeQueueSheet === 'function') closeQueueSheet();
  if (typeof closeOrderedSheet === 'function') closeOrderedSheet();

  // Open with animation
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function _closeActionSheet() {
  const overlay = document.getElementById('action-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
  _actionSheetOpenGroup = null;
}

function _toggleActionSheet(group) {
  if (_actionSheetOpenGroup === group) {
    _closeActionSheet();
  } else {
    _closeActionSheet();
    // Small delay so close animation plays first if switching groups
    setTimeout(() => _openActionSheet(group), _actionSheetOpenGroup ? 100 : 0);
  }
}

function _updateActionSheetBadges() {
  // Driver orders badge
  const driverCount = incomingOrders.filter(o =>
    o.status === 'pending' || o.status === 'confirmed' || o.status === 'sent'
  ).length;
  const dBadge = document.getElementById('as-incoming-badge');
  if (dBadge) { dBadge.textContent = driverCount; dBadge.style.display = driverCount > 0 ? '' : 'none'; }

  // Online orders badge
  const onlineCount = typeof _cachedOnlineOrders !== 'undefined' ? _cachedOnlineOrders.length : 0;
  const oBadge = document.getElementById('as-online-badge');
  if (oBadge) { oBadge.textContent = onlineCount; oBadge.style.display = onlineCount > 0 ? '' : 'none'; }

  // Wholesale badge (reads the existing sidebar badge value)
  const existingWsBadge = document.getElementById('wholesale-badge');
  const wsCount = existingWsBadge ? parseInt(existingWsBadge.textContent) || 0 : 0;
  const wBadge = document.getElementById('as-wholesale-badge');
  if (wBadge) { wBadge.textContent = wsCount; wBadge.style.display = wsCount > 0 ? '' : 'none'; }
}

async function showSection(name) {
  // Warn about unsaved Product Manager changes when navigating away
  if (typeof _pmHasPending === 'function' && _pmHasPending() && currentSection === 'products' && name !== 'products') {
    const canLeave = await _pmConfirmDiscard();
    if (!canLeave) return;
  }
  currentSection = name;
  sessionStorage.setItem('admin_section', name);

  // Remember this section as the last-visited in its group
  const group = _sectionGroupMap[name];
  if (group) _lastSectionInGroup[group] = name;

  // Close old mobile dropdown (legacy, still in DOM but hidden)
  document.getElementById('mobile-nav').classList.remove('open');
  document.getElementById('mobile-menu-btn').classList.remove('open');

  // Hide all sections, show target
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = 'block';

  // Hide the new-order footer bar if navigating away
  if (name !== 'new-order') {
    const ff = document.getElementById('form-footer');
    if (ff) ff.style.display = 'none';
  }

  // Update desktop sidebar + old mobile nav active states
  document.querySelectorAll('.sidebar-nav-item, .mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });

  // ── Bottom Nav: highlight the correct group tab ──
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === group);
  });

  // ── Close any open sheets/overlays when switching sections ──
  _closeActionSheet();
  if (typeof closeOrderSheet === 'function') closeOrderSheet();
  if (typeof closeQueueSheet === 'function') closeQueueSheet();
  if (typeof closeOrderedSheet === 'function') closeOrderedSheet();

  // Update mobile header section name
  const nameEl = document.getElementById('mobile-section-name');
  const activeBtn = document.querySelector(`.sidebar-nav-item[data-section="${name}"] span`);
  if (nameEl && activeBtn) {
    const enName = activeBtn.getAttribute('data-en') || activeBtn.textContent;
    const esName = activeBtn.getAttribute('data-es') || activeBtn.textContent;
    nameEl.setAttribute('data-en', enName);
    nameEl.setAttribute('data-es', esName);
    nameEl.textContent = lang === 'es' ? esName : enName;
  }

  // Unsubscribe admin products realtime when leaving the products tab
  if (currentSection === 'products' && name !== 'products') {
    try {
      const sb = window.__supabase;
      if (sb) sb.removeChannel(sb.channel('admin-products-live'));
    } catch (_) {}
  }

  if (name === 'overview') loadOverview();
  if (name === 'insights') loadInsights();
  if (name === 'online-orders') { loadOnlineOrders(); markAllOnlineOrdersSeen(); }
  if (name === 'incoming') loadIncomingOrders();
  if (name === 'new-order') initAdminOrderForm();
  if (name === 'history') loadHistoryOrders(true);
  if (name === 'drivers') {
    const subview = sessionStorage.getItem('driver_subview');
    if (subview === 'form') {
      _restoreDriverForm().then(restored => { if (!restored) { showDriversListView(); loadDriverList(); } });
    } else {
      showDriversListView(); loadDriverList();
    }
  }

  if (name === 'products') loadProductManager();
  if (name === 'staff') loadStaffSection();
  if (name === 'wholesale') loadWholesaleSection();
}

/* Exposed for pull-to-refresh.js — reloads the current active section */
window.__adminRefresh = async function () {
  const fnMap = {
    overview:  loadOverview,
    insights:  loadInsights,
    'online-orders': loadOnlineOrders,
    incoming:  loadIncomingOrders,
    'new-order': initAdminOrderForm,
    drivers:   loadDriverList,
    history:   () => loadHistoryOrders(true),
    products:  loadProductManager,
    settings:  () => {},
    staff:     loadStaffSection,
    wholesale: loadWholesaleSection,
  };
  const fn = fnMap[currentSection];
  if (fn) await fn();
};

/* ═══════════════════════════════════
   AUTH — CLERK-BASED LOGIN
   ═══════════════════════════════════ */
function showLoginScreen() {
  showScreen('login');
  mountClerkSignIn();
}

function mountClerkSignIn() {
  const mount = document.getElementById('clerk-mount-target');
  if (mount && window.Clerk) {
    mount.innerHTML = '';
    window.Clerk.mountSignIn(mount, {
      afterSignInUrl: '/admin-dashboard.html',
      afterSignUpUrl: '/admin-dashboard.html',
    });
  }
}

async function handleClerkUser(user) {
  if (!user) {
    showLoginScreen();
    return;
  }

  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const email = user.primaryEmailAddress?.emailAddress || '';
    console.log('[AUTH] Clerk user ID:', user.id, 'Email:', email);

    // ── Strategy 1: Look up profile by clerk_user_id ──
    let existingRole = null;
    let profileFound = false;

    try {
      const resp1 = await sb
        .from('profiles')
        .select('role, email, clerk_user_id')
        .eq('clerk_user_id', user.id)
        .maybeSingle();

      console.log('[AUTH] Lookup by clerk_user_id:', JSON.stringify(resp1.data), 'Error:', JSON.stringify(resp1.error));

      if (resp1.data) {
        existingRole = resp1.data.role;
        profileFound = true;
        // Silently update email if needed
        if (resp1.data.email !== email) {
          await sb.from('profiles').update({ email }).eq('clerk_user_id', user.id);
        }
      }
    } catch (e1) {
      console.warn('[AUTH] Lookup 1 exception:', e1);
    }

    // ── Strategy 2: Fallback — look up by email ──
    if (!profileFound && email) {
      try {
        const resp2 = await sb
          .from('profiles')
          .select('role, clerk_user_id, id')
          .ilike('email', email)
          .maybeSingle();

        console.log('[AUTH] Lookup by email:', JSON.stringify(resp2.data), 'Error:', JSON.stringify(resp2.error));

        if (resp2.data) {
          existingRole = resp2.data.role;
          profileFound = true;
          // Link the Clerk user ID to this profile if not already linked
          if (!resp2.data.clerk_user_id || resp2.data.clerk_user_id !== user.id) {
            console.log('[AUTH] Linking clerk_user_id to existing profile');
            await sb.from('profiles').update({ clerk_user_id: user.id }).eq('id', resp2.data.id);
          }
        }
      } catch (e2) {
        console.warn('[AUTH] Lookup 2 exception:', e2);
      }
    }

    // ── Strategy 3: Last resort — fetch ALL profiles and check ──
    if (!profileFound) {
      try {
        const resp3 = await sb
          .from('profiles')
          .select('id, role, clerk_user_id, email')
          .order('created_at', { ascending: false })
          .limit(20);

        console.log('[AUTH] All profiles dump:', JSON.stringify(resp3.data), 'Error:', JSON.stringify(resp3.error));

        if (resp3.data) {
          // Try to find matching row
          const match = resp3.data.find(p =>
            p.clerk_user_id === user.id ||
            (p.email && p.email.toLowerCase() === email.toLowerCase())
          );
          if (match) {
            existingRole = match.role;
            profileFound = true;
            console.log('[AUTH] Found match via dump:', JSON.stringify(match));
          }
        }
      } catch (e3) {
        console.warn('[AUTH] Strategy 3 exception:', e3);
      }
    }

    // ── Create profile if none exists ──
    if (!profileFound) {
      console.log('[AUTH] No profile found — creating new one with clerk_user_id:', user.id, 'email:', email);
      try {
        const { data: inserted, error: insertErr } = await sb.from('profiles')
          .insert({ clerk_user_id: user.id, email: email, role: 'customer' })
          .select()
          .single();
        if (insertErr) {
          console.error('[AUTH] Insert error:', JSON.stringify(insertErr));
          // Retry without .select().single() in case it's a PostgREST issue
          const { error: retryErr } = await sb.from('profiles')
            .insert({ clerk_user_id: user.id, email: email, role: 'customer' });
          if (retryErr) {
            console.error('[AUTH] Retry insert error:', JSON.stringify(retryErr));
          } else {
            console.log('[AUTH] Retry insert succeeded');
            existingRole = 'customer';
            profileFound = true;
          }
        } else {
          console.log('[AUTH] Profile created successfully:', JSON.stringify(inserted));
          existingRole = 'customer';
          profileFound = true;
        }
      } catch (ie) {
        console.error('[AUTH] Insert exception:', ie);
      }
    }

    console.log('[AUTH] Final role:', existingRole, '| Profile found:', profileFound);

    // Role check — admin only
    if (existingRole !== 'admin') {
      _log('User role is not admin. Role:', existingRole);
      errorEl.innerHTML = lang === 'es'
        ? 'Acceso denegado. Solo cuentas de administrador.<br><small style="color:var(--tx-muted)">Tu cuenta fue registrada. Un administrador puede darte acceso.</small>'
        : 'Access denied. Admin accounts only.<br><small style="color:var(--tx-muted)">Your account has been registered. An admin can grant you access from the Staff tab.</small>';
      await window.Clerk.signOut();
      showLoginScreen();
      return;
    }

    currentUser = user;
    enterDashboard(user);
  } catch (e) {
    console.error('Auth check error:', e);
    errorEl.textContent = lang === 'es' ? 'Error de conexión' : 'Connection error';
  }
}

async function checkSession() {
  try {
    if (!window.Clerk) {
      _log('Clerk not available yet');
      return false;
    }
    await window.Clerk.load();

    const user = window.Clerk.user;
    if (user) {
      await handleClerkUser(user);
      return true;
    } else {
      showLoginScreen();
    }
  } catch (e) { console.error('Session check error:', e); }
  return false;
}

function enterDashboard(user) {
  applyLang();
  showScreen('dashboard');
  const savedSection = sessionStorage.getItem('admin_section') || 'overview';
  showSection(savedSection);
  loadDriversCache();
  setupRealtime();
  setupOnlineOrdersRealtime();
  updateOnlineOrdersBadge();
  updateWholesaleBadge();
  setupWholesaleRealtime();
  loadIncomingOrders();
  requestNotifPermission();
  // Push opt-in: only auto-subscribe if permission already granted
  const clerkUserId = user?.id || currentUser?.id || '';
  if ('Notification' in window && Notification.permission === 'granted') {
    subscribeToPush('admin', clerkUserId);
  } else if ('Notification' in window && Notification.permission === 'default') {
    const dismissed = localStorage.getItem('cb-admin-notif-dismissed');
    if (!dismissed || (Date.now() - parseInt(dismissed)) >= 24 * 60 * 60 * 1000) {
      setTimeout(function() { showAdminNotifBanner(); }, 2000);
    }
  }
  lucide.createIcons();

  // Show admin email in settings
  const adminInfo = document.getElementById('admin-info');
  const displayEmail = user?.primaryEmailAddress?.emailAddress || currentUser?.primaryEmailAddress?.emailAddress || '';
  if (adminInfo && displayEmail) {
    adminInfo.textContent = `${lang === 'es' ? 'Sesión:' : 'Signed in as:'} ${displayEmail}`;
  }
}

async function handleLogout() {
  // Clean up push subscription on logout
  const clerkUserId = currentUser?.id || '';
  if (clerkUserId) {
    await unsubscribeFromPush(sb, 'admin', clerkUserId);
  }

  try {
    if (window.Clerk) await window.Clerk.signOut();
  } catch (e) { console.error(e); }
  currentUser = null;
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  showLoginScreen();
}

/* ═══════════════════════════════════
   LANGUAGE
   ═══════════════════════════════════ */
function setLang(l) {
  lang = l;
  localStorage.setItem('cecilia_admin_lang', lang);
  applyLang();
}

function applyLang() {
  document.querySelectorAll('[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.textContent = text;
  });
  document.querySelectorAll('[data-en-placeholder]').forEach(el => {
    const ph = el.getAttribute('data-' + lang + '-placeholder');
    if (ph) el.placeholder = ph;
  });
  const lb = document.getElementById('login-lang-btn');
  if (lb) lb.textContent = lang.toUpperCase();
  document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // Update select options
  document.querySelectorAll('select option[data-en]').forEach(opt => {
    const text = opt.getAttribute('data-' + lang);
    if (text) opt.textContent = text;
  });
}

/* ═══════════════════════════════════
   THEME
   ═══════════════════════════════════ */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('cecilia_admin_theme', isDark ? 'light' : 'dark');
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = !isDark;
}

function applyTheme() {
  const saved = localStorage.getItem('cecilia_admin_theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = saved === 'dark';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = false;
  }
}

/* ═══════════════════════════════════
   TEXT SIZE
   ═══════════════════════════════════ */
function changeSize(delta) {
  const html = document.documentElement;
  const current = parseFloat(getComputedStyle(html).fontSize);
  const next = Math.min(24, Math.max(12, current + delta));
  html.style.fontSize = next + 'px';
  localStorage.setItem('cecilia_admin_font_size', next);
}

/* ═══════════════════════════════════
   DRIVERS CACHE
   ═══════════════════════════════════ */
async function loadDriversCache() {
  try {
    const { data } = await sb.from('drivers').select('id, name, code').order('name');
    driversCache = data || [];
    // Populate driver filter dropdown
    const select = document.getElementById('filter-driver');
    if (select && driversCache.length) {
      // Keep the first "All Drivers" option
      const firstOpt = select.querySelector('option');
      select.innerHTML = '';
      select.appendChild(firstOpt);
      driversCache.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        select.appendChild(opt);
      });
    }
  } catch (e) { console.error('Drivers cache error:', e); }
}

function getDriverName(driverId) {
  const d = driversCache.find(x => x.id === driverId);
  return d ? d.name : 'Unknown';
}

/* ═══════════════════════════════════
   SUPABASE REALTIME
   ═══════════════════════════════════ */
function setupRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
  }

  realtimeChannel = sb
    .channel('admin-orders-realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'driver_orders'
    }, (payload) => {
      _log('Realtime INSERT:', payload);
      handleNewOrder(payload.new);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'driver_orders'
    }, (payload) => {
      _log('Realtime UPDATE:', payload);
      handleOrderUpdate(payload.new);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'driver_order_items'
    }, (payload) => {
      _log('Realtime driver_order_items change:', payload);
      handleOrderItemsChange(payload);
    })
    .subscribe((status) => {
      _log('Realtime subscription status:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime disconnected, reconnecting in 3s...');
        setTimeout(() => setupRealtime(), 3000);
      }
    });

  // Start reliability layers
  startRealtimeGuard();
}

/* ── Wholesale badge (lightweight — no full section load) ── */
async function updateWholesaleBadge() {
  const { data, error } = await sb.from('wholesale_accounts').select('id', { count: 'exact', head: false }).eq('status', 'pending');
  const count = (data && data.length) || 0;
  const badge = document.getElementById('wholesale-badge');
  const badgeM = document.getElementById('wholesale-badge-m');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
  if (badgeM) { badgeM.textContent = count; badgeM.style.display = count > 0 ? '' : 'none'; }

  // Bottom nav "Manage" badge
  const manageBadge = document.getElementById('manage-bottom-badge');
  if (manageBadge) { manageBadge.textContent = count; manageBadge.style.display = count > 0 ? '' : 'none'; }

}

/* ── Wholesale realtime subscription ── */
function setupWholesaleRealtime() {
  sb.channel('admin-wholesale-live')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'wholesale_accounts'
    }, (payload) => {
      updateWholesaleBadge();
      if (payload.eventType === 'INSERT') {
        showToast('New wholesale application received!', 'success');
      }
      if (currentSection === 'wholesale') {
        loadWholesaleSection();
      }
    })
    .subscribe();

  // Wholesale orders realtime
  sb.channel('admin-ws-orders-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wholesale_orders' }, function(payload) {
      if (payload.eventType === 'INSERT') {
        showToast('New wholesale order received!', 'success');
      }
      updateWholesaleBadge();
      if (currentSection === 'wholesale') {
        loadWholesaleSection();
      }
    })
    .subscribe();
}

/* ── RELIABILITY LAYER 1: Visibility change ──
   When user returns to tab (switches back, unlocks phone),
   immediately reconnect WebSocket and reload latest orders */
let _visibilityListenerAdded = false;
function startRealtimeGuard() {
  if (_visibilityListenerAdded) return;
  _visibilityListenerAdded = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser) {
      _log('Tab visible — reconnecting realtime + refreshing orders');
      // Reconnect WebSocket (mobile often kills it in background)
      setupRealtime();
      // Immediately fetch latest orders
      silentRefreshOrders();
      updateOnlineOrdersBadge();
    }
  });

  // Also handle iOS PWA resume (doesn't always fire visibilitychange)
  window.addEventListener('focus', () => {
    if (currentUser) {
      silentRefreshOrders();
    }
  });

  // RELIABILITY LAYER 2: Periodic polling fallback
  // Every 60 seconds, check database for orders the WebSocket may have missed
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser) {
      silentRefreshOrders();
    }
  }, 60 * 1000);
}

/* ── Silent refresh: fetch latest orders and detect new ones ── */
let _lastKnownOrderIds = new Set();

async function silentRefreshOrders() {
  if (!sb || !currentUser) return;
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('*')
      .in('status', ['pending', 'confirmed', 'sent', 'picked_up'])
      .order('submitted_at', { ascending: false });

    if (error || !data) return;

    // On first run, just seed the known IDs
    if (_lastKnownOrderIds.size === 0) {
      data.forEach(o => _lastKnownOrderIds.add(o.id));
      incomingOrders = data;
      updateIncomingBadge();
      if (currentSection === 'incoming') renderIncomingOrders();
      if (currentSection === 'overview') loadOverview();
      return;
    }

    // Detect truly new orders (ones we haven't seen before)
    const newOrders = data.filter(o => !_lastKnownOrderIds.has(o.id));

    // Update known IDs
    data.forEach(o => _lastKnownOrderIds.add(o.id));

    // Update the order list
    incomingOrders = data;
    updateIncomingBadge();

    // Notify about new orders that the WebSocket missed
    newOrders.forEach(order => {
      _log('Polling caught missed order:', order.id);
      if (notificationsEnabled) playNotification();
      showToast(lang === 'es' ? '🚚 Nuevo pedido de conductor' : '🚚 New driver order received', 'info');
    });

    // Re-render current view
    if (currentSection === 'incoming') renderIncomingOrders();
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.warn('Silent refresh failed:', e);
  }
}

function handleNewOrder(order) {
  // Mark as known so polling won't re-notify
  _lastKnownOrderIds.add(order.id);

  // Add to incoming orders if not already there
  if (!incomingOrders.find(o => o.id === order.id)) {
    incomingOrders.unshift(order);
  }

  // Play notification sound
  if (notificationsEnabled) playNotification();

  // Show toast
  showToast(lang === 'es' ? '🚚 Nuevo pedido de conductor' : '🚚 New driver order received', 'info');

  // NOTE: Browser push notification is handled by the Edge Function (triggerPushNotification)
  // No need to also call showBrowserNotification here — that causes duplicates

  // Update badge
  updateIncomingBadge();

  // Re-render if on incoming page
  if (currentSection === 'incoming') renderIncomingOrders();
  if (currentSection === 'overview') loadOverview();
}

async function handleOrderUpdate(order) {
  // Capture last_edited_by before refetch (payload.new has it)
  const editedBy = order.last_edited_by || '';

  // Refetch the full order with items so changes show immediately
  try {
    const { data } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .eq('id', order.id)
      .single();
    if (data) order = data;
  } catch (e) { /* use the payload order as fallback */ }

  // Preserve last_edited_by on refetched order
  if (editedBy && !order.last_edited_by) order.last_edited_by = editedBy;

  // Update in incoming orders
  const idx = incomingOrders.findIndex(o => o.id === order.id);
  if (idx !== -1) incomingOrders[idx] = order;
  else incomingOrders.unshift(order);

  // Show toast with editor name if someone edited
  if (editedBy) {
    const driverName = getDriverName(order.driver_id);
    const msg = lang === 'es'
      ? `Pedido${driverName ? ' de ' + driverName : ''} editado por ${editedBy}`
      : `${driverName ? driverName + "'s order" : 'Order'} updated by ${editedBy}`;
    showToast(msg, 'info');
    _staffEditedOrders.add(order.id);
  }

  // Re-render if viewing
  if (currentSection === 'incoming') renderIncomingOrders();
  if (currentSection === 'overview') loadOverview();
}

// Debounced handler for item-level changes
let _itemChangeTimer = null;
let _isSavingOrder = false; // prevents realtime from clobbering detailItems mid-save
function handleOrderItemsChange(payload) {
  // Skip entirely while the admin is actively saving — the save function
  // manages detailItems itself; letting realtime overwrite it mid-save
  // causes duplicate inserts and lost _isNew flags.
  if (_isSavingOrder) {
    _log('[REALTIME] Suppressed during active save');
    return;
  }

  // Debounce: staff often updates multiple items at once
  clearTimeout(_itemChangeTimer);
  _itemChangeTimer = setTimeout(async () => {
    // Re-check flag after debounce delay (save may have started in the interim)
    if (_isSavingOrder) return;

    // Identify the affected order
    const orderId = payload.new ? payload.new.order_id : (payload.old ? payload.old.order_id : null);

    // Track this order as staff-edited
    if (orderId) _staffEditedOrders.add(orderId);

    // If this is the order the admin currently has open and is editing,
    // skip the toast and live-refresh — the admin IS the editor.
    const isOwnEdit = orderId && detailOrder && detailOrder.id === orderId;

    // Show toast with editor name (only for external edits)
    if (orderId && !isOwnEdit) {
      try {
        const match = incomingOrders.find(o => o.id === orderId);
        const driverName = match ? getDriverName(match.driver_id) : '';
        const editedBy = match && match.last_edited_by ? match.last_edited_by : 'staff';
        const msg = lang === 'es'
          ? `Pedido${driverName ? ' de ' + driverName : ''} editado por ${editedBy}`
          : `${driverName ? driverName + "'s order" : 'Order'} updated by ${editedBy}`;
        console.log('[REALTIME DEBUG] About to show toast:', msg);
        showToast(msg, 'info');
      } catch (e) { console.error('handleOrderItemsChange toast error:', e); }
    }

    // Refresh the order list
    silentRefreshOrders();

    // If the detail modal is open for the affected order, refresh it live
    // BUT only if it's an external edit — not our own save.
    const overlay = document.getElementById('order-sheet-overlay');
    if (orderId && detailOrder && detailOrder.id === orderId && overlay && overlay.classList.contains('open') && !isOwnEdit) {
      try {
        const { data: items } = await sb.from('driver_order_items').select('*').eq('order_id', orderId);
        if (items) {
          detailItems = sortItemsByCategory(items);
          await renderOrderSheet();
        }
      } catch (e) { console.warn('Detail refresh failed:', e); }
    }
  }, 1500);
}

/* ═══════════════════════════════════
   NOTIFICATION SOUND
   ═══════════════════════════════════ */
function playNotification() {
  try {
    // Create a simple chime using Web Audio API
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) { console.warn('Audio notification failed:', e); }
}

// ── BROWSER NOTIFICATION API ──
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      _log('Notification permission:', perm);
    });
  }
}

function showAdminNotifBanner() {
  var dismissed = localStorage.getItem('cb-admin-notif-dismissed');
  if (dismissed && (Date.now() - parseInt(dismissed)) < 24 * 60 * 60 * 1000) return;
  var existing = document.getElementById('admin-notif-banner');
  if (existing) return;

  var banner = document.createElement('div');
  banner.id = 'admin-notif-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--red);color:#fff;padding:16px 20px;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 -4px 20px rgba(0,0,0,.2)';
  banner.innerHTML = '<div style="flex:1;min-width:200px">' +
    '<div style="font-weight:700;font-size:.95rem;margin-bottom:2px">🔔 Enable Notifications</div>' +
    '<div style="font-size:.82rem;opacity:.9">Get notified when new orders come in and when staff edits orders.</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-shrink:0">' +
      '<button onclick="dismissAdminNotifBanner()" style="padding:8px 16px;background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;font-size:.82rem;cursor:pointer">Later</button>' +
      '<button onclick="enableAdminNotifications()" style="padding:8px 16px;background:#fff;color:var(--red);border:none;border-radius:8px;font-size:.82rem;font-weight:700;cursor:pointer">Enable</button>' +
    '</div>';
  document.body.appendChild(banner);
}

window.enableAdminNotifications = function() {
  Notification.requestPermission().then(function(perm) {
    if (perm === 'granted') {
      showToast(lang === 'es' ? '¡Notificaciones activadas!' : 'Notifications enabled!', 'success');
      if (currentUser) subscribeToPush('admin', currentUser.id);
    } else {
      showToast(lang === 'es' ? 'Notificaciones bloqueadas. Actívalas en configuración del navegador.' : 'Notifications blocked. Enable in browser settings.', 'error');
    }
    dismissAdminNotifBanner();
  });
};

window.dismissAdminNotifBanner = function() {
  var banner = document.getElementById('admin-notif-banner');
  if (banner) banner.remove();
  localStorage.setItem('cb-admin-notif-dismissed', Date.now());
};

async function showBrowserNotification(title, body, section, orderId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!notificationsEnabled) return;

  const options = {
    body,
    icon: '/assets/logo.png',
    badge: '/assets/logo.png',
    tag: 'cecilia-order-' + (orderId || Date.now()),
    data: { url: '/admin-dashboard', section }
  };

  try {
    // Use service worker notification (required for iOS PWA standalone)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
    } else {
      // Fallback for browsers without service worker
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); if (section) showSection(section); n.close(); };
      setTimeout(() => n.close(), 8000);
    }
  } catch (e) { console.warn('Notification failed:', e); }
}

// ── WEB PUSH SUBSCRIPTION (delegated to push-utils.js) ──
async function subscribeToPush(userType, userId) {
  return _subscribeToPush(sb, userType, userId, lang, showToast);
}

/* ═══════════════════════════════════
   ONLINE ORDERS (website checkout)
   ═══════════════════════════════════ */
let _onlineOrdersChannel = null;
let _cachedOnlineOrders = [];

async function updateOnlineOrdersBadge() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('orders')
      .select('id, customer_name, customer_phone, total_amount, delivery_status, created_at')
      .eq('source', 'website')
      .in('delivery_status', ['pending', 'preparing', 'ready']);

    if (!error && data) _cachedOnlineOrders = data;

    // Badge counts ALL non-completed active orders
    const activeCount = _cachedOnlineOrders.length;

    const badges = [
      document.getElementById('online-orders-badge'),
      document.getElementById('online-orders-badge-mobile')
    ];
    badges.forEach(badge => {
      if (!badge) return;
      if (activeCount > 0) {
        badge.textContent = activeCount;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    });

    // Also refresh the combined bottom nav "Orders" badge
    _updateOrdersBottomBadge();

    // Re-render needs attention if on overview
    if (currentSection === 'overview') renderNeedsAttention();
  } catch (e) {
    console.warn('Online orders badge update failed:', e);
  }
}

function generateTimeOptions(selectedValue) {
  const times = [];
  for (let h = 8; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
      const ampm = h < 12 ? 'AM' : 'PM';
      const display = `${hour12}:${m === 0 ? '00' : m} ${ampm}`;
      const value = `${String(h).padStart(2, '0')}:${m === 0 ? '00' : m}`;
      const selected = selectedValue === value ? 'selected' : '';
      times.push(`<option value="${value}" ${selected}>${display}</option>`);
    }
  }
  return '<option value="">Set pickup time...</option>' + times.join('');
}

async function loadOnlineOrders() {
  _log('📦 loadOnlineOrders() called');
  _log('📦 sb client:', sb ? 'exists' : 'NULL');

  if (!sb) { console.warn('📦 Aborting: sb is null'); return; }

  const container = document.getElementById('section-online-orders');
  _log('📦 container:', container ? 'found' : 'NOT FOUND');
  if (!container) { console.warn('📦 Aborting: container not found'); return; }

  // Show loading
  container.innerHTML = '<div class="empty-state">Loading online orders...</div>';

  try {
    _log('📦 Querying orders table with source=website...');
    const { data, error } = await sb
      .from('orders')
      .select('*')
      .eq('source', 'website')
      .order('created_at', { ascending: false });

    _log('📦 Query result — error:', error, '| data:', data);
    _log('📦 Row count:', data ? data.length : 0);
    if (data && data.length > 0) _log('📦 First row:', JSON.stringify(data[0]).slice(0, 300));

    if (error) throw error;

    // Update badge (pending + preparing)
    updateOnlineOrdersBadge();

    if (!data || data.length === 0) {
      _log('📦 No data — showing empty state');
      container.innerHTML = `
        <div class="section-header">
          <h2 class="page-title" data-en="Online Orders" data-es="Pedidos en Línea">${lang === 'es' ? 'Pedidos en Línea' : 'Online Orders'}</h2>
        </div>
        <div class="empty-state" data-en="No online orders yet." data-es="Aún no hay pedidos en línea.">${lang === 'es' ? 'Aún no hay pedidos en línea.' : 'No online orders yet.'}</div>
      `;
      setupOnlineOrdersRealtime();
      return;
    }

    // Render header with count
    let html = `
      <div class="section-header">
        <h2 class="page-title" data-en="Online Orders" data-es="Pedidos en Línea">${lang === 'es' ? 'Pedidos en Línea' : 'Online Orders'}
          <span class="badge badge-confirmed" style="font-size:.7rem;vertical-align:middle;margin-left:8px">${data.length}</span>
        </h2>
        <button class="link-btn" onclick="loadOnlineOrders()" data-en="Refresh" data-es="Actualizar">${lang === 'es' ? 'Actualizar' : 'Refresh'}</button>
      </div>
    `;

    // Render each order as a card
    data.forEach(order => {
      const date = new Date(order.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      const items = Array.isArray(order.items)
        ? order.items.map(i => `${i.qty || 1}× ${i.name}`).join(', ')
        : 'No items';

      const status = order.delivery_status || 'pending';
      const statusColors = {
        'pending': 'var(--yellow)',
        'preparing': 'var(--blue)',
        'ready': '#8B5CF6',
        'completed': 'var(--green)',
        'cancelled': 'var(--red)'
      };
      const statusLabelsEn = { pending: 'Pending', preparing: 'Preparing', ready: 'Ready for Pickup', completed: 'Completed', cancelled: 'Cancelled' };
      const statusLabelsEs = { pending: 'Pendiente', preparing: 'Preparando', ready: 'Listo para Recoger', completed: 'Completado', cancelled: 'Cancelado' };
      const statusLabel = lang === 'es' ? (statusLabelsEs[status] || status) : (statusLabelsEn[status] || status);
      const statusColor = statusColors[status] || 'var(--tx-muted)';

      const pickupInfo = order.pickup_date
        ? `<span class="online-order-pickup">📅 ${order.pickup_date}${order.pickup_time ? ' · ' + order.pickup_time : ''}</span>`
        : '';

      html += `
        <div class="online-order-card${isOnlineOrderSeen(order.id) ? '' : ' order-unseen'}" id="online-order-${order.id}" data-clerk-user-id="${order.clerk_user_id || ''}" data-customer-name="${_esc(order.customer_name || '')}">
          <div class="online-order-header">
            <div class="online-order-customer">
              <span class="online-order-name">${_esc(order.customer_name || 'Customer')}</span>
              <span class="online-order-phone">${_esc(order.customer_phone || '')}</span>
            </div>
            <div class="online-order-meta">
              <span class="online-order-date">${date}</span>
              <span class="online-order-total">$${parseFloat(order.total_amount || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="online-order-items">${_esc(items)}</div>

          ${pickupInfo ? `<div class="online-order-pickup-row">${pickupInfo}</div>` : ''}
          ${order.order_note ? `<div class="online-order-note">📝 ${_esc(order.order_note)}</div>` : ''}

          <div class="online-order-footer">
            <span class="online-order-status" style="color:${statusColor}">● ${statusLabel}</span>
            <div class="online-order-actions">
              <select class="online-order-status-select"
                onchange="updateOnlineOrderStatus('${order.id}', this.value)">
                <option value="pending" ${status === 'pending' ? 'selected' : ''}>${lang === 'es' ? 'Pendiente' : 'Pending'}</option>
                <option value="preparing" ${status === 'preparing' ? 'selected' : ''}>${lang === 'es' ? 'Preparando' : 'Preparing'}</option>
                <option value="ready" ${status === 'ready' ? 'selected' : ''}>${lang === 'es' ? 'Listo para Recoger' : 'Ready for Pickup'}</option>
                <option value="completed" ${status === 'completed' ? 'selected' : ''}>${lang === 'es' ? 'Completado' : 'Completed'}</option>
                <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>${lang === 'es' ? 'Cancelado' : 'Cancelled'}</option>
              </select>
            </div>
          </div>
          <div class="online-order-time-set">
            <label>${lang === 'es' ? 'Hora de recogida:' : 'Pickup Time:'}</label>
            <select
              class="online-order-time-input"
              id="pickup-time-${order.id}">
              ${generateTimeOptions(order.estimated_pickup_at ? new Date(order.estimated_pickup_at).toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit'}) : '')}
            </select>
            <button class="online-order-time-btn"
              onclick="setEstimatedPickupTime('${order.id}', document.getElementById('pickup-time-${order.id}').value)">
              Set
            </button>
          </div>
        </div>
      `;
    });


    container.innerHTML = html;
    setupOnlineOrdersRealtime();

  } catch (err) {
    console.error('Failed to load online orders:', err);
    container.innerHTML = '<div class="empty-state" style="color:var(--red)">Failed to load orders. Please try again.</div>';
  }
}

function setupOnlineOrdersRealtime() {
  if (!sb) return;
  // Remove existing channel if any
  if (_onlineOrdersChannel) {
    sb.removeChannel(_onlineOrdersChannel);
    _onlineOrdersChannel = null;
  }

  _onlineOrdersChannel = sb
    .channel('online-orders-live')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'orders',
      filter: 'source=eq.website'
    }, (payload) => {
      _log('New online order:', payload);
      updateOnlineOrdersBadge();
      if (currentSection === 'online-orders') loadOnlineOrders();
      showToast(lang === 'es' ? '🛒 ¡Nuevo pedido en línea!' : '🛒 New online order received!', 'info');
      if (notificationsEnabled) playNotification();
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: 'source=eq.website'
    }, (payload) => {
      _log('Online order updated:', payload);
      updateOnlineOrdersBadge();
      if (currentSection === 'online-orders') loadOnlineOrders();
    })
    .subscribe();
}

async function updateOnlineOrderStatus(orderId, newStatus) {
  if (!sb) return;
  // Mark as seen when admin interacts with status
  markOnlineOrderSeen(orderId);

  try {
    const { error } = await sb
      .from('orders')
      .update({ delivery_status: newStatus })
      .eq('id', orderId);

    if (error) throw error;

    // Update the status display on the card inline
    const card = document.getElementById('online-order-' + orderId);
    if (card) {
      const statusEl = card.querySelector('.online-order-status');
      const statusColors = {
        'pending': 'var(--yellow)',
        'preparing': 'var(--blue)',
        'ready': '#8B5CF6',
        'completed': 'var(--green)',
        'cancelled': 'var(--red)'
      };
      const statusLabelsEn = { pending: 'Pending', preparing: 'Preparing', ready: 'Ready for Pickup', completed: 'Completed', cancelled: 'Cancelled' };
      const statusLabelsEs = { pending: 'Pendiente', preparing: 'Preparando', ready: 'Listo para Recoger', completed: 'Completado', cancelled: 'Cancelado' };
      const label = lang === 'es' ? (statusLabelsEs[newStatus] || newStatus) : (statusLabelsEn[newStatus] || newStatus);
      if (statusEl) {
        statusEl.style.color = statusColors[newStatus] || 'var(--tx-muted)';
        statusEl.textContent = '● ' + label;
      }
    }

    showToast(lang === 'es' ? 'Estado del pedido actualizado' : 'Order status updated');
    updateOnlineOrdersBadge();

    // Push notification to customer is handled automatically by the database webhook

  } catch (err) {
    console.error('Failed to update order status:', err);
    showToast(lang === 'es' ? 'Error al actualizar estado' : 'Failed to update status', 'error');
  }
}

async function setEstimatedPickupTime(orderId, timeValue) {
  if (!sb || !timeValue) return;

  const today = new Date().toISOString().split('T')[0];
  const fullDateTime = new Date(today + 'T' + timeValue).toISOString();

  try {
    const { error } = await sb
      .from('orders')
      .update({ estimated_pickup_at: fullDateTime })
      .eq('id', orderId);

    if (error) throw error;
    showToast(lang === 'es' ? 'Hora de recogida actualizada — el cliente lo verá al instante' : 'Pickup time updated — customer will see this instantly');
  } catch (err) {
    console.error('Failed to set pickup time:', err);
    showToast(lang === 'es' ? 'Error al actualizar hora de recogida' : 'Failed to update pickup time', 'error');
  }
}

// Make functions globally accessible (called via onclick in rendered HTML)
window.loadOnlineOrders = loadOnlineOrders;
window.updateOnlineOrderStatus = updateOnlineOrderStatus;
window.setEstimatedPickupTime = setEstimatedPickupTime;
window.loadOverview = loadOverview;

/* ═══════════════════════════════════
   TOAST
   ═══════════════════════════════════ */
function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.app-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => toast.remove());
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
}

/* ═══════════════════════════════════
   OVERVIEW PAGE
   ═══════════════════════════════════ */
let _revenueChart = null;

/* ── Today's Snapshot: always shows today regardless of filter ── */
async function loadTodaySnapshot() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    const [dRes, wRes, oRes, driversRes] = await Promise.all([
      sb.from('driver_orders').select('total_amount, payment_amount, driver_id').gte('submitted_at', todayStart).lte('submitted_at', todayEnd),
      sb.from('wholesale_orders').select('subtotal, status').gte('placed_at', todayStart).lte('placed_at', todayEnd),
      sb.from('orders').select('total_amount, delivery_status').eq('source', 'website').gte('created_at', todayStart).lte('created_at', todayEnd),
      sb.from('drivers').select('id').eq('is_active', true)
    ]);

    const driverOrders = dRes.data || [];
    const wholesaleOrders = wRes.data || [];
    const onlineOrders = oRes.data || [];
    const totalDrivers = (driversRes.data || []).length;

    const totalOrders = driverOrders.length + wholesaleOrders.length + onlineOrders.length;
    const totalRevenue =
      driverOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0) +
      wholesaleOrders.reduce((s, o) => s + parseFloat(o.subtotal || 0), 0) +
      onlineOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
      
    const collectedToday =
      driverOrders.reduce((s, o) => s + parseFloat(o.payment_amount || 0), 0) +
      wholesaleOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + parseFloat(o.subtotal || 0), 0) +
      onlineOrders.filter(o => o.delivery_status !== 'cancelled').reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    // Count unique drivers who submitted today
    const uniqueDriverIds = new Set(driverOrders.map(o => o.driver_id));
    const activeToday = uniqueDriverIds.size;

    // Formatting helper to drop .00 if whole dollar
    const fmt = (val) => formatCurrency(val).replace('.00', '');

    document.getElementById('today-order-count').textContent = totalOrders;
    document.getElementById('today-revenue').textContent = fmt(collectedToday);
    document.getElementById('today-revenue-sub').textContent = (lang === 'es' ? 'Pedido: ' : 'Ordered: ') + fmt(totalRevenue);
    document.getElementById('today-drivers-active').textContent = `${activeToday} / ${totalDrivers}`;
  } catch (e) {
    console.warn('Today snapshot error:', e);
  }
}

/* ── Quick Action Badges: reads from cached globals ── */
function updateQuickActionBadges() {
  // Unpaid driver orders
  const unpaidCount = incomingOrders.filter(o => o.payment_status === 'not_paid' || o.payment_status === 'partial').length;
  const unpaidBadge = document.getElementById('qa-unpaid-badge');
  if (unpaidBadge) {
    if (unpaidCount > 0) { unpaidBadge.textContent = unpaidCount; unpaidBadge.style.display = ''; }
    else { unpaidBadge.style.display = 'none'; }
  }

  // Active online orders (pending, preparing, ready)
  const onlineActive = _cachedOnlineOrders.filter(o => o.delivery_status === 'pending' || o.delivery_status === 'preparing' || o.delivery_status === 'ready').length;
  const onlineBadge = document.getElementById('qa-online-badge');
  if (onlineBadge) {
    if (onlineActive > 0) { onlineBadge.textContent = onlineActive; onlineBadge.style.display = ''; }
    else { onlineBadge.style.display = 'none'; }
  }
}

/* ── Pending Collection Sheet ── */
let _pendingSheetListener = null;
function _pendingSheetEscHandler(e) { if (e.key === 'Escape') closePendingSheet(); }

function openPendingSheet() {
  const overlay = document.getElementById('pending-sheet-overlay');
  const container = document.getElementById('pending-sheet-items');
  const titleEl = document.getElementById('pending-sheet-title');
  if (!overlay || !container) return;

  // Toggle: if already open, just close it
  if (overlay.classList.contains('open')) {
    closePendingSheet();
    return;
  }

  titleEl.textContent = lang === 'es' ? 'PENDIENTE DE COBRO' : 'PENDING COLLECTION';

  // Aggregate per-driver outstanding balances from cached incomingOrders
  const driverBalances = {};
  incomingOrders.forEach(o => {
    if (o.payment_status === 'not_paid' || o.payment_status === 'partial') {
      const owed = Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.payment_amount || 0));
      if (owed > 0) {
        if (!driverBalances[o.driver_id]) {
          driverBalances[o.driver_id] = { name: getDriverName(o.driver_id), amount: 0 };
        }
        driverBalances[o.driver_id].amount += owed;
      }
    }
  });

  // Sort highest first
  const sorted = Object.entries(driverBalances)
    .map(([id, d]) => ({ id, name: d.name, amount: d.amount }))
    .sort((a, b) => b.amount - a.amount);

  if (sorted.length === 0) {
    container.innerHTML = `<div class="pending-all-clear">${lang === 'es' ? 'Todo cobrado ✓' : 'All collected ✓'}</div>`;
  } else {
    container.innerHTML = sorted.map(d => `
      <div class="pending-driver-row" onclick="closePendingSheet();_openHistoryForDriver('${d.id}')">
        <span class="pending-driver-name">${_esc(d.name)}</span>
        <span class="pending-driver-amount">${formatCurrency(d.amount)}</span>
      </div>
    `).join('');
  }

  overlay.classList.add('open');

  // Dismiss on tap outside the sheet panel (delay to avoid immediate self-dismiss)
  setTimeout(() => {
    _pendingSheetListener = (e) => {
      const sheet = document.getElementById('pending-sheet');
      if (sheet && !sheet.contains(e.target)) {
        closePendingSheet();
      }
    };
    document.addEventListener('click', _pendingSheetListener, true);
    // Also dismiss on Escape key
    document.addEventListener('keydown', _pendingSheetEscHandler);
  }, 300);
}

function closePendingSheet() {
  const overlay = document.getElementById('pending-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
  if (_pendingSheetListener) {
    document.removeEventListener('click', _pendingSheetListener, true);
    _pendingSheetListener = null;
  }
  document.removeEventListener('keydown', _pendingSheetEscHandler);
}

/* Navigate to Order History pre-filtered to a specific driver's unpaid orders */
function _openHistoryForDriver(driverId) {
  showSection('history');
  setTimeout(() => {
    const driverSelect = document.getElementById('filter-driver');
    const paymentSelect = document.getElementById('filter-payment');
    if (driverSelect) driverSelect.value = driverId;
    if (paymentSelect) paymentSelect.value = 'not_paid';
    loadHistoryOrders(true);
  }, 300);
}
window._openHistoryForDriver = _openHistoryForDriver;

/* ── AssistiveTouch-style Draggable FAB ── */
(function initDraggableFab() {
  const fab = document.getElementById('action-queue-fab');
  if (!fab) return;

  let isDragging = false;
  let dragMoved = false;
  let startX = 0, startY = 0;
  let fabX = 0, fabY = 0;
  let idleTimer = null;
  const DRAG_THRESHOLD = 8;
  const IDLE_DELAY = 3000;
  const EDGE_MARGIN = 10;
  const NAV_HEIGHT = 64;

  function initPosition() {
    const rect = fab.getBoundingClientRect();
    fabX = rect.left;
    fabY = rect.top;
    fab.style.position = 'fixed';
    fab.style.left = fabX + 'px';
    fab.style.top = fabY + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    fab.style.transition = 'transform 0.2s, opacity 0.4s';
  }

  function snapToEdge() {
    const w = window.innerWidth;
    const fabW = fab.offsetWidth;
    fab.style.transition = 'left 0.35s cubic-bezier(0.25,1,0.5,1), top 0.35s cubic-bezier(0.25,1,0.5,1), opacity 0.4s';
    if (fabX + fabW / 2 < w / 2) {
      fabX = EDGE_MARGIN;
    } else {
      fabX = w - fabW - EDGE_MARGIN;
    }
    const h = window.innerHeight;
    const fabH = fab.offsetHeight;
    fabY = Math.max(60, Math.min(fabY, h - fabH - NAV_HEIGHT - EDGE_MARGIN));
    fab.style.left = fabX + 'px';
    fab.style.top = fabY + 'px';
    try { sessionStorage.setItem('fab_pos', JSON.stringify({ x: fabX, y: fabY })); } catch(_) {}
    setTimeout(() => { fab.style.transition = 'transform 0.2s, opacity 0.4s'; }, 400);
  }

  function resetIdleTimer() {
    fab.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!isDragging) fab.style.opacity = '0.4'; }, IDLE_DELAY);
  }

  function restorePosition() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('fab_pos'));
      if (saved) { fabX = saved.x; fabY = saved.y; fab.style.left = fabX + 'px'; fab.style.top = fabY + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; fab.style.position = 'fixed'; }
      else initPosition();
    } catch(_) { initPosition(); }
  }

  // Touch
  fab.addEventListener('touchstart', (e) => {
    isDragging = true; dragMoved = false;
    const t = e.touches[0]; startX = t.clientX - fabX; startY = t.clientY - fabY;
    fab.style.transition = 'transform 0.2s, opacity 0.1s'; fab.style.opacity = '1'; fab.style.transform = 'scale(1.08)';
    clearTimeout(idleTimer);
  }, { passive: true });

  fab.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - startX - fabX) > DRAG_THRESHOLD || Math.abs(t.clientY - startY - fabY) > DRAG_THRESHOLD) dragMoved = true;
    if (dragMoved) { fabX = t.clientX - startX; fabY = t.clientY - startY; fab.style.left = fabX + 'px'; fab.style.top = fabY + 'px'; }
  }, { passive: true });

  fab.addEventListener('touchend', () => {
    isDragging = false; fab.style.transform = 'scale(1)';
    if (dragMoved) snapToEdge(); else openQueueSheet();
    resetIdleTimer();
  });

  // Mouse (desktop)
  fab.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true; dragMoved = false;
    startX = e.clientX - fabX; startY = e.clientY - fabY;
    fab.style.transition = 'transform 0.2s, opacity 0.1s'; fab.style.opacity = '1'; fab.style.transform = 'scale(1.08)';
    clearTimeout(idleTimer); e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    if (Math.abs(e.clientX - startX - fabX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY - fabY) > DRAG_THRESHOLD) dragMoved = true;
    if (dragMoved) { fabX = e.clientX - startX; fabY = e.clientY - startY; fab.style.left = fabX + 'px'; fab.style.top = fabY + 'px'; }
  });
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false; fab.style.transform = 'scale(1)';
    if (dragMoved) snapToEdge();
    resetIdleTimer();
  });

  // Prevent onclick on drag
  fab.removeAttribute('onclick');
  fab.addEventListener('click', (e) => {
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); return; }
    openQueueSheet();
  });

  // Wake on hover
  fab.addEventListener('mouseenter', () => { fab.style.opacity = '1'; clearTimeout(idleTimer); });
  fab.addEventListener('mouseleave', resetIdleTimer);

  // Init on load
  setTimeout(() => { restorePosition(); resetIdleTimer(); }, 1000);
  window.addEventListener('resize', () => { if (fab.style.display !== 'none') snapToEdge(); });
})();

/* ── Total Ordered Value Breakdown Sheet ── */
function openOrderedSheet() {
  const overlay = document.getElementById('ordered-sheet-overlay');
  const content = document.getElementById('ordered-sheet-content');
  const periodEl = document.getElementById('ordered-sheet-period');
  if (!overlay || !content) return;

  // Get the current timeframe label
  const activePill = document.querySelector('.overview-time-selector .insights-pill.active, [id="overview-timeframe-selector"] .insights-pill.active');
  const periodLabel = activePill?.textContent?.trim() || 'This Month';
  if (periodEl) periodEl.textContent = lang === 'es'
    ? `Total facturado · ${periodLabel}`
    : `Everything invoiced, paid or not · ${periodLabel}`;

  const b = _channelBreakdown;
  const total = b.driverGross + b.wholesaleGross + b.onlineGross;
  const totalCollected = b.driverCollected + b.wholesaleCollected + b.onlineCollected;
  const totalOutstanding = b.driverOutstanding + b.wholesaleOutstanding;

  const pct = (v) => total > 0 ? Math.round((v / total) * 100) : 0;
  const pctOf = (v, base) => base > 0 ? Math.round((v / base) * 100) : 0;
  const fc = (v) => formatCurrency(v);

  // Channel rows
  const channels = [
    {
      key: 'driver',
      label: lang === 'es' ? 'Conductores' : 'Driver Orders',
      sublabel: lang === 'es' ? 'Órdenes de campo' : 'Field deliveries',
      amount: b.driverGross,
      iconClass: 'icon-driver',
      fillClass: 'fill-driver',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 7v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    },
    {
      key: 'wholesale',
      label: lang === 'es' ? 'Mayoreo' : 'Wholesale',
      sublabel: lang === 'es' ? 'Órdenes mayoristas' : 'Bulk business orders',
      amount: b.wholesaleGross,
      iconClass: 'icon-wholesale',
      fillClass: 'fill-wholesale',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`,
    },
    {
      key: 'online',
      label: lang === 'es' ? 'Pedidos en Línea' : 'Online Orders',
      sublabel: lang === 'es' ? 'Ventas por internet' : 'Website & app orders',
      amount: b.onlineGross,
      iconClass: 'icon-online',
      fillClass: 'fill-online',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`,
    }
  ].filter(c => c.amount > 0);

  const channelRowsHTML = channels.map(c => `
    <div class="ordered-channel-row">
      <div class="ordered-channel-icon ${c.iconClass}">${c.icon}</div>
      <div class="ordered-channel-info">
        <div class="ordered-channel-name">${c.label}</div>
        <div class="ordered-channel-count">${c.sublabel}</div>
      </div>
      <div class="ordered-channel-right">
        <div class="ordered-channel-amount">${fc(c.amount)}</div>
        <div class="ordered-channel-pct">${pct(c.amount)}% of total</div>
      </div>
    </div>
  `).join('');

  // Segmented capture bar widths
  const collectedPct  = pctOf(totalCollected, total);
  const outstandingPct = pctOf(totalOutstanding, total);

  // Financial fate section
  const fateHTML = `
    <div class="capture-section">
      <div class="airy-date-header" style="margin:0 0 14px 0">${lang === 'es' ? '¿QUÉ PASÓ CON ESTE DINERO?' : 'WHAT HAPPENED TO THIS MONEY?'}</div>

      <!-- Segmented bar -->
      <div class="capture-bar-wrap">
        <div class="capture-bar">
          <div class="capture-bar-fill fill-collected" style="width:0%" data-target="${collectedPct}%"></div>
          <div class="capture-bar-fill fill-outstanding" style="width:0%" data-target="${outstandingPct}%"></div>
        </div>
        <div class="capture-bar-legend">
          <span class="capture-legend-dot dot-collected"></span>
          <span class="capture-legend-label">${lang === 'es' ? 'Cobrado' : 'Collected'}</span>
          <span class="capture-legend-dot dot-outstanding" style="margin-left:12px"></span>
          <span class="capture-legend-label">${lang === 'es' ? 'Por Cobrar' : 'Still Owed'}</span>
        </div>
      </div>

      <!-- Two summary rows -->
      <div class="capture-row">
        <div class="capture-row-left">
          <span class="capture-dot dot-collected"></span>
          <div>
            <div class="capture-row-label">${lang === 'es' ? 'Cobrado' : 'Collected'}</div>
            <div class="capture-row-sub">${collectedPct}% of invoiced</div>
          </div>
        </div>
        <div class="capture-row-amount collected">${fc(totalCollected)}</div>
      </div>
      <div class="capture-row" style="border-bottom:none">
        <div class="capture-row-left">
          <span class="capture-dot dot-outstanding"></span>
          <div>
            <div class="capture-row-label">${lang === 'es' ? 'Pendiente de Pago' : 'Still Owed'}</div>
            <div class="capture-row-sub">${outstandingPct}% of invoiced</div>
          </div>
        </div>
        <div class="capture-row-amount outstanding">${fc(totalOutstanding)}</div>
      </div>
    </div>
  `;

  content.innerHTML = `
    <div class="ordered-total-hero">
      <div class="ordered-total-label">${lang === 'es' ? 'Total Facturado' : 'Total Invoiced'}</div>
      <div class="ordered-total-value">${fc(total)}</div>
    </div>
    <div class="ordered-channels">${channelRowsHTML}</div>
    ${fateHTML}
  `;

  overlay.classList.add('open');

  // Animate bars after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      content.querySelectorAll('.capture-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.target;
      });
    }, 80);
  });
}

function closeOrderedSheet() {
  const overlay = document.getElementById('ordered-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
}
window.openOrderedSheet = openOrderedSheet;
window.closeOrderedSheet = closeOrderedSheet;

/* ── Insights Page — Premium ── */
const _donutChannels = {
  driver: { id: 'driver', main: '#C8102E', grad1: '#F02849', grad2: '#9B0B22', shadow: 'rgba(200,16,46,0.35)' },
  wholesale: { id: 'wholesale', main: '#3b82f6', grad1: '#60A5FA', grad2: '#2563EB', shadow: 'rgba(59,130,246,0.3)' },
  online: { id: 'online', main: '#1b7a4a', grad1: '#22c55e', grad2: '#166534', shadow: 'rgba(27,122,74,0.3)' }
};

function _getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function _animateCountUp(el, target, label, duration = 1200) {
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = target * eased;
    el.innerHTML = `${formatAbbreviated(current)}<span class="donut-center-sub">${label}</span>`;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function _renderDonut(svgId, centerId, channels, total, centerLabel) {
  const svg = document.getElementById(svgId);
  const center = document.getElementById(centerId);
  if (!svg || !center) return;

  const cx = 80, cy = 80, r = 60;
  const circumference = 2 * Math.PI * r;
  
  // 1) Define gradients and filters (Bloom/Glow)
  let defs = `<defs>`;
  channels.forEach(ch => {
    const c = ch.channel;
    defs += `
      <linearGradient id="grad-${c.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c.grad1}"/>
        <stop offset="100%" stop-color="${c.grad2}"/>
      </linearGradient>
      <filter id="glow-${c.id}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${c.main}" flood-opacity="0.35"/>
      </filter>
    `;
  });
  defs += `</defs>`;

  // 2) The Frosted "Track" Ring (anchors the donut) 
  let html = defs + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bd)" stroke-width="20" opacity="0.15"/>`;

  if (total <= 0) {
    center.innerHTML = `$0<span class="donut-center-sub">${centerLabel}</span>`;
  } else {
    let offset = 0;
    // Physical gap math: subtracting ~2px of arc length from the dash
    const gapVisual = 3; 

    // Filter out $0 so no dots render
    const activeChannels = channels.filter(ch => ch.amount > 0);

    activeChannels.forEach((ch, idx) => {
      const c = ch.channel;
      const pct = ch.amount / total;
      
      // If there's only 1 active category, no gap needed
      const currentGap = activeChannels.length > 1 ? gapVisual : 0;
      
      const arcLength = (pct * circumference) - currentGap;
      const dash = Math.max(0, arcLength);
      const gap = circumference - dash;

      html += `<circle class="donut-segment" cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="url(#grad-${c.id})" stroke-width="20"
        style="--target-dash:${dash};--target-gap:${gap}"
        stroke-dashoffset="${-offset}" stroke-linecap="round"
        filter="url(#glow-${c.id})"/>`;
        
      offset += (pct * circumference);
    });
    _animateCountUp(center, total, centerLabel);
  }
  svg.innerHTML = html;
}

function _renderDonutLegend(legendId, channels, total) {
  const el = document.getElementById(legendId);
  if (!el) return;
  el.innerHTML = channels.map(ch => {
    const c = ch.channel;
    const pct = total > 0 ? Math.round((ch.amount / total) * 100) : 0;
    return `<div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:linear-gradient(135deg, ${c.grad1}, ${c.grad2});box-shadow:0 0 6px ${c.shadow}"></span>
      <span class="donut-legend-label">${ch.label}</span>
      <span class="donut-legend-value">${formatCurrency(ch.amount)}</span>
      <span class="donut-legend-pct">${pct}%</span>
    </div>`;
  }).join('');
}

async function loadInsights(timeframe) {
  if (!timeframe) {
    const activePill = document.querySelector('.insights-pill.active');
    timeframe = activePill?.dataset.value || 'this_week';
  }

  if (!sb) return;

  // Ensure driver names are available for the leaderboard
  if (driversCache.length === 0) await loadDriversCache();

  // Format dates strictly as Local Time ISO strings to avoid timezone clipping in Supabase
  function _toLocalISOString(date) {
    const pad = n => n < 10 ? '0' + n : n;
    return date.getFullYear() + '-' +
      pad(date.getMonth() + 1) + '-' +
      pad(date.getDate()) + 'T' +
      pad(date.getHours()) + ':' +
      pad(date.getMinutes()) + ':' +
      pad(date.getSeconds());
  }

  const now = new Date();
  let startDate = null;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (timeframe === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (timeframe === 'this_week') {
    const dayOfWeek = now.getDay() || 7; // Convert Sunday(0) to 7 to make Monday = start of week
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1, 0, 0, 0);
  } else if (timeframe === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  } else if (timeframe === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }

  try {
    const driverQuery = sb.from('driver_orders')
      .select('total_amount, payment_amount, payment_status, submitted_at, driver_id');
    const wholesaleQuery = sb.from('wholesale_orders')
      .select('subtotal, status, placed_at');
    const onlineQuery = sb.from('orders')
      .select('total_amount, delivery_status, created_at')
      .eq('source', 'website');

    if (startDate) {
      driverQuery.gte('submitted_at', _toLocalISOString(startDate));
      wholesaleQuery.gte('placed_at', _toLocalISOString(startDate));
      onlineQuery.gte('created_at', _toLocalISOString(startDate));
    }
    driverQuery.lte('submitted_at', _toLocalISOString(endDate));
    wholesaleQuery.lte('placed_at', _toLocalISOString(endDate));
    onlineQuery.lte('created_at', _toLocalISOString(endDate));

    const [driverRes, wholesaleRes, onlineRes] = await Promise.all([
      driverQuery, wholesaleQuery, onlineQuery
    ]);

    const driverOrders = driverRes.data || [];
    const wholesaleOrders = wholesaleRes.data || [];
    const onlineOrders = onlineRes.data || [];

    // ── Aggregate channel totals ──
    let driverCollected = 0;
    const driverMap = {};
    driverOrders.forEach(o => {
      const paid = parseFloat(o.payment_amount || 0);
      driverCollected += paid;
      const name = getDriverName(o.driver_id) || 'Unknown';
      if (!driverMap[name]) driverMap[name] = { amount: 0, count: 0 };
      driverMap[name].amount += parseFloat(o.total_amount || 0);
      driverMap[name].count += 1;
    });

    let wholesaleCollected = 0;
    wholesaleOrders.forEach(o => {
      if (o.status === 'delivered') wholesaleCollected += parseFloat(o.subtotal || 0);
    });

    let onlineCollected = 0;
    onlineOrders.forEach(o => {
      if (o.delivery_status !== 'cancelled') onlineCollected += parseFloat(o.total_amount || 0);
    });

    const totalCollected = driverCollected + wholesaleCollected + onlineCollected;

    // ── Channel definitions ──
    const driverLabel = lang === 'es' ? 'Rutas de Choferes' : 'Driver Routes';
    const collectedChannels = [
      { label: driverLabel, amount: driverCollected, channel: _donutChannels.driver },
      { label: 'Wholesale', amount: wholesaleCollected, channel: _donutChannels.wholesale },
      { label: 'Online', amount: onlineCollected, channel: _donutChannels.online }
    ];

    // ── Render donut ──
    _renderDonut('collected-donut', 'collected-donut-center', collectedChannels, totalCollected,
      lang === 'es' ? 'Cobrado' : 'Collected');
    _renderDonutLegend('collected-donut-legend', collectedChannels, totalCollected);

    // ── Driver Leaderboard ──
    const leaderboard = Object.entries(driverMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);

    const lbEl = document.getElementById('driver-leaderboard');
    if (lbEl) {
      if (leaderboard.length === 0) {
        lbEl.innerHTML = `<div class="leaderboard-empty">${lang === 'es' ? 'Sin datos de conductores' : 'No driver data yet'}</div>`;
      } else {
        const topAmount = leaderboard[0].amount;
        const avatarClasses = ['gold', 'silver', 'bronze'];
        lbEl.innerHTML = leaderboard.map((d, i) => {
          const initials = _getInitials(d.name);
          const avatarCls = i < 3 ? avatarClasses[i] : 'default';
          const championCls = i === 0 ? ' champion' : '';
          const barWidth = topAmount > 0 ? Math.round((d.amount / topAmount) * 100) : 0;
          const barColor = i === 0 ? '#D4A017' : i === 1 ? '#A0A0A0' : i === 2 ? '#CD7F32' : 'var(--tx-muted)';
          const orderLabel = lang === 'es'
            ? `${d.count} pedido${d.count !== 1 ? 's' : ''}`
            : `${d.count} order${d.count !== 1 ? 's' : ''}`;
          return `<div class="leaderboard-row${championCls}">
            <div class="leaderboard-bar" style="width:${barWidth}%;background:${barColor}"></div>
            <div class="leaderboard-avatar ${avatarCls}">${initials}</div>
            <div class="leaderboard-info">
              <span class="leaderboard-name">${d.name}</span>
              <span class="leaderboard-orders">${orderLabel}</span>
            </div>
            <span class="leaderboard-amount">${formatCurrency(d.amount)}</span>
          </div>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('loadInsights error:', err);
  }
}


async function loadOverview(timeframe) {
  if (!timeframe) timeframe = document.getElementById('revenue-filter')?.value || 'this_month';

  // Format dates strictly as Local Time ISO strings to avoid timezone clipping in Supabase
  function _toLocalISOString(date) {
    const pad = n => n < 10 ? '0' + n : n;
    return date.getFullYear() + '-' +
      pad(date.getMonth() + 1) + '-' +
      pad(date.getDate()) + 'T' +
      pad(date.getHours()) + ':' +
      pad(date.getMinutes()) + ':' +
      pad(date.getSeconds());
  }

  const now = new Date();
  let startDate = null;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (timeframe === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (timeframe === 'this_week') {
    const dayOfWeek = now.getDay() || 7; // Convert Sunday(0) to 7 to make Monday = start of week
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1, 0, 0, 0);
  } else if (timeframe === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  } else if (timeframe === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }
  // all_time: startDate stays null

  try {
    // ── Fetch all three data streams in parallel ──
    const driverQuery = sb.from('driver_orders')
      .select('total_amount, payment_amount, payment_status, submitted_at');
    const wholesaleQuery = sb.from('wholesale_orders')
      .select('subtotal, status, placed_at');
    const onlineQuery = sb.from('orders')
      .select('total_amount, delivery_status, created_at')
      .eq('source', 'website');

    if (startDate) {
      driverQuery.gte('submitted_at', _toLocalISOString(startDate));
      wholesaleQuery.gte('placed_at', _toLocalISOString(startDate));
      onlineQuery.gte('created_at', _toLocalISOString(startDate));
    }
    driverQuery.lte('submitted_at', _toLocalISOString(endDate));
    wholesaleQuery.lte('placed_at', _toLocalISOString(endDate));
    onlineQuery.lte('created_at', _toLocalISOString(endDate));

    const [driverRes, wholesaleRes, onlineRes] = await Promise.all([
      driverQuery, wholesaleQuery, onlineQuery
    ]);

    const driverOrders = driverRes.data || [];
    const wholesaleOrders = wholesaleRes.data || [];
    const onlineOrders = onlineRes.data || [];

    // ── Aggregate Totals ──
    // DRIVER: has per-order payment tracking (payment_amount, payment_status)
    let driverGross = 0, driverCollected = 0, driverOutstanding = 0;
    driverOrders.forEach(o => {
      const total = parseFloat(o.total_amount || 0);
      const paid = parseFloat(o.payment_amount || 0);
      driverGross += total;
      driverCollected += paid;
      if (o.payment_status === 'not_paid' || o.payment_status === 'partial') {
        driverOutstanding += Math.max(0, total - paid);
      }
    });

    // WHOLESALE: payment happens on delivery; only 'delivered' = collected
    // confirmed/scheduled = outstanding (accepted but not yet delivered/paid)
    // pending/cancelled = neither collected nor outstanding
    let wholesaleGross = 0, wholesaleCollected = 0, wholesaleOutstanding = 0;
    wholesaleOrders.forEach(o => {
      const sub = parseFloat(o.subtotal || 0);
      wholesaleGross += sub;
      if (o.status === 'delivered') {
        wholesaleCollected += sub;
      } else if (o.status === 'confirmed' || o.status === 'scheduled') {
        wholesaleOutstanding += sub;
      }
    });

    // ONLINE: customers pay at checkout (pre-paid); delivery_status tracks fulfillment
    // All non-cancelled orders are collected; cancelled orders are excluded entirely
    let onlineGross = 0, onlineCollected = 0;
    onlineOrders.forEach(o => {
      const total = parseFloat(o.total_amount || 0);
      onlineGross += total;
      if (o.delivery_status !== 'cancelled') {
        onlineCollected += total;
      }
    });

    const totalGross = driverGross + wholesaleGross + onlineGross;
    const totalCollected = driverCollected + wholesaleCollected + onlineCollected;
    const totalOutstanding = driverOutstanding + wholesaleOutstanding;

    // ── Cache channel breakdown for drill-down sheets ──
    _channelBreakdown = {
      driverGross, driverCollected, driverOutstanding,
      wholesaleGross, wholesaleCollected, wholesaleOutstanding,
      onlineGross, onlineCollected
    };

    // ── Update Stat Cards (abbreviated) ──
    document.getElementById('stat-gross-revenue').textContent = formatAbbreviated(totalGross);
    document.getElementById('stat-collected').textContent = formatAbbreviated(totalCollected);
    document.getElementById('stat-outstanding').textContent = formatAbbreviated(totalOutstanding);

    // ── Build Chart Data ──
    const useMonthlyBuckets = (timeframe === 'all_time' || timeframe === 'last_month');
    const buckets = {};

    function addToBucket(dateStr, amount) {
      if (!dateStr) return;
      const d = new Date(dateStr);
      const key = useMonthlyBuckets
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      buckets[key] = (buckets[key] || 0) + amount;
    }

    driverOrders.forEach(o => addToBucket(o.submitted_at, parseFloat(o.total_amount || 0)));
    wholesaleOrders.forEach(o => addToBucket(o.placed_at, parseFloat(o.subtotal || 0)));
    onlineOrders.forEach(o => addToBucket(o.created_at, parseFloat(o.total_amount || 0)));

    const sortedKeys = Object.keys(buckets).sort();
    const chartLabels = sortedKeys.map(k => {
      if (useMonthlyBuckets) {
        const [y, m] = k.split('-');
        return new Date(y, m - 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
      }
      const [y, m, d] = k.split('-');
      return new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short', day: 'numeric' });
    });
    const chartValues = sortedKeys.map(k => buckets[k]);

    // ── Render Chart ──
    const ctx = document.getElementById('revenueChart');
    if (_revenueChart) { _revenueChart.destroy(); _revenueChart = null; }

    if (ctx) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(200,16,46,.06)';
      const tickColor = isDark ? '#BFA0A8' : '#6B5057';

      _revenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [{
            label: lang === 'es' ? 'Ingresos' : 'Revenue',
            data: chartValues,
            backgroundColor: 'rgba(200, 16, 46, 0.7)',
            hoverBackgroundColor: 'rgba(200, 16, 46, 0.9)',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 48
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? '#1E0D12' : '#fff',
              titleColor: isDark ? '#F2E8E4' : '#18080D',
              bodyColor: isDark ? '#BFA0A8' : '#6B5057',
              borderColor: isDark ? 'rgba(200,16,46,.35)' : 'rgba(200,16,46,.22)',
              borderWidth: 1,
              padding: 12,
              cornerRadius: 10,
              titleFont: { family: 'Outfit', weight: '600' },
              bodyFont: { family: 'Outfit' },
              callbacks: {
                label: ctx => formatCurrency(ctx.parsed.y)
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: tickColor, font: { family: 'Outfit', size: 11 } }
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: tickColor,
                font: { family: 'Outfit', size: 11 },
                callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
              },
              beginAtZero: true
            }
          }
        }
      });
    }

    // ── Revenue Breakdown ──
    const breakdownEl = document.getElementById('revenue-breakdown');
    if (breakdownEl) {
      const sources = [
        { label: lang === 'es' ? 'Rutas (Conductores)' : 'Driver Routes', amount: driverGross, color: '#C8102E' },
        { label: lang === 'es' ? 'Mayoreo (B2B)' : 'Wholesale (B2B)', amount: wholesaleGross, color: '#002D62' },
        { label: lang === 'es' ? 'En Línea (Sitio Web)' : 'Online (Website)', amount: onlineGross, color: '#1B7A4A' }
      ];
      const maxAmount = Math.max(...sources.map(s => s.amount), 1);

      breakdownEl.innerHTML = sources.map(s => {
        const pct = Math.round((s.amount / (totalGross || 1)) * 100);
        const barW = Math.max(2, (s.amount / maxAmount) * 100);
        return `<div class="rev-breakdown-row">
          <span class="rev-breakdown-dot" style="background:${s.color}"></span>
          <span class="rev-breakdown-label">${s.label} <span style="color:var(--tx-faint);font-weight:400;font-size:.8rem">(${pct}%)</span></span>
          <div class="rev-breakdown-bar-bg"><div class="rev-breakdown-bar" style="width:${barW}%;background:${s.color}"></div></div>
          <span class="rev-breakdown-amount">${formatCurrency(s.amount)}</span>
        </div>`;
      }).join('');
    }

    // Render Needs Attention from already-loaded incomingOrders
    renderNeedsAttention();

    // Load Today's Snapshot (independent of the selected timeframe)
    loadTodaySnapshot();

    // Update Quick Action tile badges
    updateQuickActionBadges();
  } catch (e) { console.error('Overview load error:', e); }
}

/* ── Global Action Queue Sheet ── */
function openQueueSheet() {
  // Close any other open sheets first
  if (typeof closeOrderSheet === 'function') closeOrderSheet();
  if (typeof closeOrderedSheet === 'function') closeOrderedSheet();
  if (typeof closePendingSheet === 'function') closePendingSheet();
  _closeActionSheet();

  renderNeedsAttention();
  const overlay = document.getElementById('queue-sheet-overlay');
  overlay.classList.add('open');
  // Lock body
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.width = '100%';
}

function closeQueueSheet() {
  document.getElementById('queue-sheet-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  document.body.style.width = '';
  window.scrollTo(0, parseInt(scrollY));
}
window.openQueueSheet = openQueueSheet;
window.closeQueueSheet = closeQueueSheet;

/* ── Needs Attention (reads from global incomingOrders + _cachedOnlineOrders) ── */
function renderNeedsAttention() {
  const container = document.getElementById('queue-sheet-content');
  const badge = document.getElementById('action-queue-badge');
  const fab = document.getElementById('action-queue-fab');

  // Active driver orders (not completed/cancelled) + active online orders
  const activeDriver = incomingOrders.filter(o => o.status === 'pending' || o.status === 'confirmed' || o.status === 'sent');
  const activeOnline = _cachedOnlineOrders.filter(o => o.delivery_status === 'pending' || o.delivery_status === 'preparing' || o.delivery_status === 'ready');
  const totalItems = activeDriver.length + activeOnline.length;

  // Update badge count
  if (badge) badge.innerText = totalItems;
  if (fab) {
    fab.style.display = 'flex';
    if (badge) badge.style.display = totalItems > 0 ? 'flex' : 'none';
  }

  if (!container) return;

  // ── Empty state ──
  if (totalItems === 0) {
    container.innerHTML = `
      <div class="queue-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <h4 class="queue-empty-title" data-en="All Caught Up" data-es="Todo al día">${lang === 'es' ? 'Todo al día' : 'All Caught Up'}</h4>
        <p class="queue-empty-desc" data-en="No orders need your attention right now." data-es="No hay pedidos pendientes.">${lang === 'es' ? 'No hay pedidos pendientes.' : 'No orders need your attention right now.'}</p>
      </div>`;
    return;
  }

  let html = '';

  // ── Online Orders section ──
  if (activeOnline.length > 0) {
    html += `<div class="airy-date-header" style="margin-top:0">${lang === 'es' ? 'PEDIDOS EN LÍNEA' : 'ONLINE ORDERS'}</div>`;
    activeOnline.forEach(order => {
      const name = _esc(order.customer_name || (lang === 'es' ? 'Cliente web' : 'Online Customer'));
      const amount = formatCurrency(parseFloat(order.total_amount || 0));
      const statusLabels = {
        pending:   lang === 'es' ? 'Pendiente'  : 'Pending',
        preparing: lang === 'es' ? 'Preparando' : 'Preparing',
        ready:     lang === 'es' ? 'Listo'      : 'Ready'
      };
      const statusLabel = statusLabels[order.delivery_status] || _esc(order.delivery_status);
      const time = order.created_at ? new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

      html += `
        <div class="order-card-avatar" onclick="closeQueueSheet(); showSection('online-orders');">
          <div class="oca-avatar" style="background:linear-gradient(135deg,#e67e22,#d35400)"><i data-lucide="shopping-cart" style="width:18px;height:18px;color:#fff"></i></div>
          <div class="oca-body">
            <div class="oca-name">${name}</div>
            <div class="oca-time">${time}${time ? ' · ' : ''}${statusLabel}</div>
          </div>
          <div class="oca-right">
            <div class="oca-price">${amount}</div>
            <div class="oca-pill partial">${statusLabel}</div>
          </div>
        </div>`;
    });
  }

  // ── Driver Orders section ──
  if (activeDriver.length > 0) {
    html += `<div class="airy-date-header"${activeOnline.length === 0 ? ' style="margin-top:0"' : ''}>${lang === 'es' ? 'CONDUCTORES' : 'DRIVER ORDERS'}</div>`;
    activeDriver.forEach(order => {
      const name = _esc(getDriverName(order.driver_id));
      const initials = name.substring(0, 2).toUpperCase();
      const amount = formatCurrency(parseFloat(order.total_amount || 0));
      const statusLabels = {
        pending:   lang === 'es' ? 'Pendiente'  : 'Pending',
        confirmed: lang === 'es' ? 'Confirmado' : 'Confirmed',
        sent:      lang === 'es' ? 'Enviado'    : 'Sent'
      };
      const statusLabel = statusLabels[order.status] || order.status;
      const time = order.submitted_at ? new Date(order.submitted_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      const payClass = order.payment_status === 'paid' ? 'paid' : order.payment_status === 'partial' ? 'partial' : 'unpaid';

      html += `
        <div class="order-card-avatar" onclick="closeQueueSheet(); showSection('incoming'); setTimeout(()=>openOrderSheet('${order.id}'),400)">
          <div class="oca-avatar">${initials}</div>
          <div class="oca-body">
            <div class="oca-name">${name}</div>
            <div class="oca-time">${time}${time ? ' · ' : ''}${statusLabel}</div>
          </div>
          <div class="oca-right">
            <div class="oca-price">${amount}</div>
            <div class="oca-pill ${payClass}">${statusLabel}</div>
          </div>
        </div>`;
    });
  }

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

/* ═══════════════════════════════════
   INCOMING ORDERS PAGE
   ═══════════════════════════════════ */
async function loadIncomingOrders() {
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('*')
      .in('status', ['pending', 'confirmed', 'sent', 'picked_up'])
      .order('submitted_at', { ascending: false });

    if (!error && data) {
      incomingOrders = data;
      updateIncomingBadge();
      renderIncomingOrders();
    }
  } catch (e) { console.error('Incoming orders error:', e); }
}

function renderIncomingOrders() {
  const activeFilter = document.querySelector('#driver-orders-filter .insights-pill.active')?.dataset.filter || 'all';
  let filtered = [...incomingOrders];

  if (activeFilter === 'today') {
    const today = getTodayStr();
    filtered = filtered.filter(o => (o.submitted_at || '').startsWith(today));
  } else if (activeFilter === 'unpaid') {
    filtered = filtered.filter(o => o.payment_status === 'not_paid');
  } else if (activeFilter === 'partial') {
    filtered = filtered.filter(o => o.payment_status === 'partial');
  }

  renderOrderCards(filtered, 'incoming-orders-list', true);
}

function updateIncomingBadge() {
  // Badge counts ALL non-completed active driver orders
  const activeCount = incomingOrders.filter(o =>
    o.status === 'pending' || o.status === 'confirmed' || o.status === 'sent'
  ).length;
  const badges = [document.getElementById('incoming-badge'), document.getElementById('incoming-badge-mobile')];
  badges.forEach(badge => {
    if (badge) {
      badge.style.display = activeCount > 0 ? 'inline' : 'none';
      badge.textContent = activeCount;
    }
  });

  // ── Bottom nav badge: sum of driver + online unseen orders ──
  _updateOrdersBottomBadge();
}

/* Unified badge helper for the bottom nav "Orders" tab */
function _updateOrdersBottomBadge() {
  const driverCount = incomingOrders.filter(o =>
    (o.status === 'pending' || o.status === 'confirmed' || o.status === 'sent') && !isDriverOrderSeen(o.id)
  ).length;
  const onlineCount = typeof _cachedOnlineOrders !== 'undefined'
    ? _cachedOnlineOrders.filter(o => !isOnlineOrderSeen(o.id)).length : 0;
  const total = driverCount + onlineCount;
  const badge = document.getElementById('orders-bottom-badge');
  if (badge) {
    badge.style.display = total > 0 ? '' : 'none';
    badge.textContent = total;
  }
}

/* ═══════════════════════════════════
   ORDER HISTORY PAGE
   ═══════════════════════════════════ */
async function loadHistoryOrders(reset = false) {
  if (reset) {
    historyPage = 0;
    historyOrders = [];
  }

  const from = historyPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = sb
    .from('driver_orders')
    .select('*')
    .order('submitted_at', { ascending: false })
    .range(from, to);

  // Apply filters
  const dateFrom = document.getElementById('filter-date-from')?.value;
  const dateTo = document.getElementById('filter-date-to')?.value;
  const driverFilter = document.getElementById('filter-driver')?.value;
  const paymentFilter = document.getElementById('filter-payment')?.value;
  const searchTerm = document.getElementById('filter-search')?.value?.trim() || '';

  if (dateFrom) query = query.gte('submitted_at', dateFrom + 'T00:00:00');
  if (dateTo) query = query.lte('submitted_at', dateTo + 'T23:59:59');
  if (driverFilter) query = query.eq('driver_id', driverFilter);
  if (paymentFilter) query = query.eq('payment_status', paymentFilter);

  // Search by order number or business name
  if (searchTerm) {
    if (searchTerm.startsWith('#')) {
      const num = parseInt(searchTerm.replace('#', ''));
      if (!isNaN(num)) query = query.eq('order_number', num);
    } else {
      // L5: Escape SQL wildcard characters to prevent pattern abuse
      const safeTerm = searchTerm.replace(/%/g, '\\%').replace(/_/g, '\\_');
      query = query.ilike('business_name', `%${safeTerm}%`);
    }
  }

  try {
    const { data, error } = await query;
    if (!error && data) {
      if (reset) {
        historyOrders = data;
      } else {
        historyOrders = [...historyOrders, ...data];
      }
      renderOrderCards(historyOrders, 'history-orders-list');

      // Show/hide load more
      const loadMoreBtn = document.getElementById('load-more-btn');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = data.length >= PAGE_SIZE ? 'block' : 'none';
      }
    }
  } catch (e) { console.error('History load error:', e); }
}

function loadMoreHistory() {
  historyPage++;
  loadHistoryOrders(false);
}

/* ═══════════════════════════════════
   RENDER ORDER CARDS
   ═══════════════════════════════════ */
function renderOrderCards(orders, containerId, showLive = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!orders || orders.length === 0) {
    container.innerHTML = `<div class="empty-state" data-en="No orders found" data-es="No se encontraron pedidos">${lang === 'es' ? 'No se encontraron pedidos' : 'No orders found'}</div>`;
    return;
  }

  let html = '';
  if (showLive) {
    html += `<div class="live-indicator"><span class="live-dot"></span>${lang === 'es' ? 'EN VIVO' : 'LIVE'}</div>`;
  }

  // Helper: get date key (YYYY-MM-DD) from submitted_at (when the order was placed).
  // submitted_at is a UTC ISO timestamp — new Date() converts it to local time automatically.
  function getDateKey(order) {
    if (!order.submitted_at) return '';
    const d = new Date(order.submitted_at);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // Helper: format a date key into a user-friendly label
  function getDateLabel(dateKey) {
    if (!dateKey) return '—';
    const today = getTodayStr();
    // Yesterday
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const yesterdayStr = yd.getFullYear() + '-' + String(yd.getMonth()+1).padStart(2,'0') + '-' + String(yd.getDate()).padStart(2,'0');

    if (dateKey === today) return lang === 'es' ? 'Hoy' : 'Today';
    if (dateKey === yesterdayStr) return lang === 'es' ? 'Ayer' : 'Yesterday';
    // Full date
    const d = new Date(dateKey + 'T12:00:00');
    const monthsEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthsEs = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const months = lang === 'es' ? monthsEs : monthsEn;
    const dayNames = lang === 'es'
      ? ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
      : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return `${dayNames[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  let lastDateKey = null;

  orders.forEach(order => {
    // Insert date separator when the date changes
    const dateKey = getDateKey(order);
    if (dateKey !== lastDateKey) {
      const dateLabel = getDateLabel(dateKey);
      html += `<div class="airy-date-header">${dateLabel}</div>`;
      lastDateKey = dateKey;
    }

    const driverName = _esc(getDriverName(order.driver_id));
    const time = formatTime(order.submitted_at);
    const orderNum = order.order_number ? `#${order.order_number}` : '';
    const initials = _getInitials(driverName) || '??';

    // Payment badge variables
    let payClass = 'unpaid';
    let payText = lang === 'es' ? 'Sin Pagar' : 'Not Paid';
    if (order.payment_status === 'paid') {
      payClass = 'paid';
      payText = lang === 'es' ? 'Pagado' : 'Paid';
    } else if (order.payment_status === 'partial') {
      payClass = 'partial';
      payText = lang === 'es' ? 'Parcial' : 'Partial';
    }

    const unseenClass = isDriverOrderSeen(order.id) ? '' : ' unseen';
    
    html += `
      <div class="order-card-avatar${unseenClass}" data-order-id="${order.id}" onclick="openOrderSheet('${order.id}')">
        <div class="oca-avatar">${initials}</div>
        <div class="oca-body">
          <div class="oca-name">${driverName}</div>
          <div class="oca-time">${orderNum ? orderNum + ' • ' : ''}${time}</div>
        </div>
        <div class="oca-right">
          <div class="oca-price">${formatCurrency(parseFloat(order.total_amount || 0))}</div>
          <div class="oca-pill ${payClass}">${payText}</div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

/* ═══════════════════════════════════
   PRODUCT → CATEGORY MAP  (for order detail)
   ═══════════════════════════════════ */
const PRODUCT_CAT = {};
(function() {
  const cats = {
    redondo: { en:'Round', es:'Redondo', keys:['pina','guava','dulce'] },
    plain:   { en:'Plain', es:'Plain', keys:['plain','raisin','pudin'] },
    tresleche:{ en:'Tres Leche', es:'Tres Leche', keys:['tl','tl_hershey','cuatro_leche','tl_straw','tl_pina'] },
    piezas:  { en:'Pieces', es:'Piezas', keys:['pz_rv','pz_carrot','pz_cheese','pz_pudin','pz_pina','pz_guava','pz_chocoflan','pz_flan'] },
    frostin: { en:'Frosted Pieces', es:'Piezas Frostin', keys:['fr_guava','fr_pina','fr_dulce','fr_choco'] },
    hb_big:  { en:'Happy Birthday — BIG', es:'Feliz Cumpleaños — GRANDE', keys:['hb_b_pina','hb_b_guava','hb_b_dulce','hb_b_choco','hb_b_straw'] },
    hb_small:{ en:'Happy Birthday — SMALL', es:'Feliz Cumpleaños — PEQUEÑO', keys:['hb_s_pina','hb_s_guava','hb_s_dulce','hb_s_choco','hb_s_straw'] },
    cuadrao: { en:'Square', es:'Cuadrao', keys:['cdr_pudin','cdr_pound','cdr_raisin','cdr_maiz'] },
    basos:   { en:'Cups', es:'Basos', keys:['bas_tl','bas_cl','bas_hershey'] },
    familiar:{ en:'Family Size', es:'Familiar', keys:['fam_tl','fam_cl'] },
  };
  const redondoCols = ['inside','inside_nt','top','top_nt'];
  Object.values(cats).forEach(c => {
    c.keys.forEach(k => {
      // Direct key
      PRODUCT_CAT[k] = c;
      // No-ticket variant
      PRODUCT_CAT[k + '_nt'] = c;
      // Redondo column variants
      if (c.en === 'Round') {
        redondoCols.forEach(col => { PRODUCT_CAT[k + '_' + col] = c; });
      }
    });
  });
})();

// Fixed category display order
const CAT_ORDER_EN = ['Tres Leche', 'Pieces', 'Frosted Pieces', 'Plain', 'Round', 'Happy Birthday \u2014 BIG', 'Happy Birthday \u2014 SMALL', 'Square', 'Cups', 'Family Size'];

function sortItemsByCategory(items) {
  return items.slice().sort(function(a, b) {
    var catA = getCategoryLabel(a.product_key) || 'zzz';
    var catB = getCategoryLabel(b.product_key) || 'zzz';
    // Map to English label for ordering consistency
    var enA = PRODUCT_CAT[a.product_key] ? PRODUCT_CAT[a.product_key].en : 'zzz';
    var enB = PRODUCT_CAT[b.product_key] ? PRODUCT_CAT[b.product_key].en : 'zzz';
    var ai = CAT_ORDER_EN.indexOf(enA); if (ai === -1) ai = 999;
    var bi = CAT_ORDER_EN.indexOf(enB); if (bi === -1) bi = 999;
    return ai - bi;
  });
}

function getCategoryLabel(productKey) {
  const cat = PRODUCT_CAT[productKey];
  if (!cat) return '';
  return lang === 'es' ? cat.es : cat.en;
}

/* ═══════════════════════════════════
   ORDER DETAIL MODAL
   ═══════════════════════════════════ */
let detailOrder = null;
let detailItems = [];
let detailTotalsVisible = true;

window.openOrderSheet = async function(orderId) {
  if (window._swipeDismissCooldown) return;
  try {
    // Fetch order
    const { data: order, error: e1 } = await sb
      .from('driver_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (e1 || !order) { showToast(lang === 'es' ? 'Error cargando pedido' : 'Error loading order', 'error'); return; }

    // Fetch items
    const { data: items, error: e2 } = await sb
      .from('driver_order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('id');

    if (e2) { showToast(lang === 'es' ? 'Error cargando items' : 'Error loading items', 'error'); return; }

    detailOrder = order;
    detailItems = sortItemsByCategory(items || []);
    detailTotalsVisible = true;
    // Mark order as seen when admin opens detail
    markDriverOrderSeen(orderId);
    await renderOrderSheet();
    document.getElementById('order-sheet-overlay').classList.add('open');
    // Lock body scroll (iOS-safe)
    document.body.dataset.scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.width = '100%';
  } catch (e) { console.error(e); }
};

window.closeOrderSheet = function() {
  const overlay = document.getElementById('order-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
  
  // Restore body scroll
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  document.body.style.width = '';
  window.scrollTo(0, parseInt(document.body.dataset.scrollY || '0') || 0);

  detailOrder = null;
  detailItems = [];
};

async function renderOrderSheet() {
  const order = detailOrder;
  if (!order) return;

  // Fetch driver credit values
  let driverCreditMap = {};
  if (order.driver_id) {
    const { data: dp } = await sb.from('driver_prices').select('product_key, credit_value').eq('driver_id', order.driver_id);
    if (dp) dp.forEach(p => { driverCreditMap[p.product_key] = p.credit_value || 0; });
  }
  window._currentCreditMap = driverCreditMap;

  const driverName = getDriverName(order.driver_id);
  const orderNum = order.order_number ? `#${order.order_number}` : '';

  // Title
  document.getElementById('order-sheet-title').textContent =
    `${lang === 'es' ? 'Pedido' : 'Order'} ${orderNum}`;

  let html = '';

  // Edit window banner
  const editWindowInfo = getEditWindowStatus(order);
  if (editWindowInfo.show) {
    html += `<div class="edit-window-banner ${editWindowInfo.expired ? 'expired' : 'active'}">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${editWindowInfo.text}
    </div>`;
  }

  // Meta info
  html += '<div class="detail-meta" style="margin-bottom:12px">';
  html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Conductor' : 'Driver'}</span><span class="detail-meta-value">${_esc(driverName)}</span></div>`;
  if (order.business_name) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Negocio' : 'Business'}</span><span class="detail-meta-value">${_esc(order.business_name)}</span></div>`;
  }
  // Smart date/time labels
  html += renderSmartDateTime(order);
  if (order.driver_ref) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Ref del Conductor' : "Driver's Ref"}</span><span class="detail-meta-value">${_esc(order.driver_ref)}</span></div>`;
  }
  html += '</div>';

  // Totals toggle
  html += `<div class="totals-toggle-wrap">
    <span class="totals-toggle-label">${lang === 'es' ? 'Mostrar precios' : 'Show prices'}</span>
    <label class="toggle">
      <input type="checkbox" id="detail-totals-toggle" ${detailTotalsVisible ? 'checked' : ''} onchange="toggleDetailTotals()">
      <span class="toggle-track"></span>
      <span class="toggle-thumb"></span>
    </label>
  </div>`;

  // --- AIRY LINE ITEMS (Receipt Layout) ---
  const isEditable = canEditOrder(order);
  html += `<div class="receipt-items-container">`;

  let grandTotal = 0;
  let lastCat = '';
  
  detailItems.forEach((item, idx) => {
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    const lineTotal = effectiveQty * parseFloat(item.price_at_order || 0);
    grandTotal += lineTotal;

    // Category header row
    const cat = getCategoryLabel(item.product_key);
    if (cat && cat !== lastCat) {
      html += `<div class="receipt-cat-header">${cat}</div>`;
      lastCat = cat;
    }

    // Clean label: strip "(No Ticket)" from text, show as tag
    let label = item.product_label || '';
    const isNoTicket = label.includes('(No Ticket)') || (item.product_key && item.product_key.endsWith('_nt'));
    if (isNoTicket) label = label.replace(/\s*\(No Ticket\)/i, '');
    label = label.replace(/_nt\b/g, '');  // clean redondo column suffixes

    html += `<div class="receipt-item">`;
    html += `  <div class="receipt-item-top">`;
    html += `    <div class="receipt-item-name">${_esc(label)}`;
    if (isNoTicket) html += ` <span class="no-ticket-tag" style="display:inline-block;margin-left:6px;font-size:0.6rem">✕ No Ticket</span>`;
    if (item.adjustment_note) html += `<span class="adj-note" style="display:block;margin-top:2px">${_esc(item.adjustment_note)}</span>`;
    html += `    </div>`;
    
    if (detailTotalsVisible) {
      html += `    <div class="receipt-item-price">${formatCurrency(lineTotal)}</div>`;
    }
    html += `  </div>`;
    
    html += `  <div class="receipt-item-sub">`;
    
    // Qty Adjust block
    if (isEditable) {
      html += `<div class="receipt-item-adjust">
        <span class="adjust-label">${lang==='es'?'Cant:':'Qty:'}</span>
        <input type="number" class="qty-adjust-input" value="${effectiveQty}" min="0" data-item-idx="${idx}" data-item-id="${item.id}" data-original-qty="${item.quantity}" onchange="handleQtyAdjust(this)">
      </div>`;
    } else {
      if (effectiveQty !== item.quantity) {
        html += `<div class="receipt-item-qty"><span style="text-decoration:line-through;opacity:0.5">${item.quantity}</span> → <strong>${effectiveQty}</strong></div>`;
      } else {
        html += `<div class="receipt-item-qty">${item.quantity} units</div>`;
      }
    }
    
    if (detailTotalsVisible) {
      html += `    <div class="receipt-item-qty-rate" style="font-size:0.75rem;color:var(--tx-faint)">@ ${formatCurrency(parseFloat(item.price_at_order || 0))}</div>`;
    }
    
    html += `  </div>`; // item-sub
    html += `</div>`; // item
  });

  html += `</div>`; // receipt-items-container

  // Add Item button (only when editable)
  if (isEditable) {
    // Build product options grouped by category, excluding items already in order
    const existingKeys = new Set(detailItems.map(it => it.product_key));
    let optionsHtml = `<option value="" disabled selected>${lang === 'es' ? '— Seleccionar producto —' : '— Select product —'}</option>`;
    ADMIN_PRODUCTS.forEach(sec => {
      const available = sec.items.filter(p => !existingKeys.has(p.key));
      if (available.length > 0) {
        const sectionLabel = lang === 'es' ? sec.sectionEs : sec.section;
        optionsHtml += `<optgroup label="${_esc(sectionLabel)}">`;
        available.forEach(p => {
          const pLabel = lang === 'es' ? p.es : p.en;
          optionsHtml += `<option value="${_esc(p.key)}" data-label="${_esc(pLabel)}">${_esc(pLabel)}</option>`;
        });
        optionsHtml += '</optgroup>';
      }
    });
    html += `<div class="add-item-row">
      <select id="add-item-select" class="add-item-select">${optionsHtml}</select>
      <button class="add-item-btn" onclick="addItemToOrder()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${lang === 'es' ? 'Agregar' : 'Add'}
      </button>
    </div>`;
  }

  if (detailTotalsVisible) {
    html += `<div class="receipt-grand-total"><span>${lang === 'es' ? 'Total General' : 'Grand Total'}</span><span id="grand-total-amount">${formatCurrency(grandTotal)}</span></div>`;
  }

  // Returns & Credit section
  window._currentGrandTotal = grandTotal;
  
  html += `<button class="returns-toggle-btn" onclick="document.getElementById('returns-body').style.display='block';this.style.display='none'">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
             ${lang === 'es' ? 'Procesar Devolución / Crédito' : 'Process Return / Credit'}
           </button>`;

  html += '<div id="returns-body" style="display:none;margin-top:20px;padding:16px;background:var(--bg-surface);border-radius:12px;border:1px solid var(--bd)">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
  html += `<span style="font-size:1rem;font-weight:800;color:var(--tx)">${lang === 'es' ? 'Devoluciones y Crédito' : 'Returns & Credit'}</span>`;
  html += `<button onclick="document.getElementById('returns-body').style.display='none';document.querySelector('.returns-toggle-btn').style.display='flex'" style="background:none;border:none;color:var(--tx-muted);cursor:pointer">✕</button></div>`;
  
  html += '<div style="font-size:.78rem;color:var(--tx-faint);margin-bottom:12px">Enter returned product quantities to calculate credit</div>';
  html += '<div id="returns-grid" style="display:grid;grid-template-columns:1fr 60px 70px;gap:6px 10px;align-items:center;margin-bottom:12px">';
  html += '<div style="font-size:.68rem;font-weight:700;color:var(--tx-faint);text-transform:uppercase">Product</div>';
  html += '<div style="font-size:.68rem;font-weight:700;color:var(--tx-faint);text-transform:uppercase;text-align:center">Qty</div>';
  html += '<div style="font-size:.68rem;font-weight:700;color:var(--tx-faint);text-transform:uppercase;text-align:right">Credit</div>';
  
  // Show items from this order with credit value (fallback to price_at_order)
  const seenKeys = new Set();
  let lastReturnCat = '';
  detailItems.forEach(function(item) {
    if (seenKeys.has(item.product_key)) return;
    seenKeys.add(item.product_key);
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    if (effectiveQty === 0) return;
    
    const cat = getCategoryLabel(item.product_key);
    if (cat && cat !== lastReturnCat) {
      html += '<div style="grid-column:1/-1;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--red);padding:8px 0 4px;border-bottom:1px solid var(--bd);margin-top:' + (lastReturnCat ? '8px' : '0') + '">' + cat + '</div>';
      lastReturnCat = cat;
    }
    const cv = driverCreditMap[item.product_key] || parseFloat(item.price_at_order) || 0;
    const label = (item.product_label || item.product_key).replace(/\s*\(No Ticket\)/i, '');
    
    html += '<div style="font-size:.85rem;color:var(--tx)">' + _esc(label) + '</div>';
    html += '<input type="number" class="return-qty-input" data-key="' + item.product_key + '" data-credit="' + cv + '" value="0" min="0" max="' + effectiveQty + '" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--bd);text-align:center;font-size:.85rem;background:var(--bg-input);color:var(--tx)" oninput="window._calcReturnCredit()">';
    html += '<div class="return-line-credit" data-key="' + item.product_key + '" style="font-size:.85rem;text-align:right;color:var(--tx-faint)">$0.00</div>';
  });
  
  html += '</div>';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid var(--bd)">';
  html += '<span style="font-weight:700;font-size:.9rem">Total Credit</span>';
  html += '<span id="total-credit" style="font-weight:700;font-size:.95rem;color:#0a7a0a">$0.00</span></div>';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">';
  html += '<span style="font-weight:700;font-size:.95rem">Adjusted Total</span>';
  html += '<span id="adjusted-total" style="font-weight:700;font-size:1.05rem;color:var(--red)">' + formatCurrency(grandTotal) + '</span></div>';
  html += '</div></div>';

  // Payment status — ALWAYS editable regardless of order age
  html += `<div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;color:var(--tx-faint);font-weight:500;margin-top:12px">${lang === 'es' ? 'Estado de Pago' : 'Payment Status'}</div>`;
  html += '<div class="payment-btns">';
  html += `<button class="payment-btn ${order.payment_status === 'not_paid' ? 'active-unpaid' : ''}" onclick="setPaymentStatus('not_paid')">${lang === 'es' ? 'Sin Pagar' : 'Not Paid'}</button>`;
  html += `<button class="payment-btn ${order.payment_status === 'paid' ? 'active-paid' : ''}" onclick="setPaymentStatus('paid')">${lang === 'es' ? 'Pagado' : 'Paid'}</button>`;
  html += `<button class="payment-btn ${order.payment_status === 'partial' ? 'active-partial' : ''}" onclick="setPaymentStatus('partial')">${lang === 'es' ? 'Parcial' : 'Partial'}</button>`;
  html += '</div>';

  // Partial amount input — always editable
  if (order.payment_status === 'partial') {
    const remaining = Math.max(0, grandTotal - parseFloat(order.payment_amount || 0));
    html += `<div class="partial-amount-wrap">
      <label>${lang === 'es' ? 'Monto pagado:' : 'Amount paid:'}</label>
      <input type="number" class="partial-amount-input" id="partial-amount" value="${order.payment_amount || 0}" step="0.01" min="0" onchange="handlePartialAmount(this)">
      <span class="partial-remaining">${lang === 'es' ? 'Restante:' : 'Remaining:'} ${formatCurrency(Math.max(0, remaining))}</span>
    </div>`;
  }

  document.getElementById('order-sheet-content').innerHTML = html;

  // Actions
  let actionsHtml = '';
  if (order.status === 'pending' || (order.status === 'sent' && canEditOrder(order))) {
    // Fully editable: one "Save Changes" button that saves everything including payment
    actionsHtml += `<button class="btn-save" onclick="saveOrderChanges()" data-en="Save Changes" data-es="Guardar Cambios">${lang === 'es' ? 'Guardar Cambios' : 'Save Changes'}</button>`;
  } else if (order.status === 'sent' || order.status === 'confirmed' || order.status === 'picked_up') {
    // Not fully editable, but payment is always editable
    actionsHtml += `<button class="btn-save" onclick="savePaymentOnly()" data-en="Update Payment" data-es="Actualizar Pago">${lang === 'es' ? 'Actualizar Pago' : 'Update Payment'}</button>`;
  }
  if (order.status === 'pending' || order.status === 'sent' || order.status === 'confirmed') {
    actionsHtml += `<button class="btn-pickup" onclick="markAsPickedUp()" data-en="Mark as Picked Up" data-es="Marcar Recogido">&#10003; ${lang === 'es' ? 'Marcar Recogido' : 'Mark as Picked Up'}</button>`;
  }
  // Export bar
  actionsHtml += `<div class="export-bar">
    <button class="export-btn" onclick="printOrder()">
      <i data-lucide="printer"></i> ${lang === 'es' ? 'Imprimir / Guardar' : 'Print / Save'}
    </button>
    <button class="export-btn whatsapp" onclick="shareWhatsApp()">
      <i data-lucide="message-circle"></i> WhatsApp
    </button>
  </div>`;
  document.getElementById('order-sheet-actions').innerHTML = actionsHtml;
  requestAnimationFrame(() => lucide.createIcons());
}

/* ═══════════════════════════════════
   SMART DATE/TIME LABELS
   ═══════════════════════════════════ */
function renderSmartDateTime(order) {
  let html = '';
  // Date
  if (order.pickup_date) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Fecha de Recogida' : 'Pickup Date'}</span><span class="detail-meta-value">${formatDate(order.pickup_date)}</span></div>`;
  } else {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Fecha del Pedido' : 'Date Ordered'}</span><span class="detail-meta-value">${formatDate(order.submitted_at)}</span></div>`;
  }
  // Time
  if (order.pickup_time) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Hora de Recogida' : 'Pickup Time'}</span><span class="detail-meta-value">${formatTimeValue(order.pickup_time)}</span></div>`;
  } else {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Hora del Pedido' : 'Time Ordered'}</span><span class="detail-meta-value">${formatTime(order.submitted_at)}</span></div>`;
  }
  return html;
}

window._calcReturnCredit = function() {
  var totalCredit = 0;
  document.querySelectorAll('.return-qty-input').forEach(function(inp) {
    var qty = parseInt(inp.value) || 0;
    var creditPer = parseFloat(inp.dataset.credit) || 0;
    var lineCredit = qty * creditPer;
    totalCredit += lineCredit;
    var lineEl = document.querySelector('.return-line-credit[data-key="' + inp.dataset.key + '"]');
    if (lineEl) lineEl.textContent = '$' + lineCredit.toFixed(2);
  });
  var totalEl = document.getElementById('total-credit');
  var adjEl = document.getElementById('adjusted-total');
  if (totalEl) totalEl.textContent = '$' + totalCredit.toFixed(2);
  if (adjEl) {
    var adjusted = (window._currentGrandTotal || 0) - totalCredit;
    adjEl.textContent = formatCurrency(Math.max(0, adjusted));
  }
};

/* ═══════════════════════════════════
   EDIT WINDOW LOGIC
   Editable until fully paid
   ═══════════════════════════════════ */
function canEditOrder(order) {
  // Editable as long as not fully paid
  if (order.payment_status === 'paid') return false;
  return true;
}

function getEditWindowStatus(order) {
  if (order.status === 'pending') return { show: false };

  if (order.payment_status === 'paid') {
    return {
      show: true,
      expired: true,
      text: lang === 'es'
        ? 'Este pedido está pagado — no se puede editar'
        : 'This order is paid — editing is locked'
    };
  }

  return {
    show: true,
    expired: false,
    text: lang === 'es'
      ? 'Puedes editar cantidades hasta que se marque como pagado'
      : 'You can edit quantities until marked as paid'
  };
}

/* ═══════════════════════════════════
   ORDER ACTIONS
   ═══════════════════════════════════ */
window.toggleDetailTotals = async function() {
  detailTotalsVisible = !detailTotalsVisible;
  await renderOrderSheet();
};

window.handleQtyAdjust = async function(input) {
  const itemIdx = parseInt(input.dataset.itemIdx);
  const itemId = input.dataset.itemId;
  const originalQty = parseInt(input.dataset.originalQty);
  const newQty = parseInt(input.value) || 0;

  const item = detailItems[itemIdx];
  if (!item) return;

  const diff = newQty - originalQty;
  let note = '';
  if (diff > 0) note = `(+${diff} ${lang === 'es' ? 'añadido en recogida' : 'added at pickup'})`;
  else if (diff < 0) note = `(${diff} ${lang === 'es' ? 'eliminado' : 'removed'})`;
  else note = null;

  // Update local state
  detailItems[itemIdx].adjusted_quantity = newQty;
  detailItems[itemIdx].adjustment_note = note;
  detailItems[itemIdx].adjusted_at = new Date().toISOString();

  // Re-render to update totals
  await renderOrderSheet();
};

window.addItemToOrder = async function() {
  const select = document.getElementById('add-item-select');
  if (!select || !select.value) return;

  const productKey = select.value;
  const selectedOption = select.options[select.selectedIndex];
  const productLabel = selectedOption.dataset.label || productKey;

  // Look up driver price for this product
  let price = 0;
  if (detailOrder && detailOrder.driver_id) {
    try {
      const { data } = await sb.from('driver_prices')
        .select('price')
        .eq('driver_id', detailOrder.driver_id)
        .eq('product_key', productKey)
        .maybeSingle();
      if (data) price = parseFloat(data.price) || 0;
    } catch (e) { console.warn('Price lookup failed:', e); }
  }

  // Add to detailItems (no id = new item, will be inserted on save)
  detailItems.push({
    id: null,
    order_id: detailOrder.id,
    product_key: productKey,
    product_label: productLabel,
    quantity: 0,
    adjusted_quantity: 1,
    adjustment_note: `(${lang === 'es' ? 'añadido por admin' : 'added by admin'})`,
    adjusted_at: new Date().toISOString(),
    price_at_order: price,
    _isNew: true
  });

  await renderOrderSheet();
  showToast(`${productLabel} ${lang === 'es' ? 'agregado' : 'added'}`, 'success');
};

window.setPaymentStatus = async function(status) {
  if (!detailOrder) return;
  detailOrder.payment_status = status;

  if (status === 'paid') {
    // Auto-set payment_amount to total
    const grandTotal = detailItems.reduce((sum, it) => {
      const eqty = it.adjusted_quantity !== null ? it.adjusted_quantity : it.quantity;
      return sum + eqty * parseFloat(it.price_at_order || 0);
    }, 0);
    detailOrder.payment_amount = grandTotal;
  } else if (status === 'not_paid') {
    detailOrder.payment_amount = 0;
  }

  await renderOrderSheet();
};

window.handlePartialAmount = async function(input) {
  if (!detailOrder) return;
  let amount = parseFloat(input.value) || 0;
  if (amount < 0) { amount = 0; input.value = 0; }
  // Clamp: can't pay more than the order total
  const total = parseFloat(detailOrder.total_amount || 0);
  if (amount > total) {
    amount = total;
    input.value = amount;
  }
  detailOrder.payment_amount = amount;
  await renderOrderSheet();
};

window.saveOrderChanges = async function() {
  if (!detailOrder) return;

  // Block realtime from overwriting detailItems while we're saving
  _isSavingOrder = true;
  try {
    // Save item adjustments (existing items)
    for (const item of detailItems) {
      if (item._isNew) continue; // new items handled below
      if (item.adjusted_quantity !== null && item.adjusted_quantity !== undefined) {
        await sb.from('driver_order_items').update({
          adjusted_quantity: item.adjusted_quantity,
          adjustment_note: item.adjustment_note,
          adjusted_at: item.adjusted_at || new Date().toISOString()
        }).eq('id', item.id);
      }
    }

    // Insert new items added by admin
    const newItems = detailItems.filter(it => it._isNew);
    for (const item of newItems) {
      const { data, error } = await sb.from('driver_order_items').insert({
        order_id: detailOrder.id,
        product_key: item.product_key,
        product_label: item.product_label,
        quantity: 0,
        adjusted_quantity: item.adjusted_quantity,
        adjustment_note: item.adjustment_note,
        adjusted_at: item.adjusted_at,
        price_at_order: item.price_at_order
      }).select().single();
      if (!error && data) {
        item.id = data.id;
        item._isNew = false;
      }
    }

    // Recalculate total
    const grandTotal = detailItems.reduce((sum, it) => {
      const eqty = it.adjusted_quantity !== null ? it.adjusted_quantity : it.quantity;
      return sum + eqty * parseFloat(it.price_at_order || 0);
    }, 0);

    // Save order payment + total
    await sb.from('driver_orders').update({
      payment_status: detailOrder.payment_status,
      payment_amount: detailOrder.payment_amount,
      total_amount: grandTotal
    }).eq('id', detailOrder.id);

    showToast(lang === 'es' ? 'Cambios guardados' : 'Changes saved', 'success');

    // Refresh
    if (currentSection === 'incoming') loadIncomingOrders();
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error guardando cambios' : 'Error saving changes', 'error');
  } finally {
    _isSavingOrder = false;
  }
};

window.confirmAndSend = async function() {
  if (!detailOrder) return;

  try {
    // Save adjustments first
    await window.saveOrderChanges();

    const now = new Date();

    await sb.from('driver_orders').update({
      status: 'picked_up',
      confirmed_at: now.toISOString(),
      picked_up_at: now.toISOString()
    }).eq('id', detailOrder.id);

    detailOrder.status = 'picked_up';
    detailOrder.confirmed_at = now.toISOString();

    showToast(lang === 'es' ? 'Pedido confirmado y marcado como recogido' : 'Order confirmed & marked as picked up', 'success');

    closeOrderSheet();

    if (currentSection === 'incoming') loadIncomingOrders();
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error confirmando pedido' : 'Error confirming order', 'error');
  }
};

window.markAsPickedUp = async function() {
  if (!detailOrder) return;

  try {
    // Save any form adjustments first
    await window.saveOrderChanges();

    await sb.from('driver_orders').update({
      status: 'picked_up',
      picked_up_at: new Date().toISOString()
    }).eq('id', detailOrder.id);

    detailOrder.status = 'picked_up';

    showToast(lang === 'es' ? 'Pedido marcado como recogido' : 'Order marked as picked up', 'success');

    closeOrderSheet();

    if (currentSection === 'incoming') loadIncomingOrders();
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error actualizando pedido' : 'Error updating order', 'error');
  }
};

window.savePaymentOnly = async function() {
  if (!detailOrder) return;

  try {
    const updateData = {
      payment_status: detailOrder.payment_status,
      payment_amount: detailOrder.payment_amount
    };

    // Auto-mark as picked up when paid (if not already)
    if (detailOrder.payment_status === 'paid' && detailOrder.status !== 'picked_up') {
      updateData.status = 'picked_up';
      updateData.picked_up_at = new Date().toISOString();
      if (!detailOrder.confirmed_at) {
        updateData.confirmed_at = new Date().toISOString();
      }
      detailOrder.status = 'picked_up';
    }

    await sb.from('driver_orders').update(updateData).eq('id', detailOrder.id);

    showToast(lang === 'es' ? 'Pago actualizado' : 'Payment updated', 'success');

    if (currentSection === 'incoming') loadIncomingOrders();
    if (currentSection === 'history') loadHistoryOrders(true);
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error actualizando pago' : 'Error updating payment', 'error');
  }
};

function closeDetailModal() {
  // Delegated to the new sheet system
  closeOrderSheet();
}
window.closeDetailModal = closeDetailModal;  // expose for swipe-dismiss.js

/* ═══════════════════════════════════
   PHASE 6 — EXPORT, PRINT & SHARE
   ═══════════════════════════════════ */
function buildPrintHTML(showTotals) {
  const order = detailOrder;
  if (!order) return '';

  const driverName = getDriverName(order.driver_id);
  const orderNum = order.order_number ? `#${order.order_number}` : `#${order.id.replace(/-/g, '').slice(-5).toUpperCase()}`;

  // Date/time
  let dateStr = '';
  let dateLabel = '';
  if (order.pickup_date) {
    dateLabel = lang === 'es' ? 'Fecha de Recogida' : 'Pickup Date';
    dateStr = formatDate(order.pickup_date);
  } else {
    dateLabel = lang === 'es' ? 'Fecha del Pedido' : 'Date Ordered';
    dateStr = formatDate(order.submitted_at);
  }
  let timeStr = '';
  let timeLabel = '';
  if (order.pickup_time) {
    timeLabel = lang === 'es' ? 'Hora de Recogida' : 'Pickup Time';
    timeStr = formatTimeValue(order.pickup_time);
  } else {
    timeLabel = lang === 'es' ? 'Hora del Pedido' : 'Time Ordered';
    timeStr = formatTime(order.submitted_at);
  }

  const logoUrl = window.location.origin + '/assets/logo.png';
  let html = `<div class="print-header">
    <img src="${logoUrl}" alt="Cecilia Bakery" class="print-logo" onerror="this.style.display='none'">
    <div class="print-order-num">${lang === 'es' ? 'Pedido' : 'Order'} ${orderNum}</div>
  </div>`;

  html += `<div class="print-meta">`;
  html += `<div class="print-meta-item"><span class="print-meta-label">${lang === 'es' ? 'Conductor:' : 'Driver:'}</span> ${driverName}</div>`;
  if (order.business_name) {
    html += `<div class="print-meta-item"><span class="print-meta-label">${lang === 'es' ? 'Negocio:' : 'Business:'}</span> ${order.business_name}</div>`;
  }
  html += `<div class="print-meta-item"><span class="print-meta-label">${dateLabel}:</span> ${dateStr}</div>`;
  html += `<div class="print-meta-item"><span class="print-meta-label">${timeLabel}:</span> ${timeStr}</div>`;
  html += `</div>`;

  // Items table
  html += `<table class="print-items"><thead><tr>`;
  html += `<th>${lang === 'es' ? 'Producto' : 'Product'}</th>`;
  html += `<th class="col-r">${lang === 'es' ? 'Cant.' : 'Qty'}</th>`;
  if (showTotals) {
    html += `<th class="col-r">${lang === 'es' ? 'Precio' : 'Price'}</th>`;
    html += `<th class="col-r">Total</th>`;
  }
  html += `</tr></thead><tbody>`;

  let grandTotal = 0;
  let lastPrintCat = '';
  const colSpan = showTotals ? 4 : 2;
  detailItems.forEach(item => {
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    const lineTotal = effectiveQty * parseFloat(item.price_at_order || 0);
    grandTotal += lineTotal;
    const adjNote = (item.adjusted_quantity !== null && item.adjusted_quantity !== item.quantity)
      ? ` (${item.quantity} → ${effectiveQty})` : '';

    // Category header row
    const cat = getCategoryLabel(item.product_key);
    if (cat && cat !== lastPrintCat) {
      html += `<tr><td colspan="${colSpan}" style="background:#fff5f5;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#C8102E;padding:6px 8px;border-bottom:2px solid #C8102E">${cat}</td></tr>`;
      lastPrintCat = cat;
    }

    html += `<tr>`;
    html += `<td>${item.product_label}${adjNote}</td>`;
    html += `<td class="col-r">${effectiveQty}</td>`;
    if (showTotals) {
      html += `<td class="col-r">${formatCurrency(parseFloat(item.price_at_order || 0))}</td>`;
      html += `<td class="col-r">${formatCurrency(lineTotal)}</td>`;
    }
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  if (showTotals) {
    html += `<div class="print-total">${lang === 'es' ? 'Total General' : 'Grand Total'}: ${formatCurrency(grandTotal)}</div>`;
  }

  // Payment status
  const payLabels = {
    paid: lang === 'es' ? 'Pagado' : 'Paid',
    not_paid: lang === 'es' ? 'No Pagado' : 'Not Paid',
    partial: lang === 'es' ? 'Parcial' : 'Partial'
  };
  let payStr = payLabels[order.payment_status] || order.payment_status;
  if (order.payment_status === 'partial' && showTotals) {
    payStr += ` — ${formatCurrency(order.payment_amount || 0)} / ${formatCurrency(grandTotal)}`;
  }
  html += `<div class="print-payment"><strong>${lang === 'es' ? 'Pago:' : 'Payment:'}</strong> ${payStr}</div>`;

  // Notes
  if (order.notes) {
    html += `<div class="print-notes"><strong>${lang === 'es' ? 'Notas:' : 'Notes:'}</strong> ${order.notes}</div>`;
  }

  return html;
}

function openPrintWindow(showTotals) {
  const content = buildPrintHTML(showTotals);
  if (!content) return;

  // Remove any existing print overlay
  const existing = document.getElementById('print-preview-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'print-preview-overlay';
  overlay.innerHTML = `
    <div class="pp-scroll">
      <div class="pp-page">
        ${content}
        <div class="pp-footer">ceciliabakery.com</div>
      </div>
      <div class="pp-actions">
        <button class="pp-btn pp-print" id="pp-print-btn">🖨 ${lang === 'es' ? 'Imprimir' : 'Print'}</button>
        <button class="pp-btn pp-share" id="pp-share-btn">📤 ${lang === 'es' ? 'Compartir' : 'Share'}</button>
        <button class="pp-btn pp-close" id="pp-close-btn">✕ ${lang === 'es' ? 'Cerrar' : 'Close'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Unlock the body scroll so the overlay can scroll freely
  const savedTop = document.body.style.top;
  const savedScrollY = parseInt(savedTop || '0', 10) * -1;
  document.body.style.position = '';
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);

  // Close button — re-lock body if modal is still open
  document.getElementById('pp-close-btn').addEventListener('click', () => {
    overlay.remove();
    const detailOverlay = document.getElementById('order-sheet-overlay');
    if (detailOverlay && detailOverlay.classList.contains('open')) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${window.scrollY}px`;
    }
  });

  // Print button — calls window.print() from main page (no Safari blocking)
  document.getElementById('pp-print-btn').addEventListener('click', () => {
    overlay.classList.add('printing');
    window.print();
    // Remove printing class after dialog closes
    const removePrinting = () => {
      overlay.classList.remove('printing');
      window.removeEventListener('focus', removePrinting);
    };
    window.addEventListener('focus', removePrinting);
  });

  // Share button — captures print preview as image
  document.getElementById('pp-share-btn').addEventListener('click', async () => {
    const pageEl = overlay.querySelector('.pp-page');
    if (!pageEl) return;
    try {
      const shareBtn = document.getElementById('pp-share-btn');
      shareBtn.textContent = '⏳ ' + (lang === 'es' ? 'Generando...' : 'Generating...');
      shareBtn.disabled = true;
      const canvas = await html2canvas(pageEl, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const orderNum = detailOrder?.order_number || '';
      const fileName = `cecilia-order-${orderNum}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Cecilia Bakery Order',
          files: [file]
        });
      } else {
        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        showToast(lang === 'es' ? 'Imagen descargada' : 'Image downloaded', 'success');
      }
      shareBtn.textContent = '📤 ' + (lang === 'es' ? 'Compartir' : 'Share');
      shareBtn.disabled = false;
    } catch (e) {
      console.error('Share error:', e);
      const shareBtn = document.getElementById('pp-share-btn');
      if (shareBtn) {
        shareBtn.textContent = '📤 ' + (lang === 'es' ? 'Compartir' : 'Share');
        shareBtn.disabled = false;
      }
    }
  });
}

window.printOrder = function() {
  openPrintWindow(detailTotalsVisible);
};


window.shareWhatsApp = async function() {
  if (!detailOrder) return;

  const order = detailOrder;
  const orderNum = order.order_number ? `#${order.order_number}` : `#${order.id.replace(/-/g, '').slice(-5).toUpperCase()}`;

  // Build the print preview off-screen
  const content = buildPrintHTML(detailTotalsVisible);
  if (!content) return;

  const tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;background:#fff;padding:20px;font-family:Outfit,Segoe UI,sans-serif;color:#1a1a1a';
  tempDiv.innerHTML = `<div class="pp-page">${content}<div class="pp-footer" style="margin-top:24px;text-align:center;font-size:.75rem;color:#aaa;border-top:1px solid #eee;padding-top:12px">ceciliabakery.com</div></div>`;
  document.body.appendChild(tempDiv);

  try {
    // Copy print-preview CSS styles inline for html2canvas
    const canvas = await html2canvas(tempDiv.querySelector('.pp-page'), {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false
    });
    tempDiv.remove();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const fileName = `cecilia-order-${order.order_number || ''}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    // Try native share with file (works on mobile)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: `Cecilia Bakery Order ${orderNum}`,
        files: [file]
      });
    } else {
      // Fallback: download the image so user can manually attach to WhatsApp
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      showToast(lang === 'es' ? 'Imagen descargada — compártela en WhatsApp' : 'Image downloaded — share it on WhatsApp', 'success');
    }
  } catch (e) {
    tempDiv.remove();
    console.error('WhatsApp image share error:', e);
    showToast(lang === 'es' ? 'Error al generar imagen' : 'Error generating image', 'error');
  }
};

/* ═══════════════════════════════════
   PHASE 4 — DRIVER MANAGEMENT
   ═══════════════════════════════════ */

// Product catalog matching driver-order.js keys
const ADMIN_PRODUCTS = [
  { section: 'Redondo', sectionEs: 'Redondo', items: [
    { key: 'pina_inside', en: 'Piña Inside', es: 'Piña Interior' },
    { key: 'pina_inside_nt', en: 'Piña Inside (NT)', es: 'Piña Interior (ST)' },
    { key: 'pina_top', en: 'Piña Top', es: 'Piña Arriba' },
    { key: 'pina_top_nt', en: 'Piña Top (NT)', es: 'Piña Arriba (ST)' },
    { key: 'guava_inside', en: 'Guava Inside', es: 'Guayaba Interior' },
    { key: 'guava_inside_nt', en: 'Guava Inside (NT)', es: 'Guayaba Interior (ST)' },
    { key: 'guava_top', en: 'Guava Top', es: 'Guayaba Arriba' },
    { key: 'guava_top_nt', en: 'Guava Top (NT)', es: 'Guayaba Arriba (ST)' },
    { key: 'dulce_inside', en: 'Dulce De Leche Inside', es: 'Dulce De Leche Interior' },
    { key: 'dulce_inside_nt', en: 'Dulce De Leche Inside (NT)', es: 'Dulce De Leche Interior (ST)' },
  ]},
  { section: 'Plain', sectionEs: 'Plain', items: [
    { key: 'plain', en: 'Plain', es: 'Plain' },
    { key: 'plain_nt', en: 'Plain (NT)', es: 'Plain (ST)' },
    { key: 'raisin', en: 'Raisin', es: 'Pasas' },
    { key: 'raisin_nt', en: 'Raisin (NT)', es: 'Pasas (ST)' },
    { key: 'pudin', en: 'Pudin', es: 'Pudín' },
    { key: 'pudin_nt', en: 'Pudin (NT)', es: 'Pudín (ST)' },
  ]},
  { section: 'Tres Leche', sectionEs: 'Tres Leche', items: [
    { key: 'tl', en: 'Tres Leche', es: 'Tres Leche' },
    { key: 'tl_nt', en: 'Tres Leche (NT)', es: 'Tres Leche (ST)' },
    { key: 'tl_hershey', en: 'Tres Leche Hershey', es: 'Tres Leche Hershey' },
    { key: 'tl_hershey_nt', en: 'Tres Leche Hershey (NT)', es: 'Tres Leche Hershey (ST)' },
    { key: 'cuatro_leche', en: 'Cuatro Leche', es: 'Cuatro Leche' },
    { key: 'cuatro_leche_nt', en: 'Cuatro Leche (NT)', es: 'Cuatro Leche (ST)' },
    { key: 'tl_straw', en: 'Tres Leche Strawberry', es: 'Tres Leche Fresa' },
    { key: 'tl_straw_nt', en: 'Tres Leche Strawberry (NT)', es: 'Tres Leche Fresa (ST)' },
    { key: 'tl_pina', en: 'Tres Leche Piña', es: 'Tres Leche Piña' },
    { key: 'tl_pina_nt', en: 'Tres Leche Piña (NT)', es: 'Tres Leche Piña (ST)' },
  ]},
  { section: 'Pieces', sectionEs: 'Piezas', items: [
    { key: 'pz_rv', en: 'Red Velvet', es: 'Red Velvet' },
    { key: 'pz_rv_nt', en: 'Red Velvet (NT)', es: 'Red Velvet (ST)' },
    { key: 'pz_carrot', en: 'Carrot Cake', es: 'Zanahoria' },
    { key: 'pz_carrot_nt', en: 'Carrot Cake (NT)', es: 'Zanahoria (ST)' },
    { key: 'pz_cheese', en: 'Cheesecake', es: 'Cheesecake' },
    { key: 'pz_cheese_nt', en: 'Cheesecake (NT)', es: 'Cheesecake (ST)' },
    { key: 'pz_pudin', en: 'Pudin', es: 'Pudin' },
    { key: 'pz_pudin_nt', en: 'Pudin (NT)', es: 'Pudin (ST)' },
    { key: 'pz_pina', en: 'Piña', es: 'Piña' },
    { key: 'pz_pina_nt', en: 'Piña (NT)', es: 'Piña (ST)' },
    { key: 'pz_guava', en: 'Guava', es: 'Guayaba' },
    { key: 'pz_guava_nt', en: 'Guava (NT)', es: 'Guayaba (ST)' },
    { key: 'pz_chocoflan', en: 'Chocoflan', es: 'Chocoflan' },
    { key: 'pz_chocoflan_nt', en: 'Chocoflan (NT)', es: 'Chocoflan (ST)' },
    { key: 'pz_flan', en: 'Flan', es: 'Flan' },
    { key: 'pz_flan_nt', en: 'Flan (NT)', es: 'Flan (ST)' },
  ]},
  { section: 'Frosted Pieces', sectionEs: 'Piezas Frostin', items: [
    { key: 'fr_guava', en: 'Guava', es: 'Guayaba' },
    { key: 'fr_guava_nt', en: 'Guava (NT)', es: 'Guayaba (ST)' },
    { key: 'fr_pina', en: 'Piña', es: 'Piña' },
    { key: 'fr_pina_nt', en: 'Piña (NT)', es: 'Piña (ST)' },
    { key: 'fr_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
    { key: 'fr_dulce_nt', en: 'Dulce De Leche (NT)', es: 'Dulce De Leche (ST)' },
    { key: 'fr_choco', en: 'Chocolate', es: 'Chocolate' },
    { key: 'fr_choco_nt', en: 'Chocolate (NT)', es: 'Chocolate (ST)' },
  ]},
  { section: 'HB Big', sectionEs: 'HB Grande', items: [
    { key: 'hb_b_pina', en: 'Piña', es: 'Piña' },
    { key: 'hb_b_pina_nt', en: 'Piña (NT)', es: 'Piña (ST)' },
    { key: 'hb_b_guava', en: 'Guava', es: 'Guayaba' },
    { key: 'hb_b_guava_nt', en: 'Guava (NT)', es: 'Guayaba (ST)' },
    { key: 'hb_b_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
    { key: 'hb_b_dulce_nt', en: 'Dulce De Leche (NT)', es: 'Dulce De Leche (ST)' },
    { key: 'hb_b_choco', en: 'Chocolate', es: 'Chocolate' },
    { key: 'hb_b_choco_nt', en: 'Chocolate (NT)', es: 'Chocolate (ST)' },
    { key: 'hb_b_straw', en: 'Strawberry', es: 'Fresa' },
    { key: 'hb_b_straw_nt', en: 'Strawberry (NT)', es: 'Fresa (ST)' },
  ]},
  { section: 'HB Small', sectionEs: 'HB Pequeño', items: [
    { key: 'hb_s_pina', en: 'Piña', es: 'Piña' },
    { key: 'hb_s_pina_nt', en: 'Piña (NT)', es: 'Piña (ST)' },
    { key: 'hb_s_guava', en: 'Guava', es: 'Guayaba' },
    { key: 'hb_s_guava_nt', en: 'Guava (NT)', es: 'Guayaba (ST)' },
    { key: 'hb_s_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
    { key: 'hb_s_dulce_nt', en: 'Dulce De Leche (NT)', es: 'Dulce De Leche (ST)' },
    { key: 'hb_s_choco', en: 'Chocolate', es: 'Chocolate' },
    { key: 'hb_s_choco_nt', en: 'Chocolate (NT)', es: 'Chocolate (ST)' },
    { key: 'hb_s_straw', en: 'Strawberry', es: 'Fresa' },
    { key: 'hb_s_straw_nt', en: 'Strawberry (NT)', es: 'Fresa (ST)' },
  ]},
  { section: 'Square', sectionEs: 'Cuadrao', items: [
    { key: 'cdr_pudin', en: 'Pudin', es: 'Pudin' },
    { key: 'cdr_pudin_nt', en: 'Pudin (NT)', es: 'Pudin (ST)' },
    { key: 'cdr_pound', en: 'Pound', es: 'Pound' },
    { key: 'cdr_pound_nt', en: 'Pound (NT)', es: 'Pound (ST)' },
    { key: 'cdr_raisin', en: 'Raisin', es: 'Pasas' },
    { key: 'cdr_raisin_nt', en: 'Raisin (NT)', es: 'Pasas (ST)' },
    { key: 'cdr_maiz', en: 'Maiz', es: 'Maiz' },
    { key: 'cdr_maiz_nt', en: 'Maiz (NT)', es: 'Maiz (ST)' },
  ]},
  { section: 'Cups', sectionEs: 'Basos', items: [
    { key: 'bas_tl', en: 'Tres Leche', es: 'Tres Leche' },
    { key: 'bas_tl_nt', en: 'Tres Leche (NT)', es: 'Tres Leche (ST)' },
    { key: 'bas_cl', en: 'Cuatro Leche', es: 'Cuatro Leche' },
    { key: 'bas_cl_nt', en: 'Cuatro Leche (NT)', es: 'Cuatro Leche (ST)' },
    { key: 'bas_hershey', en: 'Hershey', es: 'Hershey' },
    { key: 'bas_hershey_nt', en: 'Hershey (NT)', es: 'Hershey (ST)' },
  ]},
  { section: 'Family Size', sectionEs: 'Familiar', items: [
    { key: 'fam_tl', en: 'Tres Leche', es: 'Tres Leche' },
    { key: 'fam_tl_nt', en: 'Tres Leche (NT)', es: 'Tres Leche (ST)' },
    { key: 'fam_cl', en: 'Cuatro Leche', es: 'Cuatro Leche' },
    { key: 'fam_cl_nt', en: 'Cuatro Leche (NT)', es: 'Cuatro Leche (ST)' },
  ]},
];

let driverListData = [];
let driverSortField = 'name';
let driverSortDir = 'asc';
let editingDriverId = null;

// Show/hide sub-views
function showDriversListView() {
  document.getElementById('drivers-list-view').style.display = 'block';
  document.getElementById('drivers-form-view').style.display = 'none';
  document.getElementById('drivers-profile-view').style.display = 'none';
  sessionStorage.removeItem('driver_form');
  sessionStorage.setItem('driver_subview', 'list');
}

function showDriversFormView() {
  document.getElementById('drivers-list-view').style.display = 'none';
  document.getElementById('drivers-form-view').style.display = 'block';
  document.getElementById('drivers-profile-view').style.display = 'none';
  sessionStorage.setItem('driver_subview', 'form');
  lucide.createIcons();
  // Auto-save form on any input change
  setTimeout(() => {
    document.getElementById('drivers-form-view').querySelectorAll('input, select').forEach(el => {
      el.removeEventListener('input', _autoSaveDriverForm);
      el.addEventListener('input', _autoSaveDriverForm);
    });
  }, 100);
}

function _autoSaveDriverForm() {
  const prices = {};
  document.querySelectorAll('.price-input').forEach(inp => {
    prices[inp.dataset.key] = inp.value;
  });
  const formState = {
    editingDriverId,
    name: document.getElementById('df-name')?.value || '',
    code: document.getElementById('df-code')?.value || '',
    phone: document.getElementById('df-phone')?.value || '',
    active: document.getElementById('df-active')?.checked ?? true,
    prices
  };
  sessionStorage.setItem('driver_form', JSON.stringify(formState));
}

async function _restoreDriverForm() {
  const raw = sessionStorage.getItem('driver_form');
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    editingDriverId = s.editingDriverId || null;

    // Update title
    const titleEl = document.getElementById('driver-form-title');
    if (editingDriverId) {
      titleEl.textContent = lang === 'es' ? 'Editar Conductor' : 'Edit Driver';
      document.getElementById('df-status-wrap').style.display = 'flex';
    } else {
      titleEl.textContent = lang === 'es' ? 'Agregar Nuevo Conductor' : 'Add New Driver';
      document.getElementById('df-status-wrap').style.display = 'none';
    }

    document.getElementById('df-name').value = s.name || '';
    document.getElementById('df-code').value = s.code || '';
    document.getElementById('df-phone').value = s.phone || '';
    document.getElementById('df-active').checked = s.active ?? true;

    renderPriceTable(s.prices || {});
    populateCopyDropdown(editingDriverId || undefined);
    showDriversFormView();
    return true;
  } catch (e) { return false; }
}

function showDriversProfileView() {
  document.getElementById('drivers-list-view').style.display = 'none';
  document.getElementById('drivers-form-view').style.display = 'none';
  document.getElementById('drivers-profile-view').style.display = 'block';
  lucide.createIcons();
}

// ── DRIVER LIST ─────────────────────
async function loadDriverList() {
  try {
    const { data: drivers } = await sb.from('drivers').select('*').order('name');
    if (!drivers) { driverListData = []; renderDriverTable(); return; }

    // Compute outstanding balance per driver
    const { data: orders } = await sb.from('driver_orders')
      .select('driver_id, total_amount, payment_amount, payment_status')
      .in('payment_status', ['not_paid', 'partial']);

    const balanceMap = {};
    if (orders) {
      orders.forEach(o => {
        const remaining = Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.payment_amount || 0));
        balanceMap[o.driver_id] = (balanceMap[o.driver_id] || 0) + remaining;
      });
    }

    driverListData = drivers.map(d => ({
      ...d,
      balance: balanceMap[d.id] || 0
    }));

    renderDriverTable();
  } catch (e) {
    console.error('Load drivers error:', e);
  }
}

function renderDriverTable() {
  const search = (document.getElementById('driver-search').value || '').toLowerCase();
  let filtered = driverListData.filter(d =>
    d.name.toLowerCase().includes(search) || d.code.toLowerCase().includes(search)
  );

  // Sort
  filtered.sort((a, b) => {
    let va = a[driverSortField], vb = b[driverSortField];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return driverSortDir === 'asc' ? -1 : 1;
    if (va > vb) return driverSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('driver-table-body');
  const emptyEl = document.getElementById('drivers-empty');
  const tableEl = document.getElementById('driver-table');

  if (filtered.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = filtered.map(d => {
    const statusClass = d.is_active ? 'status-active' : 'status-disabled';
    const statusText = d.is_active
      ? (lang === 'es' ? 'Activo' : 'Active')
      : (lang === 'es' ? 'Desactivado' : 'Disabled');
    const balClass = d.balance > 0 ? 'has-balance' : 'no-balance';
    const advBadge = d.advanced_features
      ? `<span class="adv-badge" title="Advanced Features Enabled"><i data-lucide="zap" style="width:14px;height:14px;color:var(--yellow);margin-left:6px"></i></span>`
      : '';
    return `<tr onclick="showDriverProfile('${d.id}')">
      <td class="driver-name" style="display:flex;align-items:center">${_esc(d.name)} ${advBadge}</td>
      <td class="driver-code"><span class="code-masked" data-code="${_escAttr(d.code)}">••••••</span> <button class="code-eye-btn" onclick="event.stopPropagation();toggleCode(this)" title="Show code"><i data-lucide="eye"></i></button></td>
      <td class="driver-phone hide-mobile">${_esc(d.phone || '—')}</td>
      <td><span class="${statusClass}">${statusText}</span></td>
      <td class="driver-balance ${balClass}">${formatCurrency(d.balance)}</td>
    </tr>`;
  }).join('');

  // Update sort header indicators
  document.querySelectorAll('.driver-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === driverSortField) {
      th.classList.add(driverSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  requestAnimationFrame(() => lucide.createIcons());
}

function sortDrivers(field) {
  if (driverSortField === field) {
    driverSortDir = driverSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    driverSortField = field;
    driverSortDir = 'asc';
  }
  renderDriverTable();
}

// ── ADD DRIVER ─────────────────────
function showAddDriver() {
  editingDriverId = null;
  const titleEl = document.getElementById('driver-form-title');
  titleEl.textContent = lang === 'es' ? 'Agregar Nuevo Conductor' : 'Add New Driver';
  titleEl.setAttribute('data-en', 'Add New Driver');
  titleEl.setAttribute('data-es', 'Agregar Nuevo Conductor');

  document.getElementById('df-name').value = '';
  document.getElementById('df-code').value = '';
  document.getElementById('df-phone').value = '';
  document.getElementById('df-status-wrap').style.display = 'none';
  document.getElementById('df-active').checked = true;

  renderPriceTable({});
  populateCopyDropdown();
  showDriversFormView();
}

// ── EDIT DRIVER ─────────────────────
window.showEditDriver = async function(driverId) {
  editingDriverId = driverId;
  const titleEl = document.getElementById('driver-form-title');
  titleEl.textContent = lang === 'es' ? 'Editar Conductor' : 'Edit Driver';
  titleEl.setAttribute('data-en', 'Edit Driver');
  titleEl.setAttribute('data-es', 'Editar Conductor');

  // Fetch driver
  const { data: driver } = await sb.from('drivers').select('*').eq('id', driverId).single();
  if (!driver) { showToast('Driver not found', 'error'); return; }

  document.getElementById('df-name').value = driver.name;
  document.getElementById('df-code').value = driver.code;
  document.getElementById('df-phone').value = driver.phone || '';
  document.getElementById('df-status-wrap').style.display = 'flex';
  document.getElementById('df-active').checked = driver.is_active;
  document.getElementById('df-active-label').textContent =
    driver.is_active ? (lang === 'es' ? 'Activo' : 'Active') : (lang === 'es' ? 'Desactivado' : 'Disabled');
  // Advanced features toggle
  document.getElementById('df-advanced-wrap').style.display = 'flex';
  document.getElementById('df-advanced').checked = !!driver.advanced_features;

  // Fetch prices
  const { data: prices } = await sb.from('driver_prices').select('product_key, price, credit_value').eq('driver_id', driverId);
  const priceMap = {};
  const creditMap = {};
  if (prices) prices.forEach(p => {
    priceMap[p.product_key] = p.price;
    creditMap[p.product_key] = p.credit_value;
  });

  renderPriceTable(priceMap, creditMap);
  populateCopyDropdown(driverId);
  showDriversFormView();
}

// ── PRICE TABLE ─────────────────────
function renderPriceTable(priceMap, creditMap) {
  let html = '';
  ADMIN_PRODUCTS.forEach((sec, idx) => {
    html += `<div class="price-section">`;
    html += `<div class="price-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <span>${lang === 'es' ? sec.sectionEs : sec.section}</span>
        <div style="display:flex; gap:6px; align-items:center; text-transform:none; font-weight:normal; letter-spacing:normal; flex-wrap:wrap;">
          <input type="number" id="cat-price-${idx}" class="price-input" style="width:70px; padding:4px 6px; font-size:0.8rem;" placeholder="${lang === 'es' ? 'Precio' : 'Price'}" step="0.01" min="0">
          <input type="number" id="cat-credit-${idx}" class="credit-input" style="width:70px; padding:4px 6px; font-size:0.8rem;" placeholder="Credit" step="0.01" min="0">
          <button type="button" class="btn-save-driver" style="padding:4px 8px; font-size:0.75rem; flex:none;" onclick="applyCategoryPrice(${idx})">${lang === 'es' ? 'Aplicar' : 'Apply'}</button>
        </div>
      </div>`;
    html += '<div class="price-row" style="margin-bottom:4px"><span class="price-label" style="font-size:.68rem;color:var(--tx-faint);font-weight:700;text-transform:uppercase">Product</span><div style="display:flex;gap:6px"><span style="font-size:.68rem;color:var(--tx-faint);font-weight:700;text-transform:uppercase;width:90px;text-align:center">Price</span><span style="font-size:.68rem;color:var(--tx-faint);font-weight:700;text-transform:uppercase;width:90px;text-align:center">Credit</span></div></div>';
    sec.items.forEach(item => {
      const val = priceMap[item.key] !== undefined ? parseFloat(priceMap[item.key]).toFixed(2) : '';
      const creditVal = creditMap && creditMap[item.key] !== undefined ? parseFloat(creditMap[item.key]).toFixed(2) : '';
      html += `<div class="price-row">
        <span class="price-label">${lang === 'es' ? item.es : item.en}</span>
        <div style="display:flex;gap:6px">
          <input type="number" class="price-input" data-key="${item.key}" value="${val}"
            placeholder="0.00" step="0.01" min="0">
          <input type="number" class="credit-input" data-key="${item.key}" value="${creditVal}"
            placeholder="0.00" step="0.01" min="0">
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  document.getElementById('price-table-container').innerHTML = html;
}

window.applyCategoryPrice = function(secIdx) {
  const priceEl = document.getElementById(`cat-price-${secIdx}`);
  const creditEl = document.getElementById(`cat-credit-${secIdx}`);
  const priceVal = priceEl ? priceEl.value : '';
  const creditVal = creditEl ? creditEl.value : '';
  if (!priceVal && !creditVal) return;
  const sec = ADMIN_PRODUCTS[secIdx];
  if (!sec) return;
  sec.items.forEach(item => {
    if (priceVal) {
      const itemInput = document.querySelector(`.price-input[data-key="${item.key}"]`);
      if (itemInput) {
        itemInput.value = parseFloat(priceVal).toFixed(2);
        itemInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (creditVal) {
      const creditInput = document.querySelector(`.credit-input[data-key="${item.key}"]`);
      if (creditInput) {
        creditInput.value = parseFloat(creditVal).toFixed(2);
        creditInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  if (priceEl) priceEl.value = '';
  if (creditEl) creditEl.value = '';
  showToast(lang === 'es' ? 'Valores aplicados a la categoría' : 'Values applied to category', 'success');
};

function renderProfilePrices(priceMap) {
  let html = '';
  ADMIN_PRODUCTS.forEach(sec => {
    html += `<div class="profile-price-section">`;
    html += `<div class="profile-price-section-title">${lang === 'es' ? sec.sectionEs : sec.section}</div>`;
    sec.items.forEach(item => {
      const val = priceMap[item.key] !== undefined ? formatCurrency(priceMap[item.key]) : '—';
      html += `<div class="profile-price-row">
        <span>${lang === 'es' ? item.es : item.en}</span>
        <span class="profile-price-value">${val}</span>
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

// ── COPY PRICES ─────────────────────
async function populateCopyDropdown(excludeId) {
  const select = document.getElementById('copy-prices-select');
  select.innerHTML = `<option value="">${lang === 'es' ? '— Seleccionar —' : '— Select —'}</option>`;
  const { data } = await sb.from('drivers').select('id, name').order('name');
  if (data) {
    data.filter(d => d.id !== excludeId).forEach(d => {
      select.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });
  }
}

async function copyPricesFrom(sourceDriverId) {
  if (!sourceDriverId) return;
  const { data: prices } = await sb.from('driver_prices').select('product_key, price').eq('driver_id', sourceDriverId);
  if (!prices || prices.length === 0) {
    showToast(lang === 'es' ? 'Este conductor no tiene precios' : 'This driver has no prices', 'info');
    return;
  }
  const priceMap = {};
  prices.forEach(p => priceMap[p.product_key] = p.price);

  // Fill inputs
  document.querySelectorAll('.price-input').forEach(input => {
    const key = input.dataset.key;
    if (priceMap[key] !== undefined) {
      input.value = parseFloat(priceMap[key]).toFixed(2);
    }
  });

  showToast(lang === 'es' ? 'Precios copiados' : 'Prices copied', 'success');
}

// ── SAVE DRIVER ─────────────────────
async function saveDriver() {
  const name = document.getElementById('df-name').value.trim();
  const code = document.getElementById('df-code').value.trim().toLowerCase();
  const phone = document.getElementById('df-phone').value.trim() || null;
  const isActive = document.getElementById('df-active').checked;

  // Validation
  if (!name) { showToast(lang === 'es' ? 'El nombre es obligatorio' : 'Name is required', 'error'); return; }
  if (!code) { showToast(lang === 'es' ? 'El código es obligatorio' : 'Code is required', 'error'); return; }

  // Check unique code
  const { data: existing } = await sb.from('drivers').select('id').eq('code', code);
  if (existing && existing.length > 0) {
    const isOwnCode = editingDriverId && existing[0].id === editingDriverId;
    if (!isOwnCode) {
      showToast(lang === 'es' ? 'Ya existe un conductor con ese código' : 'A driver with that code already exists', 'error');
      return;
    }
  }

  // Collect prices — only inputs with data-key (skip category-level inputs)
  const priceInputs = document.querySelectorAll('.price-input[data-key]');
  const prices = [];
  let allFilled = true;
  priceInputs.forEach(input => {
    const val = input.value.trim();
    if (!val && !editingDriverId) { allFilled = false; return; }
    const product = ADMIN_PRODUCTS.flatMap(s => s.items).find(i => i.key === input.dataset.key);
    prices.push({
      product_key: input.dataset.key,
      product_label: product ? product.en : input.dataset.key,
      price: parseFloat(val) || 0
    });
  });

  // Collect credit values
  const creditInputs = document.querySelectorAll('.credit-input[data-key]');
  const creditValues = {};
  creditInputs.forEach(inp => {
    if (inp.value.trim() !== '') creditValues[inp.dataset.key] = parseFloat(inp.value) || 0;
  });

  if (!allFilled) {
    showToast(lang === 'es' ? 'Todos los precios son obligatorios' : 'All prices are required', 'error');
    return;
  }

  try {
    let driverId;

    if (editingDriverId) {
      // Update driver
      const advFeatures = document.getElementById('df-advanced').checked;
      const { error } = await sb.from('drivers').update({ name, code, phone, is_active: isActive, advanced_features: advFeatures }).eq('id', editingDriverId);
      if (error) throw error;
      driverId = editingDriverId;
    } else {
      // Insert new driver
      const advFeatures = document.getElementById('df-advanced').checked;
      const { data: newDriver, error } = await sb.from('drivers').insert({ name, code, phone, is_active: isActive, advanced_features: advFeatures }).select('id').single();
      if (error) throw error;
      driverId = newDriver.id;
    }

    // Build price rows
    const priceRows = prices.map(p => ({
      driver_id: driverId,
      product_key: p.product_key,
      product_label: p.product_label,
      price: p.price,
      credit_value: creditValues[p.product_key] || 0
    }));

    // Insert new prices FIRST into a test to validate they work
    // Only delete old prices AFTER confirming new ones are valid
    // Use upsert to avoid the delete-then-insert data-loss window
    const { error: priceErr } = await sb.from('driver_prices')
      .upsert(priceRows, { onConflict: 'driver_id,product_key' });

    if (priceErr) {
      // Fallback: try delete-then-insert, but only delete if insert succeeds
      const { error: insertErr } = await sb.from('driver_prices').insert(priceRows);
      if (insertErr) throw insertErr;
      // Only delete orphan rows that are no longer in the product list
      const currentKeys = prices.map(p => p.product_key);
      await sb.from('driver_prices').delete().eq('driver_id', driverId).not('product_key', 'in', `(${currentKeys.join(',')})`);
    }

    showToast(
      editingDriverId
        ? (lang === 'es' ? 'Conductor actualizado' : 'Driver updated')
        : (lang === 'es' ? 'Conductor agregado' : 'Driver added'),
      'success'
    );

    // Refresh caches
    await loadDriversCache();
    showDriversListView();
    await loadDriverList();
  } catch (e) {
    console.error('Save driver error:', e);
    showToast(lang === 'es' ? 'Error guardando conductor' : 'Error saving driver', 'error');
  }
}

// ── DRIVER PROFILE ─────────────────────
let profileDriverId = null;

// ── Toggle driver code visibility ──
window.toggleCode = function(btn) {
  const span = btn.previousElementSibling || btn.parentElement.querySelector('.code-masked');
  const realCode = span.dataset.code;
  const isHidden = span.textContent.includes('•');
  span.textContent = isHidden ? realCode : '••••••';
  const icon = btn.querySelector('i, svg');
  if (icon) {
    icon.setAttribute('data-lucide', isHidden ? 'eye-off' : 'eye');
    lucide.createIcons({ nodes: [icon.parentElement] });
  }
};

window.showDriverProfile = async function(driverId) {
  profileDriverId = driverId;

  // Fetch driver
  const { data: driver } = await sb.from('drivers').select('*').eq('id', driverId).single();
  if (!driver) return;

  // Compute balance
  const { data: unpaidOrders } = await sb.from('driver_orders')
    .select('id, business_name, submitted_at, total_amount, payment_amount, payment_status, order_number')
    .eq('driver_id', driverId)
    .in('payment_status', ['not_paid', 'partial'])
    .order('submitted_at', { ascending: false });

  let totalBalance = 0;
  if (unpaidOrders) {
    unpaidOrders.forEach(o => {
      totalBalance += Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.payment_amount || 0));
    });
  }

  // Profile header
  const statusBadge = driver.is_active
    ? `<span class="badge badge-sent">${lang === 'es' ? 'Activo' : 'Active'}</span>`
    : `<span class="badge badge-pending">${lang === 'es' ? 'Desactivado' : 'Disabled'}</span>`;
  const balClass = totalBalance > 0 ? 'has-balance' : 'no-balance';

  document.getElementById('driver-profile-header').innerHTML = `
    <div class="profile-info">
      <div class="profile-name">${_esc(driver.name)}</div>
      <div class="profile-meta">
        <span class="code-masked" data-code="${_escAttr(driver.code)}">••••••</span>
        <button class="code-eye-btn" onclick="toggleCode(this)" title="Show code"><i data-lucide="eye"></i></button>
        ${driver.phone ? `<span>${_esc(driver.phone)}</span>` : ''}
        ${statusBadge}
      </div>
    </div>
    <div class="profile-balance-card">
      <div class="profile-balance-label">${lang === 'es' ? 'Saldo Pendiente' : 'Outstanding Balance'}</div>
      <div class="profile-balance-amount ${balClass}">${formatCurrency(totalBalance)}</div>
    </div>
  `;

  // Balance breakdown
  if (unpaidOrders && unpaidOrders.length > 0) {
    document.getElementById('profile-balance-list').innerHTML = unpaidOrders.map(o => {
      const remaining = Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.payment_amount || 0));
      return `<div class="balance-row" onclick="openOrderDetail('${o.id}')">
        <div class="balance-row-info">
          <span class="balance-row-date">${formatDate(o.submitted_at)} — #${o.order_number}</span>
          <span class="balance-row-business">${_esc(o.business_name || (lang === 'es' ? 'Sin negocio' : 'No business'))}</span>
        </div>
        <div class="balance-row-amounts">
          <span class="balance-row-total">${lang === 'es' ? 'Total:' : 'Total:'} ${formatCurrency(o.total_amount)}</span>
          <span class="balance-row-remaining">${lang === 'es' ? 'Resta:' : 'Remaining:'} ${formatCurrency(remaining)}</span>
        </div>
      </div>`;
    }).join('');
  } else {
    document.getElementById('profile-balance-list').innerHTML =
      `<div class="empty-state">${lang === 'es' ? 'Sin saldo pendiente' : 'No outstanding balance'}</div>`;
  }

  // Recent orders (last 10)
  const { data: recentOrders } = await sb.from('driver_orders')
    .select('id, business_name, submitted_at, total_amount, payment_status, status, order_number')
    .eq('driver_id', driverId)
    .order('submitted_at', { ascending: false })
    .limit(10);

  if (recentOrders && recentOrders.length > 0) {
    document.getElementById('profile-recent-orders').innerHTML = recentOrders.map(o => {
      let payBadge = '';
      if (o.payment_status === 'paid') payBadge = `<span class="badge badge-paid">${lang === 'es' ? 'Pagado' : 'Paid'}</span>`;
      else if (o.payment_status === 'partial') payBadge = `<span class="badge badge-partial">${lang === 'es' ? 'Parcial' : 'Partial'}</span>`;
      else payBadge = `<span class="badge badge-unpaid">${lang === 'es' ? 'Sin Pagar' : 'Not Paid'}</span>`;

      return `<div class="order-card" onclick="openOrderDetail('${o.id}')">
        <div class="order-card-top">
          <div class="order-card-info">
            <div class="order-card-driver">${_esc(o.business_name || (lang === 'es' ? 'Sin negocio' : 'No business'))}</div>
            <div class="order-card-meta">
              <span class="order-card-number">#${o.order_number}</span>
              <span class="order-card-time"><i data-lucide="clock" style="width:12px;height:12px"></i> ${formatTime(o.submitted_at)}</span>
            </div>
          </div>
          <div class="order-card-badges">${payBadge}</div>
        </div>
      </div>`;
    }).join('');
    lucide.createIcons();
  } else {
    document.getElementById('profile-recent-orders').innerHTML =
      `<div class="empty-state">${lang === 'es' ? 'Sin pedidos' : 'No orders yet'}</div>`;
  }

  // Price table (read-only)
  const { data: prices } = await sb.from('driver_prices').select('product_key, price').eq('driver_id', driverId);
  const priceMap = {};
  if (prices) prices.forEach(p => priceMap[p.product_key] = p.price);
  document.getElementById('profile-prices').innerHTML = renderProfilePrices(priceMap);

  showDriversProfileView();
}

// Open order detail from profile
window.openOrderDetail = async function(orderId) {
  // Switch to incoming section and open the detail
  if (window._swipeDismissCooldown) return;
  const { data: order } = await sb.from('driver_orders').select('*').eq('id', orderId).single();
  if (!order) return;
  const { data: items } = await sb.from('driver_order_items').select('*').eq('order_id', orderId);
  detailOrder = order;
  detailItems = sortItemsByCategory(items || []);
  await renderOrderSheet();
  document.getElementById('order-sheet-overlay').classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.width = '100%';
};

/* ═══════════════════════════════════
   FORMAT HELPERS
   ═══════════════════════════════════ */
function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatCurrency(amount) {
  return '$' + parseFloat(amount || 0).toFixed(2);
}

function formatAbbreviated(amount) {
  const n = parseFloat(amount || 0);
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '$' + n.toFixed(0);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  // Date-only strings (YYYY-MM-DD) are parsed as UTC midnight by JS,
  // which shifts back a day in timezones west of UTC. Append T12:00:00
  // to force local-time interpretation.
  const safe = dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr;
  const d = new Date(safe);
  const months = lang === 'es'
    ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function formatTimeValue(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

/* ═══════════════════════════════════
   INIT — ALL EVENT LISTENERS
   ═══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  _log('Admin Dashboard: DOMContentLoaded');
  applyTheme();
  applyLang();
  lucide.createIcons();

  // Restore font size
  const savedSize = localStorage.getItem('cecilia_admin_font_size');
  if (savedSize) document.documentElement.style.fontSize = savedSize + 'px';

  // Restore notification preference
  const notifToggle = document.getElementById('notification-toggle');
  if (notifToggle) notifToggle.checked = notificationsEnabled;

  // ── Login screen controls ──
  document.getElementById('login-lang-btn').addEventListener('click', () => {
    setLang(lang === 'en' ? 'es' : 'en');
  });
  document.getElementById('login-theme-btn').addEventListener('click', toggleTheme);

  // ── Sidebar nav ──
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // ── Mobile nav ──
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('mobile-nav').classList.toggle('open');
    document.getElementById('mobile-menu-btn').classList.toggle('open');
  });
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // ── Bottom Nav (app-style tab bar) ──
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      if (group === 'dashboard' || group === 'insights') {
        // Direct navigation — no action sheet
        showSection(btn.dataset.defaultSection);
      } else {
        // Toggle action sheet for this group
        _toggleActionSheet(group);
      }
    });
  });

  // ── Action Sheet: backdrop click to close ──
  document.getElementById('action-sheet-overlay').addEventListener('click', (e) => {
    // Only close if clicking the backdrop, not the sheet itself
    if (e.target === e.currentTarget) _closeActionSheet();
  });

  // ── Overview ──
  document.getElementById('view-all-orders-btn')?.addEventListener('click', () => showSection('incoming'));
  document.getElementById('stat-outstanding-card').addEventListener('click', () => {
    openPendingSheet();
  });
  document.getElementById('stat-ordered-card')?.addEventListener('click', () => {
    openOrderedSheet();
  });
  document.getElementById('stat-collected-card')?.addEventListener('click', () => {
    showSection('insights');
  });

  // ── Insights pill selector ──
  document.querySelectorAll('.insights-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.insights-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadInsights(pill.dataset.value);
    });
  });

  // ── Filter tabs (incoming) ──
  document.querySelectorAll('#driver-orders-filter .insights-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#driver-orders-filter .insights-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderIncomingOrders();
    });
  });

  // ── History filters ──
  document.getElementById('filter-apply-btn').addEventListener('click', () => loadHistoryOrders(true));
  document.getElementById('filter-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadHistoryOrders(true);
  });
  document.getElementById('load-more-btn').addEventListener('click', loadMoreHistory);

  // ── Settings ──
  document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => changeSize(parseInt(btn.dataset.size)));
  });
  document.getElementById('theme-toggle').addEventListener('change', toggleTheme);
  document.getElementById('notification-toggle').addEventListener('change', async (e) => {
    notificationsEnabled = e.target.checked;
    localStorage.setItem('cecilia_admin_notifications', notificationsEnabled);

    if (!notificationsEnabled) {
      // Unsubscribe from push
      if (currentUser) await unsubscribeFromPush(sb, 'admin', currentUser.id);
      showToast(lang === 'es' ? 'Notificaciones desactivadas' : 'Notifications disabled');
    } else {
      // Re-subscribe to push
      if (currentUser) await subscribeToPush('admin', currentUser.id);
      showToast(lang === 'es' ? 'Notificaciones activadas' : 'Notifications enabled');
    }
  });
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // ── Order Receipt Sheet ──
  // close button is now inline on the HTML element; sheet backdrop handled by onclick on overlay

  // ── Driver management ──
  document.getElementById('btn-add-driver').addEventListener('click', showAddDriver);
  document.getElementById('btn-back-to-list').addEventListener('click', () => {
    showDriversListView(); loadDriverList();
  });
  document.getElementById('btn-cancel-driver').addEventListener('click', () => {
    showDriversListView(); loadDriverList();
  });
  document.getElementById('btn-save-driver').addEventListener('click', saveDriver);
  document.getElementById('btn-back-from-profile').addEventListener('click', () => {
    showDriversListView(); loadDriverList();
  });
  document.getElementById('btn-edit-driver-from-profile').addEventListener('click', () => {
    if (profileDriverId) showEditDriver(profileDriverId);
  });
  document.getElementById('driver-search').addEventListener('input', renderDriverTable);
  document.querySelectorAll('.driver-table th.sortable').forEach(th => {
    th.addEventListener('click', () => sortDrivers(th.dataset.sort));
  });
  document.getElementById('copy-prices-select').addEventListener('change', (e) => {
    if (e.target.value) copyPricesFrom(e.target.value);
  });
  document.getElementById('df-active').addEventListener('change', (e) => {
    const label = document.getElementById('df-active-label');
    label.textContent = e.target.checked
      ? (lang === 'es' ? 'Activo' : 'Active')
      : (lang === 'es' ? 'Desactivado' : 'Disabled');
  });

  // ── Clerk init: wait for Clerk script to load, then check session ──
  window.addEventListener('load', async () => {
    try {
      await checkSession();
    } catch (err) {
      console.error('Clerk init error:', err);
      showLoginScreen();
    }
  });
});

// ═══════════════════════════════════
//  STAFF ROLE API HELPER
// ═══════════════════════════════════
// All role changes go through /api/update-staff-role which uses the
// Supabase service role key to bypass the guard_profile_role trigger.

async function updateStaffRole(targetClerkUserId, newRole) {
  if (!currentUser) throw new Error('Not authenticated');

  const resp = await fetch('/api/update-staff-role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clerk_user_id: targetClerkUserId,
      role: newRole,
      admin_clerk_user_id: currentUser.id,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(data.message || 'Failed to update role');
  }
  return data;
}

/* ═══════════════════════════════════════════════════════════
   PRODUCT MANAGER — Section: "products"
   ═══════════════════════════════════════════════════════════ */

/* ── Seed data (mirrored from menu.html PRODUCTS const) ── */
const PM_SEED_DATA = [
  { name_en:'Tres Leches',                   name_es:'Tres Leches',                tag_en:'Tres Leches',           tag_es:'Tres Leches',             price:4.99,  icon_name:'star' },
  { name_en:'Tres Leche Piña',               name_es:'Tres Leche Piña',            tag_en:'Tres Leches',           tag_es:'Tres Leches',             price:4.99,  icon_name:'star' },
  { name_en:'Tres Leche Strawberry',         name_es:'Tres Leche Fresa',           tag_en:'Tres Leches',           tag_es:'Tres Leches',             price:4.99,  icon_name:'star' },
  { name_en:'Tres Leche Hershey',            name_es:'Tres Leche Hershey',         tag_en:'Tres Leches',           tag_es:'Tres Leches',             price:4.99,  icon_name:'star' },
  { name_en:'Cuatro Leche',                  name_es:'Cuatro Leche',               tag_en:'Tres Leches · Premium', tag_es:'Tres Leches · Premium',   price:4.99,  icon_name:'star' },
  { name_en:'Piña',          name_es:'Piña',          tag_en:'Birthday Cake', tag_es:'Bizcocho de Cumpleaños', prices:{ Small:'$17.99', Medium:'$25.99' }, icon_name:'cake' },
  { name_en:'Guava',         name_es:'Guava',         tag_en:'Birthday Cake', tag_es:'Bizcocho de Cumpleaños', prices:{ Small:'$17.99', Medium:'$25.99' }, icon_name:'cake' },
  { name_en:'Dulce de Leche',name_es:'Dulce de Leche',tag_en:'Birthday Cake', tag_es:'Bizcocho de Cumpleaños', prices:{ Small:'$17.99', Medium:'$25.99' }, icon_name:'cake' },
  { name_en:'Chocolate',     name_es:'Chocolate',     tag_en:'Birthday Cake', tag_es:'Bizcocho de Cumpleaños', prices:{ Small:'$17.99', Medium:'$25.99' }, icon_name:'cake' },
  { name_en:'Strawberry',    name_es:'Fresa',         tag_en:'Birthday Cake', tag_es:'Bizcocho de Cumpleaños', prices:{ Small:'$17.99', Medium:'$25.99' }, icon_name:'cake' },
  { name_en:'Pudin',                         name_es:'Pudín',                      tag_en:'Square Cake',           tag_es:'Bizcocho Cuadrado',       price:9.99,  icon_name:'square' },
  { name_en:'Plain',                         name_es:'Plain',                      tag_en:'Square Cake',           tag_es:'Bizcocho Cuadrado',       price:9.99,  icon_name:'square' },
  { name_en:'Maiz',                          name_es:'Maíz',                       tag_en:'Square Cake',           tag_es:'Bizcocho Cuadrado',       price:9.99,  icon_name:'square' },
  { name_en:'Red Velvet',                    name_es:'Red Velvet',                 tag_en:'Square Cake',           tag_es:'Bizcocho Cuadrado',       price:9.99,  icon_name:'square' },
  { name_en:'Carrot Cake',                   name_es:'Bizcocho de Zanahoria',      tag_en:'Square Cake',           tag_es:'Bizcocho Cuadrado',       price:9.99,  icon_name:'square' },
  { name_en:'Cheesecake',                    name_es:'Cheesecake',                 tag_en:'Slice',                 tag_es:'Pieza',                   price:4.99,  icon_name:'cake-slice' },
  { name_en:'Pudin (Slice)',                 name_es:'Pudín (Pieza)',              tag_en:'Slice',                 tag_es:'Pieza',                   price:4.99,  icon_name:'cake-slice' },
  { name_en:'Piña (Slice)',                  name_es:'Piña (Pieza)',               tag_en:'Slice',                 tag_es:'Pieza',                   price:4.99,  icon_name:'cake-slice' },
  { name_en:'Guava (Slice)',                 name_es:'Guava (Pieza)',              tag_en:'Slice',                 tag_es:'Pieza',                   price:4.99,  icon_name:'cake-slice' },
  { name_en:'Whipping Cream Piña',           name_es:'Crema Piña',                 tag_en:'Whipping Cream Slice',  tag_es:'Crema · Pieza',           price:4.99,  icon_name:'layers' },
  { name_en:'Whipping Cream Guava',          name_es:'Crema Guava',                tag_en:'Whipping Cream Slice',  tag_es:'Crema · Pieza',           price:4.99,  icon_name:'layers' },
  { name_en:'Whipping Cream Dulce de Leche', name_es:'Crema Dulce de Leche',       tag_en:'Whipping Cream Slice',  tag_es:'Crema · Pieza',           price:4.99,  icon_name:'layers' },
  { name_en:'Whipping Cream Chocolate',      name_es:'Crema Chocolate',            tag_en:'Whipping Cream Slice',  tag_es:'Crema · Pieza',           price:4.99,  icon_name:'layers' },
  { name_en:'Chocoflan',                     name_es:'Chocoflan',                  tag_en:'Slice · New',           tag_es:'Pieza · Nuevo',           price:4.99,  icon_name:'cake-slice' },
  { name_en:'Tres Leche (Cup)',              name_es:'Tres Leche',                 tag_en:'Cup',                   tag_es:'Baso',                    price:4.99,  icon_name:'cup-soda' },
  { name_en:'Cuatro Leche (Cup)',            name_es:'Cuatro Leche',               tag_en:'Cup · Premium',         tag_es:'Baso · Premium',          price:4.99,  icon_name:'cup-soda' },
  { name_en:'Hershey (Cup)',                 name_es:'Hershey',                    tag_en:'Cup',                   tag_es:'Baso',                    price:4.99,  icon_name:'cup-soda' },
];

/* ── Module state ── */
let _pmProducts  = [];
let _pmEditId    = null;
let _pmImages    = [];
let _pmZoom = 1.0;
let _pmPosition = '50% 50%';
let _pmPriceMode = 'single';
let _pmPendingChanges = {};  // { productId: { field: value, ... } }

/* ── Inject scoped styles once ── */
let _pmStylesInjected = false;
function _pmInjectStyles() {
  if (_pmStylesInjected) return;
  _pmStylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.pm-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.pm-title{font-size:1.8rem;font-weight:300;color:var(--tx)}
.pm-title em{color:var(--red);font-style:italic}
.pm-header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.pm-search-wrap{display:flex;align-items:center;gap:10px;background:var(--bg-card);
  border:1px solid var(--bd);border-radius:10px;padding:10px 14px;margin-bottom:16px;box-shadow:var(--shadow-card)}
.pm-search-wrap svg,.pm-search-wrap i{color:var(--tx-faint);flex-shrink:0;width:18px;height:18px}
.pm-search{flex:1;border:none;background:none;color:var(--tx);font-size:.9rem;font-family:inherit;outline:none}
.pm-search::placeholder{color:var(--tx-faint)}
.btn-add-prod{display:flex;align-items:center;gap:6px;padding:10px 18px;border:none;
  border-radius:10px;background:var(--red);color:#fff;font-size:.85rem;font-weight:600;
  font-family:inherit;cursor:pointer;transition:background .2s,transform .1s;white-space:nowrap}
.btn-add-prod:hover{background:var(--red-dk)}.btn-add-prod:active{transform:scale(.97)}
.btn-seed-prod{display:flex;align-items:center;gap:6px;padding:10px 16px;border:1px solid var(--bd);
  border-radius:10px;background:none;color:var(--tx-muted);font-size:.82rem;font-weight:600;
  font-family:inherit;cursor:pointer;transition:var(--transition);white-space:nowrap}
.btn-seed-prod:hover{border-color:var(--blue);color:var(--blue)}
.pm-card{background:var(--bg-card);border:1px solid var(--bd);border-radius:12px;
  padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;
  box-shadow:var(--shadow-card);transition:background .15s}
.pm-card:hover{background:var(--bg-card-hover)}
.pm-card-top{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:14px 0 14px 16px}
.pm-thumb{width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--bd);background:var(--bg-surface)}
.pm-thumb-ph{width:56px;height:56px;border-radius:8px;flex-shrink:0;border:1px solid var(--bd);
  background:var(--bg-surface);display:flex;align-items:center;justify-content:center;color:var(--tx-faint)}
.pm-thumb-ph svg,.pm-thumb-ph i{width:22px;height:22px}
.pm-info{flex:1;min-width:0}
.pm-name{font-size:.95rem;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-tag{font-size:.72rem;color:var(--tx-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
.pm-price-txt{font-size:.82rem;color:var(--red);font-weight:600;margin-top:4px}
.pm-controls{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
.pm-toggle-wrap{display:flex;flex-direction:column;align-items:center;gap:2px}
.pm-toggle-lbl{font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--tx-faint);font-weight:500;white-space:nowrap}
.pm-icon-btn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;
  border-radius:8px;border:1px solid var(--bd);background:none;color:var(--tx-muted);cursor:pointer;transition:var(--transition)}
.pm-icon-btn:hover{border-color:var(--red);color:var(--red)}
.pm-icon-btn.danger:hover{border-color:#dc2626;color:#dc2626}
.pm-icon-btn svg,.pm-icon-btn i{width:15px;height:15px}
.pm-badge-live{background:rgba(27,122,74,.1);color:var(--green)}
.pm-badge-soldout{background:rgba(200,155,42,.1);color:var(--yellow)}
.pm-badge-hidden{background:rgba(220,38,38,.1);color:#dc2626}
.pm-grip{cursor:grab;padding:0 10px;display:flex;align-items:center;flex-shrink:0;opacity:.4;transition:opacity .2s}
.pm-grip:hover{opacity:1}
.pm-grip:active{cursor:grabbing}
.pm-dragging{opacity:.4;transform:scale(.98);box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:10;position:relative}
.pm-drag-over{border:2px dashed var(--red,#C8102E)!important;background:rgba(200,16,46,.04);transform:translateY(2px)}
.pm-card{transition:background .15s,transform .15s,opacity .15s,box-shadow .15s}
.pm-cat-grip{cursor:grab;padding:0 12px 0 4px;display:flex;align-items:center;flex-shrink:0;opacity:.35;transition:opacity .2s}
.pm-cat-grip:hover{opacity:.8}
.pm-cat-grip:active{cursor:grabbing}
.pm-cat-dragging{opacity:.5;transform:scale(.99);box-shadow:0 8px 32px rgba(0,0,0,.12)}
.pm-cat-drag-over{border:2px dashed var(--red,#C8102E)!important;border-radius:8px;background:rgba(200,16,46,.03)}
.pm-category-group{transition:opacity .15s,transform .15s,box-shadow .15s}
.pm-category-header{display:flex;align-items:center}
.pm-save-bar{position:fixed;bottom:0;left:0;right:0;z-index:300;padding:14px 20px;
  background:var(--bg-card);border-top:1px solid var(--bd);box-shadow:0 -4px 20px rgba(0,0,0,.15);
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  transition:opacity .25s,transform .25s}
.pm-save-bar.hidden{opacity:0;transform:translateY(100%);pointer-events:none}
.pm-save-bar .pm-pending-count{font-size:.85rem;color:var(--tx-muted);font-weight:500}
.pm-save-bar .pm-pending-count strong{color:var(--red);font-weight:700}
.pm-save-bar-actions{display:flex;gap:10px}
.pm-btn-discard{padding:10px 18px;border-radius:10px;border:1px solid var(--bd);background:none;
  color:var(--tx-muted);font-size:.82rem;font-weight:600;font-family:inherit;cursor:pointer;transition:var(--transition)}
.pm-btn-discard:hover{border-color:var(--red);color:var(--red)}
.pm-btn-save-all{padding:10px 22px;border-radius:10px;border:none;
  background:var(--red);color:#fff;font-size:.82rem;font-weight:700;font-family:inherit;
  cursor:pointer;transition:var(--transition);display:flex;align-items:center;gap:6px}
.pm-btn-save-all:hover{background:var(--red-dk)}
.pm-btn-save-all:disabled{opacity:.5;cursor:not-allowed}
.pm-card.pm-changed{border-left:3px solid var(--red)}
/* Modal */
.pm-overlay{position:fixed;inset:0;background:var(--bg-overlay);z-index:400;
  display:none;align-items:flex-end;justify-content:center;overscroll-behavior:none}
.pm-overlay.open{display:flex}
.pm-overlay.open .pm-modal{animation:slideUp .3s ease}
.pm-modal{background:var(--bg-card);border-radius:20px 20px 0 0;width:100%;max-width:640px;
  max-height:calc(100dvh - 20px);display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.2)}
@media(min-width:680px){.pm-overlay{align-items:center}.pm-modal{border-radius:16px;max-height:calc(100dvh - 40px)}}
.pm-modal-handle{width:40px;height:4px;background:var(--bd);border-radius:2px;margin:12px auto 0;flex-shrink:0}
.pm-modal-header{display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px 12px;border-bottom:1px solid var(--bd);flex-shrink:0}
.pm-modal-title{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:600;color:var(--tx)}
.pm-modal-title em{color:var(--red);font-style:italic}
.pm-modal-close{background:none;border:1px solid var(--bd);border-radius:8px;padding:6px 12px;
  color:var(--tx-muted);cursor:pointer;font-family:inherit;font-size:.82rem;transition:var(--transition)}
.pm-modal-close:hover{border-color:var(--red);color:var(--red)}
.pm-tabs-bar{display:flex;border-bottom:1px solid var(--bd);flex-shrink:0}
.pm-tab{flex:1;padding:12px 8px;background:none;border:none;border-bottom:2px solid transparent;
  font-family:inherit;font-size:.78rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
  color:var(--tx-muted);cursor:pointer;transition:color .2s,border-color .2s}
.pm-tab.active{color:var(--red);border-bottom-color:var(--red)}
.pm-modal-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px;overscroll-behavior:contain}
.pm-panel{display:none}.pm-panel.active{display:block}
.pm-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.pm-form-grid{grid-template-columns:1fr}}
.pm-form-field{display:flex;flex-direction:column;gap:5px}
.pm-form-field.full{grid-column:span 2}
@media(max-width:520px){.pm-form-field.full{grid-column:span 1}}
.pm-form-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;font-weight:500;color:var(--tx-faint)}
.pm-form-label .req{color:var(--red)}
.pm-input{width:100%;padding:11px 13px;border:1.5px solid var(--bd-input);border-radius:10px;
  background:var(--bg-input);color:var(--tx);font-size:.88rem;font-family:inherit;
  transition:border-color .2s,box-shadow .2s;box-sizing:border-box}
.pm-input:focus{outline:none;border-color:var(--red);box-shadow:0 0 0 3px rgba(200,16,46,.10)}
.pm-input::placeholder{color:var(--tx-faint)}
textarea.pm-input{resize:vertical;min-height:68px}
.pm-price-toggle{display:flex;gap:8px;margin-bottom:16px}
.pm-price-toggle button{flex:1;padding:9px;border:1.5px solid var(--bd-input);border-radius:8px;
  background:none;font-family:inherit;font-size:.82rem;font-weight:500;color:var(--tx-muted);cursor:pointer;transition:var(--transition)}
.pm-price-toggle button.active{border-color:var(--red);background:rgba(200,16,46,.06);color:var(--red)}
.pm-progress-wrap{height:4px;background:var(--bg-surface);border-radius:2px;overflow:hidden;margin-bottom:8px;display:none}
.pm-progress-bar{height:100%;background:var(--red);border-radius:2px;transition:width .2s;width:0}
.pm-img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;margin-bottom:12px}
.pm-img-thumb{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;border:1.5px solid var(--bd);background:var(--bg-surface)}
.pm-img-thumb img{width:100%;height:100%;object-fit:cover}
.pm-img-rm{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;
  background:rgba(0,0,0,.65);color:#fff;border:none;cursor:pointer;display:flex;
  align-items:center;justify-content:center;font-size:.85rem;line-height:1}
.pm-img-rm:hover{background:var(--red)}
.pm-upload-area{display:block;border:2px dashed var(--bd-input);border-radius:10px;padding:20px;
  text-align:center;cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:10px}
.pm-upload-area:hover,.pm-upload-area:focus{border-color:var(--red);background:rgba(200,16,46,.03)}
.pm-upload-area p{font-size:.8rem;color:var(--tx-muted);margin-top:8px}
.pm-url-row{display:flex;gap:8px;align-items:center}
.pm-img-preview-wrap{display:none;margin:12px 0}
.pm-img-preview-label{font-size:.72rem;color:var(--tx-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;display:block}
.pm-img-preview-square{width:200px;height:200px;border-radius:8px;overflow:hidden;border:2px solid var(--bd)}
.pm-img-preview-square img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
.pm-img-preview-actions{display:flex;gap:8px;margin-top:10px}
.pm-btn-confirm{padding:9px 18px;border:none;border-radius:8px;background:var(--red);color:#fff;font-size:.82rem;font-weight:600;font-family:inherit;cursor:pointer;transition:background .2s}
.pm-btn-confirm:hover{background:var(--red-dk)}
.pm-btn-repick{padding:9px 16px;border:1.5px solid var(--bd);border-radius:8px;background:none;color:var(--tx-muted);font-size:.82rem;font-weight:600;font-family:inherit;cursor:pointer;transition:var(--transition)}
.pm-btn-repick:hover{border-color:var(--red);color:var(--red)}
.pm-divider{border:none;border-top:1px solid var(--bd);margin:14px 0}
.pm-modal-footer{padding:14px 20px;border-top:1px solid var(--bd);display:flex;
  justify-content:flex-end;gap:8px;flex-shrink:0;background:var(--bg-card)}
.pm-skeleton{background:var(--bg-surface);border-radius:12px;height:84px;margin-bottom:10px;
  animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@media(max-width:480px){.pm-controls{gap:5px}.pm-icon-btn{width:30px;height:30px}}
/* ═══ MOBILE: bulletproof stacked card layout ═══ */
@media(max-width:600px){
.pm-card{flex-wrap:wrap;padding:0;overflow:hidden}
.pm-card-top{display:flex;align-items:center;gap:10px;padding:12px;width:100%;min-width:0}
.pm-grip{padding:0 6px 0 0}
.pm-thumb,.pm-thumb-ph{width:48px;height:48px;min-width:48px;min-height:48px;max-width:48px;max-height:48px;border-radius:6px}
.pm-info{flex:1;min-width:0}
.pm-name{font-size:14px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
.pm-price-txt{font-size:13px;white-space:nowrap}
.pm-controls{width:100%;padding:8px 12px;border-top:1px solid var(--bd);background:rgba(200,16,46,.02);
  gap:8px;flex-wrap:wrap;justify-content:flex-start}
.pm-toggle-wrap{flex-shrink:0}
.pm-toggle-lbl{font-size:10px}
.pm-icon-btn{width:32px;height:32px;min-width:32px;min-height:32px;max-width:32px;max-height:32px;flex-shrink:0}
.pm-header{flex-direction:column;align-items:stretch;gap:8px}
.pm-header-actions{width:100%;justify-content:stretch}
.btn-add-prod,.btn-seed-prod{flex:1;justify-content:center;font-size:13px}
.pm-search{font-size:16px}
}
.pm-category-group{margin-bottom:24px}
.pm-category-header{display:flex;align-items:baseline;gap:8px;padding:8px 0;margin-bottom:8px;
  border-bottom:2px solid var(--bd);font-family:'Cormorant Garamond',serif;font-size:1.05rem;
  font-weight:600;color:var(--tx)}
.pm-category-es{font-size:.78rem;color:var(--tx-faint);font-weight:400;font-family:'Outfit',sans-serif;font-style:italic}
.pm-category-count{margin-left:auto;font-size:.7rem;font-weight:700;background:rgba(200,16,46,.08);
  color:var(--red);padding:2px 8px;border-radius:20px;font-family:'Outfit',sans-serif;white-space:nowrap}
.pm-search-results-lbl{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:var(--tx-faint);
  font-weight:600;padding:4px 0 10px;display:block}
.pm-icon-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:6px}
.pm-icon-opt{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;padding:8px 4px;border:1.5px solid var(--bd-input);border-radius:8px;cursor:pointer;
  background:none;font-family:inherit;transition:border-color .15s,background .15s;min-width:0}
.pm-icon-opt:hover{border-color:var(--red);background:rgba(200,16,46,.04)}
.pm-icon-opt.selected{border-color:var(--red);background:rgba(200,16,46,.08)}
.pm-icon-opt svg,.pm-icon-opt i{width:20px;height:20px;color:var(--tx-muted)}
.pm-icon-opt.selected svg,.pm-icon-opt.selected i{color:var(--red)}
.pm-icon-lbl{font-size:9px;color:var(--tx-faint);text-align:center;line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}
@media(max-width:400px){.pm-icon-grid{grid-template-columns:repeat(4,1fr)}}
.pm-preview-section{margin:16px 0 20px}
.pm-preview-label{font-size:.72rem;text-transform:uppercase;color:var(--tx-faint);letter-spacing:.5px;margin-bottom:10px;font-weight:600}
.pm-preview-cards{display:flex;gap:16px;flex-wrap:wrap}
.pm-preview-card{border-radius:10px;overflow:hidden;border:1.5px solid var(--bd);background:var(--bg-card);flex-shrink:0}
.pm-preview-card-desktop{width:280px}
.pm-preview-card-mobile{width:150px}
.pm-preview-card-label{font-size:.65rem;text-transform:uppercase;color:var(--tx-faint);padding:6px 10px 4px;letter-spacing:.5px}
.pm-preview-img-wrap{position:relative;overflow:hidden;cursor:grab}
.pm-preview-img-wrap:active{cursor:grabbing}
.pm-preview-img-wrap.desktop{aspect-ratio:3/4}
.pm-preview-img-wrap.mobile{aspect-ratio:4/5}
.pm-preview-img-wrap img{width:100%;height:100%;object-fit:cover;display:block;transform-origin:center center;pointer-events:none;transition:transform .15s ease,object-position .15s ease}
.pm-zoom-control{display:flex;align-items:center;gap:10px;margin-top:14px;padding:0 2px}
.pm-zoom-label{font-size:.72rem;text-transform:uppercase;color:var(--tx-faint);font-weight:600;white-space:nowrap}
.pm-zoom-slider{flex:1;-webkit-appearance:none;height:4px;border-radius:2px;background:var(--bd);outline:none}
.pm-zoom-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--red);cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.pm-zoom-value{font-size:.78rem;color:var(--tx);font-weight:600;min-width:36px;text-align:right}
.pm-framing-hint{font-size:.7rem;color:var(--tx-faint);margin-top:8px;font-style:italic}
.pm-menu-preview{margin:16px 0;padding:12px;background:var(--bg-surface);border-radius:12px;border:1px solid var(--bd)}
.pm-menu-preview-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:var(--tx-faint);margin-bottom:8px;font-weight:600}
.pm-preview-tabs{display:flex;gap:6px;margin-bottom:10px}
.pm-preview-tab{padding:4px 10px;border-radius:6px;border:1px solid var(--bd);background:none;font-size:.72rem;cursor:pointer;color:var(--tx-muted)}
.pm-preview-tab.active{background:var(--red);color:#fff;border-color:var(--red)}
.pm-preview-card{border-radius:10px;overflow:hidden;border:1px solid var(--bd);background:var(--bg-card);max-width:300px}
.pm-preview-card-imgwrap{position:relative;overflow:hidden;width:100%}
.pm-preview-card-imgwrap.ratio-desktop{aspect-ratio:3/2}
.pm-preview-card-imgwrap.ratio-mobile{aspect-ratio:4/3}
.pm-preview-card-imgwrap img{width:100%;height:100%;object-fit:cover;display:block;transform-origin:center center}
.pm-preview-card-text{padding:10px 12px}
.pm-preview-card-name{font-weight:600;font-size:.9rem}
.pm-preview-card-price{color:var(--red);font-size:.85rem;margin-top:2px}
.pm-zoom-control{margin-top:12px}
.pm-zoom-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:var(--tx-faint);margin-bottom:6px;font-weight:600;display:flex;justify-content:space-between}
.pm-zoom-slider{width:100%;cursor:pointer;accent-color:var(--red)}
.pm-drag-hint{font-size:.7rem;color:var(--tx-faint);margin-top:6px;text-align:center}
.pm-preview-card-imgwrap.dragging{cursor:grabbing}
.pm-preview-card-imgwrap:not(.dragging){cursor:grab}
.ws-tab{padding:8px 16px;border-radius:8px;border:1px solid var(--bd);background:none;cursor:pointer;font-size:.82rem;font-weight:600;color:var(--tx-muted);transition:all .2s}
.ws-tab.active{background:var(--red);color:#fff;border-color:var(--red)}
.ws-tab-count{font-size:.7rem;background:rgba(200,16,46,.12);color:var(--red);padding:1px 7px;border-radius:10px;margin-left:4px}
.ws-tab.active .ws-tab-count{background:rgba(255,255,255,.25);color:#fff}
.ws-card{background:var(--bg-card);border:1px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:12px}
.ws-card-collapsed:hover{border-color:var(--red);box-shadow:0 2px 12px rgba(200,16,46,.08)}
.ws-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:12px}
.ws-card-biz{font-size:1.05rem;font-weight:700;color:var(--tx)}
.ws-card-status{font-size:.7rem;font-weight:700;text-transform:uppercase;padding:3px 10px;border-radius:6px;letter-spacing:.5px}
.ws-card-status.pending{background:rgba(255,165,0,.12);color:#c77800}
.ws-card-status.approved{background:rgba(0,160,0,.12);color:#0a7a0a}
.ws-card-status.rejected{background:rgba(200,16,46,.1);color:var(--red)}
.ws-card-detail{font-size:.85rem;color:var(--tx-muted);line-height:1.7}
.ws-card-detail strong{color:var(--tx);font-weight:600}
.ws-card-actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.ws-btn{padding:8px 18px;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;border:none;transition:all .2s}
.ws-btn-approve{background:var(--red);color:#fff}
.ws-btn-approve:hover{background:var(--red-dk)}
.ws-btn-reject{background:none;border:1px solid var(--bd);color:var(--tx-muted)}
.ws-btn-reject:hover{border-color:var(--red);color:var(--red)}
.ws-btn-pricing{background:none;border:1px solid var(--bd);color:var(--tx)}
.ws-btn-pricing:hover{border-color:var(--red);color:var(--red)}
.ws-pricing-grid{display:grid;grid-template-columns:1fr auto auto;gap:8px 12px;align-items:center;margin:16px 0}
.ws-pricing-grid .ws-pg-header{font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--tx-faint);letter-spacing:.5px}
.ws-pricing-grid input{padding:6px 10px;border-radius:6px;border:1px solid var(--bd);font-size:.85rem;text-align:center;width:80px}
.ws-pricing-grid input:focus{border-color:var(--red);outline:none}
.ws-pricing-grid .ws-pg-name{font-size:.88rem;font-weight:500;color:var(--tx)}
.ws-empty{text-align:center;padding:40px 20px;color:var(--tx-muted);font-size:.9rem}
.ws-approved-badge{display:inline-block;font-size:.65rem;font-weight:700;background:rgba(0,160,0,.12);color:#0a7a0a;padding:2px 8px;border-radius:4px;margin-left:8px}
@media(max-width:600px){.ws-pricing-grid{grid-template-columns:1fr;gap:12px}.ws-pricing-grid input{width:100%}}
  `;
  document.head.appendChild(s);
}

/* ── Main entry point — called by showSection('products') ── */
async function loadProductManager() {
  _pmInjectStyles();
  const sec = document.getElementById('section-products');

  sec.innerHTML = `
    <div class="pm-section-tabs" id="pm-section-tabs" style="display:flex;gap:8px;margin-bottom:20px">
      <button class="ws-tab active" data-pmtab="menu" onclick="window._pmSwitchSection('menu')">Menu Products</button>
      <button class="ws-tab" data-pmtab="b2b" onclick="window._pmSwitchSection('b2b')">B2B Catalog</button>
    </div>
    <div id="pm-section-menu">
    <div class="pm-header">
      <h1 class="pm-title">Product <em>Manager</em></h1>
      <div class="pm-header-actions">
        <button class="btn-seed-prod" id="pm-btn-seed">
          <i data-lucide="database-zap"></i> Seed from Code
        </button>
        <button class="btn-add-prod" id="pm-btn-add">
          <i data-lucide="plus"></i> Add Product
        </button>
      </div>
    </div>
    <div class="pm-search-wrap">
      <i data-lucide="search"></i>
      <input class="pm-search" id="pm-search" type="text" placeholder="Search products…" autocomplete="off">
    </div>
    <div id="pm-list"></div>
    ${_pmModalHTML()}
    </div>
    <div id="pm-section-b2b" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--tx);margin:0">B2B Product Catalog</h3>
          <p style="font-size:.82rem;color:var(--tx-muted);margin:4px 0 0">Products available to drivers and wholesale customers</p>
        </div>
        <button class="ws-btn ws-btn-approve" onclick="window._b2bAddProduct()">+ Add Product</button>
      </div>
      <div id="b2b-product-list"></div>
    </div>
  `;

  lucide.createIcons();
  _pmBindModal();

  document.getElementById('pm-btn-add').addEventListener('click', () => _pmOpenModal(null));
  document.getElementById('pm-btn-seed').addEventListener('click', _pmSeed);
  document.getElementById('pm-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (q) {
      _pmRenderList(
        _pmProducts.filter(p => p.name_en.toLowerCase().includes(q) || p.tag_en.toLowerCase().includes(q)),
        true  // isSearch — render flat with result count, no category headers
      );
    } else {
      _pmRenderList(_pmProducts); // restore grouped view
    }
  });

  await _pmFetch();
  initAdminProductsRealtime();
  _pmInjectSaveBar();
  _pmUpdateSaveBar();
}

/* ── Products section sub-tab switching (Menu Products / B2B Catalog) ── */
window._pmSwitchSection = function(tab) {
  document.querySelectorAll('#pm-section-tabs .ws-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.pmtab === tab);
  });
  document.getElementById('pm-section-menu').style.display = tab === 'menu' ? 'block' : 'none';
  document.getElementById('pm-section-b2b').style.display = tab === 'b2b' ? 'block' : 'none';
  if (tab === 'b2b') _b2bLoadProducts();
};


/* ── Modal structure ── */
function _pmModalHTML() {
  return `
<div class="pm-overlay" id="pm-overlay">
  <div class="pm-modal">
    <div class="pm-modal-handle"></div>
    <div class="pm-modal-header">
      <div class="pm-modal-title" id="pm-modal-title">Add <em>Product</em></div>
      <button class="pm-modal-close" id="pm-modal-close">Close</button>
    </div>
    <div class="pm-tabs-bar">
      <button class="pm-tab active" data-tab="info">Basic Info</button>
      <button class="pm-tab" data-tab="pricing">Pricing</button>
      <button class="pm-tab" data-tab="images">Images</button>
    </div>
    <div class="pm-modal-body">
      <div class="pm-panel active" id="pm-panel-info">
        <div class="pm-form-grid">
          <div class="pm-form-field">
            <label class="pm-form-label">Name (EN) <span class="req">*</span></label>
            <input class="pm-input" id="pm-f-en" type="text" placeholder="e.g. Tres Leches">
          </div>
          <div class="pm-form-field">
            <label class="pm-form-label">Name (ES) <span class="req">*</span></label>
            <input class="pm-input" id="pm-f-es" type="text" placeholder="e.g. Tres Leches">
          </div>
          <div class="pm-form-field">
            <label class="pm-form-label">Tag (EN) <span class="req">*</span></label>
            <input class="pm-input" id="pm-f-tag-en" type="text" placeholder="e.g. Tres Leches">
          </div>
          <div class="pm-form-field">
            <label class="pm-form-label">Tag (ES) <span class="req">*</span></label>
            <input class="pm-input" id="pm-f-tag-es" type="text" placeholder="e.g. Tres Leches">
          </div>
          <div class="pm-form-field full">
            <label class="pm-form-label">Description (EN)</label>
            <textarea class="pm-input" id="pm-f-desc-en" placeholder="Short description…"></textarea>
          </div>
          <div class="pm-form-field full">
            <label class="pm-form-label">Description (ES)</label>
            <textarea class="pm-input" id="pm-f-desc-es" placeholder="Descripción corta…"></textarea>
          </div>
          <div class="pm-form-field full">
            <label class="pm-form-label">Category Icon</label>
            <div class="pm-icon-grid" id="pm-icon-grid">
              ${['cake','cake-slice','star','cup-soda','layers','cookie','wheat','coffee','gift','heart','sparkles','flame','leaf','droplets','zap','chef-hat','utensils','egg','apple','banana','ice-cream-cone','candy','croissant','sandwich','glass-water','gem','award']
                .map(ic => `<button type="button" class="pm-icon-opt" data-icon="${ic}" onclick="window._pmSelectIcon('${ic}')">
                  <i data-lucide="${ic}"></i>
                  <span class="pm-icon-lbl">${ic}</span>
                </button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="pm-panel" id="pm-panel-pricing">
        <div class="pm-price-toggle">
          <button id="pm-pt-single" class="active" onclick="window._pmSetPriceMode('single')">Single Price</button>
          <button id="pm-pt-sized" onclick="window._pmSetPriceMode('sized')">Size-Based</button>
        </div>
        <div id="pm-price-single">
          <div class="pm-form-field">
            <label class="pm-form-label">Price ($)</label>
            <input class="pm-input" id="pm-f-price" type="number" step="0.01" min="0" placeholder="4.99">
          </div>
        </div>
        <div id="pm-price-sized" style="display:none">
          <div class="pm-form-grid">
            <div class="pm-form-field">
              <label class="pm-form-label">Small ($)</label>
              <input class="pm-input" id="pm-f-sm" type="number" step="0.01" min="0" placeholder="17.99">
            </div>
            <div class="pm-form-field">
              <label class="pm-form-label">Medium ($)</label>
              <input class="pm-input" id="pm-f-md" type="number" step="0.01" min="0" placeholder="25.99">
            </div>
            <div class="pm-form-field">
              <label class="pm-form-label">Large ($)</label>
              <input class="pm-input" id="pm-f-lg" type="number" step="0.01" min="0" placeholder="(optional)">
            </div>
          </div>
        </div>
      </div>
      <div class="pm-panel" id="pm-panel-images">
        <p style="font-size:.78rem;color:var(--tx-muted);margin-bottom:10px">
          Up to 5 images. Tap the area below to choose from your camera roll or files.
        </p>
        <div class="pm-img-grid" id="pm-img-grid"></div>
        <label class="pm-upload-area" for="pm-file-input">
          <i data-lucide="upload-cloud" style="width:26px;height:26px;color:var(--tx-faint)"></i>
          <p>Tap to choose photos<br><small>JPEG · PNG · WebP · max 5 MB each</small></p>
        </label>
        <input type="file" id="pm-file-input" accept="image/*" multiple style="display:none">
        <!-- Upload preview (shown after file pick, before Supabase upload) -->
        <div class="pm-img-preview-wrap" id="pm-preview-wrap">
          <span class="pm-img-preview-label">Preview — this is how it appears on the menu</span>
          <div class="pm-img-preview-square">
            <img id="pm-preview-img" src="" alt="preview">
          </div>
          <div class="pm-img-preview-actions">
            <button class="pm-btn-confirm" id="pm-btn-confirm-upload">Upload this photo</button>
            <button class="pm-btn-repick"  id="pm-btn-repick">Choose different</button>
          </div>
        </div>
        <div class="pm-progress-wrap" id="pm-progress-wrap">
          <div class="pm-progress-bar" id="pm-progress-bar"></div>
        </div>
        <hr class="pm-divider">
        <p style="font-size:.78rem;color:var(--tx-muted);margin-bottom:8px">Or paste an image URL:</p>
        <div class="pm-url-row">
          <input class="pm-input" id="pm-url-input" type="url" placeholder="https://…" inputmode="url">
          <button class="btn-seed-prod" style="height:44px;padding:0 14px;flex-shrink:0" onclick="window._pmAddUrl()">Add</button>
        </div>
        <!-- Live Menu Preview -->
        <div class="pm-menu-preview" id="pm-menu-preview" style="display:none">
          <div class="pm-menu-preview-label">Menu Preview — what customers will see</div>
          <div class="pm-preview-tabs">
            <button class="pm-preview-tab active" onclick="window._pmPreviewTab('desktop')">Desktop</button>
            <button class="pm-preview-tab" onclick="window._pmPreviewTab('mobile')">Mobile</button>
          </div>
          <div class="pm-preview-card">
            <div class="pm-preview-card-imgwrap ratio-desktop" id="pm-preview-imgwrap">
              <img id="pm-preview-menu-img" src="" alt="preview">
            </div>
            <div class="pm-preview-card-text">
              <div class="pm-preview-card-name" id="pm-preview-name">Product Name</div>
              <div class="pm-preview-card-price" id="pm-preview-price">$0.00</div>
            </div>
          </div>
          <div class="pm-zoom-control">
            <div class="pm-zoom-label">
              <span>Zoom</span>
              <span id="pm-zoom-val">1.0×</span>
            </div>
            <input type="range" class="pm-zoom-slider" id="pm-zoom-slider"
              min="0.5" max="2" step="0.05" value="1"
              oninput="window._pmZoomChange(this.value)">
          </div>
          <div class="pm-drag-hint">Drag the image to reposition</div>
        </div>
      </div>
    </div>
    <div class="pm-modal-footer">
      <button class="btn-cancel" id="pm-btn-cancel" style="padding:10px 18px;font-size:.85rem">Cancel</button>
      <button class="btn-add-prod" id="pm-btn-save">Save Product</button>
    </div>
  </div>
</div>`;
}

/* ── Modal event binding ── */
function _pmBindModal() {
  document.getElementById('pm-modal-close').addEventListener('click', _pmCloseModal);
  document.getElementById('pm-btn-cancel').addEventListener('click', _pmCloseModal);
  document.getElementById('pm-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('pm-overlay')) _pmCloseModal();
  });
  document.getElementById('pm-btn-save').addEventListener('click', _pmSave);
  // Upload preview state
  let _pmPendingFiles = [];

  const fileInput   = document.getElementById('pm-file-input');
  const previewWrap = document.getElementById('pm-preview-wrap');
  const previewImg  = document.getElementById('pm-preview-img');
  const uploadArea  = document.querySelector('.pm-upload-area');
  const confirmBtn  = document.getElementById('pm-btn-confirm-upload');
  const repickBtn   = document.getElementById('pm-btn-repick');

  function _pmResetPreview() {
    _pmPendingFiles = [];
    previewWrap.style.display = 'none';
    previewImg.src = '';
    fileInput.value = '';
    if (uploadArea) uploadArea.style.display = '';
  }
  window._pmResetPreview = _pmResetPreview;

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    _pmPendingFiles = files;
    // Show square preview of first selected file
    const reader = new FileReader();
    reader.onload = (ev) => {
      previewImg.src = ev.target.result;
      previewWrap.style.display = 'block';
      if (uploadArea) uploadArea.style.display = 'none';
    };
    reader.readAsDataURL(files[0]);
  });

  confirmBtn.addEventListener('click', async () => {
    const files = _pmPendingFiles;
    _pmResetPreview();
    await _pmUploadFiles(files);
  });

  repickBtn.addEventListener('click', () => {
    _pmResetPreview();
    fileInput.click();
  });

  document.querySelectorAll('.pm-tab').forEach(t => {
    t.addEventListener('click', () => _pmSwitchTab(t.dataset.tab));
  });
  // expose for inline onclick
  window._pmSetPriceMode = _pmSetPriceMode;
  window._pmAddUrl       = _pmAddUrl;
  window._pmRemoveImg    = _pmRemoveImg;
  window._pmSelectIcon   = _pmSelectIcon;
}

function _pmSwitchTab(name) {
  document.querySelectorAll('.pm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.pm-panel').forEach(p => p.classList.toggle('active', p.id === 'pm-panel-' + name));
  lucide.createIcons();
}

function _pmSetPriceMode(mode) {
  _pmPriceMode = mode;
  document.getElementById('pm-pt-single').classList.toggle('active', mode === 'single');
  document.getElementById('pm-pt-sized').classList.toggle('active', mode === 'sized');
  document.getElementById('pm-price-single').style.display = mode === 'single' ? 'block' : 'none';
  document.getElementById('pm-price-sized').style.display  = mode === 'sized'  ? 'grid'  : 'none';
}

function _pmSelectIcon(iconName) {
  const grid = document.getElementById('pm-icon-grid');
  if (!grid) return;
  grid.querySelectorAll('.pm-icon-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === iconName);
  });
  lucide.createIcons();
}

/* ── Image helpers ── */
function _pmRenderImages() {
  const grid = document.getElementById('pm-img-grid');
  if (!grid) return;
  grid.innerHTML = _pmImages.map((url, i) => `
    <div class="pm-img-thumb">
      <img src="${_esc(url)}" alt="">
      <button class="pm-img-rm" onclick="window._pmRemoveImg(${i})">✕</button>
    </div>`).join('');
  _pmRenderMenuPreview();
}

function _pmRemoveImg(i) { _pmImages.splice(i, 1); _pmRenderImages(); }

function _pmRenderMenuPreview() {
  const wrap = document.getElementById('pm-menu-preview');
  const img = document.getElementById('pm-preview-menu-img');
  const imgWrap = document.getElementById('pm-preview-imgwrap');
  if (!wrap || !img) return;
  const firstImg = _pmImages.length > 0 ? _pmImages[0] : null;
  if (!firstImg) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  img.src = firstImg;
  img.style.transform = 'scale(' + _pmZoom + ')';
  img.style.objectPosition = _pmPosition;
  const nameEl = document.getElementById('pm-preview-name');
  const priceEl = document.getElementById('pm-preview-price');
  if (nameEl) nameEl.textContent = document.getElementById('pm-f-en')?.value || 'Product Name';
  if (priceEl) priceEl.textContent = '$' + (document.getElementById('pm-f-price')?.value || '0.00');
  const slider = document.getElementById('pm-zoom-slider');
  const zoomVal = document.getElementById('pm-zoom-val');
  if (slider) slider.value = _pmZoom;
  if (zoomVal) zoomVal.textContent = _pmZoom.toFixed(2) + '×';
  _pmInitDrag(imgWrap, img);
}

window._pmPreviewTab = function(tab) {
  const imgWrap = document.getElementById('pm-preview-imgwrap');
  if (!imgWrap) return;
  imgWrap.classList.remove('ratio-desktop', 'ratio-mobile');
  imgWrap.classList.add('ratio-' + tab);
  document.querySelectorAll('.pm-preview-tab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
};

window._pmZoomChange = function(val) {
  _pmZoom = parseFloat(val);
  const img = document.getElementById('pm-preview-menu-img');
  const zoomVal = document.getElementById('pm-zoom-val');
  if (img) img.style.transform = 'scale(' + _pmZoom + ')';
  if (zoomVal) zoomVal.textContent = _pmZoom.toFixed(2) + '×';
};

function _pmInitDrag(wrap, img) {
  if (!wrap || wrap._dragInit) return;
  wrap._dragInit = true;
  let dragging = false, startX, startY, startPosX, startPosY;
  function parsePosPercent(pos) {
    const parts = (pos || '50% 50%').split(/\s+/);
    return [parseFloat(parts[0]) || 50, parseFloat(parts[1]) || 50];
  }
  function onStart(e) {
    e.preventDefault();
    dragging = true;
    wrap.classList.add('dragging');
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY;
    const parsed = parsePosPercent(_pmPosition);
    startPosX = parsed[0]; startPosY = parsed[1];
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const rect = wrap.getBoundingClientRect();
    const pctX = Math.max(0, Math.min(100, startPosX - (dx / rect.width) * 100));
    const pctY = Math.max(0, Math.min(100, startPosY - (dy / rect.height) * 100));
    _pmPosition = pctX.toFixed(1) + '% ' + pctY.toFixed(1) + '%';
    img.style.objectPosition = _pmPosition;
  }
  function onEnd() {
    dragging = false;
    wrap.classList.remove('dragging');
  }
  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('mousemove', onMove);
  wrap.addEventListener('mouseup', onEnd);
  wrap.addEventListener('mouseleave', onEnd);
  wrap.addEventListener('touchstart', onStart, {passive:false});
  wrap.addEventListener('touchmove', onMove, {passive:false});
  wrap.addEventListener('touchend', onEnd);
}

function _pmAddUrl() {
  const el = document.getElementById('pm-url-input');
  const url = el.value.trim();
  if (!url) return;
  if (_pmImages.length >= 5) { showToast('Max 5 images per product', 'error'); return; }
  _pmImages.push(url);
  _pmRenderImages();
  el.value = '';
}

async function _pmUploadFiles(files) {
  if (!files.length) return;
  const slots = 5 - _pmImages.length;
  if (slots <= 0) { showToast('Max 5 images per product', 'error'); return; }
  files = files.slice(0, slots);

  const productId = _pmEditId || (window._pmTempId = window._pmTempId || crypto.randomUUID());
  const wrap = document.getElementById('pm-progress-wrap');
  const bar  = document.getElementById('pm-progress-bar');
  if (wrap) wrap.style.display = 'block';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > 10 * 1024 * 1024) { showToast(`${file.name} exceeds 10 MB`, 'error'); continue; }
    const path = `${productId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if (bar) bar.style.width = Math.round(((i + 0.5) / files.length) * 100) + '%';

    const { error } = await sb.storage.from('product-images').upload(path, file, { upsert: true });
    if (error) { showToast(`Upload failed: ${error.message}`, 'error'); continue; }

    const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);
    _pmImages.push(urlData.publicUrl);
    _pmRenderImages();
    if (bar) bar.style.width = Math.round(((i + 1) / files.length) * 100) + '%';
  }
  lucide.createIcons();
  setTimeout(() => { if (wrap) { wrap.style.display = 'none'; } if (bar) bar.style.width = '0'; }, 700);
}

/* ── Open / close modal ── */
function _pmOpenModal(product) {
  _pmEditId    = product ? product.id : null;
  _pmImages    = product ? [...(product.images || [])] : [];
  _pmZoom = product ? (product.image_zoom || 1.0) : 1.0;
  _pmPosition = product ? (product.image_position || '50% 50%') : '50% 50%';
  _pmPriceMode = (product && product.prices && Object.keys(product.prices).length) ? 'sized' : 'single';

  document.getElementById('pm-modal-title').innerHTML = product ? 'Edit <em>Product</em>' : 'Add <em>Product</em>';
  document.getElementById('pm-f-en').value         = product?.name_en         || '';
  document.getElementById('pm-f-es').value         = product?.name_es         || '';
  document.getElementById('pm-f-tag-en').value     = product?.tag_en          || '';
  document.getElementById('pm-f-tag-es').value     = product?.tag_es          || '';
  document.getElementById('pm-f-desc-en').value    = product?.description_en  || '';
  document.getElementById('pm-f-desc-es').value    = product?.description_es  || '';
  document.getElementById('pm-f-price').value      = product?.price           || '';
  document.getElementById('pm-url-input').value    = '';
  // Set icon picker selection
  window._pmSelectIcon(product?.icon_name || 'cake');

  if (_pmPriceMode === 'sized' && product && product.prices) {
    document.getElementById('pm-f-sm').value = product.prices.Small  ? product.prices.Small.replace('$','')  : '';
    document.getElementById('pm-f-md').value = product.prices.Medium ? product.prices.Medium.replace('$','') : '';
    document.getElementById('pm-f-lg').value = product.prices.Large  ? product.prices.Large.replace('$','')  : '';
  } else {
    ['pm-f-sm','pm-f-md','pm-f-lg'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  _pmSetPriceMode(_pmPriceMode);
  _pmSwitchTab('info');
  _pmRenderImages();
  _pmRenderMenuPreview();
  if (typeof window._pmResetPreview === 'function') window._pmResetPreview();
  document.getElementById('pm-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();
}

function _pmCloseModal() {
  const ov = document.getElementById('pm-overlay');
  if (ov) ov.classList.remove('open');
  document.body.style.overflow = '';
  window._pmTempId = null;
  // Flush any queued realtime reload that was deferred while modal was open
  if (window._pmReloadQueued) {
    window._pmReloadQueued = false;
    _pmReloadSilent();
  }
}

/* ── Save (insert or update) ── */
async function _pmSave() {
  const nameEn = document.getElementById('pm-f-en').value.trim();
  const nameEs = document.getElementById('pm-f-es').value.trim();
  const tagEn  = document.getElementById('pm-f-tag-en').value.trim();
  const tagEs  = document.getElementById('pm-f-tag-es').value.trim();

  if (!nameEn || !nameEs || !tagEn || !tagEs) {
    showToast('Fill in all required fields', 'error');
    _pmSwitchTab('info');
    return;
  }

  let price = null, prices = null;
  if (_pmPriceMode === 'single') {
    const v = document.getElementById('pm-f-price').value;
    price = v ? parseFloat(v) : null;
  } else {
    const sm = document.getElementById('pm-f-sm').value;
    const md = document.getElementById('pm-f-md').value;
    const lg = document.getElementById('pm-f-lg').value;
    prices = {};
    if (sm) prices.Small  = `$${parseFloat(sm).toFixed(2)}`;
    if (md) prices.Medium = `$${parseFloat(md).toFixed(2)}`;
    if (lg) prices.Large  = `$${parseFloat(lg).toFixed(2)}`;
    if (!Object.keys(prices).length) prices = null;
  }

  const payload = {
    name_en: nameEn, name_es: nameEs, tag_en: tagEn, tag_es: tagEs,
    description_en: document.getElementById('pm-f-desc-en').value.trim() || null,
    description_es: document.getElementById('pm-f-desc-es').value.trim() || null,
    icon_name: (document.querySelector('#pm-icon-grid .pm-icon-opt.selected')?.dataset.icon) || 'package',
    price, prices, images: _pmImages, image_zoom: _pmZoom, image_position: _pmPosition,
    updated_at: new Date().toISOString(),
  };

  const btn = document.getElementById('pm-btn-save');
  btn.disabled = true; btn.textContent = 'Saving…';

  let error;
  if (_pmEditId) {
    ({ error } = await sb.from('products').update(payload).eq('id', _pmEditId));
  } else {
    payload.available  = true;
    payload.sold_out   = false;
    payload.sort_order = 999;
    ({ error } = await sb.from('products').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Save Product';

  if (error) { showToast(error.message || 'Save failed', 'error'); return; }

  if (_pmEditId) {
    // ── Existing product: surgical card update (no full reload) ──
    const p = _pmProducts.find(x => x.id === _pmEditId);
    if (p) Object.assign(p, payload);
    showToast('Product updated ✓', 'success');
    _pmCloseModal();
    _pmUpdateCard(_pmEditId, payload);
  } else {
    // ── New product: full reload to render the new card ──
    showToast('Product added ✓', 'success');
    const scrollY = window.scrollY;
    _pmCloseModal();
    await _pmFetch();
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
}

/* ── Surgical in-place card update (no re-render) ── */
function _pmUpdateCard(id, data) {
  const card = document.querySelector(`[data-product-id="${id}"]`);
  if (!card) return;

  // Update thumbnail
  const existingImg = card.querySelector('.pm-thumb');
  const existingPh  = card.querySelector('.pm-thumb-ph');
  if (data.images && data.images[0]) {
    if (existingImg) {
      existingImg.src = data.images[0];
    } else if (existingPh) {
      const img = document.createElement('img');
      img.className = 'pm-thumb';
      img.src = data.images[0];
      img.alt = '';
      img.loading = 'lazy';
      existingPh.replaceWith(img);
    }
  } else if (existingImg) {
    const ph = document.createElement('div');
    ph.className = 'pm-thumb-ph';
    ph.innerHTML = '<i data-lucide="image-off"></i>';
    existingImg.replaceWith(ph);
    lucide.createIcons({ nodes: [ph] });
  }

  // Update name
  const nameEl = card.querySelector('.pm-name');
  if (nameEl && data.name_en) nameEl.textContent = data.name_en;

  // Update price
  const priceEl = card.querySelector('.pm-price-txt');
  if (priceEl) {
    if (data.prices && typeof data.prices === 'object' && Object.keys(data.prices).length) {
      const vals = Object.values(data.prices).map(v => parseFloat(String(v).replace('$', '')));
      priceEl.textContent = `From $${Math.min(...vals)}`;
    } else if (data.price) {
      priceEl.textContent = `$${parseFloat(data.price).toFixed(2)}`;
    } else {
      priceEl.textContent = '—';
    }
  }

  // Update badge
  const badge = card.querySelector('.badge');
  if (badge) {
    const p = _pmProducts.find(x => x.id === id);
    if (p) {
      if (!p.available) {
        badge.textContent = 'HIDDEN';
        badge.className = badge.className.replace(/pm-badge-\w+/g, 'pm-badge-hidden');
      } else if (p.sold_out) {
        badge.textContent = 'SOLD OUT';
        badge.className = badge.className.replace(/pm-badge-\w+/g, 'pm-badge-soldout');
      } else {
        badge.textContent = 'LIVE';
        badge.className = badge.className.replace(/pm-badge-\w+/g, 'pm-badge-live');
      }
    }
  }

  // Flash confirmation
  card.style.transition = 'box-shadow 0.3s ease';
  card.style.boxShadow = '0 0 0 2px #C8102E';
  setTimeout(() => { card.style.boxShadow = ''; }, 800);

  // Re-attach drag listeners (clone to clear old listeners, preserve inline handlers)
  const group = card.closest('.pm-category-group');
  if (group) {
    const fresh = card.cloneNode(true);
    card.replaceWith(fresh);
    _pmAttachCardDrag(fresh, group);
  }
}

/* ── Fetch products from Supabase ── */
async function _pmFetch() {
  const list = document.getElementById('pm-list');
  if (!list) return;
  list.innerHTML = `
    <div class="pm-skeleton"></div>
    <div class="pm-skeleton"></div>
    <div class="pm-skeleton"></div>`;

  const { data, error } = await sb
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) { showToast('Failed to load products', 'error'); list.innerHTML = ''; return; }
  _pmProducts = data || [];
  _pmApplyPendingToProducts();  // reapply unsaved toggle states
  _pmRenderList(_pmProducts);
}

/* ── Reapply pending toggle changes to fresh DB data ── */
function _pmApplyPendingToProducts() {
  Object.entries(_pmPendingChanges).forEach(([id, changes]) => {
    const p = _pmProducts.find(x => x.id === id);
    if (!p) return;
    Object.assign(p, changes);
  });
}

/* ── Silent reload helper (no skeleton flash) ── */
async function _pmReloadSilent() {
  try {
    const { data, error } = await sb
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error || !data) return;
    _pmProducts = data;
    _pmApplyPendingToProducts();  // reapply unsaved toggle states
    // Preserve search state if the user is actively searching
    const q = document.getElementById('pm-search')?.value.toLowerCase().trim();
    if (q) {
      _pmRenderList(_pmProducts.filter(p =>
        p.name_en.toLowerCase().includes(q) || p.tag_en.toLowerCase().includes(q)
      ), true);
    } else {
      _pmRenderList(_pmProducts);
    }
    showToast('Product list updated', 'info');
  } catch (_) { /* silent */ }
}

/* ── Subscribe to Realtime while Products tab is open ── */
function initAdminProductsRealtime() {
  try {
    const sb = window.__supabase;
    if (!sb) return;
    // Remove any stale channel before (re)subscribing
    try { sb.removeChannel(sb.channel('admin-products-live')); } catch (_) {}

    sb.channel('admin-products-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'products'
      }, (payload) => {
        handleAdminProductChange(payload);
      })
      .subscribe();
  } catch (_) { /* silent */ }
}

/* ── Handle incoming realtime change (debounced) ── */
let _pmRealtimeTimer = null;
async function handleAdminProductChange(payload) {
  try {
    // Skip if there are pending unsaved changes — don't wipe local edits
    if (_pmHasPending()) return;

    // Skip during active drag operations
    if (window.__pmDragging || window.__pmDraggingCat) return;

    // If the modal is open, queue the reload for when it closes
    const modalOpen = document.getElementById('pm-overlay')?.classList.contains('open');
    if (modalOpen) {
      window._pmReloadQueued = true;
      return;
    }

    // Debounce: wait 800ms after last event before reloading
    // (drag-and-drop saves fire many rapid updates)
    clearTimeout(_pmRealtimeTimer);
    _pmRealtimeTimer = setTimeout(async () => {
      // Re-check guards after debounce delay
      if (_pmHasPending() || window.__pmDragging || window.__pmDraggingCat) return;
      await _pmReloadSilent();
    }, 800);
  } catch (_) { /* silent */ }
}

/* ── Render the product list ── */
function _pmRenderList(list, isSearch) {
  const container = document.getElementById('pm-list');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <i data-lucide="package-open" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 10px"></i>
      ${isSearch ? 'No products match your search.' : 'No products yet — use \"+ Add Product\" or \"Seed from Code\".'}
    </div>`;
    lucide.createIcons();
    return;
  }

  // Shared card builder
  function _pmCardHTML(p) {
    const thumb = p.images && p.images[0]
      ? `<img class="pm-thumb" src="${_esc(p.images[0])}" alt="" loading="lazy">`
      : `<div class="pm-thumb-ph"><i data-lucide="image-off"></i></div>`;

    const priceVals = p.prices && typeof p.prices === 'object' && Object.keys(p.prices).length
      ? Object.values(p.prices) : null;
    const priceStr = priceVals
      ? `From $${Math.min(...priceVals.map(v => parseFloat(String(v).replace('$',''))))}`
      : (p.price ? `$${parseFloat(p.price).toFixed(2)}` : '—');

    let badgeClass, badgeLabel;
    if (!p.available)    { badgeClass = 'pm-badge-hidden';  badgeLabel = 'HIDDEN';   }
    else if (p.sold_out) { badgeClass = 'pm-badge-soldout'; badgeLabel = 'SOLD OUT'; }
    else                 { badgeClass = 'pm-badge-live';    badgeLabel = 'LIVE';     }
    const hasChange = _pmPendingChanges[p.id] ? ' pm-changed' : '';

    return `
    <div class="pm-card${hasChange}" draggable="true" data-product-id="${p.id}" data-sort-order="${p.sort_order ?? 0}">
      <div class="pm-card-top">
        <div class="pm-grip" title="Drag to reorder">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
            <circle cx="2" cy="2" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="2" r="1.5" fill="#C8A0A8"/>
            <circle cx="2" cy="8" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="8" r="1.5" fill="#C8A0A8"/>
            <circle cx="2" cy="14" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="14" r="1.5" fill="#C8A0A8"/>
          </svg>
        </div>
        ${thumb}
        <div class="pm-info">
          <div class="pm-name">${_esc(p.name_en)}</div>
          <div class="pm-price-txt">${priceStr}</div>
          <span class="badge ${badgeClass}" style="margin-top:4px">${badgeLabel}</span>
        </div>
      </div>
      <div class="pm-controls">
        <div class="pm-toggle-wrap">
          <span class="pm-toggle-lbl">Sold Out</span>
          <label class="toggle" style="width:44px;height:26px">
            <input type="checkbox" ${p.sold_out ? 'checked' : ''}
              onchange="window._pmToggle('${p.id}','sold_out',this.checked)">
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <div class="pm-toggle-wrap">
          <span class="pm-toggle-lbl">Hidden</span>
          <label class="toggle" style="width:44px;height:26px">
            <input type="checkbox" ${!p.available ? 'checked' : ''}
              onchange="window._pmToggle('${p.id}','available',!this.checked)">
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <button class="pm-icon-btn" title="Edit"
          onclick="window._pmEdit('${p.id}')">
          <i data-lucide="pencil"></i>
        </button>
        <button class="pm-icon-btn danger" title="Delete"
          onclick="window._pmDelete('${p.id}','${_escAttr(p.name_en)}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`;
  }

  // Search mode: flat list with result count
  if (isSearch) {
    container.innerHTML =
      `<span class="pm-search-results-lbl">${list.length} result${list.length !== 1 ? 's' : ''}</span>` +
      list.map(_pmCardHTML).join('');
    lucide.createIcons();
    return;
  }

  // Normal mode: group by tag_en, preserving sort_order within each group
  const groupOrder = [];
  const groups = {};
  list.forEach(p => {
    if (!groups[p.tag_en]) {
      groupOrder.push(p.tag_en);
      groups[p.tag_en] = { tag_es: p.tag_es, items: [] };
    }
    groups[p.tag_en].items.push(p);
  });

  container.innerHTML = groupOrder.map(tag => {
    const g = groups[tag];
    return `
    <div class="pm-category-group" draggable="true" data-category="${_esc(tag)}">
      <div class="pm-category-header">
        <div class="pm-cat-grip" title="Drag to reorder category">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
            <circle cx="2" cy="2" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="2" r="1.5" fill="#C8A0A8"/>
            <circle cx="2" cy="8" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="8" r="1.5" fill="#C8A0A8"/>
            <circle cx="2" cy="14" r="1.5" fill="#C8A0A8"/>
            <circle cx="8" cy="14" r="1.5" fill="#C8A0A8"/>
          </svg>
        </div>
        ${_esc(tag)}
        <span class="pm-category-es">/ ${_esc(g.tag_es)}</span>
        <span class="pm-category-count">${g.items.length} item${g.items.length !== 1 ? 's' : ''}</span>
      </div>
      ${g.items.map(_pmCardHTML).join('')}
    </div>`;
  }).join('');

  lucide.createIcons();
  if (!isSearch) _pmAttachDragListeners();
}

/* ── Attach drag listeners to a single product card ── */
function _pmAttachCardDrag(card, group) {
  card.addEventListener('dragstart', (e) => {
    if (window.__pmDraggingCategory) { e.preventDefault(); return; }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.productId);
    card.classList.add('pm-dragging');
    window.__pmDragging = card;
    window.__pmDragGroup = group;
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('pm-dragging');
    document.querySelectorAll('.pm-drag-over')
      .forEach(el => el.classList.remove('pm-drag-over'));
    window.__pmDragging = null;
    window.__pmDragGroup = null;
  });

  card.addEventListener('dragover', (e) => {
    if (window.__pmDraggingCategory) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (window.__pmDragging && window.__pmDragging !== card && window.__pmDragGroup === group) {
      card.classList.add('pm-drag-over');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('pm-drag-over');
  });

  card.addEventListener('drop', async (e) => {
    if (window.__pmDraggingCategory) return;
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('pm-drag-over');

    const draggedId = e.dataTransfer.getData('text/plain');
    const targetId = card.dataset.productId;
    if (draggedId === targetId) return;
    if (window.__pmDragGroup !== group) return;

    const draggedCard = window.__pmDragging;
    if (!draggedCard) return;

    const allCards = [...group.querySelectorAll('.pm-card[data-product-id]')];
    const draggedIndex = allCards.indexOf(draggedCard);
    const targetIndex = allCards.indexOf(card);

    if (draggedIndex < targetIndex) {
      group.insertBefore(draggedCard, card.nextSibling);
    } else {
      group.insertBefore(draggedCard, card);
    }

    await _pmSaveOrder(group);
  });
}

/* ── Drag-and-drop reordering (products within groups + category groups) ── */
function _pmAttachDragListeners() {
  const container = document.getElementById('pm-list');
  if (!container) return;

  /* ── Product card drag (within same category) ── */
  document.querySelectorAll('.pm-category-group').forEach(group => {
    const cards = group.querySelectorAll('.pm-card[data-product-id]');
    cards.forEach(card => _pmAttachCardDrag(card, group));
  });

  /* ── Category group drag ── */
  const catGroups = container.querySelectorAll('.pm-category-group[data-category]');
  catGroups.forEach(group => {
    // Track whether the drag started from the grip handle
    const grip = group.querySelector('.pm-cat-grip');
    let gripActive = false;
    if (grip) {
      grip.addEventListener('mousedown', () => { gripActive = true; });
      document.addEventListener('mouseup', () => { gripActive = false; });
    }

    group.addEventListener('dragstart', (e) => {
      if (!gripActive) {
        // Not from the grip — let product card drag handle it
        return;
      }
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('category', group.dataset.category);
      setTimeout(() => group.classList.add('pm-cat-dragging'), 0);
      window.__pmDraggingCat = group;
      window.__pmDraggingCategory = true;
    });

    group.addEventListener('dragend', () => {
      group.classList.remove('pm-cat-dragging');
      document.querySelectorAll('.pm-cat-drag-over')
        .forEach(el => el.classList.remove('pm-cat-drag-over'));
      window.__pmDraggingCat = null;
      window.__pmDraggingCategory = false;
    });

    group.addEventListener('dragover', (e) => {
      if (!window.__pmDraggingCategory) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (window.__pmDraggingCat !== group) {
        group.classList.add('pm-cat-drag-over');
      }
    });

    group.addEventListener('dragleave', (e) => {
      if (!group.contains(e.relatedTarget)) {
        group.classList.remove('pm-cat-drag-over');
      }
    });

    group.addEventListener('drop', async (e) => {
      if (!window.__pmDraggingCategory) return;
      e.preventDefault();
      e.stopPropagation();
      group.classList.remove('pm-cat-drag-over');

      const draggedGroup = window.__pmDraggingCat;
      if (!draggedGroup || draggedGroup === group) return;

      // Determine drop position (above or below target)
      const rect = group.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dropAbove = e.clientY < midY;

      if (dropAbove) {
        container.insertBefore(draggedGroup, group);
      } else {
        container.insertBefore(draggedGroup, group.nextSibling);
      }

      await _pmSaveCategoryOrder(container);
    });
  });
}

/* ── Save product order within a single category group ── */
async function _pmSaveOrder(groupEl) {
  const cards = [...groupEl.querySelectorAll('.pm-card[data-product-id]')];
  const updates = cards.map((card, index) => ({
    id: card.dataset.productId,
    sort_order: index
  }));

  try {
    const results = await Promise.all(updates.map(({ id, sort_order }) =>
      sb.from('products')
        .update({ sort_order, updated_at: new Date().toISOString() })
        .eq('id', id)
    ));

    const failed = results.filter(r => r.error);
    if (failed.length) {
      showToast('Failed to save order', 'error');
      return;
    }

    updates.forEach(({ id, sort_order }) => {
      const p = _pmProducts.find(x => x.id === id);
      if (p) p.sort_order = sort_order;
    });

    cards.forEach((card, i) => card.dataset.sortOrder = i);
    showToast('Order saved', 'success');
  } catch (err) {
    console.error('Failed to save order:', err);
    showToast('Failed to save order', 'error');
  }
}

/* ── Save category order (renumber all products in blocks of 100) ── */
async function _pmSaveCategoryOrder(container) {
  const groups = [...container.querySelectorAll('.pm-category-group[data-category]')];
  const updates = [];

  groups.forEach((group, groupIndex) => {
    const cards = [...group.querySelectorAll('.pm-card[data-product-id]')];
    cards.forEach((card, productIndex) => {
      updates.push({
        id: card.dataset.productId,
        sort_order: (groupIndex * 100) + productIndex
      });
    });
  });

  try {
    const results = await Promise.all(updates.map(({ id, sort_order }) =>
      sb.from('products')
        .update({ sort_order, updated_at: new Date().toISOString() })
        .eq('id', id)
    ));

    const failed = results.filter(r => r.error);
    if (failed.length) {
      showToast('Failed to save category order', 'error');
      return;
    }

    // Update local data
    updates.forEach(({ id, sort_order }) => {
      const p = _pmProducts.find(x => x.id === id);
      if (p) p.sort_order = sort_order;
    });

    showToast('Category order saved', 'success');
  } catch (err) {
    console.error('Failed to save category order:', err);
    showToast('Failed to save category order', 'error');
  }
}

/* ── Instant toggle (sold_out / available) ── */
window._pmToggle = function(id, field, value) {
  // Update local data immediately (no DB save yet)
  const p = _pmProducts.find(x => x.id === id);
  if (p) p[field] = value;

  // Track as pending change
  if (!_pmPendingChanges[id]) _pmPendingChanges[id] = {};
  _pmPendingChanges[id][field] = value;

  // Re-render preserving scroll
  const scrollY = window.scrollY;
  _pmRenderList(_pmProducts);
  requestAnimationFrame(() => window.scrollTo(0, scrollY));

  _pmUpdateSaveBar();
};

/* ── Pending changes helpers ── */
function _pmHasPending() {
  return Object.keys(_pmPendingChanges).length > 0;
}

function _pmUpdateSaveBar() {
  const bar = document.getElementById('pm-save-bar');
  if (!bar) return;
  const count = Object.keys(_pmPendingChanges).length;
  if (count > 0) {
    bar.classList.remove('hidden');
    bar.querySelector('.pm-pending-count').innerHTML =
      `<strong>${count}</strong> product${count !== 1 ? 's' : ''} with unsaved changes`;
  } else {
    bar.classList.add('hidden');
  }
  _pmUpdateNavBadge();
}

function _pmInjectSaveBar() {
  if (document.getElementById('pm-save-bar')) return;
  const section = document.getElementById('section-products');
  if (!section) return;
  const bar = document.createElement('div');
  bar.id = 'pm-save-bar';
  bar.className = 'pm-save-bar hidden';
  bar.innerHTML = `
    <span class="pm-pending-count"></span>
    <div class="pm-save-bar-actions">
      <button class="pm-btn-discard" onclick="window._pmDiscardChanges()">Discard</button>
      <button class="pm-btn-save-all" onclick="window._pmSaveAllChanges()">Save Changes</button>
    </div>`;
  section.appendChild(bar);
}

window._pmSaveAllChanges = async function() {
  const ids = Object.keys(_pmPendingChanges);
  if (!ids.length) return;

  const btn = document.querySelector('.pm-btn-save-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const results = await Promise.all(ids.map(id => {
      const fields = { ..._pmPendingChanges[id], updated_at: new Date().toISOString() };
      return sb.from('products').update(fields).eq('id', id);
    }));

    const failed = results.filter(r => r.error);
    if (failed.length) {
      showToast(`${failed.length} update(s) failed`, 'error');
    } else {
      showToast(`${ids.length} product${ids.length !== 1 ? 's' : ''} saved ✓`, 'success');
    }

    _pmPendingChanges = {};
    _pmUpdateSaveBar();
  } catch (err) {
    console.error('Batch save failed:', err);
    showToast('Save failed', 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
};

window._pmDiscardChanges = async function() {
  _pmPendingChanges = {};
  _pmUpdateSaveBar();
  // Reload from DB to revert local changes
  await _pmFetch();
  showToast('Changes discarded', 'info');
};

/* ── Confirm discard dialog (SweetAlert2) ── */
async function _pmConfirmDiscard() {
  if (!_pmHasPending()) return true;

  const result = await Swal.fire({
    title: 'Unsaved Changes',
    text: 'You have unsaved product changes. What would you like to do?',
    icon: 'warning',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Save Changes',
    denyButtonText: 'Discard',
    cancelButtonText: 'Stay Here',
    confirmButtonColor: '#C8102E',
    denyButtonColor: '#6B5057',
    cancelButtonColor: '#A08088',
    reverseButtons: false,
  });

  if (result.isConfirmed) {
    await window._pmSaveAllChanges();
    return true;
  } else if (result.isDenied) {
    _pmPendingChanges = {};
    _pmUpdateSaveBar();
    await _pmFetch();
    return true;
  }
  return false; // cancelled — stay
}

/* ── Pulsing nav badge for unsaved changes ── */
(function _pmInjectPulseStyle() {
  if (document.getElementById('pm-pulse-style')) return;
  const s = document.createElement('style');
  s.id = 'pm-pulse-style';
  s.textContent = `@keyframes pmPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`;
  document.head.appendChild(s);
})();

function _pmUpdateNavBadge() {
  const navItems = document.querySelectorAll('[data-section="products"]');
  navItems.forEach(item => {
    if (_pmHasPending()) {
      if (!item.querySelector('.pm-unsaved-dot')) {
        const dot = document.createElement('span');
        dot.className = 'pm-unsaved-dot';
        dot.style.cssText = 'display:inline-block;width:8px;height:8px;background:#C8102E;border-radius:50%;margin-left:6px;vertical-align:middle;animation:pmPulse 1.5s ease-in-out infinite';
        item.appendChild(dot);
      }
    } else {
      item.querySelector('.pm-unsaved-dot')?.remove();
    }
  });
}

/* ── Edit (open modal prefilled) ── */
window._pmEdit = function(id) {
  const p = _pmProducts.find(x => x.id === id);
  if (p) _pmOpenModal(p);
};

/* ── Delete with typed confirmation ── */
window._pmDelete = async function(id, name) {
  // Confirm deletion — use Swal if available, native confirm as fallback
  let confirmed = false;
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: 'Delete Product',
      html: `<p style="font-size:.9rem;color:var(--tx-muted);margin-bottom:12px">
               Type <strong>${_esc(name)}</strong> to confirm deletion.
               This cannot be undone.
             </p>
             <input id="swal-pm-confirm" class="swal2-input" placeholder="${_esc(name)}" style="font-size:.88rem">`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#C8102E',
      cancelButtonText: 'Cancel',
      focusConfirm: false,
      preConfirm: () => {
        const val = document.getElementById('swal-pm-confirm').value.trim();
        if (val !== name) { Swal.showValidationMessage(`Type exactly: "${name}"`); return false; }
        return true;
      }
    });
    confirmed = result.isConfirmed;
  } else {
    confirmed = window.confirm(`Delete "${name}"? This cannot be undone. Type OK to confirm.`);
  }

  if (!confirmed) return;

  // Best-effort: remove storage files
  try {
    const { data: files } = await sb.storage.from('product-images').list(id);
    if (files && files.length) {
      await sb.storage.from('product-images').remove(files.map(f => `${id}/${f.name}`));
    }
  } catch (e) { /* storage cleanup is non-critical */ }

  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) { showToast('Delete failed', 'error'); return; }
  showToast('Product deleted', 'success');
  await _pmFetch();
};

/* ── Seed from hardcoded catalog ── */
async function _pmSeed() {
  // Confirm seed — use Swal if available, native confirm as fallback
  let seedConfirmed = false;
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: 'Seed Products',
      html: `<p style="font-size:.9rem;color:var(--tx-muted)">
               Insert <strong>${PM_SEED_DATA.length} products</strong> from the
               hardcoded catalog. Any product whose name already exists will be skipped.
             </p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Seed Now',
      confirmButtonColor: '#002D62',
      cancelButtonText: 'Cancel',
    });
    seedConfirmed = result.isConfirmed;
  } else {
    seedConfirmed = window.confirm(`Seed ${PM_SEED_DATA.length} products into Supabase? Duplicates will be skipped.`);
  }

  const btn = document.getElementById('pm-btn-seed');
  btn.disabled = true;
  btn.textContent = `Seeding ${PM_SEED_DATA.length} products…`;

  const { data: existing } = await sb.from('products').select('name_en, tag_en');
  const existingKeys = new Set((existing || []).map(p => `${p.name_en}|${p.tag_en}`));

  const toInsert = PM_SEED_DATA
    .filter(p => !existingKeys.has(`${p.name_en}|${p.tag_en}`))
    .map((p, i) => ({
      name_en: p.name_en, name_es: p.name_es,
      tag_en:  p.tag_en,  tag_es:  p.tag_es,
      price:   p.price  || null,
      prices:  p.prices || null,
      icon_name: p.icon_name || 'package',
      images:  [],
      available:  true,
      sold_out:   false,
      sort_order: i,
    }));

  const skipped = PM_SEED_DATA.length - toInsert.length;

  if (!toInsert.length) {
    showToast(`All ${PM_SEED_DATA.length} products already exist (0 added, ${skipped} skipped)`, 'info');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="database-zap"></i> Seed from Code';
    lucide.createIcons();
    return;
  }

  const { error } = await sb.from('products').insert(toInsert);

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="database-zap"></i> Seed from Code';
  lucide.createIcons();

  if (error) { showToast(`Seed failed: ${error.message}`, 'error'); return; }
  _log('Seeded:', toInsert.map(p => `${p.name_en} (${p.tag_en})`).join(', '));
  showToast(`Done! ${toInsert.length} added, ${skipped} skipped`, 'success');
  await _pmFetch();
}

/* ═══════════════════════════════════════════════════════════
   STAFF MANAGEMENT — Section: "staff"
   ═══════════════════════════════════════════════════════════ */

async function loadStaffSection() {
  if (!sb || !currentUser) return;
  await Promise.all([loadPendingStaff(), loadCurrentStaff()]);
  lucide.createIcons();
}

/* ── Pending Users (role = 'customer', has clerk_user_id, last 30 days) ── */
async function loadPendingStaff() {
  const container = document.getElementById('pending-staff-list');
  const badge = document.getElementById('pending-staff-badge');
  if (!container) return;

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pending, error } = await sb
      .from('profiles')
      .select('id, clerk_user_id, email, created_at, role')
      .eq('role', 'customer')
      .not('clerk_user_id', 'is', null)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false });

    if (error) { console.error('Pending staff error:', error); return; }

    if (!pending || pending.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px" data-en="No pending users" data-es="No hay usuarios pendientes">${lang === 'es' ? 'No hay usuarios pendientes' : 'No pending users'}</div>`;
      if (badge) badge.style.display = 'none';
      return;
    }

    if (badge) {
      badge.textContent = pending.length;
      badge.style.display = 'inline-flex';
    }

    const headerEn = `<tr><th>Email</th><th>User ID</th><th>Signed Up</th><th>Actions</th></tr>`;
    const headerEs = `<tr><th>Correo</th><th>ID de Usuario</th><th>Registrado</th><th>Acciones</th></tr>`;

    const rows = pending.map(p => {
      const email = p.email ? _esc(p.email) : `<span style="color:var(--tx-faint);font-style:italic">${lang === 'es' ? 'Sin correo' : 'No email'}</span>`;
      const shortId = p.clerk_user_id ? _esc(p.clerk_user_id.slice(0, 20)) + '…' : '—';
      const date = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<tr>
        <td class="staff-email-cell">${email}</td>
        <td class="staff-id-cell">${shortId}</td>
        <td>${date}</td>
        <td class="staff-actions-cell">
          <button class="staff-action-btn grant" onclick="grantStaffAccess('${_escAttr(p.clerk_user_id)}', 'staff')">
            ${lang === 'es' ? 'Staff' : 'Grant Staff'}
          </button>
          <button class="staff-action-btn grant" onclick="grantStaffAccess('${_escAttr(p.clerk_user_id)}', 'admin')">
            ${lang === 'es' ? 'Admin' : 'Grant Admin'}
          </button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `<div class="staff-table-wrap"><table class="staff-table"><thead>${lang === 'es' ? headerEs : headerEn}</thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { console.error('Pending staff load error:', e); }
}

/* ── Current Staff Members (role in ['staff', 'admin'], has clerk_user_id) ── */
async function loadCurrentStaff() {
  const container = document.getElementById('current-staff-list');
  if (!container) return;

  try {
    const { data: staff, error } = await sb
      .from('profiles')
      .select('id, clerk_user_id, email, role, created_at')
      .in('role', ['staff', 'admin'])
      .not('clerk_user_id', 'is', null)
      .order('created_at', { ascending: false });

    if (error) { console.error('Current staff error:', error); return; }

    if (!staff || staff.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px" data-en="No staff members yet" data-es="Aún no hay miembros del personal">${lang === 'es' ? 'Aún no hay miembros del personal' : 'No staff members yet'}</div>`;
      return;
    }

    const headerEn = `<tr><th>Email</th><th>User ID</th><th>Role</th><th>Added</th><th>Actions</th></tr>`;
    const headerEs = `<tr><th>Correo</th><th>ID de Usuario</th><th>Rol</th><th>Agregado</th><th>Acciones</th></tr>`;

    const rows = staff.map(s => {
      const email = s.email ? _esc(s.email) : `<span style="color:var(--tx-faint);font-style:italic">${lang === 'es' ? 'Sin correo' : 'No email'}</span>`;
      const shortId = s.clerk_user_id ? _esc(s.clerk_user_id.slice(0, 20)) + '…' : '—';
      const roleBadge = s.role === 'admin'
        ? `<span class="staff-role-badge role-admin">Admin</span>`
        : `<span class="staff-role-badge role-staff">Staff</span>`;
      const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<tr>
        <td class="staff-email-cell">${email}</td>
        <td class="staff-id-cell">${shortId}</td>
        <td>${roleBadge}</td>
        <td>${date}</td>
        <td>
          <button class="staff-action-btn revoke" onclick="revokeStaffAccess('${_escAttr(s.clerk_user_id)}')">
            ${lang === 'es' ? 'Revocar' : 'Remove Access'}
          </button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `<div class="staff-table-wrap"><table class="staff-table"><thead>${lang === 'es' ? headerEs : headerEn}</thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { console.error('Current staff load error:', e); }
}

/* ── Grant Access by Email ── */
window.grantStaffByEmail = async function() {
  if (!sb) return;
  const emailInput = document.getElementById('staff-email-input');
  const roleSelect = document.getElementById('staff-role-select');
  const email = emailInput.value.trim().toLowerCase();
  const newRole = roleSelect.value;

  if (!email) {
    showToast(lang === 'es' ? 'Ingresa un correo electrónico' : 'Enter an email address', 'error');
    return;
  }

  try {
    // Find profile by email
    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, clerk_user_id, email, role')
      .ilike('email', email)
      .limit(1);

    if (error) throw error;

    if (!profiles || profiles.length === 0) {
      // No profile exists — create one with the desired role right now
      // The user can link their Clerk ID when they sign in later
      const { data: newProfile, error: insertErr } = await sb
        .from('profiles')
        .insert({ email: email, role: newRole })
        .select()
        .single();

      if (insertErr) {
        // Retry without .select().single()
        const { error: retryErr } = await sb
          .from('profiles')
          .insert({ email: email, role: newRole });
        if (retryErr) throw retryErr;
      }

      emailInput.value = '';
      showToast(
        lang === 'es'
          ? `Cuenta creada con acceso de ${newRole} para ${_esc(email)}`
          : `Account created with ${newRole} access for ${_esc(email)}`,
        'success'
      );
      await loadStaffSection();
      return;
    }

    const profile = profiles[0];

    // Profile exists — update role directly via Supabase
    if (profile.clerk_user_id) {
      // Has Clerk ID — use the API
      await updateStaffRole(profile.clerk_user_id, newRole);
    } else {
      // No Clerk ID yet — update role directly in DB
      const { error: updateErr } = await sb
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profile.id);
      if (updateErr) throw updateErr;
    }

    emailInput.value = '';
    showToast(
      lang === 'es'
        ? `Acceso de ${newRole} concedido a ${_esc(email)}`
        : `${newRole.charAt(0).toUpperCase() + newRole.slice(1)} access granted to ${_esc(email)}`,
      'success'
    );
    await loadStaffSection();
  } catch (e) {
    console.error('Grant staff error:', e);
    showToast(e.message || (lang === 'es' ? 'Error al conceder acceso' : 'Error granting access'), 'error');
  }
};

/* ── Grant Access by Clerk User ID (from pending list) ── */
window.grantStaffAccess = async function(clerkUserId, newRole) {
  if (!clerkUserId) return;
  try {
    await updateStaffRole(clerkUserId, newRole);

    showToast(
      lang === 'es'
        ? `Acceso de ${newRole} concedido`
        : `${newRole.charAt(0).toUpperCase() + newRole.slice(1)} access granted`,
      'success'
    );
    await loadStaffSection();
  } catch (e) {
    console.error('Grant access error:', e);
    showToast(e.message || (lang === 'es' ? 'Error al conceder acceso' : 'Error granting access'), 'error');
  }
};

/* ── Revoke Access (set role back to 'customer') ── */
window.revokeStaffAccess = async function(clerkUserId) {
  if (!clerkUserId) return;

  const confirmed = await Swal.fire({
    title: lang === 'es' ? '¿Revocar acceso?' : 'Revoke access?',
    text: lang === 'es' ? 'Este usuario perderá acceso al portal de personal.' : 'This user will lose access to the staff portal.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: lang === 'es' ? 'Sí, revocar' : 'Yes, revoke',
    cancelButtonText: lang === 'es' ? 'Cancelar' : 'Cancel',
    confirmButtonColor: '#C8102E',
  });

  if (!confirmed.isConfirmed) return;

  try {
    await updateStaffRole(clerkUserId, 'customer');

    showToast(
      lang === 'es' ? 'Acceso revocado' : 'Access revoked',
      'success'
    );
    await loadStaffSection();
  } catch (e) {
    console.error('Revoke access error:', e);
    showToast(e.message || (lang === 'es' ? 'Error al revocar acceso' : 'Error revoking access'), 'error');
  }
};

// Wire up grant button
document.getElementById('staff-grant-btn')?.addEventListener('click', () => grantStaffByEmail());
document.getElementById('staff-email-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') grantStaffByEmail();
});

/* ═══════════════════════════════════
   WHOLESALE MANAGEMENT
   ═══════════════════════════════════ */
let _wsAccounts = [];
let _wsProducts = [];
let _wsPrices = {};
let _wsSelectedAccountId = null;
let _wsAllPricesData = [];
let _wsOrders = [];

async function loadWholesaleSection() {
  _pmInjectStyles();
  const { data, error } = await sb.from('wholesale_accounts').select('*').order('created_at', { ascending: false });
  if (error) { console.error('Wholesale load error:', error); return; }
  _wsAccounts = data || [];

  // Load products for pricing
  const { data: prods } = await sb.from('b2b_products').select('*').order('sort_order', { ascending: true });
  _wsProducts = prods || [];

  // Load ALL wholesale prices (for all accounts)
  const { data: prices } = await sb.from('wholesale_prices').select('*');
  _wsAllPricesData = prices || [];

  // Load wholesale orders
  const { data: orderRes } = await sb.from('wholesale_orders').select('*, wholesale_accounts(business_name)').order('placed_at', { ascending: false });
  _wsOrders = orderRes || [];

  // Build price map for selected account
  _wsBuildPriceMap();

  // Update badge
  const pendingCount = _wsAccounts.filter(a => a.status === 'pending').length;
  ['wholesale-badge', 'wholesale-badge-m'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (pendingCount > 0) { el.textContent = pendingCount; el.style.display = 'inline-flex'; }
    else { el.style.display = 'none'; }
  });
  var pendingBadge = document.getElementById('ws-pending-count');
  if (pendingBadge) {
    if (pendingCount > 0) { pendingBadge.textContent = pendingCount; pendingBadge.style.display = ''; }
    else { pendingBadge.textContent = ''; pendingBadge.style.display = 'none'; }
  }

  // Update orders badge
  var pendingOrders = _wsOrders.filter(function(o) { return o.status === 'pending'; });
  var ordersCountEl = document.getElementById('ws-orders-count');
  if (ordersCountEl) ordersCountEl.textContent = pendingOrders.length > 0 ? pendingOrders.length : '';

  _wsRenderApplications();
  _wsRenderAccounts();
}

function _wsBuildPriceMap() {
  _wsPrices = {};
  (_wsAllPricesData || []).forEach(function(p) {
    var key = (p.account_id || 'global') + ':' + (p.b2b_product_id || p.product_id);
    _wsPrices[key] = p;
  });
}

function _wsGetPrice(accountId, productId) {
  return _wsPrices[accountId + ':' + productId] || _wsPrices['global:' + productId] || null;
}
function _wsAccountPricedCount(accountId) {
  return _wsProducts.filter(function(p) { return _wsGetPrice(accountId, p.id); }).length;
}
function _wsAccountAllPriced(accountId) {
  return _wsProducts.length > 0 && _wsProducts.every(function(p) { return _wsGetPrice(accountId, p.id); });
}

window._wsShowTab = function(tab) {
  document.querySelectorAll('.ws-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['applications', 'accounts', 'pricing', 'orders'].forEach(t => {
    const el = document.getElementById('ws-panel-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'pricing') _wsRenderPricing();
  if (tab === 'orders') _wsRenderOrders();
};

function _wsRenderApplications() {
  const panel = document.getElementById('ws-panel-applications');
  const pending = _wsAccounts.filter(a => a.status === 'pending');
  const rejected = _wsAccounts.filter(a => a.status === 'rejected');
  if (!pending.length && !rejected.length) {
    panel.innerHTML = '<div class="ws-empty">No pending applications</div>';
    return;
  }
  let html = '';
  if (pending.length) {
    html += pending.map(a => _wsCardHTML(a)).join('');
  }
  if (rejected.length) {
    html += '<h3 style="font-size:.82rem;color:var(--tx-faint);margin:24px 0 12px;text-transform:uppercase;letter-spacing:.5px">Rejected</h3>';
    html += rejected.map(a => _wsCardHTML(a)).join('');
  }
  panel.innerHTML = html;
}

function _wsRenderAccounts() {
  const panel = document.getElementById('ws-panel-accounts');
  const approved = _wsAccounts.filter(a => a.status === 'approved');
  if (!approved.length) {
    panel.innerHTML = '<div class="ws-empty">No approved accounts yet</div>';
    return;
  }
  panel.innerHTML = approved.map(a => _wsCardHTML(a, true)).join('');
}

function _wsCardHTML(a) {
  var date = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var statusClass = a.status;
  return '<div class="ws-card ws-card-collapsed" onclick="window._wsOpenDetail(\'' + a.id + '\')" style="cursor:pointer;transition:border-color .2s">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div>' +
        '<div class="ws-card-biz">' + a.business_name + '</div>' +
        '<div style="font-size:.78rem;color:var(--tx-faint)">' + (a.business_type || '—') + ' · ' + date + '</div>' +
      '</div>' +
      '<span class="ws-card-status ' + statusClass + '">' + a.status + '</span>' +
    '</div>' +
  '</div>';
}

window._wsOpenDetail = function(id) {
  var a = _wsAccounts.find(function(x) { return x.id === id; });
  if (!a) return;
  var date = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var allPriced = _wsAccountAllPriced(a.id);
  var actions = '';
  if (a.status === 'pending') {
    var pricedCount = _wsAccountPricedCount(a.id);
    var totalCount = _wsProducts.length;
    var acctAllPriced = _wsAccountAllPriced(a.id);
    var approveDisabled = acctAllPriced ? '' : 'disabled title="Set all wholesale prices first"';
    actions = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<span style="font-size:.82rem;font-weight:600;color:' + (acctAllPriced ? '#0a7a0a' : 'var(--red)') + '">' + pricedCount + ' of ' + totalCount + ' products priced</span>' +
        '<button class="ws-btn ws-btn-pricing" onclick="document.getElementById(\'ws-detail-overlay\').remove();window._wsOpenAccountPricing(\'' + a.id + '\',\'' + a.business_name.replace(/'/g, "\\'") + '\')">Set Prices</button>' +
      '</div>' +
      '<div class="ws-card-actions">' +
        '<button class="ws-btn ws-btn-approve" onclick="window._wsApprove(\'' + a.id + '\')" ' + approveDisabled + '>Approve</button>' +
        '<button class="ws-btn ws-btn-reject" onclick="window._wsReject(\'' + a.id + '\')">Reject</button>' +
      '</div>' +
      (!acctAllPriced ? '<div style="font-size:.75rem;color:var(--red);margin-top:8px">⚠ Set all prices for this account before approving</div>' : '') +
    '</div>';
  } else if (a.status === 'approved') {
    actions = '<div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<span class="ws-card-status approved">APPROVED</span>' +
      (a.approved_at ? '<span style="font-size:.78rem;color:var(--tx-faint)">on ' + new Date(a.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</span>' : '') +
    '</div>' +
    '<div class="ws-card-actions" style="margin-top:12px">' +
      '<button class="ws-btn ws-btn-pricing" onclick="document.getElementById(\'ws-detail-overlay\').remove();window._wsOpenAccountPricing(\'' + a.id + '\',\'' + a.business_name.replace(/'/g, "\\'") + '\')">Edit Prices</button>' +
      '<button class="ws-btn ws-btn-reject" onclick="window._wsRevoke(\'' + a.id + '\')">Revoke Access</button>' +
    '</div>';
  } else if (a.status === 'rejected') {
    var pricedCountR = _wsAccountPricedCount(a.id);
    var totalCountR = _wsProducts.length;
    var acctAllPricedR = _wsAccountAllPriced(a.id);
    var approveDisabledR = acctAllPricedR ? '' : 'disabled title="Set all wholesale prices first"';
    actions = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<span style="font-size:.82rem;font-weight:600;color:' + (acctAllPricedR ? '#0a7a0a' : 'var(--red)') + '">' + pricedCountR + ' of ' + totalCountR + ' products priced</span>' +
        '<button class="ws-btn ws-btn-pricing" onclick="document.getElementById(\'ws-detail-overlay\').remove();window._wsOpenAccountPricing(\'' + a.id + '\',\'' + a.business_name.replace(/'/g, "\\'") + '\')">Set Prices</button>' +
      '</div>' +
      '<div class="ws-card-actions">' +
        '<button class="ws-btn ws-btn-approve" onclick="window._wsApprove(\'' + a.id + '\')" ' + approveDisabledR + '>Reconsider & Approve</button>' +
      '</div>' +
      (!acctAllPricedR ? '<div style="font-size:.75rem;color:var(--red);margin-top:8px">⚠ Set all prices for this account before approving</div>' : '') +
    '</div>';
  }

  var overlay = document.getElementById('ws-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ws-detail-overlay';
    document.body.appendChild(overlay);
  }
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:var(--bg-card);border-radius:16px;padding:28px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:85vh;overflow-y:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">' +
      '<div>' +
        '<h3 style="font-size:1.2rem;font-weight:700;color:var(--tx);margin:0">' + a.business_name + '</h3>' +
        '<div style="font-size:.78rem;color:var(--tx-faint);margin-top:2px">Applied ' + date + '</div>' +
      '</div>' +
      '<button onclick="document.getElementById(\'ws-detail-overlay\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--tx-muted);padding:4px">✕</button>' +
    '</div>' +
    '<div class="ws-card-detail">' +
      '<strong>Contact:</strong> ' + a.contact_name + '<br>' +
      '<strong>Email:</strong> <a href="mailto:' + a.email + '" style="color:var(--red)">' + a.email + '</a><br>' +
      '<strong>Phone:</strong> <a href="tel:' + a.phone + '" style="color:var(--red)">' + a.phone + '</a><br>' +
      '<strong>Address:</strong> ' + a.address + (a.city ? ', ' + a.city : '') + (a.state ? ', ' + a.state : '') + ' ' + (a.zip || '') + '<br>' +
      '<strong>Business Type:</strong> ' + (a.business_type || '—') + '<br>' +
      (a.notes ? '<strong>Notes:</strong> ' + a.notes + '<br>' : '') +
    '</div>' +
    actions +
  '</div>';
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
};

function _wsRenderPricing() {
  var panel = document.getElementById('ws-panel-pricing');
  if (!_wsAccounts.length) {
    panel.innerHTML = '<div class="ws-empty">No wholesale accounts yet. Pricing is set per account — click an application to set prices.</div>';
    return;
  }
  var html = '<div class="ws-card"><p style="font-size:.85rem;color:var(--tx-muted);margin-bottom:16px">Pricing is set individually per account. Click an application or approved account to view or edit their prices.</p>';

  var approved = _wsAccounts.filter(function(a) { return a.status === 'approved'; });
  var pending = _wsAccounts.filter(function(a) { return a.status === 'pending'; });

  if (approved.length) {
    html += '<h4 style="font-size:.82rem;color:var(--tx);margin:16px 0 8px">Approved Accounts</h4>';
    approved.forEach(function(a) {
      var count = _wsAccountPricedCount(a.id);
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="font-size:.88rem;font-weight:600">' + a.business_name + '</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:.78rem;color:var(--tx-faint)">' + count + '/' + _wsProducts.length + ' priced</span>' +
          '<button class="ws-btn ws-btn-pricing" style="padding:4px 10px;font-size:.75rem" onclick="window._wsOpenAccountPricing(\'' + a.id + '\',\'' + a.business_name.replace(/'/g, "\\'") + '\')">Edit</button>' +
        '</div></div>';
    });
  }

  if (pending.length) {
    html += '<h4 style="font-size:.82rem;color:var(--tx-faint);margin:16px 0 8px">Pending — Needs Pricing</h4>';
    pending.forEach(function(a) {
      var count = _wsAccountPricedCount(a.id);
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="font-size:.88rem;font-weight:500">' + a.business_name + '</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:.78rem;color:var(--red)">' + count + '/' + _wsProducts.length + ' priced</span>' +
          '<button class="ws-btn ws-btn-pricing" style="padding:4px 10px;font-size:.75rem" onclick="window._wsOpenAccountPricing(\'' + a.id + '\',\'' + a.business_name.replace(/'/g, "\\'") + '\')">Set Prices</button>' +
        '</div></div>';
    });
  }

  html += '</div>';
  panel.innerHTML = html;
}

window._wsSavePricing = async function() {
  const statusEl = document.getElementById('ws-pricing-status');
  if (statusEl) statusEl.textContent = 'Saving...';

  const inputs = document.querySelectorAll('.ws-pricing-grid input');
  const updates = {};
  inputs.forEach(inp => {
    const pid = inp.dataset.productId;
    const field = inp.dataset.field;
    if (!updates[pid]) updates[pid] = { b2b_product_id: pid, account_id: _wsSelectedAccountId };
    if (field === 'wholesale_price') updates[pid].wholesale_price = parseFloat(inp.value) || 0;
    if (field === 'min_qty') updates[pid].min_qty = parseInt(inp.value) || 1;
  });

  if (!_wsSelectedAccountId) { showToast('Select an account first', 'error'); if (statusEl) statusEl.textContent = ''; return; }

  let errors = 0;
  for (const pid of Object.keys(updates)) {
    const row = updates[pid];
    if (!row.wholesale_price || row.wholesale_price <= 0) continue;
    row.updated_at = new Date().toISOString();
    const { error } = await sb.from('wholesale_prices').upsert(row, { onConflict: 'b2b_product_id,account_id' });
    if (error) errors++;
  }

  if (errors) {
    showToast(errors + ' prices failed to save', 'error');
  } else {
    showToast('Wholesale prices saved', 'success');
  }
  if (statusEl) statusEl.textContent = '';
  await loadWholesaleSection();
};

window._wsApprove = async function(id) {
  const account = _wsAccounts.find(a => a.id === id);
  const name = account ? account.business_name : 'this account';
  var accountPrices = {};
  _wsAllPricesData.forEach(function(pr) { if (pr.account_id === id) accountPrices[pr.b2b_product_id || pr.product_id] = pr; });
  var allPriced = _wsProducts.length > 0 && _wsProducts.every(function(p) { return accountPrices[p.id]; });
  if (!allPriced) {
    showToast('Set all wholesale prices before approving', 'error');
    return;
  }
  _wsConfirm(
    'Approve Account',
    'Are you sure you want to approve <strong>' + name + '</strong>? They will gain access to the wholesale ordering portal.',
    'Approve',
    'ws-btn-approve',
    async function() {
      const { error } = await sb.from('wholesale_accounts').update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      var detailOverlay = document.getElementById('ws-detail-overlay');
      if (detailOverlay) detailOverlay.remove();
      showToast(name + ' approved!', 'success');
      await loadWholesaleSection();
    }
  );
};

window._wsReject = async function(id) {
  const account = _wsAccounts.find(a => a.id === id);
  const name = account ? account.business_name : 'this application';
  _wsConfirm(
    'Reject Application',
    'Are you sure you want to reject <strong>' + name + '</strong>?',
    'Reject',
    'ws-btn-reject',
    async function() {
      const { error } = await sb.from('wholesale_accounts').update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      var detailOverlay = document.getElementById('ws-detail-overlay');
      if (detailOverlay) detailOverlay.remove();
      showToast('Application rejected', 'success');
      await loadWholesaleSection();
    }
  );
};

window._wsRevoke = async function(id) {
  const account = _wsAccounts.find(a => a.id === id);
  const name = account ? account.business_name : 'this account';
  _wsConfirm(
    'Revoke Access',
    'Are you sure you want to revoke wholesale access for <strong>' + name + '</strong>? They will no longer be able to place wholesale orders.',
    'Revoke',
    'ws-btn-reject',
    async function() {
      const { error } = await sb.from('wholesale_accounts').update({
        status: 'rejected',
        approved_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      var detailOverlay = document.getElementById('ws-detail-overlay');
      if (detailOverlay) detailOverlay.remove();
      showToast(name + ' access revoked', 'success');
      await loadWholesaleSection();
    }
  );
};

function _wsConfirm(title, message, confirmText, confirmClass, onConfirm) {
  let overlay = document.getElementById('ws-confirm-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ws-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:16px;padding:28px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <h3 style="font-size:1.1rem;font-weight:700;color:var(--tx);margin:0 0 8px">${title}</h3>
      <p style="font-size:.9rem;color:var(--tx-muted);margin:0 0 24px;line-height:1.5">${message}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="ws-btn ws-btn-reject" onclick="document.getElementById('ws-confirm-overlay').remove()">Cancel</button>
        <button class="ws-btn ${confirmClass}" id="ws-confirm-btn">${confirmText}</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  document.getElementById('ws-confirm-btn').onclick = function() {
    overlay.remove();
    onConfirm();
  };
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

window._wsOpenAccountPricing = function(accountId, businessName) {
  var overlay = document.getElementById('ws-pricing-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ws-pricing-overlay';
    document.body.appendChild(overlay);
  }
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  var grouped = {};
  var groupOrder = [];
  _wsProducts.forEach(function(p) {
    var cat = p.tag_en || 'Other';
    if (!grouped[cat]) { grouped[cat] = []; groupOrder.push(cat); }
    grouped[cat].push(p);
  });

  var pricedCount = _wsAccountPricedCount(accountId);
  var totalCount = _wsProducts.length;

  var approvedAccounts = _wsAccounts.filter(function(a) { return a.status === 'approved' && a.id !== accountId; });

  var html = '<div style="background:var(--bg-card);border-radius:16px;padding:28px;max-width:620px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:85vh;overflow-y:auto">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">';
  html += '<div><h3 style="font-size:1.1rem;font-weight:700;color:var(--tx);margin:0">Pricing for ' + businessName + '</h3>';
  html += '<p style="font-size:.82rem;color:' + (pricedCount === totalCount ? '#0a7a0a' : 'var(--red)') + ';margin:4px 0 0;font-weight:600" id="ws-price-progress">' + pricedCount + ' of ' + totalCount + ' products priced</p></div>';
  html += '<button onclick="document.getElementById(\'ws-pricing-overlay\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--tx-muted)">\u2715</button>';
  html += '</div>';

  // --- Copy from / Template controls ---
  html += '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end">';

  // Copy from account
  if (approvedAccounts.length > 0) {
    html += '<div style="flex:1;min-width:160px"><label style="font-size:.7rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Copy prices from</label>';
    html += '<select id="ws-copy-from" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--bd);font-size:.82rem" onchange="window._wsCopyFromAccount(this.value,\'' + accountId + '\')">';
    html += '<option value="">\u2014 Select account \u2014</option>';
    approvedAccounts.forEach(function(a) {
      html += '<option value="' + a.id + '">' + a.business_name + '</option>';
    });
    html += '</select></div>';
  }

  // Load template
  html += '<div style="flex:1;min-width:160px"><label style="font-size:.7rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Load template</label>';
  html += '<select id="ws-load-template" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--bd);font-size:.82rem" onchange="window._wsLoadTemplate(this.value)">';
  html += '<option value="">\u2014 Select template \u2014</option>';
  html += '</select></div>';

  // Save as template button
  html += '<button class="ws-btn ws-btn-pricing" style="padding:6px 12px;font-size:.78rem;white-space:nowrap" onclick="window._wsSaveTemplate()">Save as Template</button>';
  html += '</div>';

  // --- Product pricing grid with category pricing ---
  groupOrder.forEach(function(cat) {
    html += '<div style="font-size:.72rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin-top:16px;padding:6px 0;border-bottom:2px solid rgba(200,16,46,.15);display:flex;justify-content:space-between;align-items:center">';
    html += '<span>' + cat + '</span>';
    html += '<div style="display:flex;gap:6px;align-items:center">';
    html += '<span style="font-size:.65rem;color:var(--tx-faint);font-weight:400">Set all:</span>';
    html += '<input type="number" step="0.01" min="0" placeholder="$" style="width:65px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);font-size:.78rem;text-align:center" data-cat-price="' + cat + '" onchange="window._wsFillCategory(\'' + cat.replace(/'/g, "\\'") + '\',\'price\',this.value)">';
    html += '<input type="number" step="1" min="1" placeholder="Qty" style="width:50px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);font-size:.78rem;text-align:center" data-cat-qty="' + cat + '" onchange="window._wsFillCategory(\'' + cat.replace(/'/g, "\\'") + '\',\'qty\',this.value)">';
    html += '</div></div>';

    html += '<div class="ws-pricing-grid" style="margin-top:6px">';
    html += '<div class="ws-pg-header">Product</div><div class="ws-pg-header">Price</div><div class="ws-pg-header">Min Qty</div>';
    grouped[cat].forEach(function(p) {
      var existing = _wsGetPrice(accountId, p.id) || {};
      var wp = existing.wholesale_price || '';
      var mq = existing.min_qty || '';
      var pName = p.name_en + (p.type ? ' (' + p.type + ')' : '');
      html += '<div class="ws-pg-name">' + pName + '</div>';
      html += '<input type="number" step="0.01" min="0" placeholder="$0.00" value="' + wp + '" data-product-id="' + p.id + '" data-field="wholesale_price" data-cat="' + cat + '">';
      html += '<input type="number" step="1" min="1" placeholder="Min" value="' + mq + '" data-product-id="' + p.id + '" data-field="min_qty" data-cat="' + cat + '">';
    });
    html += '</div>';
  });

  html += '<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">';
  html += '<button class="ws-btn ws-btn-approve" onclick="window._wsSaveAccountPricing(\'' + accountId + '\')">Save Prices</button>';
  html += '<span style="font-size:.78rem;color:var(--tx-faint)" id="ws-acct-pricing-status"></span>';
  html += '</div></div>';

  overlay.innerHTML = html;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  // Load templates into dropdown
  _wsLoadTemplateList();
};

// --- Category fill ---
window._wsFillCategory = function(cat, type, value) {
  var field = type === 'price' ? 'wholesale_price' : 'min_qty';
  var inputs = document.querySelectorAll('#ws-pricing-overlay input[data-cat="' + cat + '"][data-field="' + field + '"]');
  inputs.forEach(function(inp) { inp.value = value; });
};

// --- Copy from account ---
window._wsCopyFromAccount = function(sourceAccountId, targetAccountId) {
  if (!sourceAccountId) return;
  _wsProducts.forEach(function(p) {
    var source = _wsGetPrice(sourceAccountId, p.id);
    if (source) {
      var priceInput = document.querySelector('#ws-pricing-overlay input[data-product-id="' + p.id + '"][data-field="wholesale_price"]');
      var qtyInput = document.querySelector('#ws-pricing-overlay input[data-product-id="' + p.id + '"][data-field="min_qty"]');
      if (priceInput) priceInput.value = source.wholesale_price || '';
      if (qtyInput) qtyInput.value = source.min_qty || '';
    }
  });
  showToast('Prices copied \u2014 review and save', 'success');
};

// --- Templates ---
async function _wsLoadTemplateList() {
  var { data } = await sb.from('wholesale_price_templates').select('id, name').order('name');
  var select = document.getElementById('ws-load-template');
  if (!select || !data) return;
  var options = '<option value="">\u2014 Select template \u2014</option>';
  data.forEach(function(t) {
    options += '<option value="' + t.id + '">' + t.name + '</option>';
  });
  select.innerHTML = options;
}

window._wsLoadTemplate = async function(templateId) {
  if (!templateId) return;
  var { data, error } = await sb.from('wholesale_price_templates').select('*').eq('id', templateId).single();
  if (error || !data) { showToast('Failed to load template', 'error'); return; }
  var prices = data.prices || {};
  _wsProducts.forEach(function(p) {
    var key = p.id;
    var nameKey = p.name_en + '|' + p.tag_en;
    var entry = prices[key] || prices[nameKey] || null;
    if (entry) {
      var priceInput = document.querySelector('#ws-pricing-overlay input[data-product-id="' + p.id + '"][data-field="wholesale_price"]');
      var qtyInput = document.querySelector('#ws-pricing-overlay input[data-product-id="' + p.id + '"][data-field="min_qty"]');
      if (priceInput) priceInput.value = entry.price || '';
      if (qtyInput) qtyInput.value = entry.qty || '';
    }
  });
  showToast('Template "' + data.name + '" loaded \u2014 review and save', 'success');
};

window._wsSaveTemplate = function() {
  _wsConfirm('Save as Template', '<div style="margin-bottom:12px">Save the current prices as a reusable template.</div><input id="ws-template-name" type="text" placeholder="Template name (e.g. Standard Rate)" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem">', 'Save Template', 'ws-btn-approve', async function() {
    var name = document.getElementById('ws-template-name').value.trim();
    if (!name) { showToast('Please enter a template name', 'error'); return; }
    var prices = {};
    var inputs = document.querySelectorAll('#ws-pricing-overlay .ws-pricing-grid input');
    inputs.forEach(function(inp) {
      var pid = inp.dataset.productId;
      if (!pid) return;
      var product = _wsProducts.find(function(p) { return p.id === pid; });
      var nameKey = product ? (product.name_en + '|' + product.tag_en) : pid;
      if (!prices[pid]) prices[pid] = {};
      if (!prices[nameKey]) prices[nameKey] = {};
      if (inp.dataset.field === 'wholesale_price') {
        prices[pid].price = parseFloat(inp.value) || 0;
        prices[nameKey].price = parseFloat(inp.value) || 0;
      }
      if (inp.dataset.field === 'min_qty') {
        prices[pid].qty = parseInt(inp.value) || 1;
        prices[nameKey].qty = parseInt(inp.value) || 1;
      }
    });
    var { error } = await sb.from('wholesale_price_templates').upsert({
      name: name,
      prices: prices,
      updated_at: new Date().toISOString()
    }, { onConflict: 'name' });
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Template "' + name + '" saved!', 'success');
    _wsLoadTemplateList();
  });
};

window._wsSaveAccountPricing = async function(accountId) {
  var statusEl = document.getElementById('ws-acct-pricing-status');
  if (statusEl) statusEl.textContent = 'Saving...';

  var inputs = document.querySelectorAll('#ws-pricing-overlay .ws-pricing-grid input');
  var updates = {};
  inputs.forEach(function(inp) {
    var pid = inp.dataset.productId;
    var field = inp.dataset.field;
    if (!updates[pid]) updates[pid] = { account_id: accountId, b2b_product_id: pid };
    if (field === 'wholesale_price') updates[pid].wholesale_price = parseFloat(inp.value) || 0;
    if (field === 'min_qty') updates[pid].min_qty = parseInt(inp.value) || 1;
  });

  var errors = 0;
  for (var pid of Object.keys(updates)) {
    var row = updates[pid];
    if (!row.wholesale_price || row.wholesale_price <= 0) continue;
    row.updated_at = new Date().toISOString();
    var { error } = await sb.from('wholesale_prices').upsert(row, { onConflict: 'account_id,b2b_product_id' });
    if (error) { console.error('Price save error:', error); errors++; }
  }

  if (errors) {
    showToast(errors + ' prices failed to save', 'error');
  } else {
    showToast('Prices saved for ' + (document.querySelector('#ws-pricing-overlay h3')?.textContent?.replace('Pricing for ', '') || 'account'), 'success');
  }
  if (statusEl) statusEl.textContent = '';
  await loadWholesaleSection();
};

/* ═══════════════════════════════════
   WHOLESALE ORDERS
   ═══════════════════════════════════ */
function _wsRenderOrders() {
  var panel = document.getElementById('ws-panel-orders');
  if (!panel) return;
  if (!_wsOrders.length) {
    panel.innerHTML = '<div class="ws-empty">No wholesale orders yet</div>';
    return;
  }

  var pending = _wsOrders.filter(function(o) { return o.status === 'pending'; });
  var confirmed = _wsOrders.filter(function(o) { return o.status === 'confirmed'; });
  var delivering = _wsOrders.filter(function(o) { return o.status === 'delivering'; });
  var delivered = _wsOrders.filter(function(o) { return o.status === 'delivered'; });
  var cancelled = _wsOrders.filter(function(o) { return o.status === 'cancelled'; });

  var html = '';

  if (pending.length) {
    html += '<h3 style="font-size:.82rem;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin:0 0 12px">Pending Orders (' + pending.length + ')</h3>';
    pending.forEach(function(o) { html += _wsOrderCard(o); });
  }
  if (confirmed.length) {
    html += '<h3 style="font-size:.82rem;color:#0a7a0a;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px">Confirmed (' + confirmed.length + ')</h3>';
    confirmed.forEach(function(o) { html += _wsOrderCard(o); });
  }
  if (delivering.length) {
    html += '<h3 style="font-size:.82rem;color:#1a4a8a;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px">Delivering (' + delivering.length + ')</h3>';
    delivering.forEach(function(o) { html += _wsOrderCard(o); });
  }
  if (delivered.length) {
    html += '<h3 style="font-size:.82rem;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px">Delivered (' + delivered.length + ')</h3>';
    delivered.forEach(function(o) { html += _wsOrderCard(o); });
  }
  if (cancelled.length) {
    html += '<h3 style="font-size:.82rem;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px">Cancelled (' + cancelled.length + ')</h3>';
    cancelled.forEach(function(o) { html += _wsOrderCard(o); });
  }

  panel.innerHTML = html;
}

function _wsOrderCard(o) {
  var bizName = (o.wholesale_accounts && o.wholesale_accounts.business_name) || 'Unknown';
  var date = new Date(o.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  var items = o.items || [];
  var statusColors = { pending: 'color:#c77800;background:rgba(255,165,0,.12)', confirmed: 'color:#0a7a0a;background:rgba(0,160,0,.12)', delivering: 'color:#1a4a8a;background:rgba(0,45,98,.12)', delivered: 'color:#0a7a0a;background:rgba(0,160,0,.12)', cancelled: 'color:var(--red);background:rgba(200,16,46,.1)' };
  var statusStyle = statusColors[o.status] || '';

  var html = '<div class="ws-card" style="cursor:pointer" onclick="window._wsOpenOrderDetail(\'' + o.id + '\')">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center">';
  html += '<div>';
  html += '<div class="ws-card-biz">' + _esc(bizName) + '</div>';
  html += '<div style="font-size:.78rem;color:var(--tx-faint)">' + date + ' · ' + items.length + ' items · $' + parseFloat(o.subtotal || 0).toFixed(2) + '</div>';
  if (o.requested_date) {
    html += '<div style="font-size:.78rem;color:var(--tx-muted)">Delivery: ' + _esc(o.requested_date) + (o.requested_time ? ' (' + _esc(o.requested_time) + ')' : '') + '</div>';
  }
  html += '</div>';
  html += '<span class="ws-card-status" style="' + statusStyle + '">' + _esc(o.status) + '</span>';
  html += '</div></div>';
  return html;
}

window._wsOpenOrderDetail = function(orderId) {
  var o = _wsOrders.find(function(x) { return x.id === orderId; });
  if (!o) return;
  var bizName = (o.wholesale_accounts && o.wholesale_accounts.business_name) || 'Unknown';
  var date = new Date(o.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  var items = o.items || [];

  var overlay = document.getElementById('ws-order-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'ws-order-overlay'; document.body.appendChild(overlay); }
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px';

  var html = '<div style="background:var(--bg-card);border-radius:16px;padding:28px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:85vh;overflow-y:auto">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">';
  html += '<div><h3 style="font-size:1.1rem;font-weight:700;margin:0">' + _esc(bizName) + '</h3>';
  html += '<div style="font-size:.78rem;color:var(--tx-faint)">' + date + '</div></div>';
  html += '<button onclick="document.getElementById(\'ws-order-overlay\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--tx-muted)">✕</button></div>';

  // Items
  html += '<div style="margin-bottom:16px">';
  items.forEach(function(item) {
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd);font-size:.88rem">';
    html += '<span>' + _esc(item.name) + ' × ' + item.qty + '</span>';
    html += '<span style="font-weight:600">$' + parseFloat(item.total || 0).toFixed(2) + '</span></div>';
  });
  html += '<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700;font-size:1rem">';
  html += '<span>Total</span><span>$' + parseFloat(o.subtotal || 0).toFixed(2) + '</span></div></div>';

  // Requested delivery
  if (o.requested_date) {
    html += '<div style="font-size:.85rem;margin-bottom:12px"><strong>Requested delivery:</strong> ' + _esc(o.requested_date) + (o.requested_time ? ' (' + _esc(o.requested_time) + ')' : '') + '</div>';
  }
  if (o.notes) {
    html += '<div style="font-size:.85rem;margin-bottom:12px"><strong>Notes:</strong> ' + _esc(o.notes) + '</div>';
  }

  // Actions based on status
  if (o.status === 'pending') {
    html += '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)">';
    html += '<div style="margin-bottom:12px"><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Confirm Delivery Date</label>';
    html += '<input type="date" id="ws-order-date" value="' + (o.requested_date || '') + '" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem;background:var(--bg-input);color:var(--tx);font-family:inherit;box-sizing:border-box"></div>';
    html += '<div style="margin-bottom:12px"><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Confirm Delivery Time</label>';
    html += '<select id="ws-order-time" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem;background:var(--bg-input);color:var(--tx);font-family:inherit;box-sizing:border-box">';
    html += '<option value="morning"' + (o.requested_time === 'morning' ? ' selected' : '') + '>Morning (6AM - 10AM)</option>';
    html += '<option value="midday"' + (o.requested_time === 'midday' ? ' selected' : '') + '>Midday (10AM - 2PM)</option>';
    html += '<option value="afternoon"' + (o.requested_time === 'afternoon' ? ' selected' : '') + '>Afternoon (2PM - 6PM)</option>';
    html += '<option value="flexible"' + (o.requested_time === 'flexible' ? ' selected' : '') + '>Flexible</option></select></div>';
    html += '<div class="ws-card-actions">';
    html += '<button class="ws-btn ws-btn-approve" onclick="window._wsConfirmOrder(\'' + o.id + '\')">Confirm Order</button>';
    html += '<button class="ws-btn ws-btn-reject" onclick="window._wsCancelOrder(\'' + o.id + '\')">Cancel Order</button>';
    html += '</div></div>';
  } else if (o.status === 'confirmed') {
    if (o.confirmed_date) {
      html += '<div style="font-size:.85rem;margin-bottom:12px;color:#0a7a0a"><strong>Confirmed delivery:</strong> ' + _esc(o.confirmed_date) + (o.confirmed_time ? ' (' + _esc(o.confirmed_time) + ')' : '') + '</div>';
    }
    html += '<div class="ws-card-actions" style="margin-top:16px">';
    html += '<button class="ws-btn ws-btn-approve" onclick="window._wsUpdateOrderStatus(\'' + o.id + '\',\'delivering\')">Mark Delivering</button>';
    html += '<button class="ws-btn ws-btn-reject" onclick="window._wsCancelOrder(\'' + o.id + '\')">Cancel</button>';
    html += '</div>';
  } else if (o.status === 'delivering') {
    html += '<div class="ws-card-actions" style="margin-top:16px">';
    html += '<button class="ws-btn ws-btn-approve" onclick="window._wsUpdateOrderStatus(\'' + o.id + '\',\'delivered\')">Mark Delivered</button>';
    html += '</div>';
  }

  html += '</div>';
  overlay.innerHTML = html;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
};

window._wsConfirmOrder = async function(orderId) {
  var date = document.getElementById('ws-order-date').value;
  var time = document.getElementById('ws-order-time').value;
  if (!date) { showToast('Please set a delivery date', 'error'); return; }
  var { error } = await sb.from('wholesale_orders').update({
    status: 'confirmed', confirmed_date: date, confirmed_time: time,
    confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }).eq('id', orderId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Order confirmed!', 'success');
  document.getElementById('ws-order-overlay').remove();
  await loadWholesaleSection();
  _wsShowTab('orders');
};

window._wsUpdateOrderStatus = async function(orderId, status) {
  var updates = { status: status, updated_at: new Date().toISOString() };
  if (status === 'delivered') updates.delivered_at = new Date().toISOString();
  var { error } = await sb.from('wholesale_orders').update(updates).eq('id', orderId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Order ' + status, 'success');
  document.getElementById('ws-order-overlay').remove();
  await loadWholesaleSection();
  _wsShowTab('orders');
};

window._wsCancelOrder = function(orderId) {
  _wsConfirm('Cancel Order', 'Are you sure you want to cancel this wholesale order?', 'Cancel Order', 'ws-btn-reject', async function() {
    var { error } = await sb.from('wholesale_orders').update({
      status: 'cancelled', updated_at: new Date().toISOString()
    }).eq('id', orderId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Order cancelled', 'success');
    var overlay = document.getElementById('ws-order-overlay');
    if (overlay) overlay.remove();
    await loadWholesaleSection();
    _wsShowTab('orders');
  });
};

/* ── Escape helpers (scoped to avoid conflicts) ── */
function _esc(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _escAttr(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ═══════════════════════════════════
   B2B PRODUCT CATALOG
   ═══════════════════════════════════ */
let _b2bProducts = [];

async function _b2bLoadProducts() {
  var { data, error } = await sb.from('b2b_products').select('*').order('sort_order', { ascending: true });
  if (error) { showToast('Failed to load B2B products', 'error'); return; }
  _b2bProducts = data || [];
  _b2bRenderList();
}

function _b2bRenderList() {
  var list = document.getElementById('b2b-product-list');
  if (!list) return;
  if (!_b2bProducts.length) {
    list.innerHTML = '<div class="ws-empty">No B2B products yet</div>';
    return;
  }

  var grouped = {};
  var groupOrder = [];
  _b2bProducts.forEach(function(p) {
    var cat = p.tag_en || 'Other';
    if (!grouped[cat]) { grouped[cat] = []; groupOrder.push(cat); }
    grouped[cat].push(p);
  });

  var html = '';
  groupOrder.forEach(function(cat) {
    html += '<div style="margin-bottom:20px">';
    html += '<div style="font-size:.75rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px;padding:8px 0;border-bottom:2px solid rgba(200,16,46,.15);margin-bottom:8px">' + cat + '</div>';
    grouped[cat].forEach(function(p) {
      var soldOutClass = p.sold_out ? 'opacity:.5;' : '';
      html += '<div class="ws-card" style="padding:12px 16px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:12px;' + soldOutClass + '">';
      html += '<div style="flex:1;min-width:0">';
      var displayName = p.name_en;
      if (p.variant) displayName += ' — ' + (p.variant === 'inside' ? 'Inside' : p.variant === 'top' ? 'Top' : p.variant);
      html += '<div style="font-weight:600;font-size:.9rem;color:var(--tx)">' + displayName;
      if (p.name_es && p.name_es !== p.name_en) html += ' <span style="font-size:.78rem;color:var(--tx-faint)">/ ' + p.name_es + '</span>';
      html += '</div>';
      if (p.variant) html += '<span style="font-size:.68rem;background:rgba(0,45,98,.08);color:var(--blue,#002D62);padding:1px 6px;border-radius:4px">' + (p.variant === 'inside' ? 'Inside' : 'Top') + '</span> ';
      if (p.sold_out) html += '<span style="font-size:.68rem;background:rgba(200,16,46,.08);color:var(--red);padding:1px 6px;border-radius:4px">Sold Out</span>';
      html += '</div>';
      html += '<div style="display:flex;gap:6px;flex-shrink:0">';
      html += '<button class="ws-btn ws-btn-pricing" style="padding:4px 10px;font-size:.75rem" onclick="window._b2bToggleSoldOut(\'' + p.id + '\',' + !p.sold_out + ')">' + (p.sold_out ? 'Restock' : 'Sold Out') + '</button>';
      html += '<button class="ws-btn ws-btn-pricing" style="padding:4px 10px;font-size:.75rem" onclick="window._b2bEditProduct(\'' + p.id + '\')">' + 'Edit</button>';
      html += '<button class="ws-btn ws-btn-reject" style="padding:4px 10px;font-size:.75rem" onclick="window._b2bDeleteProduct(\'' + p.id + '\')">' + '✕</button>';
      html += '</div></div>';
    });
    html += '</div>';
  });
  list.innerHTML = html;
}

window._b2bToggleSoldOut = async function(id, soldOut) {
  var { error } = await sb.from('b2b_products').update({ sold_out: soldOut, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(soldOut ? 'Marked sold out' : 'Restocked', 'success');
  await _b2bLoadProducts();
};

window._b2bDeleteProduct = function(id) {
  var p = _b2bProducts.find(function(x) { return x.id === id; });
  _wsConfirm('Delete Product', 'Remove <strong>' + (p ? p.name_en : 'this product') + '</strong> from the B2B catalog? This cannot be undone.', 'Delete', 'ws-btn-reject', async function() {
    var { error } = await sb.from('b2b_products').delete().eq('id', id);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Product deleted', 'success');
    await _b2bLoadProducts();
  });
};

window._b2bAddProduct = function() {
  _b2bOpenModal(null);
};

window._b2bEditProduct = function(id) {
  var p = _b2bProducts.find(function(x) { return x.id === id; });
  if (p) _b2bOpenModal(p);
};

function _b2bOpenModal(product) {
  var isEdit = !!product;
  var overlay = document.getElementById('b2b-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'b2b-modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px';

  var cats = [];
  _b2bProducts.forEach(function(p) { if (cats.indexOf(p.tag_en) === -1 && p.tag_en) cats.push(p.tag_en); });
  var catOptions = cats.map(function(c) { return '<option value="' + c + '"' + (product && product.tag_en === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');

  overlay.innerHTML = '<div style="background:var(--bg-card);border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:85vh;overflow-y:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
      '<h3 style="font-size:1.1rem;font-weight:700;color:var(--tx);margin:0">' + (isEdit ? 'Edit Product' : 'Add B2B Product') + '</h3>' +
      '<button onclick="document.getElementById(\'b2b-modal-overlay\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--tx-muted)">✕</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Name (English) *</label>' +
        '<input id="b2b-f-en" type="text" value="' + (product ? product.name_en : '') + '" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem" placeholder="e.g. Tres Leche"></div>' +
      '<div><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Name (Spanish)</label>' +
        '<input id="b2b-f-es" type="text" value="' + (product ? (product.name_es || '') : '') + '" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem" placeholder="e.g. Tres Leche"></div>' +
      '<div><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Category *</label>' +
        '<select id="b2b-f-cat" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem">' +
          '<option value="">Select category...</option>' + catOptions +
          '<option value="__new">+ New Category</option>' +
        '</select></div>' +
      '<div id="b2b-new-cat-wrap" style="display:none"><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">New Category (EN / ES)</label>' +
        '<div style="display:flex;gap:8px"><input id="b2b-f-cat-en" type="text" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem" placeholder="English">' +
        '<input id="b2b-f-cat-es" type="text" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem" placeholder="Spanish"></div></div>' +
      '<div><label style="font-size:.75rem;font-weight:600;color:var(--tx-faint);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Type</label>' +
        '<select id="b2b-f-type" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);font-size:.9rem">' +
          '<option value="standard"' + (product && product.type === 'standard' ? ' selected' : '') + '>Standard</option>' +
          '<option value="redondo"' + (product && product.type === 'redondo' ? ' selected' : '') + '>Round (Inside/Top)</option>' +
        '</select></div>' +
      '<div style="display:flex;gap:12px;margin-top:8px">' +
        '<button class="ws-btn ws-btn-reject" style="flex:1" onclick="document.getElementById(\'b2b-modal-overlay\').remove()">Cancel</button>' +
        '<button class="ws-btn ws-btn-approve" style="flex:1" id="b2b-save-btn">' + (isEdit ? 'Update' : 'Add Product') + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  document.getElementById('b2b-f-cat').addEventListener('change', function() {
    document.getElementById('b2b-new-cat-wrap').style.display = this.value === '__new' ? 'block' : 'none';
  });

  document.getElementById('b2b-save-btn').addEventListener('click', async function() {
    var nameEn = document.getElementById('b2b-f-en').value.trim();
    var nameEs = document.getElementById('b2b-f-es').value.trim();
    var catSelect = document.getElementById('b2b-f-cat').value;
    var type = document.getElementById('b2b-f-type').value;

    var tagEn, tagEs;
    if (catSelect === '__new') {
      tagEn = document.getElementById('b2b-f-cat-en').value.trim();
      tagEs = document.getElementById('b2b-f-cat-es').value.trim() || tagEn;
    } else {
      tagEn = catSelect;
      var existing = _b2bProducts.find(function(p) { return p.tag_en === catSelect; });
      tagEs = existing ? (existing.tag_es || tagEn) : tagEn;
    }

    if (!nameEn || !tagEn) { showToast('Name and category are required', 'error'); return; }

    var payload = {
      name_en: nameEn, name_es: nameEs || nameEn,
      tag_en: tagEn, tag_es: tagEs,
      type: type,
      updated_at: new Date().toISOString()
    };

    var error;
    if (isEdit) {
      ({ error } = await sb.from('b2b_products').update(payload).eq('id', product.id));
    } else {
      payload.sort_order = 999;
      ({ error } = await sb.from('b2b_products').insert(payload));
    }

    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast(isEdit ? 'Product updated' : 'Product added', 'success');
    document.getElementById('b2b-modal-overlay').remove();
    await _b2bLoadProducts();
  });

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

/* ═══════════════════════════════════
   ADMIN NEW ORDER
   Mirrors the driver-side "New Order" tab exactly.
   Admin selects a driver → their prices are loaded →
   products are shown → order is submitted as if the
   driver placed it themselves (status: 'pending', payment: 'not_paid').
   ═══════════════════════════════════ */

let adminNoOrders = [];
let adminNoActiveOrderIdx = 0;
let adminNoProducts = {};
let adminNoSelectedDriverId = null;
let adminNoDriverPriceMap = {};
let adminNoSummaryIdx = 0;
let adminNoProductsLoaded = false;

function _noL(obj) { return obj[lang] || obj.en; }

function _noGetTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _noCreateBlankOrder() {
  const qty = {};
  Object.values(adminNoProducts).forEach(sec => {
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        ['inside','top','inside_nt','top_nt'].forEach(c => { qty[item.key + '_' + c] = 0; });
      } else {
        qty[item.key] = 0;
        qty[item.key + '_nt'] = 0;
      }
    });
  });
  return { business: '', date: _noGetTodayStr(), time: '', ref: '', notes: '', qty };
}

async function _noLoadProducts() {
  if (adminNoProductsLoaded) return;

  // Use the canonical hardcoded catalog — keys match driver_prices exactly
  adminNoProducts = {
    redondo: {
      en: 'Round', es: 'Redondo', type: 'redondo',
      items: [
        { key: 'pina', en: 'Piña', es: 'Piña', cols: ['inside','inside_nt','top','top_nt'] },
        { key: 'guava', en: 'Guava', es: 'Guayaba', cols: ['inside','inside_nt','top','top_nt'] },
        { key: 'dulce', en: 'Dulce De Leche', es: 'Dulce De Leche', cols: ['inside','inside_nt'] },
      ]
    },
    plain: {
      en: 'Plain', es: 'Plain', type: 'standard',
      items: [
        { key: 'plain', en: 'Plain', es: 'Plain' },
        { key: 'raisin', en: 'Raisin', es: 'Pasas' },
        { key: 'pudin', en: 'Pudin', es: 'Pudín' },
      ]
    },
    tresleche: {
      en: 'Tres Leche', es: 'Tres Leche', type: 'standard',
      items: [
        { key: 'tl', en: 'Tres Leche', es: 'Tres Leche' },
        { key: 'tl_hershey', en: 'Tres Leche Hershey', es: 'Tres Leche Hershey' },
        { key: 'cuatro_leche', en: 'Cuatro Leche', es: 'Cuatro Leche' },
        { key: 'tl_straw', en: 'Tres Leche Strawberry', es: 'Tres Leche Fresa' },
        { key: 'tl_pina', en: 'Tres Leche Piña', es: 'Tres Leche Piña' },
      ]
    },
    piezas: {
      en: 'Pieces', es: 'Piezas', type: 'standard',
      items: [
        { key: 'pz_rv', en: 'Red Velvet', es: 'Red Velvet' },
        { key: 'pz_carrot', en: 'Carrot Cake', es: 'Zanahoria' },
        { key: 'pz_cheese', en: 'Cheesecake', es: 'Cheesecake' },
        { key: 'pz_pudin', en: 'Pudin', es: 'Pudin' },
        { key: 'pz_pina', en: 'Piña', es: 'Piña' },
        { key: 'pz_guava', en: 'Guava', es: 'Guayaba' },
        { key: 'pz_chocoflan', en: 'Chocoflan', es: 'Chocoflan' },
        { key: 'pz_flan', en: 'Flan', es: 'Flan' },
      ]
    },
    frostin: {
      en: 'Frosted Pieces', es: 'Piezas Frostin', type: 'standard',
      items: [
        { key: 'fr_guava', en: 'Guava', es: 'Guayaba' },
        { key: 'fr_pina', en: 'Piña', es: 'Piña' },
        { key: 'fr_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
        { key: 'fr_choco', en: 'Chocolate', es: 'Chocolate' },
      ]
    },
    hb_big: {
      en: 'Happy Birthday — BIG', es: 'Feliz Cumpleaños — GRANDE', type: 'standard',
      items: [
        { key: 'hb_b_pina', en: 'Piña', es: 'Piña' },
        { key: 'hb_b_guava', en: 'Guava', es: 'Guayaba' },
        { key: 'hb_b_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
        { key: 'hb_b_choco', en: 'Chocolate', es: 'Chocolate' },
        { key: 'hb_b_straw', en: 'Strawberry', es: 'Fresa' },
      ]
    },
    hb_small: {
      en: 'Happy Birthday — SMALL', es: 'Feliz Cumpleaños — PEQUEÑO', type: 'standard',
      items: [
        { key: 'hb_s_pina', en: 'Piña', es: 'Piña' },
        { key: 'hb_s_guava', en: 'Guava', es: 'Guayaba' },
        { key: 'hb_s_dulce', en: 'Dulce De Leche', es: 'Dulce De Leche' },
        { key: 'hb_s_choco', en: 'Chocolate', es: 'Chocolate' },
        { key: 'hb_s_straw', en: 'Strawberry', es: 'Fresa' },
      ]
    },
    cuadrao: {
      en: 'Square', es: 'Cuadrao', type: 'standard',
      items: [
        { key: 'cdr_pudin', en: 'Pudin', es: 'Pudin' },
        { key: 'cdr_pound', en: 'Pound', es: 'Pound' },
        { key: 'cdr_raisin', en: 'Raisin', es: 'Pasas' },
        { key: 'cdr_maiz', en: 'Maiz', es: 'Maiz' },
      ]
    },
    basos: {
      en: 'Cups', es: 'Basos', type: 'standard',
      items: [
        { key: 'bas_tl', en: 'Tres Leche', es: 'Tres Leche' },
        { key: 'bas_cl', en: 'Cuatro Leche', es: 'Cuatro Leche' },
        { key: 'bas_hershey', en: 'Hershey', es: 'Hershey' },
      ]
    },
    familiar: {
      en: 'Family Size', es: 'Familiar', type: 'standard',
      items: [
        { key: 'fam_tl', en: 'Tres Leche', es: 'Tres Leche' },
        { key: 'fam_cl', en: 'Cuatro Leche', es: 'Cuatro Leche' },
      ]
    },
  };
  adminNoProductsLoaded = true;
}

async function _noLoadDriverPrices(driverId) {
  try {
    const { data } = await sb.from('driver_prices').select('product_key, price').eq('driver_id', driverId);
    adminNoDriverPriceMap = {};
    if (data) data.forEach(p => adminNoDriverPriceMap[p.product_key] = parseFloat(p.price));
  } catch(e) { console.warn('Admin New Order: prices load failed', e); }
}

async function initAdminOrderForm() {
  // Force a fresh load so deduplication always applies
  adminNoProductsLoaded = false;
  adminNoProducts = {};
  await _noLoadProducts();

  // Populate driver dropdown
  if (driversCache.length === 0) await loadDriversCache();
  const select = document.getElementById('no-driver-select');
  if (!select) return;

  select.innerHTML = '<option value="">— Select Driver —</option>';
  driversCache.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    select.appendChild(opt);
  });

  // Restore previously selected driver if switching back to tab
  if (adminNoSelectedDriverId) {
    select.value = adminNoSelectedDriverId;
    _noShowFormContainer();
  }

  select.onchange = async () => {
    adminNoSelectedDriverId = select.value || null;
    if (adminNoSelectedDriverId) {
      await _noLoadDriverPrices(adminNoSelectedDriverId);
      // Reset orders when changing driver
      adminNoOrders = [_noCreateBlankOrder()];
      adminNoActiveOrderIdx = 0;
      _noShowFormContainer();
    } else {
      document.getElementById('no-order-container').style.display = 'none';
      document.getElementById('form-footer').style.display = 'none';
    }
  };
}

function _noShowFormContainer() {
  if (adminNoOrders.length === 0) adminNoOrders = [_noCreateBlankOrder()];
  document.getElementById('no-order-container').style.display = 'block';
  _noRenderOrderTabs();
  _noBuildProductSections();
  _noLoadOrderToForm(adminNoActiveOrderIdx);
  document.getElementById('form-footer').style.display = 'flex';
  _noUpdateFooterCount();
}

/* ── TABS ── */
function _noRenderOrderTabs() {
  const container = document.getElementById('order-tabs');
  if (!container) return;
  let html = '';
  adminNoOrders.forEach((_, i) => {
    html += `<button class="order-tab${i === adminNoActiveOrderIdx ? ' active' : ''}" data-idx="${i}">Order ${i + 1}`;
    if (adminNoOrders.length > 1) html += `<span class="order-tab-delete" data-delidx="${i}" title="Remove">✕</span>`;
    html += `</button>`;
  });
  html += `<button class="order-tab-add" id="no-add-order-btn">+</button>`;
  container.innerHTML = html;

  container.querySelectorAll('.order-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('order-tab-delete')) return;
      _noSwitchOrder(parseInt(btn.dataset.idx));
    });
  });
  container.querySelectorAll('.order-tab-delete').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); _noRemoveOrder(parseInt(btn.dataset.delidx)); });
  });
  const addBtn = document.getElementById('no-add-order-btn');
  if (addBtn) addBtn.addEventListener('click', _noAddOrder);
}

function _noSwitchOrder(idx) {
  _noSaveFormToOrder(adminNoActiveOrderIdx);
  adminNoActiveOrderIdx = idx;
  _noRenderOrderTabs();
  _noLoadOrderToForm(idx);
  _noUpdateFooterCount();
}

function _noAddOrder() {
  _noSaveFormToOrder(adminNoActiveOrderIdx);
  adminNoOrders.push(_noCreateBlankOrder());
  adminNoActiveOrderIdx = adminNoOrders.length - 1;
  _noRenderOrderTabs();
  _noLoadOrderToForm(adminNoActiveOrderIdx);
  _noUpdateFooterCount();
}

function _noRemoveOrder(idx) {
  if (adminNoOrders.length <= 1) return;
  adminNoOrders.splice(idx, 1);
  if (adminNoActiveOrderIdx >= adminNoOrders.length) adminNoActiveOrderIdx = adminNoOrders.length - 1;
  else if (adminNoActiveOrderIdx > idx) adminNoActiveOrderIdx--;
  _noRenderOrderTabs();
  _noLoadOrderToForm(adminNoActiveOrderIdx);
  _noUpdateFooterCount();
}

/* ── FORM SYNC ── */
function _noSaveFormToOrder(idx) {
  const o = adminNoOrders[idx];
  if (!o) return;
  o.business = (document.getElementById('field-business') || {}).value || '';
  o.date = (document.getElementById('field-date') || {}).value || '';
  o.time = (document.getElementById('field-time') || {}).value || '';
  o.ref = (document.getElementById('field-ref') || {}).value || '';
  const section = document.getElementById('section-new-order');
  if (section) {
    section.querySelectorAll('.qty-input').forEach(inp => {
      o.qty[inp.dataset.key] = parseInt(inp.value) || 0;
    });
  }
}

function _noUpdateTimeDisplay(val) {
  const textEl = document.getElementById('field-time-text');
  if (!textEl) return;
  if (val) {
    let [h, m] = val.split(':');
    let period = 'AM';
    h = parseInt(h);
    if (h >= 12) { period = 'PM'; if (h > 12) h -= 12; }
    if (h === 0) h = 12;
    textEl.textContent = `${h}:${m || '00'} ${period}`;
    textEl.style.color = 'var(--tx)';
  } else {
    textEl.textContent = 'Select time';
    textEl.style.color = 'var(--tx-faint)';
  }
}

function _noLoadOrderToForm(idx) {
  const o = adminNoOrders[idx];
  if (!o) return;
  const bEl = document.getElementById('field-business');
  const dEl = document.getElementById('field-date');
  const tEl = document.getElementById('field-time');
  const rEl = document.getElementById('field-ref');
  if (bEl) bEl.value = o.business;
  if (dEl) dEl.value = o.date;
  if (tEl) tEl.value = o.time;
  if (rEl) rEl.value = o.ref;
  _noUpdateTimeDisplay(o.time);

  const section = document.getElementById('section-new-order');
  if (section) section.querySelectorAll('.qty-input').forEach(inp => {
    inp.value = o.qty[inp.dataset.key] || 0;
    _noUpdateRowHighlight(inp);
  });
}

function _noUpdateRowHighlight(inp) {
  const row = inp.closest('.prod-row');
  if (!row) return;
  const hasVal = Array.from(row.querySelectorAll('.qty-input')).some(i => parseInt(i.value) > 0);
  row.classList.toggle('has-value', hasVal);
}

function _noUpdateFooterCount() {
  let total = 0;
  const section = document.getElementById('section-new-order');
  if (section) section.querySelectorAll('.qty-input').forEach(inp => { total += parseInt(inp.value) || 0; });
  const countEl = document.getElementById('footer-item-count');
  const contBtn = document.getElementById('footer-continue-btn');
  if (countEl) countEl.textContent = total;
  if (contBtn) contBtn.disabled = total === 0;
}

function _noQtyControl(key) {
  return `<div class="qty-wrap"><button class="qty-btn" data-dir="-">−</button><input type="number" class="qty-input" data-key="${key}" value="0" min="0"><button class="qty-btn" data-dir="+">+</button></div>`;
}

function _noBuildProductSections() {
  const container = document.getElementById('product-sections');
  if (!container) return;
  let html = '';

  Object.entries(adminNoProducts).forEach(([secKey, sec]) => {
    if (sec.items.length === 0) return;
    html += `<div class="acc-section" id="no-sec-${secKey}">`;
    html += `<div class="acc-header"><span class="acc-title">${_noL(sec)}</span><svg class="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>`;
    html += `<div class="acc-body"><div class="prod-table">`;

    if (sec.type === 'redondo') {
      sec.items.forEach(item => {
        const insideLabel = `${_noL(item)} — Inside`;
        html += `<div class="prod-row"><span class="prod-name">${insideLabel}</span>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">Qty</span>${_noQtyControl(item.key + '_inside')}</div>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">No Tkt</span>${_noQtyControl(item.key + '_inside_nt')}</div></div>`;
        const topLabel = `${_noL(item)} — Top`;
        html += `<div class="prod-row"><span class="prod-name">${topLabel}</span>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">Qty</span>${_noQtyControl(item.key + '_top')}</div>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">No Tkt</span>${_noQtyControl(item.key + '_top_nt')}</div></div>`;
      });
    } else {
      sec.items.forEach(item => {
        html += `<div class="prod-row"><span class="prod-name">${_noL(item)}</span>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">Qty</span>${_noQtyControl(item.key)}</div>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">No Tkt</span>${_noQtyControl(item.key + '_nt')}</div></div>`;
      });
    }
    html += `</div></div></div>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.acc-header').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('.acc-section').classList.toggle('open'));
  });
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = btn.parentElement.querySelector('.qty-input');
      const cur = parseInt(inp.value) || 0;
      inp.value = Math.max(0, cur + (btn.dataset.dir === '+' ? 1 : -1));
      _noUpdateRowHighlight(inp);
      _noUpdateFooterCount();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    });
  });
  container.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; });
    inp.addEventListener('blur', () => {
      if (inp.value === '') inp.value = '0';
      _noUpdateRowHighlight(inp);
      _noUpdateFooterCount();
    });
  });
}

function _noHandleSearch() {
  const q = (document.getElementById('product-search') || {}).value?.toLowerCase().trim() || '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  const section = document.getElementById('section-new-order');
  if (!section) return;
  section.querySelectorAll('.acc-section').forEach(sec => {
    let hasMatch = false;
    sec.querySelectorAll('.prod-row').forEach(row => {
      const name = row.querySelector('.prod-name')?.textContent.toLowerCase() || '';
      const match = !q || name.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) hasMatch = true;
    });
    sec.style.display = hasMatch ? '' : 'none';
    if (q && hasMatch) sec.classList.add('open');
  });
}

/* ── SUMMARY ── */
function _noOpenSummary() {
  _noSaveFormToOrder(adminNoActiveOrderIdx);
  adminNoSummaryIdx = 0;
  _noRenderSummaryOrder(0);
  const overlay = document.getElementById('summary-overlay');
  if (overlay) overlay.classList.add('open');
}

function _noCloseSummary() {
  const overlay = document.getElementById('summary-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _noNavigateSummary(dir) {
  const notesEl = document.getElementById('summary-notes');
  if (notesEl) adminNoOrders[adminNoSummaryIdx].notes = notesEl.value;
  adminNoSummaryIdx = Math.max(0, Math.min(adminNoOrders.length - 1, adminNoSummaryIdx + dir));
  _noRenderSummaryOrder(adminNoSummaryIdx);
}

function _noRenderSummaryOrder(idx) {
  const o = adminNoOrders[idx];
  const titleEl = document.getElementById('summary-title');
  if (titleEl) titleEl.textContent = `Order ${idx+1} of ${adminNoOrders.length}`;
  const prevBtn = document.getElementById('summary-prev');
  const nextBtn = document.getElementById('summary-next');
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.disabled = idx === adminNoOrders.length - 1;

  let html = '';
  if (o.business || o.date || o.time || o.ref) {
    html += '<div class="summary-meta">';
    if (o.business) html += `<div><strong>Business:</strong> ${o.business}</div>`;
    if (o.date) html += `<div><strong>Date:</strong> ${o.date}</div>`;
    if (o.time) html += `<div><strong>Time:</strong> ${o.time}</div>`;
    if (o.ref) html += `<div><strong>Ref:</strong> ${o.ref}</div>`;
    html += '</div>';
  }

  let grandTotal = 0;
  let hasAnyPrice = false;
  Object.entries(adminNoProducts).forEach(([, sec]) => {
    const items = [];
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        ['inside','top','inside_nt','top_nt'].forEach(col => {
          const k = item.key + '_' + col;
          const v = o.qty[k] || 0;
          if (v > 0) {
            const colClean = col.replace('_nt','').replace('inside','Inside').replace('top','Top');
            const isNT = col.includes('nt');
            items.push({ name: `${_noL(item)} (${colClean})`, qty: v, nt: isNT, key: k, price: adminNoDriverPriceMap[k] });
          }
        });
      } else {
        const v = o.qty[item.key] || 0;
        const vnt = o.qty[item.key + '_nt'] || 0;
        if (v > 0) items.push({ name: _noL(item), qty: v, nt: false, key: item.key, price: adminNoDriverPriceMap[item.key] });
        if (vnt > 0) items.push({ name: _noL(item), qty: vnt, nt: true, key: item.key + '_nt', price: adminNoDriverPriceMap[item.key + '_nt'] });
      }
    });
    if (items.length > 0) {
      html += `<div class="summary-section"><div class="summary-section-title">${_noL(sec)}</div>`;
      items.forEach(it => {
        const hasPrice = it.price != null && it.price > 0;
        if (hasPrice) hasAnyPrice = true;
        const priceStr = hasPrice ? `$${it.price.toFixed(2)}` : '—';
        const lineTotal = hasPrice ? it.qty * it.price : 0;
        if (hasPrice) grandTotal += lineTotal;
        html += `<div class="summary-item">
          <span class="summary-item-name">${it.name}${it.nt ? '<span class="no-ticket-tag">No Ticket</span>' : ''}</span>
          <span class="summary-item-price-col">
            <span class="summary-item-qty">×${it.qty}</span>
            <span class="summary-item-unit">${priceStr}</span>
            <span class="summary-item-line">${hasPrice ? '$' + lineTotal.toFixed(2) : ''}</span>
          </span>
        </div>`;
      });
      html += '</div>';
    }
  });

  if (hasAnyPrice) html += `<div class="summary-total"><span>Total</span><span>$${grandTotal.toFixed(2)}</span></div>`;
  if (!html) html = `<div class="empty-state">No items</div>`;

  const contentEl = document.getElementById('summary-content');
  if (contentEl) contentEl.innerHTML = html;
  const notesEl = document.getElementById('summary-notes');
  if (notesEl) notesEl.value = o.notes || '';
}

/* ── SUBMIT ── */
async function _noSubmitAllOrders() {
  const notesEl = document.getElementById('summary-notes');
  if (notesEl) adminNoOrders[adminNoSummaryIdx].notes = notesEl.value;

  const submitBtn = document.getElementById('summary-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

  try {
    const batchId = crypto.randomUUID();
    const editableUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    for (let i = 0; i < adminNoOrders.length; i++) {
      const o = adminNoOrders[i];
      const items = [];

      Object.entries(adminNoProducts).forEach(([, sec]) => {
        sec.items.forEach(item => {
          if (sec.type === 'redondo') {
            ['inside','top','inside_nt','top_nt'].forEach(col => {
              const k = item.key + '_' + col;
              const v = o.qty[k] || 0;
              if (v > 0) {
                const ntTag = col.endsWith('_nt') ? ' (No Ticket)' : '';
                const colClean = col.replace('_nt','');
                items.push({ product_key: k, product_label: `${item.en} (${colClean})${ntTag}`, quantity: v });
              }
            });
          } else {
            const v = o.qty[item.key] || 0;
            const vnt = o.qty[item.key + '_nt'] || 0;
            if (v > 0) items.push({ product_key: item.key, product_label: item.en, quantity: v });
            if (vnt > 0) items.push({ product_key: item.key + '_nt', product_label: item.en + ' (No Ticket)', quantity: vnt });
          }
        });
      });

      if (items.length === 0) continue;

      const orderPayload = {
        driver_id: adminNoSelectedDriverId,
        batch_id: batchId,
        business_name: o.business || null,
        pickup_date: o.date || null,
        pickup_time: o.time || null,
        driver_ref: o.ref || null,
        notes: o.notes || null,
        status: 'pending',
        payment_status: 'not_paid',
        editable_until: editableUntil,
      };

      let { data: orderData, error: orderErr } = await sb.from('driver_orders').insert(orderPayload).select('id').single();
      if (orderErr) {
        // Retry without batch_id in case column doesn't exist yet
        delete orderPayload.batch_id;
        const res = await sb.from('driver_orders').insert(orderPayload).select('id').single();
        orderData = res.data; orderErr = res.error;
      }
      if (orderErr) throw orderErr;

      const orderItems = items.map(it => ({
        order_id: orderData.id,
        product_key: it.product_key,
        product_label: it.product_label,
        quantity: it.quantity,
        price_at_order: adminNoDriverPriceMap[it.product_key] || 0,
      }));

      await sb.from('driver_order_items').insert(orderItems);
      const orderTotal = orderItems.reduce((sum, it) => sum + it.quantity * it.price_at_order, 0);
      await sb.from('driver_orders').update({ total_amount: orderTotal }).eq('id', orderData.id);
    }

    _noCloseSummary();
    showToast('Order submitted successfully!', 'success');

    // Reset state
    adminNoOrders = [];
    adminNoActiveOrderIdx = 0;
    adminNoSelectedDriverId = null;
    adminNoDriverPriceMap = {};
    const driverSelect = document.getElementById('no-driver-select');
    if (driverSelect) driverSelect.value = '';
    document.getElementById('no-order-container').style.display = 'none';
    document.getElementById('form-footer').style.display = 'none';

    // Navigate to Driver Orders so admin can see the new order
    showSection('incoming');

  } catch (err) {
    console.error('Admin New Order submit error:', err);
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (submitBtn) { submitBtn.textContent = 'Submit Order'; submitBtn.disabled = false; }
  }
}

/* ── TIME PICKER (Admin New Order) ── */
let _noTpCallback = null;

function _noInitTimePicker(initialVal, cb) {
  _noTpCallback = cb;
  const overlay = document.getElementById('tp-overlay');
  if (!overlay) return;

  let currentH = 5, currentM = 30, currentP = 'AM';
  if (initialVal) {
    let [hStr, mStr] = initialVal.split(':');
    let h = parseInt(hStr), m = parseInt(mStr) || 0;
    currentP = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    currentH = h; currentM = m;
  }

  const buildCol = (innerId, values, activeVal) => {
    const inner = document.getElementById(innerId);
    if (!inner) return;
    inner.innerHTML = '';
    values.forEach(v => {
      const div = document.createElement('div');
      div.className = 'tp-item' + (v === activeVal ? ' active' : '');
      div.textContent = typeof v === 'number' && innerId !== 'tp-period-inner' ? String(v).padStart(2, '0') : v;
      inner.appendChild(div);
      div.addEventListener('click', () => {
        inner.querySelectorAll('.tp-item').forEach(i => i.classList.remove('active'));
        div.classList.add('active');
      });
    });
    // Scroll to active
    setTimeout(() => {
      const active = inner.querySelector('.active');
      if (active) inner.scrollTop = active.offsetTop - inner.parentElement.offsetHeight / 2 + 20;
    }, 10);
  };

  buildCol('tp-hour-inner', [12,1,2,3,4,5,6,7,8,9,10,11], currentH);
  buildCol('tp-minute-inner', [0,15,30,45], currentM);
  buildCol('tp-period-inner', ['AM','PM'], currentP);

  overlay.classList.add('open');

  const cancelBtn = document.getElementById('tp-cancel');
  const confirmBtn = document.getElementById('tp-confirm');
  if (cancelBtn) cancelBtn.onclick = () => overlay.classList.remove('open');
  if (confirmBtn) confirmBtn.onclick = () => {
    const hActive = document.getElementById('tp-hour-inner')?.querySelector('.active');
    const mActive = document.getElementById('tp-minute-inner')?.querySelector('.active');
    const pActive = document.getElementById('tp-period-inner')?.querySelector('.active');
    if (!hActive || !mActive || !pActive) { overlay.classList.remove('open'); return; }
    let h = parseInt(hActive.textContent);
    const mVal = mActive.textContent;
    const pStr = pActive.textContent;
    if (pStr === 'PM' && h !== 12) h += 12;
    if (pStr === 'AM' && h === 12) h = 0;
    const val = String(h).padStart(2,'0') + ':' + mVal;
    const disp = hActive.textContent + ':' + mVal + ' ' + pStr;
    overlay.classList.remove('open');
    if (_noTpCallback) _noTpCallback(val, disp);
  };
}

/* ── WIRE UP STATIC EVENT LISTENERS ON DOM  ── */
(function _noBindStaticListeners() {
  function doWire() {
    const timeDisplay = document.getElementById('field-time-display');
    if (timeDisplay) {
      timeDisplay.addEventListener('click', () => {
        const currentVal = (document.getElementById('field-time') || {}).value || '';
        _noInitTimePicker(currentVal, (val, disp) => {
          const tEl = document.getElementById('field-time');
          const textEl = document.getElementById('field-time-text');
          if (tEl) tEl.value = val;
          if (textEl) { textEl.textContent = disp; textEl.style.color = 'var(--tx)'; }
        });
      });
    }

    const contBtn = document.getElementById('footer-continue-btn');
    if (contBtn && !contBtn._noBound) {
      contBtn._noBound = true;
      contBtn.addEventListener('click', _noOpenSummary);
    }

    const sumPrev = document.getElementById('summary-prev');
    if (sumPrev && !sumPrev._noBound) {
      sumPrev._noBound = true;
      sumPrev.addEventListener('click', () => _noNavigateSummary(-1));
    }
    const sumNext = document.getElementById('summary-next');
    if (sumNext && !sumNext._noBound) {
      sumNext._noBound = true;
      sumNext.addEventListener('click', () => _noNavigateSummary(1));
    }
    const sumBack = document.getElementById('summary-back');
    if (sumBack && !sumBack._noBound) {
      sumBack._noBound = true;
      sumBack.addEventListener('click', _noCloseSummary);
    }
    const sumSubmit = document.getElementById('summary-submit');
    if (sumSubmit && !sumSubmit._noBound) {
      sumSubmit._noBound = true;
      sumSubmit.addEventListener('click', _noSubmitAllOrders);
    }

    const searchEl = document.getElementById('product-search');
    if (searchEl && !searchEl._noBound) {
      searchEl._noBound = true;
      searchEl.addEventListener('input', _noHandleSearch);
    }
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn && !clearBtn._noBound) {
      clearBtn._noBound = true;
      clearBtn.addEventListener('click', () => {
        const s = document.getElementById('product-search');
        if (s) s.value = '';
        _noHandleSearch();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doWire);
  } else {
    doWire();
  }
})();
