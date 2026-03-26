/* ═══════════════════════════════════
   SUPABASE INIT
   ═══════════════════════════════════ */
const SUPABASE_URL = 'https://dykztphptnytbihpavpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w';
const VAPID_PUBLIC_KEY = 'BPK9nQfqIXaf-kc5HHJ5G6trkWxjAX9MzeYwLTUfcnk4jWVYVO6gpzXS-d0tNgGTmHp0ntzYe3xRKT0Ud3t5a3Q';

let sb = null;
try {
  const supabaseLib = window.supabase;
  if (supabaseLib && supabaseLib.createClient) {
    sb = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Admin: Supabase client initialized');
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

/* ═══════════════════════════════════
   SCREEN MANAGEMENT
   ═══════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

function showSection(name) {
  currentSection = name;
  sessionStorage.setItem('admin_section', name);
  // Close mobile nav
  document.getElementById('mobile-nav').classList.remove('open');
  document.getElementById('mobile-menu-btn').classList.remove('open');

  // Hide all sections, show target
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = 'block';

  // Update nav active states
  document.querySelectorAll('.sidebar-nav-item, .mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });

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

  // Load section data
  if (name === 'overview') loadOverview();
  if (name === 'incoming') loadIncomingOrders();
  if (name === 'history') loadHistoryOrders(true);
  if (name === 'drivers') {
    const subview = sessionStorage.getItem('driver_subview');
    if (subview === 'form') {
      _restoreDriverForm().then(restored => { if (!restored) { showDriversListView(); loadDriverList(); } });
    } else {
      showDriversListView(); loadDriverList();
    }
  }
  if (name === 'settings') loadActiveInvites();
}

/* ═══════════════════════════════════
   AUTH — LOGIN
   ═══════════════════════════════════ */
async function handleLogin() {
  const emailInput = document.getElementById('admin-email');
  const passInput = document.getElementById('admin-password');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  const email = emailInput.value.trim();
  const password = passInput.value;

  if (!email || !password) {
    errorEl.textContent = lang === 'es' ? 'Ingresa email y contraseña' : 'Enter email and password';
    return;
  }

  btn.disabled = true;
  errorEl.textContent = '';

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = lang === 'es' ? 'Credenciales incorrectas' : 'Invalid credentials';
      btn.disabled = false;
      return;
    }

    currentUser = data.user;

    // Save email if Remember Me is checked
    const remember = document.getElementById('remember-me-check');
    if (remember && remember.checked) {
      localStorage.setItem('cecilia_admin_email', email);
    } else {
      localStorage.removeItem('cecilia_admin_email');
    }

    // Check role — user_metadata or app_metadata
    const role = currentUser.user_metadata?.role || currentUser.app_metadata?.role || '';
    if (role !== 'admin' && role !== 'staff') {
      console.warn('User role not set to admin/staff. Role:', role);
    }

    enterDashboard();
  } catch (e) {
    errorEl.textContent = lang === 'es' ? 'Error de conexión' : 'Connection error';
    console.error('Login error:', e);
  }
  btn.disabled = false;
}

async function checkSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      enterDashboard();
      return true;
    }
  } catch (e) { console.error('Session check error:', e); }
  return false;
}

function enterDashboard() {
  applyLang();
  showScreen('dashboard');
  const savedSection = sessionStorage.getItem('admin_section') || 'overview';
  showSection(savedSection);
  loadDriversCache();
  setupRealtime();
  requestNotifPermission();
  subscribeToPush('admin', currentUser.id);
  lucide.createIcons();

  // Show admin email in settings
  const adminInfo = document.getElementById('admin-info');
  if (adminInfo && currentUser) {
    adminInfo.textContent = `${lang === 'es' ? 'Sesión:' : 'Signed in as:'} ${currentUser.email}`;
  }
}

async function handleLogout() {
  try {
    await sb.auth.signOut();
  } catch (e) { console.error(e); }
  currentUser = null;
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  showScreen('login');
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
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = true;
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
      console.log('Realtime INSERT:', payload);
      handleNewOrder(payload.new);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'driver_orders'
    }, (payload) => {
      console.log('Realtime UPDATE:', payload);
      handleOrderUpdate(payload.new);
    })
    .subscribe((status) => {
      console.log('Realtime subscription status:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime disconnected, reconnecting in 3s...');
        setTimeout(() => setupRealtime(), 3000);
      }
    });
}

function handleNewOrder(order) {
  // Add to incoming orders if not already there
  if (!incomingOrders.find(o => o.id === order.id)) {
    incomingOrders.unshift(order);
  }

  // Play notification sound
  if (notificationsEnabled) playNotification();

  // Show toast
  const driverName = getDriverName(order.driver_id);
  const items = order.items ? Object.values(order.items).reduce((s, v) => s + (parseInt(v) || 0), 0) : 0;
  const msgEn = `New order from ${driverName}` + (items ? ` (${items} items)` : '');
  const msgEs = `Nuevo pedido de ${driverName}` + (items ? ` (${items} artículos)` : '');
  showToast(lang === 'es' ? msgEs : msgEn, 'info');

  // Browser notification
  showBrowserNotification(
    lang === 'es' ? 'Nuevo Pedido' : 'New Order',
    lang === 'es' ? msgEs : msgEn,
    'incoming'
  );

  // Update badge
  updateIncomingBadge();

  // Re-render if on incoming page
  if (currentSection === 'incoming') renderIncomingOrders();
  if (currentSection === 'overview') loadOverview();
}

function handleOrderUpdate(order) {
  // Update in incoming orders
  const idx = incomingOrders.findIndex(o => o.id === order.id);
  if (idx !== -1) incomingOrders[idx] = order;

  // Re-render if viewing
  if (currentSection === 'incoming') renderIncomingOrders();
  if (currentSection === 'overview') loadOverview();
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
      console.log('Notification permission:', perm);
    });
  }
}

async function showBrowserNotification(title, body, section) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!notificationsEnabled) return;

  const options = {
    body,
    icon: '/assets/logo.png',
    badge: '/assets/logo.png',
    tag: 'cecilia-admin-' + Date.now(),
    data: { url: '/admin-dashboard.html', section }
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

// ── WEB PUSH SUBSCRIPTION ──
async function subscribeToPush(userType, userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push not supported in this browser');
    return;
  }
  if (!sb) return;

  try {
    // Wait for SW with a timeout (5 seconds)
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), 5000))
    ]);

    console.log('Service Worker ready, checking push subscription...');

    // Check existing subscription
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const perm = await Notification.requestPermission();
      console.log('Notification permission:', perm);
      if (perm !== 'granted') return;

      // Convert VAPID key from base64url to Uint8Array
      const urlBase64 = VAPID_PUBLIC_KEY;
      const padding = '='.repeat((4 - urlBase64.length % 4) % 4);
      const base64 = (urlBase64 + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      const applicationServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) applicationServerKey[i] = rawData.charCodeAt(i);

      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
      console.log('Push subscription created');
    } else {
      console.log('Existing push subscription found');
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

    if (error) console.error('Push sub save error:', error);
    else console.log('✅ Push subscription saved for', userType);
  } catch (e) { console.warn('Push subscription failed:', e.message || e); }
}

/* ═══════════════════════════════════
   TOAST
   ═══════════════════════════════════ */
function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.app-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.innerHTML = `<span>${message}</span><button class="toast-close">✕</button>`;
  document.body.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
}

/* ═══════════════════════════════════
   OVERVIEW PAGE
   ═══════════════════════════════════ */
async function loadOverview() {
  // Use timezone-aware boundaries for "today" in the user's local timezone
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  try {
    // Today's orders
    const { data: todayOrders, error: e1 } = await sb
      .from('driver_orders')
      .select('id, total_amount, payment_status, payment_amount, driver_id, business_name, submitted_at, status, order_number')
      .gte('submitted_at', startOfDay.toISOString())
      .lte('submitted_at', endOfDay.toISOString());

    if (!e1 && todayOrders) {
      document.getElementById('stat-today-orders').textContent = todayOrders.length;
      const revenue = todayOrders.reduce((sum, o) => sum + parseFloat(o.payment_amount || 0), 0);
      document.getElementById('stat-today-revenue').textContent = formatCurrency(revenue);
    }

    // Outstanding unpaid (all time)
    const { data: unpaidOrders, error: e2 } = await sb
      .from('driver_orders')
      .select('total_amount, payment_amount, payment_status')
      .in('payment_status', ['not_paid', 'partial']);

    if (!e2 && unpaidOrders) {
      const outstanding = unpaidOrders.reduce((sum, o) => {
        const total = parseFloat(o.total_amount || 0);
        const paid = parseFloat(o.payment_amount || 0);
        return sum + Math.max(0, total - paid);
      }, 0);
      document.getElementById('stat-outstanding').textContent = formatCurrency(outstanding);
    }

    // Recent 5 orders
    const { data: recent, error: e3 } = await sb
      .from('driver_orders')
      .select('id, driver_id, business_name, submitted_at, payment_status, status, order_number, total_amount')
      .order('submitted_at', { ascending: false })
      .limit(5);

    if (!e3 && recent) {
      renderOrderCards(recent, 'recent-orders-list');
    }
  } catch (e) { console.error('Overview load error:', e); }
}

/* ═══════════════════════════════════
   INCOMING ORDERS PAGE
   ═══════════════════════════════════ */
async function loadIncomingOrders() {
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('*')
      .in('status', ['pending', 'confirmed', 'sent'])
      .order('submitted_at', { ascending: false });

    if (!error && data) {
      incomingOrders = data;
      updateIncomingBadge();
      renderIncomingOrders();
    }
  } catch (e) { console.error('Incoming orders error:', e); }
}

function renderIncomingOrders() {
  const activeFilter = document.querySelector('.filter-tab.active')?.dataset.filter || 'all';
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
  const pendingCount = incomingOrders.filter(o => o.status === 'pending').length;
  const badges = [document.getElementById('incoming-badge'), document.getElementById('incoming-badge-mobile')];
  badges.forEach(badge => {
    if (badge) {
      badge.style.display = pendingCount > 0 ? 'inline' : 'none';
      badge.textContent = pendingCount;
    }
  });
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
      query = query.ilike('business_name', `%${searchTerm}%`);
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

  orders.forEach(order => {
    const driverName = getDriverName(order.driver_id);
    const business = order.business_name || (lang === 'es' ? 'Sin negocio' : 'No business');
    const time = formatTime(order.submitted_at);
    const orderNum = order.order_number ? `#${order.order_number}` : '';

    // Payment badge
    let payBadge = '';
    if (order.payment_status === 'paid') {
      payBadge = `<span class="badge badge-paid">${lang === 'es' ? 'Pagado' : 'Paid'}</span>`;
    } else if (order.payment_status === 'partial') {
      payBadge = `<span class="badge badge-partial">${lang === 'es' ? 'Parcial' : 'Partial'}</span>`;
    } else {
      payBadge = `<span class="badge badge-unpaid">${lang === 'es' ? 'Sin Pagar' : 'Not Paid'}</span>`;
    }

    // Status badge
    let statusBadge = '';
    if (order.status === 'pending') {
      statusBadge = `<span class="badge badge-pending">${lang === 'es' ? 'Pendiente' : 'Pending'}</span>`;
    } else if (order.status === 'confirmed') {
      statusBadge = `<span class="badge badge-confirmed">${lang === 'es' ? 'Confirmado' : 'Confirmed'}</span>`;
    } else if (order.status === 'sent') {
      statusBadge = `<span class="badge badge-sent">${lang === 'es' ? 'Enviado' : 'Sent'}</span>`;
    }

    html += `
      <div class="order-card" data-order-id="${order.id}" onclick="openOrderDetail('${order.id}')">
        <div class="order-card-top">
          <div class="order-card-info">
            <div class="order-card-driver">${driverName}</div>
            <div class="order-card-business">${business}</div>
          </div>
          <div class="order-card-badges">${payBadge} ${statusBadge}</div>
        </div>
        <div class="order-card-meta">
          <span class="order-card-number">${orderNum}</span>
          <span class="order-card-time"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${time}</span>
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

window.openOrderDetail = async function(orderId) {
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
    detailItems = items || [];
    detailTotalsVisible = true;
    renderOrderDetail();
    document.getElementById('detail-overlay').classList.add('open');
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

function renderOrderDetail() {
  const order = detailOrder;
  if (!order) return;

  const driverName = getDriverName(order.driver_id);
  const orderNum = order.order_number ? `#${order.order_number}` : '';

  // Title
  document.getElementById('detail-title').textContent =
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
  html += '<div class="detail-meta">';
  html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Conductor' : 'Driver'}</span><span class="detail-meta-value">${driverName}</span></div>`;
  if (order.business_name) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Negocio' : 'Business'}</span><span class="detail-meta-value">${order.business_name}</span></div>`;
  }
  // Smart date/time labels
  html += renderSmartDateTime(order);
  if (order.driver_ref) {
    html += `<div class="detail-meta-item"><span class="detail-meta-label">${lang === 'es' ? 'Ref del Conductor' : "Driver's Ref"}</span><span class="detail-meta-value">${order.driver_ref}</span></div>`;
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

  // Line items table
  const isEditable = canEditOrder(order);
  html += '<table class="line-items-table"><thead><tr>';
  html += `<th>${lang === 'es' ? 'Producto' : 'Product'}</th>`;
  html += `<th class="col-qty">${lang === 'es' ? 'Orig' : 'Orig'}</th>`;
  html += `<th class="col-qty">${lang === 'es' ? 'Ajust' : 'Adj'}</th>`;
  if (detailTotalsVisible) {
    html += `<th class="col-price">${lang === 'es' ? 'Precio' : 'Price'}</th>`;
    html += `<th class="col-total">Total</th>`;
  }
  html += '</tr></thead><tbody>';

  let grandTotal = 0;
  let lastCat = '';
  const colSpan = 3 + (detailTotalsVisible ? 2 : 0);
  detailItems.forEach((item, idx) => {
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    const lineTotal = effectiveQty * parseFloat(item.price_at_order || 0);
    grandTotal += lineTotal;

    // Category header row
    const cat = getCategoryLabel(item.product_key);
    if (cat && cat !== lastCat) {
      html += `<tr class="cat-header-row"><td colspan="${colSpan}">${cat}</td></tr>`;
      lastCat = cat;
    }

    // Clean label: strip "(No Ticket)" from text, show as tag
    let label = item.product_label || '';
    const isNoTicket = label.includes('(No Ticket)') || (item.product_key && item.product_key.endsWith('_nt'));
    if (isNoTicket) label = label.replace(/\s*\(No Ticket\)/i, '');
    label = label.replace(/_nt\b/g, '');  // clean redondo column suffixes

    html += '<tr>';
    html += `<td>${label}`;
    if (isNoTicket) html += `<span class="no-ticket-tag">✕ No Ticket</span>`;
    if (item.adjustment_note) html += `<span class="adj-note">${item.adjustment_note}</span>`;
    html += '</td>';
    html += `<td class="col-qty">${item.quantity}</td>`;
    html += `<td class="col-qty">`;
    if (isEditable) {
      html += `<input type="number" class="qty-adjust-input" value="${effectiveQty}" min="0" data-item-idx="${idx}" data-item-id="${item.id}" data-original-qty="${item.quantity}" onchange="handleQtyAdjust(this)">`;
    } else {
      html += effectiveQty !== item.quantity ? effectiveQty : '—';
    }
    html += '</td>';
    if (detailTotalsVisible) {
      html += `<td class="col-price">${formatCurrency(parseFloat(item.price_at_order || 0))}</td>`;
      html += `<td class="col-total">${formatCurrency(lineTotal)}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table>';

  if (detailTotalsVisible) {
    html += `<div class="grand-total-row"><span>${lang === 'es' ? 'Total General' : 'Grand Total'}</span><span>${formatCurrency(grandTotal)}</span></div>`;
  }

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

  document.getElementById('detail-content').innerHTML = html;

  // Actions
  let actionsHtml = '';
  if (order.status === 'pending' || (order.status === 'sent' && canEditOrder(order))) {
    // Fully editable: one "Save Changes" button that saves everything including payment
    actionsHtml += `<button class="btn-save" onclick="saveOrderChanges()" data-en="Save Changes" data-es="Guardar Cambios">${lang === 'es' ? 'Guardar Cambios' : 'Save Changes'}</button>`;
  } else if (order.status === 'sent') {
    // Not fully editable, but payment is always editable
    actionsHtml += `<button class="btn-save" onclick="savePaymentOnly()" data-en="Update Payment" data-es="Actualizar Pago">${lang === 'es' ? 'Actualizar Pago' : 'Update Payment'}</button>`;
  }
  if (order.status === 'pending') {
    actionsHtml += `<button class="btn-confirm" onclick="confirmAndSend()" data-en="Confirm & Send" data-es="Confirmar y Enviar">${lang === 'es' ? 'Confirmar y Enviar' : 'Confirm & Send'}</button>`;
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
  document.getElementById('detail-actions').innerHTML = actionsHtml;
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

/* ═══════════════════════════════════
   EDIT WINDOW LOGIC
   Qty/product edits: entire day
   Payment status: ALWAYS editable
   ═══════════════════════════════════ */
function canEditOrder(order) {
  // Pending orders are always editable
  if (order.status === 'pending') return true;
  // Sent orders: admin can edit quantities until end of day
  if (order.admin_editable_until) {
    return new Date(order.admin_editable_until) > new Date();
  }
  return false;
}

function getEditWindowStatus(order) {
  if (order.status === 'pending') return { show: false };
  if (!order.admin_editable_until) return { show: false };

  const until = new Date(order.admin_editable_until);
  const now = new Date();
  const expired = until <= now;

  if (expired) {
    return {
      show: true,
      expired: true,
      text: lang === 'es'
        ? 'Las cantidades ya no se pueden editar (el pago sí)'
        : 'Quantities can no longer be edited (payment still can)'
    };
  }

  const remainingMs = until - now;
  const remainingHrs = Math.floor(remainingMs / 1000 / 60 / 60);
  const remainingMin = Math.ceil((remainingMs / 1000 / 60) % 60);
  const timeStr = remainingHrs > 0
    ? `${remainingHrs}h ${remainingMin}m`
    : `${remainingMin} min`;
  return {
    show: true,
    expired: false,
    text: lang === 'es'
      ? `Puedes editar cantidades por ${timeStr} más`
      : `You can edit quantities for ${timeStr} more`
  };
}

/* ═══════════════════════════════════
   ORDER ACTIONS
   ═══════════════════════════════════ */
window.toggleDetailTotals = function() {
  detailTotalsVisible = !detailTotalsVisible;
  renderOrderDetail();
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
  renderOrderDetail();
};

window.setPaymentStatus = function(status) {
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

  renderOrderDetail();
};

window.handlePartialAmount = function(input) {
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
  renderOrderDetail();
};

window.saveOrderChanges = async function() {
  if (!detailOrder) return;

  try {
    // Save item adjustments
    for (const item of detailItems) {
      if (item.adjusted_quantity !== null && item.adjusted_quantity !== undefined) {
        await sb.from('driver_order_items').update({
          adjusted_quantity: item.adjusted_quantity,
          adjustment_note: item.adjustment_note,
          adjusted_at: item.adjusted_at || new Date().toISOString()
        }).eq('id', item.id);
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
  }
};

window.confirmAndSend = async function() {
  if (!detailOrder) return;

  try {
    // Save adjustments first
    await window.saveOrderChanges();

    const now = new Date();
    // Admin can edit quantities until end of the same day
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const editableUntil = endOfDay.toISOString();

    await sb.from('driver_orders').update({
      status: 'sent',
      confirmed_at: now.toISOString(),
      admin_editable_until: editableUntil
    }).eq('id', detailOrder.id);

    detailOrder.status = 'sent';
    detailOrder.confirmed_at = now.toISOString();
    detailOrder.admin_editable_until = editableUntil;

    showToast(lang === 'es' ? 'Pedido confirmado y enviado' : 'Order confirmed and sent', 'success');
    closeDetailModal();

    if (currentSection === 'incoming') loadIncomingOrders();
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error confirmando pedido' : 'Error confirming order', 'error');
  }
};

window.savePaymentOnly = async function() {
  if (!detailOrder) return;

  try {
    await sb.from('driver_orders').update({
      payment_status: detailOrder.payment_status,
      payment_amount: detailOrder.payment_amount
    }).eq('id', detailOrder.id);

    showToast(lang === 'es' ? 'Pago actualizado' : 'Payment updated', 'success');

    if (currentSection === 'history') loadHistoryOrders(true);
    if (currentSection === 'overview') loadOverview();
  } catch (e) {
    console.error(e);
    showToast(lang === 'es' ? 'Error actualizando pago' : 'Error updating payment', 'error');
  }
};

function closeDetailModal() {
  document.getElementById('detail-overlay').classList.remove('open');
  // Unlock body scroll (iOS-safe)
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  document.body.style.width = '';
  window.scrollTo(0, parseInt(scrollY));
  detailOrder = null;
  detailItems = [];
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
  detailItems.forEach(item => {
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    const lineTotal = effectiveQty * parseFloat(item.price_at_order || 0);
    grandTotal += lineTotal;
    const adjNote = (item.adjusted_quantity !== null && item.adjusted_quantity !== item.quantity)
      ? ` (${item.quantity} → ${effectiveQty})` : '';

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
    const detailOverlay = document.getElementById('detail-overlay');
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

  // Share button
  document.getElementById('pp-share-btn').addEventListener('click', () => {
    if (navigator.share) {
      let text = 'Cecilia Bakery\n';
      const orderNum = overlay.querySelector('.print-order-num');
      if (orderNum) text += orderNum.textContent + '\n\n';
      overlay.querySelectorAll('.print-meta-item').forEach(m => { text += m.textContent.trim() + '\n'; });
      text += '\n';
      overlay.querySelectorAll('.print-items tbody tr').forEach(r => {
        let line = '';
        r.querySelectorAll('td').forEach(c => { line += c.textContent + '  '; });
        text += line.trim() + '\n';
      });
      const total = overlay.querySelector('.print-total');
      if (total) text += '\n' + total.textContent;
      const pay = overlay.querySelector('.print-payment');
      if (pay) text += '\n' + pay.textContent;
      navigator.share({ title: 'Cecilia Bakery Order', text }).catch(() => {});
    } else {
      showToast(lang === 'es' ? 'Compartir no disponible' : 'Share not available', 'info');
    }
  });
}

window.printOrder = function() {
  openPrintWindow(detailTotalsVisible);
};


window.shareWhatsApp = function() {
  if (!detailOrder) return;

  const order = detailOrder;
  const driverName = getDriverName(order.driver_id);
  const orderNum = order.order_number ? `#${order.order_number}` : `#${order.id.replace(/-/g, '').slice(-5).toUpperCase()}`;

  let dateStr = '';
  if (order.pickup_date) {
    dateStr = formatDate(order.pickup_date);
  } else {
    dateStr = formatDate(order.submitted_at);
  }

  let msg = `📦 ${lang === 'es' ? 'Pedido' : 'Order'} ${orderNum}\n`;
  msg += `${lang === 'es' ? 'Conductor' : 'Driver'}: ${driverName}\n`;
  if (order.business_name) {
    msg += `${lang === 'es' ? 'Negocio' : 'Business'}: ${order.business_name}\n`;
  }
  msg += `${lang === 'es' ? 'Fecha' : 'Date'}: ${dateStr}\n\n`;

  msg += `${lang === 'es' ? 'Artículos' : 'Items'}:\n`;
  let grandTotal = 0;
  let totalItems = 0;
  detailItems.forEach(item => {
    const effectiveQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
    const lineTotal = effectiveQty * parseFloat(item.price_at_order || 0);
    grandTotal += lineTotal;
    totalItems += effectiveQty;

    let label = item.product_label || item.product_key;
    // Ensure no-ticket items show the tag even for old data
    if (item.product_key && item.product_key.endsWith('_nt') && !/no ticket|NT\)|ST\)/i.test(label)) {
      label += ' (No Ticket)';
    }
    let line = `• ${label} × ${effectiveQty}`;
    if (detailTotalsVisible) {
      line += ` — ${formatCurrency(lineTotal)}`;
    }
    msg += line + '\n';
  });

  msg += `\n${lang === 'es' ? 'Total Artículos' : 'Total Items'}: ${totalItems}`;
  if (detailTotalsVisible) {
    msg += `\n${lang === 'es' ? 'Total General' : 'Grand Total'}: ${formatCurrency(grandTotal)}`;
  }

  const encoded = encodeURIComponent(msg);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
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
    return `<tr onclick="showDriverProfile('${d.id}')">
      <td class="driver-name">${d.name}</td>
      <td class="driver-code"><span class="code-masked" data-code="${d.code}">••••••</span> <button class="code-eye-btn" onclick="event.stopPropagation();toggleCode(this)" title="Show code"><i data-lucide="eye"></i></button></td>
      <td class="driver-phone hide-mobile">${d.phone || '—'}</td>
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

  // Fetch prices
  const { data: prices } = await sb.from('driver_prices').select('product_key, price').eq('driver_id', driverId);
  const priceMap = {};
  if (prices) prices.forEach(p => priceMap[p.product_key] = p.price);

  renderPriceTable(priceMap);
  populateCopyDropdown(driverId);
  showDriversFormView();
}

// ── PRICE TABLE ─────────────────────
function renderPriceTable(priceMap) {
  let html = '';
  ADMIN_PRODUCTS.forEach(sec => {
    html += `<div class="price-section">`;
    html += `<div class="price-section-title">${lang === 'es' ? sec.sectionEs : sec.section}</div>`;
    sec.items.forEach(item => {
      const val = priceMap[item.key] !== undefined ? parseFloat(priceMap[item.key]).toFixed(2) : '';
      html += `<div class="price-row">
        <span class="price-label">${lang === 'es' ? item.es : item.en}</span>
        <input type="number" class="price-input" data-key="${item.key}" value="${val}"
          placeholder="0.00" step="0.01" min="0">
      </div>`;
    });
    html += `</div>`;
  });
  document.getElementById('price-table-container').innerHTML = html;
}

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

  // Collect prices
  const priceInputs = document.querySelectorAll('.price-input');
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

  if (!allFilled) {
    showToast(lang === 'es' ? 'Todos los precios son obligatorios' : 'All prices are required', 'error');
    return;
  }

  try {
    let driverId;

    if (editingDriverId) {
      // Update driver
      await sb.from('drivers').update({ name, code, phone, is_active: isActive }).eq('id', editingDriverId);
      driverId = editingDriverId;

      // Delete old prices and re-insert
      await sb.from('driver_prices').delete().eq('driver_id', driverId);
    } else {
      // Insert new driver
      const { data: newDriver, error } = await sb.from('drivers').insert({ name, code, phone, is_active: isActive }).select('id').single();
      if (error) throw error;
      driverId = newDriver.id;
    }

    // Insert prices
    const priceRows = prices.map(p => ({
      driver_id: driverId,
      product_key: p.product_key,
      product_label: p.product_label,
      price: p.price
    }));
    const { error: priceErr } = await sb.from('driver_prices').insert(priceRows);
    if (priceErr) throw priceErr;

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
      <div class="profile-name">${driver.name}</div>
      <div class="profile-meta">
        <span class="code-masked" data-code="${driver.code}">••••••</span>
        <button class="code-eye-btn" onclick="toggleCode(this)" title="Show code"><i data-lucide="eye"></i></button>
        ${driver.phone ? `<span>${driver.phone}</span>` : ''}
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
          <span class="balance-row-business">${o.business_name || (lang === 'es' ? 'Sin negocio' : 'No business')}</span>
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
            <div class="order-card-driver">${o.business_name || (lang === 'es' ? 'Sin negocio' : 'No business')}</div>
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
  detailItems = items || [];
  renderOrderDetail();
  document.getElementById('detail-overlay').classList.add('open');
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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
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
  console.log('Admin Dashboard: DOMContentLoaded');
  applyTheme();
  applyLang();
  lucide.createIcons();

  // Restore font size
  const savedSize = localStorage.getItem('cecilia_admin_font_size');
  if (savedSize) document.documentElement.style.fontSize = savedSize + 'px';

  // Restore notification preference
  const notifToggle = document.getElementById('notification-toggle');
  if (notifToggle) notifToggle.checked = notificationsEnabled;

  // ── Login ──
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('admin-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('admin-password').focus();
  });
  document.getElementById('admin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  // ── Login/Register toggle ──
  document.getElementById('toggle-register').addEventListener('click', () => {
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('toggle-register').style.display = 'none';
    document.querySelector('.login-divider').style.display = 'none';
    document.getElementById('login-btn').style.display = 'none';
    document.querySelectorAll('#screen-login .login-input-wrap').forEach((el, i) => {
      if (i < 2) el.style.display = 'none'; // hide email/password inputs
    });
  });
  document.getElementById('toggle-login').addEventListener('click', () => {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('toggle-register').style.display = '';
    document.querySelector('.login-divider').style.display = '';
    document.getElementById('login-btn').style.display = '';
    document.querySelectorAll('#screen-login .login-input-wrap').forEach(el => {
      el.style.display = '';
    });
  });
  document.getElementById('register-btn').addEventListener('click', handleRegister);

  // ── Invite code generation ──
  document.getElementById('generate-invite-btn').addEventListener('click', generateInviteCode);

  // ── Password eye toggle ──
  document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.innerHTML = `<i data-lucide="${isHidden ? 'eye' : 'eye-off'}" style="width:18px;height:18px"></i>`;
      lucide.createIcons();
    });
  });

  // ── Remember Me ──
  const savedEmail = localStorage.getItem('cecilia_admin_email');
  const rememberCheck = document.getElementById('remember-me-check');
  if (savedEmail) {
    document.getElementById('admin-email').value = savedEmail;
    rememberCheck.checked = true;
  }

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

  // ── Overview ──
  document.getElementById('view-all-orders-btn').addEventListener('click', () => showSection('incoming'));
  document.getElementById('stat-outstanding-card').addEventListener('click', () => {
    // Pre-select the "unpaid" filter tab before navigating
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    const unpaidTab = document.querySelector('.filter-tab[data-filter="unpaid"]');
    if (unpaidTab) unpaidTab.classList.add('active');
    showSection('incoming');
  });

  // ── Filter tabs (incoming) ──
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
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
  document.getElementById('notification-toggle').addEventListener('change', (e) => {
    notificationsEnabled = e.target.checked;
    localStorage.setItem('cecilia_admin_notifications', notificationsEnabled);
  });
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // ── Detail modal ──
  document.getElementById('detail-close').addEventListener('click', closeDetailModal);
  document.getElementById('detail-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetailModal();
  });

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

  // ── Check existing session ──
  await checkSession();
});

// ═══════════════════════════════════
//  ADMIN INVITE CODE SYSTEM
// ═══════════════════════════════════

async function handleRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const code = document.getElementById('reg-invite-code').value.trim().toUpperCase();
  const errorEl = document.getElementById('register-error');
  const btn = document.getElementById('register-btn');

  if (!email || !password || !code) {
    errorEl.textContent = lang === 'es' ? 'Completa todos los campos' : 'Fill in all fields';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = lang === 'es' ? 'La contraseña debe tener al menos 6 caracteres' : 'Password must be at least 6 characters';
    return;
  }

  btn.disabled = true;
  errorEl.textContent = '';

  try {
    // 1. Validate invite code
    const { data: invite, error: invErr } = await sb
      .from('admin_invite_codes')
      .select('*')
      .eq('code', code)
      .eq('is_used', false)
      .single();

    if (invErr || !invite) {
      errorEl.textContent = lang === 'es' ? 'Código de invitación no válido' : 'Invalid invite code';
      btn.disabled = false;
      return;
    }

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      errorEl.textContent = lang === 'es' ? 'Este código ha expirado' : 'This code has expired';
      btn.disabled = false;
      return;
    }

    // 2. Create user
    const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { role: 'admin' }
      }
    });

    if (signUpErr) {
      errorEl.textContent = signUpErr.message || (lang === 'es' ? 'Error al registrarse' : 'Registration error');
      btn.disabled = false;
      return;
    }

    // 3. Mark invite code as used
    await sb.from('admin_invite_codes').update({
      is_used: true,
      used_by: email,
      used_at: new Date().toISOString()
    }).eq('id', invite.id);

    // 4. Auto sign in
    const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({ email, password });
    if (loginErr) {
      errorEl.textContent = lang === 'es' ? 'Cuenta creada. Inicia sesión manualmente.' : 'Account created. Please sign in manually.';
      errorEl.style.color = 'var(--green)';
      document.getElementById('toggle-login').click();
      btn.disabled = false;
      return;
    }

    currentUser = loginData.user;
    enterDashboard();

  } catch (e) {
    errorEl.textContent = lang === 'es' ? 'Error de conexión' : 'Connection error';
    console.error('Register error:', e);
  }
  btn.disabled = false;
}

async function generateInviteCode() {
  if (!sb || !currentUser) return;

  const btn = document.getElementById('generate-invite-btn');
  btn.disabled = true;

  try {
    // Generate random 8-char code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (I/O/0/1)
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];

    // Insert into DB (expires in 24h)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await sb.from('admin_invite_codes').insert({
      code,
      created_by: currentUser.email,
      expires_at: expiresAt
    });

    if (error) {
      console.error('Invite code error:', error);
      btn.disabled = false;
      return;
    }

    // Display the code
    const display = document.getElementById('invite-code-display');
    display.style.display = 'block';
    display.innerHTML = `
      <div class="invite-code-card">
        <div style="font-size:.78rem;color:var(--tx-muted)">${lang === 'es' ? 'Código de invitación' : 'Invite Code'}</div>
        <div class="invite-code-value">
          <span class="code-masked" data-code="${code}">${'•'.repeat(code.length)}</span>
          <button class="code-eye-btn" onclick="const s=this.previousElementSibling;const c=s.dataset.code;s.textContent=s.textContent.includes('•')?c:'•'.repeat(c.length)" aria-label="Toggle code visibility"><i data-lucide="eye" style="width:14px;height:14px"></i></button>
        </div>
        <button class="invite-code-copy" onclick="navigator.clipboard.writeText('${code}').then(()=>this.textContent='✓ ${lang === 'es' ? 'Copiado' : 'Copied'}')">
          <i data-lucide="copy" style="width:12px;height:12px"></i> ${lang === 'es' ? 'Copiar' : 'Copy'}
        </button>
        <div class="invite-code-expires">${lang === 'es' ? 'Expira en 24 horas' : 'Expires in 24 hours'}</div>
      </div>`;
    lucide.createIcons();

    // Reload active invites
    loadActiveInvites();

  } catch (e) {
    console.error('Generate invite error:', e);
  }
  btn.disabled = false;
}

async function loadActiveInvites() {
  if (!sb || !currentUser) return;

  const container = document.getElementById('active-invites');
  try {
    const { data, error } = await sb
      .from('admin_invite_codes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      container.innerHTML = '';
      return;
    }

    const now = new Date();
    container.innerHTML = data.map(inv => {
      let statusClass, statusLabel;
      if (inv.is_used) {
        statusClass = 'used';
        statusLabel = lang === 'es' ? 'Usado' : 'Used';
      } else if (new Date(inv.expires_at) < now) {
        statusClass = 'expired';
        statusLabel = lang === 'es' ? 'Expirado' : 'Expired';
      } else {
        statusClass = 'active';
        statusLabel = lang === 'es' ? 'Activo' : 'Active';
      }

      const usedInfo = inv.used_by ? ` · ${inv.used_by}` : '';
      const masked = '•'.repeat(inv.code.length);
      return `
        <div class="invite-item">
          <span class="invite-item-code">
            <span class="code-masked" data-code="${inv.code}">${masked}</span>
            <button class="code-eye-btn" onclick="const s=this.previousElementSibling;const c=s.dataset.code;s.textContent=s.textContent.includes('•')?c:'•'.repeat(c.length)" aria-label="Toggle"><i data-lucide="eye" style="width:14px;height:14px"></i></button>
          </span>
          <span>${usedInfo}</span>
          <span class="invite-item-status ${statusClass}">${statusLabel}</span>
        </div>`;
    }).join('');
    lucide.createIcons();

  } catch (e) { console.error('Load invites error:', e); }
}
