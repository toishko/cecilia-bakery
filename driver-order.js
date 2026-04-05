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
    _log('Supabase client initialized');
  } else {
    console.error('Supabase JS not loaded');
  }
} catch (e) { console.error('Supabase init failed:', e); }

/* ═══════════════════════════════════
   STATE
   ═══════════════════════════════════ */
let currentDriver = null;
let lang = localStorage.getItem('cecilia_lang') || 'en';
let failedAttempts = parseInt(localStorage.getItem('cecilia_code_attempts') || '0');
let lockoutUntil = parseInt(localStorage.getItem('cecilia_lockout_until') || '0');
let driverPriceMap = {}; // product_key → price, loaded on login

// Inventory state
let driverInventory = {};    // product_key → { loaded, sold, remaining }
let inventoryLoaded = false;
let inventorySource = '';    // 'order:#123' or 'manual'

// Session timeout: 24 hours
const DRIVER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// My Products — hidden product keys
let hiddenProducts = new Set(JSON.parse(localStorage.getItem('cecilia_hidden_products') || '[]'));

/* ── Escape helper for XSS prevention ── */
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ═══════════════════════════════════
   SCREEN MANAGEMENT
   ═══════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

function showSection(name) {
  document.getElementById('dash-nav').classList.remove('open');
  document.getElementById('dash-menu-btn').classList.remove('open');
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = 'block';
  document.querySelectorAll('.dash-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });
  // Show/hide footer and init order form
  const footer = document.getElementById('form-footer');
  const saleFooter = document.getElementById('sale-footer');
  if (name === 'new-order') {
    initOrderForm();
    footer.style.display = 'flex';
    saleFooter.style.display = 'none';
  } else if (name === 'sales') {
    footer.style.display = 'none';
    saleFooter.style.display = 'flex';
    initSalesSection();
  } else {
    footer.style.display = 'none';
    saleFooter.style.display = 'none';
  }
  // Phase 5: load My Orders when switching to that tab
  if (name === 'my-orders') {
    loadDriverBalance();
    loadMyOrders();
  }
  if (name === 'overview') {
    loadDriverBalance();
    loadRecentOrders();
  }
  if (name === 'clients') {
    loadDriverClients();
  }
  if (name === 'inventory') {
    loadInventoryTab();
  }
  // Refresh icons for dynamically rendered content
  requestAnimationFrame(() => lucide.createIcons());
}

/* ═══════════════════════════════════
   LOGIN
   ═══════════════════════════════════ */
async function handleLogin() {
  const input = document.getElementById('code-input');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const code = input.value.trim().toLowerCase();

  if (Date.now() < lockoutUntil) {
    const secs = Math.ceil((lockoutUntil - Date.now()) / 1000);
    errorEl.textContent = lang === 'es'
      ? `Demasiados intentos. Espera ${secs}s`
      : `Too many attempts. Wait ${secs}s`;
    return;
  }

  if (!code) {
    errorEl.textContent = lang === 'es' ? 'Ingresa tu código' : 'Enter your code';
    return;
  }

  btn.disabled = true;
  errorEl.textContent = '';

  try {
    const { data, error } = await sb
      .from('drivers')
      .select('*')
      .ilike('code', code)
      .single();

    if (error || !data) {
      failedAttempts++;
      localStorage.setItem('cecilia_code_attempts', failedAttempts);
      if (failedAttempts >= 5) {
        lockoutUntil = Date.now() + 5 * 60 * 1000;
        localStorage.setItem('cecilia_lockout_until', lockoutUntil);
        startLockoutTimer();
      }
      errorEl.textContent = lang === 'es'
        ? 'Codigo no reconocido. Intenta de nuevo.'
        : 'Code not recognized. Try again.';
      btn.disabled = false;
      return;
    }

    if (!data.is_active) {
      errorEl.textContent = lang === 'es'
        ? 'Esta cuenta ha sido desactivada. Contacta la panaderia.'
        : 'This account has been disabled. Contact the bakery.';
      btn.disabled = false;
      return;
    }

    // Success
    failedAttempts = 0;
    localStorage.setItem('cecilia_code_attempts', '0');
    currentDriver = data;
    // Store session without the code, with a timestamp for expiry
    const sessionData = { ...data };
    delete sessionData.code;
    sessionData._session_ts = Date.now();
    localStorage.setItem('cecilia_driver', JSON.stringify(sessionData));
    if (data.language) { lang = data.language; localStorage.setItem('cecilia_lang', lang); }
    enterDashboard();
  } catch (e) {
    errorEl.textContent = lang === 'es' ? 'Error de conexion' : 'Connection error';
    console.error(e);
  }
  btn.disabled = false;
}

function startLockoutTimer() {
  const lockoutEl = document.getElementById('login-lockout');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const input = document.getElementById('code-input');
  btn.disabled = true;
  input.disabled = true;
  const tick = () => {
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      lockoutEl.textContent = '';
      failedAttempts = 0;
      localStorage.setItem('cecilia_code_attempts', '0');
      localStorage.removeItem('cecilia_lockout_until');
      btn.disabled = false;
      input.disabled = false;
      errorEl.textContent = '';
      return;
    }
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    lockoutEl.textContent = lang === 'es'
      ? `Demasiados intentos. Intenta en ${min}:${String(sec).padStart(2, '0')}`
      : `Too many attempts. Try again in ${min}:${String(sec).padStart(2, '0')}`;
    setTimeout(tick, 1000);
  };
  tick();
}

function enterDashboard() {
  applyLang();
  document.getElementById('welcome-name').textContent =
    (lang === 'es' ? 'Bienvenido, ' : 'Welcome, ') + currentDriver.name;
  showScreen('dashboard');
  lucide.createIcons();
  // Phase 5: load balance, recent orders, start realtime
  loadDriverBalance();
  loadRecentOrders();
  setupDriverRealtime();
  requestNotifPermission();
  // Push opt-in: only auto-subscribe if permission already granted
  if ('Notification' in window && Notification.permission === 'granted') {
    subscribeToPush('driver', currentDriver.id);
  } else if ('Notification' in window && Notification.permission === 'default'
             && !localStorage.getItem('cecilia_push_dismissed')) {
    const optIn = document.getElementById('push-opt-in');
    if (optIn) optIn.style.display = 'flex';
  }
  // Phase 9: sync language from Supabase
  syncLangFromSupabase();
  // NOTE: Driver products are hardcoded and separate from the customer-facing
  // menu products in the Supabase `products` table. Do NOT load from DB here.
  // The driver catalog includes items like Redondo, Happy Birthday BIG/SMALL,
  // Frosted Pieces, Family Size, etc. that don't exist in the menu products table.
  // Load driver prices for summary display
  loadDriverPriceMap();
}

async function handleLogout() {
  // Clean up push subscription on logout
  if (currentDriver) {
    await unsubscribeFromPush(sb, 'driver', currentDriver.id);
  }

  currentDriver = null;
  localStorage.removeItem('cecilia_driver');
  document.getElementById('code-input').value = '';
  showScreen('login');
}

/* ═══════════════════════════════════
   LANGUAGE
   ═══════════════════════════════════ */
function setLang(l) {
  lang = l;
  localStorage.setItem('cecilia_lang', lang);
  applyLang();
  if (sb && currentDriver) {
    sb.from('drivers').update({ language: lang }).eq('id', currentDriver.id);
  }
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
  // Re-render product names if form is visible
  document.querySelectorAll('.prod-name[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.textContent = text;
  });
  // Re-render section labels
  document.querySelectorAll('.acc-title[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.textContent = text;
  });
  // Re-render qty group labels
  document.querySelectorAll('.prod-qty-label[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.textContent = text;
  });
  // Redondo column headers
  document.querySelectorAll('.redondo-col-label[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.textContent = text;
  });
}

/* ═══════════════════════════════════
   THEME
   ═══════════════════════════════════ */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('cecilia_theme', isDark ? 'light' : 'dark');
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = !isDark;
}

function applyTheme() {
  const saved = localStorage.getItem('cecilia_theme');
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
  localStorage.setItem('cecilia_font_size', next);
}

/* ═══════════════════════════════════
   INIT — ALL EVENT LISTENERS
   ═══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  _log('DOMContentLoaded fired');
  applyTheme();
  applyLang();
  lucide.createIcons();

  // Restore font size
  const savedSize = localStorage.getItem('cecilia_font_size');
  if (savedSize) document.documentElement.style.fontSize = savedSize + 'px';

  // Check lockout
  if (Date.now() < lockoutUntil) startLockoutTimer();

  // Auto-login if session exists (with 24h expiry)
  const saved = localStorage.getItem('cecilia_driver');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const sessionAge = Date.now() - (parsed._session_ts || 0);
      if (sessionAge > DRIVER_SESSION_TTL_MS) {
        // Session expired
        localStorage.removeItem('cecilia_driver');
      } else {
        currentDriver = parsed;
        enterDashboard();
      }
    } catch (e) { localStorage.removeItem('cecilia_driver'); }
  }

  // ── Login screen ──
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-lang-btn').addEventListener('click', () => {
    setLang(lang === 'en' ? 'es' : 'en');
  });
  document.getElementById('login-theme-btn').addEventListener('click', toggleTheme);

  // ── Dashboard nav ──
  document.getElementById('dash-menu-btn').addEventListener('click', () => {
    const nav = document.getElementById('dash-nav');
    const btn = document.getElementById('dash-menu-btn');
    nav.classList.toggle('open');
    btn.classList.toggle('open');
  });
  document.querySelectorAll('.dash-nav-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });
  document.getElementById('new-order-cta').addEventListener('click', () => showSection('new-order'));

  // ── Settings ──
  document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => changeSize(parseInt(btn.dataset.size)));
  });
  document.getElementById('theme-toggle').addEventListener('change', toggleTheme);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // ── Push opt-in banner ──
  document.getElementById('push-opt-in-btn')?.addEventListener('click', async () => {
    document.getElementById('push-opt-in').style.display = 'none';
    if (currentDriver) await subscribeToPush('driver', currentDriver.id);
  });
  document.getElementById('push-opt-in-dismiss')?.addEventListener('click', () => {
    document.getElementById('push-opt-in').style.display = 'none';
    localStorage.setItem('cecilia_push_dismissed', '1');
  });

  // ── My Products ──
  document.getElementById('my-products-btn').addEventListener('click', openMyProducts);
  document.getElementById('mp-back').addEventListener('click', closeMyProducts);

  // ── Clients ──
  document.getElementById('clients-add-btn').addEventListener('click', () => openClientModal());
  document.getElementById('client-modal-close').addEventListener('click', closeClientModal);
  document.getElementById('client-modal-cancel').addEventListener('click', closeClientModal);
  document.getElementById('client-modal-save').addEventListener('click', handleSaveClient);
  document.getElementById('client-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeClientModal();
  });

  // ── Sales ──
  document.getElementById('sale-complete-btn').addEventListener('click', openPaymentModal);
  document.getElementById('sale-goto-clients-btn').addEventListener('click', () => showSection('clients'));
  document.getElementById('pay-modal-close').addEventListener('click', closePaymentModal);
  document.getElementById('pay-modal-cancel').addEventListener('click', closePaymentModal);
  document.getElementById('pay-modal-confirm').addEventListener('click', handleConfirmSale);
  document.getElementById('pay-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePaymentModal();
  });
  document.getElementById('receipt-back-btn').addEventListener('click', () => {
    document.getElementById('print-instructions').style.display = 'none';
    showScreen('dashboard');
    showSection('sales');
  });
  document.getElementById('receipt-print-btn').addEventListener('click', () => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isIOS) {
      window.print();
      return;
    }
    // iOS: copy receipt URL and show visual instructions
    const driverId = currentDriver?.id || '';
    const url = window.location.origin + '/receipt.html?driver=' + encodeURIComponent(driverId);
    _copyReceiptLink(url);
    document.getElementById('print-instructions').style.display = 'block';
    applyLang();
  });
  document.getElementById('print-copy-btn').addEventListener('click', () => {
    const driverId = currentDriver?.id || '';
    const url = window.location.origin + '/receipt.html?driver=' + encodeURIComponent(driverId);
    _copyReceiptLink(url);
  });
  // Pay toggle groups
  document.querySelectorAll('#pay-method-group .pay-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pay-method-group .pay-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('#pay-status-group .pay-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pay-status-group .pay-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Phase 5: Receipts & History ──
  document.getElementById('order-detail-back').addEventListener('click', closeOrderDetail);
  document.getElementById('order-detail-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeOrderDetail();
  });
  document.getElementById('balance-modal-close').addEventListener('click', closeBalanceBreakdown);
  document.getElementById('balance-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeBalanceBreakdown();
  });
  const notifToggle = document.getElementById('notification-toggle');
  if (notifToggle) {
    notifToggle.checked = notificationsEnabled;
    notifToggle.addEventListener('change', async (e) => {
      notificationsEnabled = e.target.checked;
      localStorage.setItem('cecilia_driver_notifications', notificationsEnabled);

      if (!notificationsEnabled) {
        // Unsubscribe from push
        if (currentDriver) await unsubscribeFromPush(sb, 'driver', currentDriver.id);
        showToast(lang === 'es' ? 'Notificaciones desactivadas' : 'Notifications disabled');
      } else {
        // Re-subscribe to push
        if (currentDriver) await subscribeToPush('driver', currentDriver.id);
        showToast(lang === 'es' ? 'Notificaciones activadas' : 'Notifications enabled');
      }
    });
  }

  // ── Order form ──
  document.getElementById('footer-continue-btn').addEventListener('click', openSummary);
  document.getElementById('summary-back').addEventListener('click', closeSummary);
  document.getElementById('summary-submit').addEventListener('click', submitAllOrders);
  document.getElementById('summary-prev').addEventListener('click', () => navigateSummary(-1));
  document.getElementById('summary-next').addEventListener('click', () => navigateSummary(1));
  document.getElementById('product-search').addEventListener('input', handleSearch);
  document.getElementById('search-clear').addEventListener('click', clearSearch);

  // ── Custom time picker ──
  document.getElementById('field-time-display').addEventListener('click', openTimePicker);
  document.getElementById('tp-cancel').addEventListener('click', closeTimePicker);
  document.getElementById('tp-confirm').addEventListener('click', confirmTimePicker);
  document.getElementById('tp-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTimePicker();
  });
  initTimePickerColumns();
});

/* ═══════════════════════════════════
   PRODUCT CATALOG (EN/ES)
   ═══════════════════════════════════ */
let PRODUCTS = {
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

/* Helper to get product/section label */
function L(obj) { return obj[lang] || obj.en; }

/* ═══════════════════════════════════
   MULTI-ORDER STATE
   ═══════════════════════════════════ */
let orders = [];
let activeOrderIdx = 0;

function createBlankOrder() {
  const qty = {};
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        (item.cols || []).forEach(c => { qty[item.key + '_' + c] = 0; });
      } else {
        qty[item.key] = 0;
        qty[item.key + '_nt'] = 0;
      }
    });
  });
  return { business: '', date: getTodayStr(), time: '', ref: '', notes: '', qty };
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function initOrderForm() {
  if (orders.length === 0) orders.push(createBlankOrder());
  activeOrderIdx = 0;
  renderOrderTabs();
  buildProductSections();
  loadOrderToForm(0);
  document.getElementById('form-footer').style.display = 'flex';
  updateFooterCount();
}

function renderOrderTabs() {
  const container = document.getElementById('order-tabs');
  let html = '';
  orders.forEach((_, i) => {
    const en = `Order ${i + 1}`;
    const es = `Pedido ${i + 1}`;
    html += `<button class="order-tab${i === activeOrderIdx ? ' active' : ''}" data-idx="${i}" data-en="${en}" data-es="${es}">${lang === 'es' ? es : en}`;
    if (orders.length > 1) {
      html += `<span class="order-tab-delete" data-delidx="${i}" title="${lang === 'es' ? 'Eliminar' : 'Remove'}">✕</span>`;
    }
    html += `</button>`;
  });
  html += `<button class="order-tab-add" id="add-order-btn">+</button>`;
  container.innerHTML = html;

  container.querySelectorAll('.order-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Don't switch if clicking the delete button
      if (e.target.classList.contains('order-tab-delete')) return;
      switchOrder(parseInt(btn.dataset.idx));
    });
  });
  container.querySelectorAll('.order-tab-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmRemoveOrder(parseInt(btn.dataset.delidx));
    });
  });
  document.getElementById('add-order-btn').addEventListener('click', addOrder);
}

function switchOrder(idx) {
  saveFormToOrder(activeOrderIdx);
  activeOrderIdx = idx;
  renderOrderTabs();
  loadOrderToForm(idx);
  updateFooterCount();
}

function addOrder() {
  saveFormToOrder(activeOrderIdx);
  orders.push(createBlankOrder());
  activeOrderIdx = orders.length - 1;
  renderOrderTabs();
  loadOrderToForm(activeOrderIdx);
  updateFooterCount();
}

function confirmRemoveOrder(idx) {
  const orderLabel = lang === 'es' ? `Pedido ${idx + 1}` : `Order ${idx + 1}`;
  const message = lang === 'es'
    ? `¿Eliminar ${orderLabel}? Esta acción no se puede deshacer.`
    : `Remove ${orderLabel}? This cannot be undone.`;
  showAppConfirm(message, () => removeOrder(idx));
}

function removeOrder(idx) {
  if (orders.length <= 1) return;
  orders.splice(idx, 1);
  if (activeOrderIdx >= orders.length) activeOrderIdx = orders.length - 1;
  else if (activeOrderIdx > idx) activeOrderIdx--;
  else if (activeOrderIdx === idx) activeOrderIdx = Math.min(idx, orders.length - 1);
  renderOrderTabs();
  loadOrderToForm(activeOrderIdx);
  updateFooterCount();
}

/* ═══════════════════════════════════
   IN-APP CONFIRMATION MODAL
   ═══════════════════════════════════ */
function showAppConfirm(message, onConfirm) {
  // Remove existing
  let existing = document.getElementById('app-confirm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'app-confirm-overlay';
  overlay.className = 'app-confirm-overlay';
  overlay.innerHTML = `
    <div class="app-confirm-modal">
      <div class="app-confirm-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p class="app-confirm-message">${message}</p>
      <div class="app-confirm-actions">
        <button class="app-confirm-cancel" id="app-confirm-cancel">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
        <button class="app-confirm-yes" id="app-confirm-yes">${lang === 'es' ? 'Sí, eliminar' : 'Yes, remove'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  overlay.querySelector('#app-confirm-cancel').addEventListener('click', () => hideAppConfirm());
  overlay.querySelector('#app-confirm-yes').addEventListener('click', () => {
    hideAppConfirm();
    if (onConfirm) onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideAppConfirm();
  });
}

function hideAppConfirm() {
  const overlay = document.getElementById('app-confirm-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  }
}

function saveFormToOrder(idx) {
  const o = orders[idx];
  if (!o) return;
  o.business = document.getElementById('field-business').value;
  o.date = document.getElementById('field-date').value;
  o.time = document.getElementById('field-time').value;
  o.ref = document.getElementById('field-ref').value;
  document.querySelectorAll('.qty-input').forEach(inp => {
    o.qty[inp.dataset.key] = parseInt(inp.value) || 0;
  });
}

function loadOrderToForm(idx) {
  const o = orders[idx];
  if (!o) return;
  document.getElementById('field-business').value = o.business;
  document.getElementById('field-date').value = o.date;
  document.getElementById('field-time').value = o.time;
  // Update the display text
  updateTimeDisplay(o.time);
  document.getElementById('field-ref').value = o.ref;
  document.querySelectorAll('.qty-input').forEach(inp => {
    inp.value = o.qty[inp.dataset.key] || 0;
    updateRowHighlight(inp);
  });

}

/* ═══════════════════════════════════
   MY PRODUCTS — HIDE / SHOW
   ═══════════════════════════════════ */
function getAllProductKeys(secKey, sec) {
  return sec.items.map(i => i.key);
}

function getTotalProductCount() {
  let count = 0;
  Object.values(PRODUCTS).forEach(sec => { count += sec.items.length; });
  return count;
}

function getVisibleProductCount() {
  let count = 0;
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => { if (!hiddenProducts.has(item.key)) count++; });
  });
  return count;
}

function saveHiddenProducts() {
  localStorage.setItem('cecilia_hidden_products', JSON.stringify([...hiddenProducts]));
}

function updateMpCounter() {
  const total = getTotalProductCount();
  const visible = getVisibleProductCount();
  const el = document.getElementById('mp-counter');
  if (el) el.textContent = `${visible} / ${total}`;
}

function openMyProducts() {
  const body = document.getElementById('mp-body');
  let html = '';

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    const keys = getAllProductKeys(secKey, sec);
    const allVisible = keys.every(k => !hiddenProducts.has(k));

    html += `<div class="mp-category">`;
    html += `<div class="mp-cat-header">`;
    html += `<span class="mp-cat-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span>`;
    html += `<div class="mp-cat-right">`;
    html += `<span class="mp-cat-toggle-label" data-en="All" data-es="Todo">${lang === 'es' ? 'Todo' : 'All'}</span>`;
    html += `<label class="toggle"><input type="checkbox" data-cat="${secKey}" class="mp-cat-toggle" ${allVisible ? 'checked' : ''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label>`;
    html += `</div></div>`;

    sec.items.forEach(item => {
      const isHidden = hiddenProducts.has(item.key);
      html += `<div class="mp-item${isHidden ? ' hidden' : ''}" data-key="${item.key}">`;
      html += `<span class="mp-item-name" data-en="${item.en}" data-es="${item.es}">${L(item)}</span>`;
      html += `<label class="toggle"><input type="checkbox" class="mp-item-toggle" data-key="${item.key}" ${!isHidden ? 'checked' : ''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label>`;
      html += `</div>`;
    });

    html += `</div>`;
  });

  body.innerHTML = html;
  updateMpCounter();

  // Bind individual product toggles
  body.querySelectorAll('.mp-item-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const key = e.target.dataset.key;
      if (e.target.checked) {
        hiddenProducts.delete(key);
      } else {
        hiddenProducts.add(key);
      }
      saveHiddenProducts();
      updateMpCounter();

      // Update row visual
      const row = e.target.closest('.mp-item');
      if (row) row.classList.toggle('hidden', !e.target.checked);

      // Update category toggle
      const cat = e.target.closest('.mp-category');
      if (cat) {
        const catToggle = cat.querySelector('.mp-cat-toggle');
        const allChecked = [...cat.querySelectorAll('.mp-item-toggle')].every(t => t.checked);
        if (catToggle) catToggle.checked = allChecked;
      }
    });
  });

  // Bind category toggle-all
  body.querySelectorAll('.mp-cat-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const secKey = e.target.dataset.cat;
      const sec = PRODUCTS[secKey];
      if (!sec) return;
      const show = e.target.checked;

      sec.items.forEach(item => {
        if (show) {
          hiddenProducts.delete(item.key);
        } else {
          hiddenProducts.add(item.key);
        }
      });
      saveHiddenProducts();
      updateMpCounter();

      // Update all item toggles within this category
      const cat = e.target.closest('.mp-category');
      if (cat) {
        cat.querySelectorAll('.mp-item-toggle').forEach(t => {
          t.checked = show;
          const row = t.closest('.mp-item');
          if (row) row.classList.toggle('hidden', !show);
        });
      }
    });
  });

  // Slide in
  const view = document.getElementById('settings-products-view');
  view.classList.add('open');
}

function closeMyProducts() {
  const view = document.getElementById('settings-products-view');
  view.classList.remove('open');
  // Rebuild product sections so hidden changes take effect
  buildProductSections();
  // Re-sync any existing order quantities
  if (orders.length > 0) loadOrderIntoForm(currentOrderIdx);
}

/* ═══════════════════════════════════
   BUILD PRODUCT SECTIONS
   ═══════════════════════════════════ */
function buildProductSections() {
  const container = document.getElementById('product-sections');
  let html = '';

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    // Check if entire section is hidden
    const allKeys = getAllProductKeys(secKey, sec);
    const visibleKeys = allKeys.filter(k => !hiddenProducts.has(k));
    if (visibleKeys.length === 0) return; // skip entire section

    html += `<div class="acc-section" data-section-key="${secKey}" id="sec-${secKey}">`;
    html += `<div class="acc-header"><span class="acc-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span><svg class="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>`;
    html += `<div class="acc-body"><div class="prod-table">`;

    if (sec.type === 'redondo') {
      // Render as standard rows — split Inside/Top into separate sub-rows
      sec.items.forEach(item => {
        if (hiddenProducts.has(item.key)) return;
        const hasInside = item.cols.includes('inside');
        const hasTop = item.cols.includes('top');

        if (hasInside) {
          const insideLabel = hasTop
            ? `${L(item)} — ${lang === 'es' ? 'Adentro' : 'Inside'}`
            : L(item);
          const insideLabelEN = hasTop ? `${item.en} — Inside` : item.en;
          const insideLabelES = hasTop ? `${item.es} — Adentro` : item.es;
          html += `<div class="prod-row" data-product="${item.key}"><span class="prod-name" data-en="${insideLabelEN}" data-es="${insideLabelES}">${insideLabel}</span>`;
          html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="Qty" data-es="Cant">${lang === 'es' ? 'Cant' : 'Qty'}</span>${qtyControl(item.key + '_inside')}</div>`;
          html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="No Tkt" data-es="Sin Tkt">${lang === 'es' ? 'Sin Tkt' : 'No Tkt'}</span>${qtyControl(item.key + '_inside_nt')}</div>`;
          html += `</div>`;
        }

        if (hasTop) {
          const topLabel = `${L(item)} — ${lang === 'es' ? 'Arriba' : 'Top'}`;
          html += `<div class="prod-row" data-product="${item.key}"><span class="prod-name" data-en="${item.en} — Top" data-es="${item.es} — Arriba">${topLabel}</span>`;
          html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="Qty" data-es="Cant">${lang === 'es' ? 'Cant' : 'Qty'}</span>${qtyControl(item.key + '_top')}</div>`;
          html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="No Tkt" data-es="Sin Tkt">${lang === 'es' ? 'Sin Tkt' : 'No Tkt'}</span>${qtyControl(item.key + '_top_nt')}</div>`;
          html += `</div>`;
        }
      });
    } else {
      sec.items.forEach(item => {
        if (hiddenProducts.has(item.key)) return;
        html += `<div class="prod-row" data-product="${item.key}"><span class="prod-name" data-en="${item.en}" data-es="${item.es}">${L(item)}</span>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="Qty" data-es="Cant">${lang === 'es' ? 'Cant' : 'Qty'}</span>${qtyControl(item.key)}</div>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label" data-en="No Tkt" data-es="Sin Tkt">${lang === 'es' ? 'Sin Tkt' : 'No Tkt'}</span>${qtyControl(item.key + '_nt')}</div>`;
        html += `</div>`;
      });
    }

    html += `</div></div></div>`;
  });

  container.innerHTML = html;


  // Bind accordion headers
  container.querySelectorAll('.acc-header').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('.acc-section').classList.toggle('open'));
  });

  // Bind qty buttons
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = btn.parentElement.querySelector('.qty-input');
      const cur = parseInt(inp.value) || 0;
      const delta = btn.dataset.dir === '+' ? 1 : -1;
      inp.value = Math.max(0, cur + delta);
      updateRowHighlight(inp);
      updateFooterCount();
      // Prevent browser from scrolling input into view
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });
  });

  // Bind qty focus/blur
  container.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; });
    inp.addEventListener('blur', () => {
      if (inp.value === '') inp.value = '0';
      updateRowHighlight(inp);

      updateFooterCount();
    });
  });

  lucide.createIcons();
}

/* ═══════════════════════════════════
   LOAD PRODUCTS FROM SUPABASE
   ═══════════════════════════════════ */
async function loadDriverProducts() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('b2b_products')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error || !data || data.length === 0) {
      console.warn('Driver: using hardcoded fallback product catalog');
      return;
    }

    const available = data.filter(p => !p.sold_out);

    // Group rows by tag_en — each tag becomes a section
    const grouped = {};
    available.forEach(p => {
      const secKey = p.tag_en.toLowerCase().replace(/\s+/g, '_');
      if (!grouped[secKey]) {
        grouped[secKey] = {
          en: p.tag_en,
          es: p.tag_es || p.tag_en,
          type: 'standard',
          items: []
        };
      }
      grouped[secKey].items.push({
        key: p.name_en.toLowerCase().replace(/\s+/g, '_'),
        en: p.name_en,
        es: p.name_es || p.name_en,
      });
    });

    PRODUCTS = grouped;
    _log('Driver: loaded', data.length, 'products from Supabase');
  } catch (err) {
    console.warn('Driver: product load failed, using hardcoded fallback:', err);
  }
}

// ── Load driver prices into global map (for summary display) ──
async function loadDriverPriceMap() {
  if (!sb || !currentDriver) return;
  try {
    const { data } = await sb
      .from('driver_prices')
      .select('product_key, price')
      .eq('driver_id', currentDriver.id);
    driverPriceMap = {};
    if (data) data.forEach(p => driverPriceMap[p.product_key] = parseFloat(p.price));
    _log('Driver prices loaded:', Object.keys(driverPriceMap).length, 'keys');
  } catch (e) { console.warn('Price map load failed:', e); }
}


function qtyControl(key) {
  return `<div class="qty-wrap"><button class="qty-btn" data-dir="-">−</button><input type="number" class="qty-input" data-key="${key}" value="0" min="0"><button class="qty-btn" data-dir="+">+</button></div>`;
}

function updateRowHighlight(inp) {
  const row = inp.closest('.prod-row');
  if (!row) return;
  const hasVal = Array.from(row.querySelectorAll('.qty-input')).some(i => parseInt(i.value) > 0);
  row.classList.toggle('has-value', hasVal);
}



function updateFooterCount() {
  let total = 0;
  document.querySelectorAll('.qty-input').forEach(inp => {
    total += parseInt(inp.value) || 0;
  });
  document.getElementById('footer-item-count').textContent = total;
  document.getElementById('footer-continue-btn').disabled = total === 0;
}

/* ═══════════════════════════════════
   SEARCH
   ═══════════════════════════════════ */
function handleSearch() {
  const q = document.getElementById('product-search').value.toLowerCase().trim();
  const clearBtn = document.getElementById('search-clear');
  clearBtn.style.display = q ? 'block' : 'none';

  document.querySelectorAll('.acc-section').forEach(sec => {
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

function clearSearch() {
  document.getElementById('product-search').value = '';
  handleSearch();
}

/* ═══════════════════════════════════
   SUMMARY MODAL
   ═══════════════════════════════════ */
let summaryIdx = 0;

function openSummary() {
  if (window._swipeDismissCooldown) return;
  saveFormToOrder(activeOrderIdx);
  summaryIdx = 0;
  renderSummaryOrder(0);
  document.getElementById('summary-overlay').classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  applyLang();
}

function closeSummary() {
  document.getElementById('summary-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
}
window.closeSummary = closeSummary;

function navigateSummary(dir) {
  // Save notes
  orders[summaryIdx].notes = document.getElementById('summary-notes').value;
  summaryIdx = Math.max(0, Math.min(orders.length - 1, summaryIdx + dir));
  renderSummaryOrder(summaryIdx);
}

function renderSummaryOrder(idx) {
  const o = orders[idx];
  const titleEl = document.getElementById('summary-title');
  titleEl.textContent = (lang === 'es' ? `Pedido ${idx+1} de ${orders.length}` : `Order ${idx+1} of ${orders.length}`);
  document.getElementById('summary-prev').disabled = idx === 0;
  document.getElementById('summary-next').disabled = idx === orders.length - 1;

  let html = '';
  // Meta
  if (o.business || o.date || o.time || o.ref) {
    html += '<div class="summary-meta">';
    if (o.business) html += `<div><strong>${lang === 'es' ? 'Negocio' : 'Business'}:</strong> ${o.business}</div>`;
    if (o.date) html += `<div><strong>${lang === 'es' ? 'Fecha' : 'Date'}:</strong> ${o.date}</div>`;
    if (o.time) html += `<div><strong>${lang === 'es' ? 'Hora' : 'Time'}:</strong> ${o.time}</div>`;
    if (o.ref) html += `<div><strong>${lang === 'es' ? 'Ref' : 'Ref'}:</strong> ${o.ref}</div>`;
    html += '</div>';
  }

  // Items by section
  let grandTotal = 0;
  let hasAnyPrice = false;
  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    const items = [];
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        (item.cols || []).forEach(col => {
          const k = item.key + '_' + col;
          const v = o.qty[k] || 0;
          if (v > 0) {
            const colEn = col.replace('_nt', '').replace('inside', 'Inside').replace('top', 'Top');
            const colEs = col.replace('_nt', '').replace('inside', 'Adentro').replace('top', 'Arriba');
            const colLabel = lang === 'es' ? colEs : colEn;
            const isNT = col.includes('nt');
            const price = driverPriceMap[k];
            items.push({ name: `${L(item)} (${colLabel})`, qty: v, nt: isNT, key: k, price });
          }
        });
      } else {
        const v = o.qty[item.key] || 0;
        const vnt = o.qty[item.key + '_nt'] || 0;
        if (v > 0) items.push({ name: L(item), qty: v, nt: false, key: item.key, price: driverPriceMap[item.key] });
        if (vnt > 0) items.push({ name: L(item), qty: vnt, nt: true, key: item.key + '_nt', price: driverPriceMap[item.key + '_nt'] });
      }
    });

    if (items.length > 0) {
      html += `<div class="summary-section"><div class="summary-section-title">${L(sec)}</div>`;
      items.forEach(it => {
        const hasPrice = it.price != null && it.price > 0;
        if (hasPrice) hasAnyPrice = true;
        const priceStr = hasPrice ? `$${it.price.toFixed(2)}` : '—';
        const lineTotal = hasPrice ? it.qty * it.price : 0;
        const lineTotalStr = hasPrice ? `$${lineTotal.toFixed(2)}` : '';
        grandTotal += lineTotal;
        html += `<div class="summary-item">
          <span class="summary-item-name">${it.name}${it.nt ? `<span class="no-ticket-tag">${lang === 'es' ? 'Sin Ticket' : 'No Ticket'}</span>` : ''}</span>
          <span class="summary-item-price-col">
            <span class="summary-item-qty">×${it.qty}</span>
            <span class="summary-item-unit">${priceStr}</span>
            <span class="summary-item-line">${lineTotalStr}</span>
          </span>
        </div>`;
      });
      html += '</div>';
    }
  });

  // Grand total row
  if (hasAnyPrice) {
    html += `<div class="summary-total">
      <span>Total</span>
      <span>$${grandTotal.toFixed(2)}</span>
    </div>`;
  }

  if (!html) html = `<div class="empty-state">${lang === 'es' ? 'Sin artículos' : 'No items'}</div>`;

  document.getElementById('summary-content').innerHTML = html;
  document.getElementById('summary-notes').value = o.notes || '';
}

/* ═══════════════════════════════════
   SUBMIT
   ═══════════════════════════════════ */
async function submitAllOrders() {
  // Save current summary notes
  orders[summaryIdx].notes = document.getElementById('summary-notes').value;

  const submitBtn = document.getElementById('summary-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = lang === 'es' ? 'Enviando...' : 'Submitting...';

  try {
    // ── Fetch driver's prices for price snapshot ──
    const { data: driverPrices } = await sb
      .from('driver_prices')
      .select('product_key, price')
      .eq('driver_id', currentDriver.id);
    const priceMap = {};
    if (driverPrices) driverPrices.forEach(p => priceMap[p.product_key] = parseFloat(p.price));

    // ── EDIT MODE: update existing order ──
    // Helper: collect items from an order object
    function collectItems(o) {
      const items = [];
      Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
        sec.items.forEach(item => {
          if (sec.type === 'redondo') {
            (item.cols || []).forEach(col => {
              const k = item.key + '_' + col;
              const v = o.qty[k] || 0;
              if (v > 0) { const colClean = col.replace('_nt',''); const ntTag = col.endsWith('_nt') ? ' (No Ticket)' : ''; items.push({ product_key: k, product_label: `${item.en} (${colClean})${ntTag}`, quantity: v }); }
            });
          } else {
            const v = o.qty[item.key] || 0;
            const vnt = o.qty[item.key + '_nt'] || 0;
            if (v > 0) items.push({ product_key: item.key, product_label: item.en, quantity: v });
            if (vnt > 0) items.push({ product_key: item.key + '_nt', product_label: item.en + ' (No Ticket)', quantity: vnt });
          }
        });
      });
      return items;
    }

    // ── EDIT MODE ──
    if (driverEditOrderId) {
      // Update the original order (orders[0])
      const o0 = orders[0];
      const items0 = collectItems(o0);

      await sb.from('driver_orders').update({
        business_name: o0.business || null,
        pickup_date: o0.date || null,
        pickup_time: o0.time || null,
        driver_ref: o0.ref || null,
        notes: o0.notes || null,
      }).eq('id', driverEditOrderId);

      await sb.from('driver_order_items').delete().eq('order_id', driverEditOrderId);
      if (items0.length > 0) {
        const orderItems = items0.map(it => ({
          order_id: driverEditOrderId,
          product_key: it.product_key,
          product_label: it.product_label,
          quantity: it.quantity,
          price_at_order: priceMap[it.product_key] || 0,
        }));
        await sb.from('driver_order_items').insert(orderItems);
        const editTotal = orderItems.reduce((sum, it) => sum + it.quantity * it.price_at_order, 0);
        await sb.from('driver_orders').update({ total_amount: editTotal }).eq('id', driverEditOrderId);
      }

      // Get the batch_id from the original order so new orders join the same batch
      const { data: origOrder } = await sb.from('driver_orders').select('batch_id, editable_until').eq('id', driverEditOrderId).single();
      const editBatchId = origOrder?.batch_id || driverEditOrderId;
      const editableUntil = origOrder?.editable_until || new Date(Date.now() + 30 * 60 * 1000).toISOString();

      // Insert any additional orders (orders[1..n]) as new orders in the same batch
      for (let i = 1; i < orders.length; i++) {
        const o = orders[i];
        const items = collectItems(o);
        if (items.length === 0) continue;

        const payload = {
          driver_id: currentDriver.id,
          batch_id: editBatchId,
          business_name: o.business || null,
          pickup_date: o.date || null,
          pickup_time: o.time || null,
          driver_ref: o.ref || null,
          notes: o.notes || null,
          status: 'pending',
          editable_until: editableUntil,
        };

        let newOrder, newErr;
        ({ data: newOrder, error: newErr } = await sb.from('driver_orders').insert(payload).select('id').single());
        if (newErr) {
          delete payload.batch_id;
          ({ data: newOrder, error: newErr } = await sb.from('driver_orders').insert(payload).select('id').single());
        }

        if (newErr) { console.error('Edit add-order error:', newErr); continue; }

        const newItems = items.map(it => ({
          order_id: newOrder.id,
          product_key: it.product_key,
          product_label: it.product_label,
          quantity: it.quantity,
          price_at_order: priceMap[it.product_key] || 0,
        }));
        await sb.from('driver_order_items').insert(newItems);
        const newTotal = newItems.reduce((sum, it) => sum + it.quantity * it.price_at_order, 0);
        await sb.from('driver_orders').update({ total_amount: newTotal }).eq('id', newOrder.id);
      }

      closeSummary();
      document.getElementById('form-footer').style.display = 'none';
      showToast(
        lang === 'es'
          ? `Pedido #${shortOrderId(driverEditOrderId)} actualizado`
          : `Order #${shortOrderId(driverEditOrderId)} updated`,
        'success'
      );
      driverEditOrderId = null;
      orders = [];
      showSection('my-orders');
      return;
    }

    // ── NORMAL MODE: create new orders ──
    const batchId = crypto.randomUUID();
    const editableUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const items = collectItems(o);

      if (items.length === 0) continue;

      // Build order payload
      const orderPayload = {
        driver_id: currentDriver.id,
        batch_id: batchId,
        business_name: o.business || null,
        pickup_date: o.date || null,
        pickup_time: o.time || null,
        driver_ref: o.ref || null,
        notes: o.notes || null,
        status: 'pending',
        editable_until: editableUntil,
      };

      // Insert order (fallback: retry without batch_id if column doesn't exist)
      let orderData, orderErr;
      ({ data: orderData, error: orderErr } = await sb
        .from('driver_orders')
        .insert(orderPayload)
        .select('id')
        .single());

      if (orderErr) {
        // Retry without batch_id in case column doesn't exist
        delete orderPayload.batch_id;
        ({ data: orderData, error: orderErr } = await sb
          .from('driver_orders')
          .insert(orderPayload)
          .select('id')
          .single());
      }

      if (orderErr) {
        console.error(`Order ${i+1} insert error:`, orderErr);
        throw orderErr;
      }

      // Insert items with price snapshot
      const orderItems = items.map(it => ({
        order_id: orderData.id,
        product_key: it.product_key,
        product_label: it.product_label,
        quantity: it.quantity,
        price_at_order: priceMap[it.product_key] || 0,
      }));

      const { error: itemsErr } = await sb.from('driver_order_items').insert(orderItems);
      if (itemsErr) {
        console.error(`Order ${i+1} items insert error:`, itemsErr);
        throw itemsErr;
      }

      // Calculate and set total_amount on the order
      const orderTotal = orderItems.reduce((sum, it) => sum + it.quantity * it.price_at_order, 0);
      await sb.from('driver_orders').update({ total_amount: orderTotal }).eq('id', orderData.id);

      // Push notification handled by admin dashboard realtime subscription
      // (no manual trigger needed — prevents double notification)
    }

    // Success
    closeSummary();
    document.getElementById('form-footer').style.display = 'none';
    orders = [];
    showConfirmation();

  } catch (e) {
    console.error('Submit error:', e);
    showToast(lang === 'es' ? 'Error al enviar los pedidos. Intenta de nuevo.' : 'Error submitting orders. Please try again.', 'error');
  }

  submitBtn.disabled = false;
  submitBtn.textContent = lang === 'es' ? 'Enviar Todos los Pedidos' : 'Submit All Orders';
}

function showConfirmation() {
  const content = document.querySelector('.dash-content');
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');

  let confirmDiv = document.getElementById('section-confirmation');
  if (!confirmDiv) {
    confirmDiv = document.createElement('div');
    confirmDiv.id = 'section-confirmation';
    confirmDiv.className = 'dash-section';
    content.appendChild(confirmDiv);
  }

  confirmDiv.style.display = 'block';
  confirmDiv.innerHTML = `
    <div class="confirm-card">
      <div class="confirm-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
      <h2 class="confirm-title" data-en="Orders Submitted!" data-es="Pedidos Enviados!">${lang === 'es' ? '¡Pedidos Enviados!' : 'Orders Submitted!'}</h2>
      <p class="confirm-sub" data-en="You can edit your orders for the next 30 minutes" data-es="Puedes editar tus pedidos durante los proximos 30 minutos">${lang === 'es' ? 'Puedes editar tus pedidos durante los próximos 30 minutos' : 'You can edit your orders for the next 30 minutes'}</p>
      <button class="confirm-btn" id="confirm-back-btn" data-en="Back to Dashboard" data-es="Volver al Panel">${lang === 'es' ? 'Volver al Panel' : 'Back to Dashboard'}</button>
    </div>`;

  document.getElementById('confirm-back-btn').addEventListener('click', () => {
    confirmDiv.style.display = 'none';
    showSection('overview');
  });
}

/* ═══════════════════════════════════
   IN-APP TOAST NOTIFICATIONS
   ═══════════════════════════════════ */
function showToast(message, type = 'info') {
  // Remove existing toast
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.className = 'app-toast ' + type;
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  });

  // Auto-dismiss after 5s
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

/* ═══════════════════════════════════
   PHASE 5 — DRIVER RECEIPTS & HISTORY
   ═══════════════════════════════════ */
let notificationsEnabled = localStorage.getItem('cecilia_driver_notifications') !== 'false';
let balanceOrders = []; // cached for breakdown modal
let driverRealtimeChannel = null;

// ── PRODUCT LABEL MAP (auto-built from PRODUCTS) ──
const PRODUCT_LABELS = {};
(function buildLabels() {
  Object.values(PRODUCTS).forEach(sec => {
    const secName = sec.en;
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        (item.cols || []).forEach(col => {
          const k = item.key + '_' + col;
          const colLabel = col.replace('_nt', ' (NT)').replace('inside', 'Inside').replace('top', 'Top');
          PRODUCT_LABELS[k] = `${secName} ${item.en} ${colLabel}`;
        });
      } else {
        PRODUCT_LABELS[item.key] = `${secName} — ${item.en}`;
        PRODUCT_LABELS[item.key + '_nt'] = `${secName} — ${item.en} (NT)`;
      }
    });
  });
})();

function productLabel(key, storedLabel) {
  // Prefer stored label if it's a full name (not abbreviated)
  if (storedLabel && storedLabel.length > 3) return storedLabel;
  return PRODUCT_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── SHORT ORDER ID (UUID → readable) ──
function shortOrderId(uuid) {
  if (!uuid) return '???';
  const clean = uuid.replace(/-/g, '');
  return clean.slice(-5).toUpperCase();
}

// ── SMART DATE / TIME LABELS ──
function smartDateLabel(order) {
  const dateVal = order.pickup_date;
  const created = new Date(order.created_at);
  if (dateVal) {
    const d = new Date(dateVal + 'T00:00:00');
    return { label: lang === 'es' ? 'Fecha de Recogida' : 'Pickup Date', value: formatDate(d) };
  }
  return { label: lang === 'es' ? 'Fecha del Pedido' : 'Date Ordered', value: formatDate(created) };
}

function smartTimeLabel(order) {
  const timeVal = order.pickup_time;
  if (timeVal) {
    return { label: lang === 'es' ? 'Hora de Recogida' : 'Pickup Time', value: formatTime(timeVal) };
  }
  const created = new Date(order.created_at);
  const h = created.getHours(), m = created.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { label: lang === 'es' ? 'Hora del Pedido' : 'Time Ordered', value: `${h12}:${String(m).padStart(2,'0')} ${period}` };
}

function formatDate(d) {
  const months = lang === 'es'
    ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(timeStr) {
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr);
  const m = parseInt(mStr);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2,'0')} ${period}`;
}

// ── LOAD DRIVER BALANCE ──
async function loadDriverBalance() {
  if (!sb || !currentDriver) return;
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('id, total_amount, payment_status, payment_amount, business_name, pickup_date, created_at')
      .eq('driver_id', currentDriver.id)
      .in('payment_status', ['not_paid', 'partial']);

    if (error) { console.error('Balance load error:', error); return; }

    balanceOrders = data || [];
    let total = 0;
    balanceOrders.forEach(o => {
      if (o.payment_status === 'not_paid') total += (o.total_amount || 0);
      else if (o.payment_status === 'partial') total += Math.max(0, (o.total_amount || 0) - (o.payment_amount || 0));
    });

    // Update both banners
    const fmt = '$' + total.toFixed(2);
    const colorClass = total === 0 ? 'green' : total >= 100 ? 'red' : 'yellow';

    const el1 = document.getElementById('balance-amount');
    const el2 = document.getElementById('balance-amount-orders');
    [el1, el2].forEach(el => {
      if (!el) return;
      el.textContent = fmt;
      el.className = 'balance-amount ' + colorClass;
    });
  } catch (e) { console.error('Balance error:', e); }
}

// ── GROUP ORDERS BY BATCH ──
function groupOrdersByBatch(orders) {
  const groups = [];
  const batchMap = {};
  orders.forEach(o => {
    const batchKey = o.batch_id || o.id; // solo orders use their own id
    if (batchMap[batchKey]) {
      batchMap[batchKey].push(o);
    } else {
      batchMap[batchKey] = [o];
      groups.push(batchKey);
    }
  });
  return groups.map(key => batchMap[key]);
}

// ── LOAD RECENT ORDERS (Overview) ──
async function loadRecentOrders() {
  if (!sb || !currentDriver) return;
  const container = document.getElementById('recent-orders');
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .eq('driver_id', currentDriver.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) { console.error('Recent orders error:', error); return; }
    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state" data-en="No orders yet" data-es="Aún no hay pedidos">${lang === 'es' ? 'Aún no hay pedidos' : 'No orders yet'}</div>`;
      return;
    }

    const batches = groupOrdersByBatch(data);
    container.innerHTML = batches.slice(0, 5).map(batch => renderOrderCard(batch)).join('');
  } catch (e) { console.error('Recent load error:', e); }
}

// ── LOAD MY ORDERS (Full list) ──
async function loadMyOrders() {
  if (!sb || !currentDriver) return;
  const container = document.getElementById('all-orders');
  try {
    const { data, error } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .eq('driver_id', currentDriver.id)
      .in('status', ['sent', 'pending'])
      .order('created_at', { ascending: false });

    if (error) { console.error('My orders error:', error); return; }
    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state" data-en="No orders yet" data-es="Aún no hay pedidos">${lang === 'es' ? 'Aún no hay pedidos' : 'No orders yet'}</div>`;
      return;
    }

    const batches = groupOrdersByBatch(data);
    container.innerHTML = batches.map(batch => renderOrderCard(batch)).join('');
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { console.error('My orders load error:', e); }
}

// ── EDIT WINDOW HELPERS ──
function isOrderEditable(order) {
  if (order.status !== 'pending') return false;
  if (!order.editable_until) return false;
  return new Date(order.editable_until) > new Date();
}

function getEditTimeRemaining(order) {
  if (!order.editable_until) return null;
  const until = new Date(order.editable_until);
  const now = new Date();
  if (until <= now) return null;
  const ms = until - now;
  const min = Math.ceil(ms / 60000);
  return min;
}

// ── RENDER ORDER CARD ──
// `batch` is an array of orders (1 for solo, N for batch)
function renderOrderCard(batch) {
  const primary = batch[0];
  const isBatch = batch.length > 1;
  const dateInfo = smartDateLabel(primary);
  const timeInfo = smartTimeLabel(primary);

  // Payment badge — use worst status in batch
  let payStatus = 'paid';
  batch.forEach(o => {
    if (o.payment_status !== 'paid' && o.payment_status !== 'partial') payStatus = 'not_paid';
    if (o.payment_status === 'partial' && payStatus === 'paid') payStatus = 'partial';
  });
  let payBadge = '';
  if (payStatus === 'paid') {
    payBadge = `<span class="pay-badge paid">${lang === 'es' ? 'Pagado' : 'Paid'}</span>`;
  } else if (payStatus === 'partial') {
    payBadge = `<span class="pay-badge partial">${lang === 'es' ? 'Parcial' : 'Partial'}</span>`;
  } else {
    payBadge = `<span class="pay-badge not-paid">${lang === 'es' ? 'No Pagado' : 'Not Paid'}</span>`;
  }

  // Business names
  const bizNames = batch.map(o => _esc(o.business_name || (lang === 'es' ? 'Sin nombre' : 'No name')));
  const bizDisplay = isBatch ? bizNames.join(' · ') : bizNames[0];

  // Combined total
  const combinedTotal = batch.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const totalStr = combinedTotal > 0 ? `$${combinedTotal.toFixed(2)}` : '';

  // Edit indicator (use primary)
  let editIndicator = '';
  if (primary.status === 'pending') {
    const minLeft = getEditTimeRemaining(primary);
    if (minLeft !== null) {
      editIndicator = `<div class="edit-indicator active"><i data-lucide="pencil"></i> ${minLeft} min</div>`;
    } else {
      editIndicator = `<div class="edit-indicator locked"><i data-lucide="lock"></i> ${lang === 'es' ? 'Bloqueado' : 'Locked'}</div>`;
    }
  }

  const statusDot = primary.status === 'pending'
    ? `<span class="status-dot pending"></span>` : '';

  const orderIds = batch.map(o => o.id).join(',');
  const batchLabel = isBatch ? `<span class="batch-count">${batch.length} ${lang === 'es' ? 'pedidos' : 'orders'}</span>` : '';

  return `
    <div class="order-card" onclick="showOrderDetail('${orderIds}')">
      <div class="order-card-row1">
        <div class="order-card-name">${bizDisplay}</div>
        <div class="order-card-total">${totalStr}</div>
      </div>
      <div class="order-card-row2">
        <div class="order-card-left">${statusDot}${payBadge}${batchLabel}<span class="order-card-id">#${shortOrderId(primary.id)}</span></div>
        <div class="order-card-date">${dateInfo.value} · ${timeInfo.value}</div>
      </div>
      ${editIndicator ? `<div class="order-card-edit">${editIndicator}</div>` : ''}
    </div>`;
}

// ── ORDER DETAIL MODAL ──
let driverEditOrderId = null; // Track which order is being edited

// Batch detail state
let _batchOrders = [];
let _batchIdx = 0;

window.showOrderDetail = async function(orderIdStr) {
  if (window._swipeDismissCooldown) return;
  if (!sb) return;
  const overlay = document.getElementById('order-detail-overlay');
  const ids = orderIdStr.split(',');

  try {
    // Fetch all orders in batch
    const { data: fetchedOrders, error } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .in('id', ids);

    if (error || !fetchedOrders || fetchedOrders.length === 0) {
      console.error('Detail load error:', error);
      return;
    }

    // Preserve the same order as the IDs
    _batchOrders = ids.map(id => fetchedOrders.find(o => o.id === id)).filter(Boolean);
    _batchIdx = 0;

    renderOrderInDetail(_batchIdx);

    overlay.classList.add('open');
    document.body.dataset.scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  } catch (e) { console.error('Order detail error:', e); }
};

window.batchDetailNav = function(dir) {
  _batchIdx = Math.max(0, Math.min(_batchOrders.length - 1, _batchIdx + dir));
  renderOrderInDetail(_batchIdx);
};

function renderOrderInDetail(idx) {
  const order = _batchOrders[idx];
  if (!order) return;
  const isBatch = _batchOrders.length > 1;

  // Batch nav bar
  let batchNavHtml = '';
  if (isBatch) {
    batchNavHtml = `<div class="batch-nav">
      <button class="batch-nav-btn" onclick="batchDetailNav(-1)" ${idx === 0 ? 'disabled' : ''}>‹</button>
      <span>${lang === 'es' ? 'Pedido' : 'Order'} ${idx + 1} ${lang === 'es' ? 'de' : 'of'} ${_batchOrders.length}</span>
      <button class="batch-nav-btn" onclick="batchDetailNav(1)" ${idx === _batchOrders.length - 1 ? 'disabled' : ''}>›</button>
    </div>`;
  }

  // Title
  document.getElementById('order-detail-title').textContent =
    `${lang === 'es' ? 'Pedido' : 'Order'} #${shortOrderId(order.id)}`;

  // Badge
  let badgeHtml = '';
  if (order.payment_status === 'paid') {
    badgeHtml = `<span class="pay-badge paid">${lang === 'es' ? 'Pagado' : 'Paid'}</span>`;
  } else if (order.payment_status === 'partial') {
    badgeHtml = `<span class="pay-badge partial">${lang === 'es' ? 'Parcial' : 'Partial'}</span>`;
  } else {
    badgeHtml = `<span class="pay-badge not-paid">${lang === 'es' ? 'No Pagado' : 'Not Paid'}</span>`;
  }
  document.getElementById('order-detail-badge').innerHTML = badgeHtml;

  // Edit indicator
  let editBannerHtml = '';
  const editable = isOrderEditable(order);
  if (order.status === 'pending') {
    const minLeft = getEditTimeRemaining(order);
    if (editable && minLeft !== null) {
      editBannerHtml = `<div class="edit-indicator active" style="margin-bottom:10px">
        <i data-lucide="pencil"></i> ${lang === 'es' ? `Editable por ${minLeft} min más` : `Editable for ${minLeft} more min`}
      </div>`;
    } else {
      editBannerHtml = `<div class="edit-indicator locked" style="margin-bottom:10px">
        <i data-lucide="lock"></i> ${lang === 'es' ? 'Este pedido ya no se puede editar' : 'This order can no longer be edited'}
      </div>`;
    }
  }

  // Meta
  const dateInfo = smartDateLabel(order);
  const timeInfo = smartTimeLabel(order);
  const bizName = _esc(order.business_name || (lang === 'es' ? 'Sin nombre' : 'No name'));
  let metaHtml = `
    <span><i data-lucide="store"></i>${bizName}</span>
    <span><i data-lucide="calendar"></i>${dateInfo.label}: ${dateInfo.value}</span>
    <span><i data-lucide="clock"></i>${timeInfo.label}: ${timeInfo.value}</span>
  `;
  if (order.driver_ref) {
    metaHtml += `<span><i data-lucide="hash"></i>${lang === 'es' ? 'Ref' : 'Ref'}: ${_esc(order.driver_ref)}</span>`;
  }
  document.getElementById('order-detail-meta').innerHTML = batchNavHtml + editBannerHtml + `<div class="order-detail-meta-inner">${metaHtml}</div>`;

  // Items
  const items = order.driver_order_items || [];
  if (items.length === 0) {
    document.getElementById('order-detail-items').innerHTML =
      `<div class="empty-state">${lang === 'es' ? 'Sin artículos' : 'No items'}</div>`;
  } else {
    let itemsHtml = '';
    let grandTotal = 0;
    let hasAnyPrice = false;

    const keyCat = {};
    Object.values(PRODUCTS).forEach(sec => {
      sec.items.forEach(item => {
        keyCat[item.key] = sec;
        keyCat[item.key + '_nt'] = sec;
        if (sec.type === 'redondo') {
          (item.cols || []).forEach(col => { keyCat[item.key + '_' + col] = sec; });
        }
      });
    });

    let lastCat = '';
    items.forEach(item => {
      const label = productLabel(item.product_key, item.product_label);
      const origQty = item.quantity;
      const adminQty = item.admin_qty;
      const effectiveQty = adminQty ?? origQty;
      const price = parseFloat(item.price_at_order || 0);
      const hasPrice = price > 0;
      if (hasPrice) hasAnyPrice = true;
      const lineTotal = effectiveQty * price;
      grandTotal += lineTotal;
      let qtyDisplay = `×${effectiveQty}`;
      let adjHtml = '';

      if (adminQty != null && adminQty !== origQty) {
        const diff = adminQty - origQty;
        const sign = diff > 0 ? '+' : '';
        adjHtml = `<span class="order-detail-item-adj">(${origQty} → ${adminQty}, ${sign}${diff} ${lang === 'es' ? 'en recogida' : 'at pickup'})</span>`;
      }

      const cat = keyCat[item.product_key];
      const catLabel = cat ? L(cat) : '';
      if (catLabel && catLabel !== lastCat) {
        itemsHtml += `<div class="order-detail-cat-header">${catLabel}</div>`;
        lastCat = catLabel;
      }

      let cleanLabel = label.replace(/\s*\(No Ticket\)/i, '').replace(/_nt\b/g, '');
      const isNT = (item.product_key && item.product_key.endsWith('_nt')) || label.includes('(No Ticket)');

      const priceStr = hasPrice ? `$${price.toFixed(2)}` : '—';
      const lineTotalStr = hasPrice ? `$${lineTotal.toFixed(2)}` : '';

      itemsHtml += `
        <div class="order-detail-item">
          <span class="order-detail-item-name">${_esc(cleanLabel)}${isNT ? `<span class="no-ticket-tag">✕ ${lang === 'es' ? 'Sin Ticket' : 'No Ticket'}</span>` : ''}${adjHtml}</span>
          <span class="order-detail-item-prices">
            <span class="order-detail-item-qty">${qtyDisplay}</span>
            <span class="order-detail-item-unit">${priceStr}</span>
            <span class="order-detail-item-line">${lineTotalStr}</span>
          </span>
        </div>`;
    });

    if (hasAnyPrice) {
      itemsHtml += `
        <div class="order-detail-total">
          <span>Total</span>
          <span>$${grandTotal.toFixed(2)}</span>
        </div>`;
    }

    document.getElementById('order-detail-items').innerHTML = itemsHtml;
  }

  // Notes
  const notesEl = document.getElementById('order-detail-notes');
  if (order.notes) {
    notesEl.style.display = 'block';
    notesEl.innerHTML = `<strong>${lang === 'es' ? 'Notas' : 'Notes'}</strong>${_esc(order.notes)}`;
  } else {
    notesEl.style.display = 'none';
  }

  // Edit button
  let actionsEl = document.getElementById('order-detail-actions');
  if (!actionsEl) {
    actionsEl = document.createElement('div');
    actionsEl.id = 'order-detail-actions';
    actionsEl.className = 'order-detail-actions';
    const itemsContainer = document.getElementById('order-detail-items');
    itemsContainer.parentNode.insertBefore(actionsEl, itemsContainer.nextSibling);
  }
  if (editable) {
    actionsEl.innerHTML = `<button class="edit-order-btn" onclick="editOrder('${order.id}')">
      <i data-lucide="pencil"></i> ${lang === 'es' ? 'Editar Pedido' : 'Edit Order'}
    </button>`;
    actionsEl.style.display = 'block';
  } else {
    actionsEl.style.display = 'none';
  }

  lucide.createIcons();
}

function closeOrderDetail() {
  document.getElementById('order-detail-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
}
window.closeOrderDetail = closeOrderDetail;

// ── EDIT ORDER (30-MIN WINDOW) ──
window.editOrder = async function(orderId) {
  if (!sb) return;
  closeOrderDetail();

  try {
    const { data: order, error } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .eq('id', orderId)
      .single();

    if (error || !order) { showToast(lang === 'es' ? 'Error cargando pedido' : 'Error loading order', 'error'); return; }
    if (!isOrderEditable(order)) {
      showToast(lang === 'es' ? 'Este pedido ya no se puede editar' : 'This order can no longer be edited', 'error');
      return;
    }

    // Set edit mode
    driverEditOrderId = orderId;

    // Switch to order form
    showSection('new-order');

    // Pre-fill header fields (use correct IDs matching the form)
    document.getElementById('field-business').value = order.business_name || '';
    document.getElementById('field-date').value = order.pickup_date || '';
    document.getElementById('field-ref').value = order.driver_ref || '';
    // Set time hidden input + display
    if (order.pickup_time) {
      document.getElementById('field-time').value = order.pickup_time;
      updateTimeDisplay(order.pickup_time);
    }

    // Pre-fill quantities — reset all to 0 first
    document.querySelectorAll('.qty-input').forEach(inp => { inp.value = 0; });

    // Set quantities from saved items
    const items = order.driver_order_items || [];
    items.forEach(item => {
      const input = document.querySelector(`.qty-input[data-key="${item.product_key}"]`);
      if (input) {
        input.value = item.quantity;
        updateRowHighlight(input);
      }
    });

    // Save populated data into orders[0] so saveFormToOrder captures it
    saveFormToOrder(0);

    // Update footer count
    updateFooterCount();

    // Show editing banner
    showToast(
      lang === 'es'
        ? `Editando pedido #${shortOrderId(orderId)}. Haz cambios y presiona Continuar.`
        : `Editing order #${shortOrderId(orderId)}. Make changes and press Continue.`,
      'info'
    );
  } catch (e) {
    console.error('Edit order error:', e);
    showToast(lang === 'es' ? 'Error cargando pedido' : 'Error loading order', 'error');
  }
};

function formatTime12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr12 = h % 12 || 12;
  return `${hr12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── BALANCE BREAKDOWN MODAL ──
window.showBalanceBreakdown = function() {
  if (window._swipeDismissCooldown) return;
  const overlay = document.getElementById('balance-modal-overlay');
  const totalEl = document.getElementById('balance-modal-total');
  const listEl = document.getElementById('balance-modal-list');

  let total = 0;
  balanceOrders.forEach(o => {
    if (o.payment_status === 'not_paid') total += (o.total_amount || 0);
    else if (o.payment_status === 'partial') total += Math.max(0, (o.total_amount || 0) - (o.payment_amount || 0));
  });

  const colorClass = total === 0 ? 'green' : total >= 100 ? 'red' : 'yellow';
  totalEl.innerHTML = `<span class="balance-amount ${colorClass}">$${total.toFixed(2)}</span>`;

  if (balanceOrders.length === 0) {
    listEl.innerHTML = `<div class="balance-empty">${lang === 'es' ? 'No hay saldo pendiente' : 'No outstanding balance'}</div>`;
  } else {
    let html = '';
    balanceOrders.forEach(o => {
      const remaining = o.payment_status === 'not_paid'
        ? (o.total_amount || 0)
        : Math.max(0, (o.total_amount || 0) - (o.payment_amount || 0));
      const dateVal = o.pickup_date || (o.created_at ? o.created_at.split('T')[0] : '');
      const d = new Date(dateVal + 'T00:00:00');
      const dateStr = formatDate(d);
      const biz = o.business_name || (lang === 'es' ? 'Sin nombre' : 'No name');
      const paidStr = o.payment_status === 'partial'
        ? `${lang === 'es' ? 'Pagado' : 'Paid'}: $${(o.payment_amount || 0).toFixed(2)} / $${(o.total_amount || 0).toFixed(2)}`
        : `${lang === 'es' ? 'Total' : 'Total'}: $${(o.total_amount || 0).toFixed(2)}`;

      html += `
        <div class="balance-item">
          <div class="balance-item-info">
            <div class="balance-item-biz">${biz} <span style="color:var(--tx-faint);font-weight:400">#${shortOrderId(o.id)}</span></div>
            <div class="balance-item-date">${dateStr}</div>
            <div class="balance-item-detail">${paidStr}</div>
          </div>
          <div class="balance-item-remaining">$${remaining.toFixed(2)}</div>
        </div>`;
    });
    listEl.innerHTML = html;
  }

  overlay.classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  lucide.createIcons();
};

function closeBalanceBreakdown() {
  document.getElementById('balance-modal-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
}
window.closeBalanceBreakdown = closeBalanceBreakdown;

// ── REALTIME SUBSCRIPTION ──
function setupDriverRealtime() {
  if (!sb || !currentDriver) return;
  // Clean up previous channel
  if (driverRealtimeChannel) {
    sb.removeChannel(driverRealtimeChannel);
  }

  driverRealtimeChannel = sb
    .channel('driver-orders-' + currentDriver.id)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'driver_orders',
      filter: 'driver_id=eq.' + currentDriver.id
    }, (payload) => {
      _log('Driver realtime event:', payload);
      // Refresh data
      loadDriverBalance();
      loadRecentOrders();
      // If on My Orders tab, refresh that too
      const myOrdersSection = document.getElementById('section-my-orders');
      if (myOrdersSection && myOrdersSection.style.display !== 'none') {
        loadMyOrders();
      }

      // Chime if order was just confirmed/sent
      if (payload.eventType === 'UPDATE' && payload.new && payload.new.status === 'sent') {
        if (notificationsEnabled) {
          playChime();
          const msg = lang === 'es'
            ? 'Tu pedido ha sido confirmado'
            : 'Your order has been confirmed';
          showToast(msg, 'success');
          showBrowserNotification(
            lang === 'es' ? 'Pedido Confirmado' : 'Order Confirmed',
            msg,
            'my-orders'
          );
        }
      }
    })
    .subscribe((status) => {
      _log('Driver realtime status:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Driver realtime disconnected, reconnecting in 3s...');
        setTimeout(() => setupDriverRealtime(), 3000);
      }
    });
}

// ── AUDIO CHIME (Web Audio API) ──
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Two-note chime: E5 → G5
    [659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.5);
    });
  } catch (e) { console.warn('Chime error:', e); }
}

// ── BROWSER NOTIFICATION API ──
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      _log('Notification permission:', perm);
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
    tag: 'cecilia-driver-' + Date.now(),
    data: { url: '/driver-order', section }
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

// ── LANGUAGE SYNC TO SUPABASE ──
async function syncLangFromSupabase() {
  if (!sb || !currentDriver) return;
  try {
    const { data } = await sb.from('drivers').select('language').eq('id', currentDriver.id).single();
    if (data && data.language && data.language !== lang) {
      setLang(data.language);
    }
  } catch (e) { /* ignore */ }
}

async function saveLangToSupabase(newLang) {
  if (!sb || !currentDriver) return;
  try {
    await sb.from('drivers').update({ language: newLang }).eq('id', currentDriver.id);
  } catch (e) { /* ignore */ }
}

/* ═══════════════════════════════════
   SALES — SUPABASE FUNCTIONS
   ═══════════════════════════════════ */
let _saleQty = {};   // product_key → quantity
let _saleClientId = null;
let _lastSaleId = null;

function _copyReceiptLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast(lang === 'es' ? '¡Link copiado!' : 'Link copied!', 'success');
  }).catch(() => {
    prompt(lang === 'es' ? 'Copia este link:' : 'Copy this link:', url);
  });
}

async function generateReceiptNumber() {
  const now = new Date();
  const dateStr = now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0');
  const prefix = 'CB-' + dateStr + '-';

  try {
    const { data } = await sb
      .from('driver_sales')
      .select('receipt_number')
      .like('receipt_number', prefix + '%')
      .order('receipt_number', { ascending: false })
      .limit(1);

    let seq = 1;
    if (data && data.length > 0) {
      const lastNum = data[0].receipt_number;
      const lastSeq = parseInt(lastNum.split('-').pop()) || 0;
      seq = lastSeq + 1;
    }
    return prefix + String(seq).padStart(4, '0');
  } catch (e) {
    console.error('Receipt number generation error:', e);
    return prefix + String(Math.floor(Math.random() * 9000) + 1000);
  }
}

async function saveSale(saleData, items) {
  if (!sb || !currentDriver) return null;
  try {
    const { data: sale, error: saleErr } = await sb
      .from('driver_sales')
      .insert({
        receipt_number: saleData.receipt_number,
        driver_id: currentDriver.id,
        client_id: saleData.client_id,
        total: saleData.total,
        payment_method: saleData.payment_method,
        payment_status: saleData.payment_status,
        notes: saleData.notes || null,
      })
      .select()
      .single();

    if (saleErr) throw saleErr;

    // Insert items
    const saleItems = items.map(it => ({
      sale_id: sale.id,
      product_key: it.product_key,
      product_label: it.product_label,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
    }));

    const { error: itemsErr } = await sb
      .from('driver_sale_items')
      .insert(saleItems);

    if (itemsErr) throw itemsErr;

    return sale;
  } catch (e) {
    console.error('Save sale error:', e);
    return null;
  }
}

async function loadTodaysSales() {
  if (!sb || !currentDriver) return [];
  try {
    const today = getTodayStr();
    const { data, error } = await sb
      .from('driver_sales')
      .select('*')
      .eq('driver_id', currentDriver.id)
      .gte('created_at', today + 'T00:00:00')
      .lte('created_at', today + 'T23:59:59')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('Load today sales error:', e);
    return [];
  }
}

/* ═══════════════════════════════════
   SALES — UI
   ═══════════════════════════════════ */
async function initSalesSection() {
  // Ensure prices are loaded
  if (Object.keys(driverPriceMap).length === 0) {
    await loadDriverPriceMap();
  }

  // Load clients for dropdown
  if (!_clientsList || _clientsList.length === 0) {
    await loadDriverClients();
  }

  const selector = document.getElementById('sale-client-selector');
  const noClients = document.getElementById('sale-no-clients');
  const productsDiv = document.getElementById('sale-products');

  if (!_clientsList || _clientsList.length === 0) {
    selector.style.display = 'none';
    noClients.style.display = 'block';
    productsDiv.style.display = 'none';
    document.getElementById('sale-footer').style.display = 'none';
    document.getElementById('sale-today-banner').style.display = 'none';
    applyLang();
    lucide.createIcons();
    return;
  }

  selector.style.display = 'block';
  noClients.style.display = 'none';
  productsDiv.style.display = 'block';
  document.getElementById('sale-footer').style.display = 'flex';

  // Populate dropdown
  const dropdown = document.getElementById('sale-client-dropdown');
  const currentVal = dropdown.value;
  dropdown.innerHTML = `<option value="">${lang === 'es' ? 'Seleccionar cliente...' : 'Select a client...'}</option>`;
  _clientsList.forEach(c => {
    dropdown.innerHTML += `<option value="${c.id}">${_esc(c.business_name)}</option>`;
  });
  if (currentVal) dropdown.value = currentVal;
  _saleClientId = dropdown.value || null;

  dropdown.onchange = () => {
    _saleClientId = dropdown.value || null;
    updateSaleFooter();
  };

  // Build product list
  buildSaleProducts();

  // Load today's sales summary
  loadTodaysSalesBanner();

  updateSaleFooter();
  applyLang();
  requestAnimationFrame(() => lucide.createIcons());
}

function buildSaleProducts() {
  const container = document.getElementById('sale-products');
  let html = '';

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    // Skip redondo for sales — simplify to standard items only
    if (sec.type === 'redondo') return;

    // Filter to visible products
    const visibleItems = sec.items.filter(item => !hiddenProducts.has(item.key));
    if (visibleItems.length === 0) return;

    html += `<div class="sale-acc" data-section-key="${secKey}">`;
    html += `<div class="sale-acc-header"><span class="sale-acc-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span><svg class="sale-acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>`;
    html += `<div class="sale-acc-body">`;

    visibleItems.forEach(item => {
      const price = driverPriceMap[item.key];
      const hasPrice = price != null && price > 0;
      const priceStr = hasPrice ? `$${price.toFixed(2)}` : (lang === 'es' ? 'Sin precio' : 'No price');
      const qty = _saleQty[item.key] || 0;
      const lineTotal = hasPrice && qty > 0 ? (qty * price).toFixed(2) : '';

      html += `<div class="sale-prod-row${qty > 0 ? ' has-value' : ''}" data-key="${item.key}">`;
      html += `<div class="sale-prod-info">`;
      html += `<div class="sale-prod-name" data-en="${item.en}" data-es="${item.es}">${L(item)}</div>`;
      html += `<div class="sale-prod-price${hasPrice ? '' : ' no-price'}">${priceStr}</div>`;
      html += `</div>`;
      html += `<div class="sale-qty-wrap"><button class="sale-qty-btn" data-dir="-" data-key="${item.key}">−</button><input type="number" class="sale-qty-input" data-key="${item.key}" value="${qty}" min="0"><button class="sale-qty-btn" data-dir="+" data-key="${item.key}">+</button></div>`;
      html += `<span class="sale-line-total" data-key="${item.key}">${lineTotal ? '$' + lineTotal : ''}</span>`;
      html += `</div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;

  // Bind accordion
  container.querySelectorAll('.sale-acc-header').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('.sale-acc').classList.toggle('open'));
  });

  // Bind qty buttons
  container.querySelectorAll('.sale-qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.dataset.key;
      const inp = container.querySelector(`.sale-qty-input[data-key="${key}"]`);
      const cur = parseInt(inp.value) || 0;
      const delta = btn.dataset.dir === '+' ? 1 : -1;
      const newVal = Math.max(0, cur + delta);
      inp.value = newVal;
      _saleQty[key] = newVal;
      updateSaleRow(key);
      updateSaleFooter();
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });
  });

  // Bind qty input
  container.querySelectorAll('.sale-qty-input').forEach(inp => {
    inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; });
    inp.addEventListener('blur', () => {
      if (inp.value === '') inp.value = '0';
      _saleQty[inp.dataset.key] = parseInt(inp.value) || 0;
      updateSaleRow(inp.dataset.key);
      updateSaleFooter();
    });
  });
}

function updateSaleRow(key) {
  const row = document.querySelector(`.sale-prod-row[data-key="${key}"]`);
  if (!row) return;
  const qty = _saleQty[key] || 0;
  const price = driverPriceMap[key];
  const hasPrice = price != null && price > 0;
  const lineEl = row.querySelector('.sale-line-total');
  if (lineEl) lineEl.textContent = (hasPrice && qty > 0) ? '$' + (qty * price).toFixed(2) : '';
  row.classList.toggle('has-value', qty > 0);
}

function getSaleTotal() {
  let total = 0;
  Object.entries(_saleQty).forEach(([key, qty]) => {
    if (qty > 0) {
      const price = driverPriceMap[key] || 0;
      total += qty * price;
    }
  });
  return total;
}

function getSaleItemCount() {
  let count = 0;
  Object.values(_saleQty).forEach(q => { count += (q || 0); });
  return count;
}

function updateSaleFooter() {
  const total = getSaleTotal();
  const count = getSaleItemCount();
  document.getElementById('sale-footer-total').textContent = '$' + total.toFixed(2);
  const btn = document.getElementById('sale-complete-btn');
  btn.disabled = !_saleClientId || count === 0;
}

async function loadTodaysSalesBanner() {
  const banner = document.getElementById('sale-today-banner');
  const sales = await loadTodaysSales();
  if (sales.length === 0) {
    banner.style.display = 'none';
    return;
  }
  const todayTotal = sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
  document.getElementById('sale-today-amount').textContent = '$' + todayTotal.toFixed(2) + ` (${sales.length})`;
  banner.style.display = 'flex';
}

/* ── Payment Modal ── */
function openPaymentModal() {
  const total = getSaleTotal();
  document.getElementById('pay-modal-total-display').textContent = '$' + total.toFixed(2);
  document.getElementById('pay-notes').value = '';

  // Reset toggles to defaults
  document.querySelectorAll('#pay-method-group .pay-toggle-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#pay-method-group .pay-toggle-btn[data-value="cash"]').classList.add('active');
  document.querySelectorAll('#pay-status-group .pay-toggle-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#pay-status-group .pay-toggle-btn[data-value="paid"]').classList.add('active');

  const overlay = document.getElementById('pay-modal-overlay');
  overlay.classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  applyLang();
  lucide.createIcons();
}

function closePaymentModal() {
  document.getElementById('pay-modal-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
}

async function handleConfirmSale() {
  const confirmBtn = document.getElementById('pay-modal-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = lang === 'es' ? 'Procesando...' : 'Processing...';

  try {
    const receiptNumber = await generateReceiptNumber();
    const payMethod = document.querySelector('#pay-method-group .pay-toggle-btn.active')?.dataset.value || 'cash';
    const payStatus = document.querySelector('#pay-status-group .pay-toggle-btn.active')?.dataset.value || 'paid';
    const notes = document.getElementById('pay-notes').value.trim();
    const total = getSaleTotal();

    // Collect items
    const items = [];
    Object.entries(_saleQty).forEach(([key, qty]) => {
      if (qty > 0) {
        const price = driverPriceMap[key] || 0;
        // Find label from PRODUCTS
        let label = key;
        Object.values(PRODUCTS).forEach(sec => {
          sec.items.forEach(item => {
            if (item.key === key) label = item.en;
          });
        });
        items.push({
          product_key: key,
          product_label: label,
          quantity: qty,
          unit_price: price,
          line_total: qty * price,
        });
      }
    });

    const saleData = {
      receipt_number: receiptNumber,
      client_id: _saleClientId,
      total: total,
      payment_method: payMethod,
      payment_status: payStatus,
      notes: notes,
    };

    const sale = await saveSale(saleData, items);

    if (!sale) {
      showToast(lang === 'es' ? 'Error al guardar la venta' : 'Error saving sale', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = lang === 'es' ? 'Confirmar Venta' : 'Confirm Sale';
      return;
    }

    closePaymentModal();

    // Get client info for receipt
    const client = _clientsList.find(c => c.id === _saleClientId);

    // Show receipt
    renderReceipt(sale, items, client);
    _lastSaleId = sale.id;
    showScreen('receipt');

    // Reset form
    _saleQty = {};
    _saleClientId = null;

    showToast(
      lang === 'es' ? `Venta ${receiptNumber} completada` : `Sale ${receiptNumber} completed`,
      'success'
    );

    // Decrement inventory after sale
    if (inventoryLoaded) {
      items.forEach(it => {
        if (driverInventory[it.product_key]) {
          driverInventory[it.product_key].sold += it.quantity;
          driverInventory[it.product_key].remaining -= it.quantity;
        }
      });
    }

  } catch (e) {
    console.error('Confirm sale error:', e);
    showToast(lang === 'es' ? 'Error al procesar la venta' : 'Error processing sale', 'error');
  }

  confirmBtn.disabled = false;
  confirmBtn.textContent = lang === 'es' ? 'Confirmar Venta' : 'Confirm Sale';
}

/* ── Receipt Rendering ── */
function renderReceipt(sale, items, client) {
  const paper = document.getElementById('receipt-paper');
  const now = new Date(sale.created_at || new Date());
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const payMethodLabel = sale.payment_method === 'cash'
    ? (lang === 'es' ? 'Efectivo' : 'Cash')
    : (lang === 'es' ? 'Cheque' : 'Check');
  const payStatusLabel = sale.payment_status === 'paid'
    ? (lang === 'es' ? 'Pagado' : 'Paid')
    : sale.payment_status === 'on_account'
      ? (lang === 'es' ? 'A Cuenta' : 'On Account')
      : (lang === 'es' ? 'Sin Pagar' : 'Unpaid');

  let itemsHtml = '';
  items.forEach(it => {
    itemsHtml += `<div class="receipt-item">
      <span class="receipt-item-name">${_esc(it.product_label)} (${it.quantity})</span>
      <span class="receipt-item-total">$${it.line_total.toFixed(2)}</span>
    </div>`;
  });

  paper.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-logo">CECILIA BAKERY</div>
      <div class="receipt-sub">Freshly Baked with Love</div>
    </div>

    <div class="receipt-meta">
      <div><strong>${lang === 'es' ? 'Recibo' : 'Receipt'} #:</strong> ${_esc(sale.receipt_number)}</div>
      <div><strong>${lang === 'es' ? 'Fecha' : 'Date'}:</strong> ${dateStr} ${timeStr}</div>
      <div><strong>${lang === 'es' ? 'Conductor' : 'Driver'}:</strong> ${_esc(currentDriver?.name || '')}</div>
      ${client ? `<div><strong>${lang === 'es' ? 'Cliente' : 'Client'}:</strong> ${_esc(client.business_name)}</div>` : ''}
      ${client?.address ? `<div><strong>${lang === 'es' ? 'Dir' : 'Addr'}:</strong> ${_esc(client.address)}</div>` : ''}
      ${client?.phone ? `<div><strong>${lang === 'es' ? 'Tel' : 'Phone'}:</strong> ${_esc(client.phone)}</div>` : ''}
    </div>

    <div class="receipt-items">
      ${itemsHtml}
    </div>

    <div class="receipt-total-row">
      <span>TOTAL</span>
      <span>$${sale.total.toFixed(2)}</span>
    </div>

    <div class="receipt-pay-info">
      <div><strong>${lang === 'es' ? 'Método' : 'Method'}:</strong> ${payMethodLabel}</div>
      <div><strong>${lang === 'es' ? 'Estado' : 'Status'}:</strong> ${payStatusLabel}</div>
    </div>

    ${sale.notes ? `<div class="receipt-notes">${_esc(sale.notes)}</div>` : ''}

    <div class="receipt-footer">¡Gracias! / Thank you!</div>
  `;

  applyLang();
}

/* ═══════════════════════════════════
   CLIENTS — SUPABASE FUNCTIONS
   ═══════════════════════════════════ */
let _clientsList = [];
let _editingClientId = null;

async function loadDriverClients() {
  if (!sb || !currentDriver) return;
  const container = document.getElementById('clients-list');
  try {
    const { data, error } = await sb
      .from('driver_route_clients')
      .select('*')
      .eq('driver_id', currentDriver.id)
      .eq('is_active', true)
      .order('business_name', { ascending: true });

    if (error) { console.error('Clients load error:', error); return; }
    _clientsList = data || [];
    renderClientsList();
  } catch (e) { console.error('Clients error:', e); }
}

async function saveClient(clientData) {
  if (!sb || !currentDriver) return null;
  try {
    const payload = {
      driver_id: currentDriver.id,
      business_name: clientData.business_name,
      contact_name: clientData.contact_name || null,
      phone: clientData.phone || null,
      address: clientData.address || null,
      notes: clientData.notes || null,
    };

    if (clientData.id) {
      // Update existing
      const { data, error } = await sb
        .from('driver_route_clients')
        .update(payload)
        .eq('id', clientData.id)
        .eq('driver_id', currentDriver.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      // Insert new
      const { data, error } = await sb
        .from('driver_route_clients')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  } catch (e) {
    console.error('Save client error:', e);
    return null;
  }
}

async function deleteClient(clientId) {
  if (!sb || !currentDriver) return false;
  try {
    const { error } = await sb
      .from('driver_route_clients')
      .update({ is_active: false })
      .eq('id', clientId)
      .eq('driver_id', currentDriver.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Delete client error:', e);
    return false;
  }
}

/* ═══════════════════════════════════
   CLIENTS — UI
   ═══════════════════════════════════ */
function renderClientsList() {
  const container = document.getElementById('clients-list');
  if (!_clientsList || _clientsList.length === 0) {
    container.innerHTML = `<div class="empty-state clients-empty" data-en="No clients yet. Add your first client to start making sales." data-es="Aún no hay clientes. Agrega tu primer cliente para comenzar a vender.">${lang === 'es' ? 'Aún no hay clientes. Agrega tu primer cliente para comenzar a vender.' : 'No clients yet. Add your first client to start making sales.'}</div>`;
    return;
  }

  let html = '';
  _clientsList.forEach(c => {
    const name = _esc(c.business_name);
    const addr = c.address ? _esc(c.address.length > 35 ? c.address.slice(0, 35) + '…' : c.address) : '';
    const phone = c.phone ? _esc(c.phone) : '';
    const contact = c.contact_name ? _esc(c.contact_name) : '';

    html += `<div class="client-card" data-client-id="${c.id}">
      <div class="client-card-row1">
        <div class="client-card-name">${name}</div>
        <div class="client-card-actions">
          <button class="client-card-edit" onclick="event.stopPropagation();openClientModal('${c.id}')" title="${lang === 'es' ? 'Editar' : 'Edit'}"><i data-lucide="pencil"></i></button>
          <button class="client-card-delete" onclick="event.stopPropagation();confirmDeleteClient('${c.id}','${name.replace(/'/g, "\\'") }')" title="${lang === 'es' ? 'Eliminar' : 'Delete'}"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
      <div class="client-card-row2">`;
    if (addr) html += `<span class="client-card-detail"><i data-lucide="map-pin"></i>${addr}</span>`;
    if (phone) html += `<span class="client-card-detail"><i data-lucide="phone"></i>${phone}</span>`;
    if (contact) html += `<span class="client-card-detail"><i data-lucide="user"></i>${contact}</span>`;
    if (!addr && !phone && !contact) html += `<span class="client-card-detail" style="color:var(--tx-faint)">${lang === 'es' ? 'Sin detalles' : 'No details'}</span>`;
    html += `</div></div>`;
  });

  container.innerHTML = html;
  requestAnimationFrame(() => lucide.createIcons());
}

function openClientModal(clientId) {
  _editingClientId = clientId || null;
  const titleEl = document.getElementById('client-modal-title');

  // Clear form
  document.getElementById('client-field-business').value = '';
  document.getElementById('client-field-contact').value = '';
  document.getElementById('client-field-phone').value = '';
  document.getElementById('client-field-address').value = '';
  document.getElementById('client-field-notes').value = '';
  document.getElementById('client-field-business').classList.remove('field-error');

  if (clientId) {
    // Edit mode: populate form
    const client = _clientsList.find(c => c.id === clientId);
    if (client) {
      document.getElementById('client-field-business').value = client.business_name || '';
      document.getElementById('client-field-contact').value = client.contact_name || '';
      document.getElementById('client-field-phone').value = client.phone || '';
      document.getElementById('client-field-address').value = client.address || '';
      document.getElementById('client-field-notes').value = client.notes || '';
    }
    titleEl.setAttribute('data-en', 'Edit Client');
    titleEl.setAttribute('data-es', 'Editar Cliente');
    titleEl.textContent = lang === 'es' ? 'Editar Cliente' : 'Edit Client';
  } else {
    titleEl.setAttribute('data-en', 'Add Client');
    titleEl.setAttribute('data-es', 'Agregar Cliente');
    titleEl.textContent = lang === 'es' ? 'Agregar Cliente' : 'Add Client';
  }

  const overlay = document.getElementById('client-modal-overlay');
  overlay.classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  applyLang();
  lucide.createIcons();
}
window.openClientModal = openClientModal;

function closeClientModal() {
  document.getElementById('client-modal-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
  _editingClientId = null;
}
window.closeClientModal = closeClientModal;

async function handleSaveClient() {
  const businessInput = document.getElementById('client-field-business');
  const businessName = businessInput.value.trim();

  if (!businessName) {
    businessInput.classList.add('field-error');
    businessInput.focus();
    showToast(lang === 'es' ? 'El nombre del negocio es requerido' : 'Business name is required', 'error');
    return;
  }
  businessInput.classList.remove('field-error');

  const saveBtn = document.getElementById('client-modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = lang === 'es' ? 'Guardando...' : 'Saving...';

  const clientData = {
    id: _editingClientId || undefined,
    business_name: businessName,
    contact_name: document.getElementById('client-field-contact').value.trim(),
    phone: document.getElementById('client-field-phone').value.trim(),
    address: document.getElementById('client-field-address').value.trim(),
    notes: document.getElementById('client-field-notes').value.trim(),
  };

  const result = await saveClient(clientData);

  saveBtn.disabled = false;
  saveBtn.textContent = lang === 'es' ? 'Guardar' : 'Save';

  if (result) {
    closeClientModal();
    showToast(
      _editingClientId
        ? (lang === 'es' ? 'Cliente actualizado' : 'Client updated')
        : (lang === 'es' ? 'Cliente agregado' : 'Client added'),
      'success'
    );
    await loadDriverClients();
  } else {
    showToast(lang === 'es' ? 'Error al guardar el cliente' : 'Error saving client', 'error');
  }
}

window.confirmDeleteClient = function(clientId, clientName) {
  const message = lang === 'es'
    ? `¿Eliminar "${clientName}"? Esta acción no se puede deshacer.`
    : `Remove "${clientName}"? This cannot be undone.`;
  showAppConfirm(message, async () => {
    const ok = await deleteClient(clientId);
    if (ok) {
      showToast(lang === 'es' ? 'Cliente eliminado' : 'Client removed', 'success');
      await loadDriverClients();
    } else {
      showToast(lang === 'es' ? 'Error al eliminar el cliente' : 'Error removing client', 'error');
    }
  });
};

/* ═══════════════════════════════════
   CUSTOM SCROLLABLE TIME PICKER
   ═══════════════════════════════════ */
let tpHour = 12, tpMinute = 0, tpPeriod = 'AM';

function initTimePickerColumns() {
  const hourInner = document.getElementById('tp-hour-inner');
  const minuteInner = document.getElementById('tp-minute-inner');
  const periodInner = document.getElementById('tp-period-inner');

  // Build hours 1-12
  let hHtml = '';
  for (let h = 1; h <= 12; h++) {
    hHtml += `<div class="tp-item" data-val="${h}">${h}</div>`;
  }
  hourInner.innerHTML = hHtml;

  // Build minutes 00, 05, 10, ..., 55
  let mHtml = '';
  for (let m = 0; m < 60; m += 5) {
    const label = String(m).padStart(2, '0');
    mHtml += `<div class="tp-item" data-val="${m}">${label}</div>`;
  }
  minuteInner.innerHTML = mHtml;

  // Build AM/PM
  periodInner.innerHTML =
    `<div class="tp-item" data-val="AM">AM</div>` +
    `<div class="tp-item" data-val="PM">PM</div>`;

  // Set up scroll listeners for selection highlighting
  setupScrollHighlight(document.getElementById('tp-hour'), 'hour');
  setupScrollHighlight(document.getElementById('tp-minute'), 'minute');
  setupScrollHighlight(document.getElementById('tp-period'), 'period');
}

function setupScrollHighlight(colEl, type) {
  let scrollTimer;
  colEl.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      updateSelectedItem(colEl, type);
    }, 60);
  });
}

function updateSelectedItem(colEl, type) {
  const items = colEl.querySelectorAll('.tp-item');
  const colRect = colEl.getBoundingClientRect();
  const centerY = colRect.top + colRect.height / 2;
  let closest = null;
  let closestDist = Infinity;

  items.forEach(item => {
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.top + itemRect.height / 2;
    const dist = Math.abs(itemCenter - centerY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
    item.classList.remove('selected');
  });

  if (closest) {
    closest.classList.add('selected');
    const val = closest.dataset.val;
    if (type === 'hour') tpHour = parseInt(val);
    else if (type === 'minute') tpMinute = parseInt(val);
    else tpPeriod = val;
  }
}

function scrollToValue(colEl, value) {
  const items = colEl.querySelectorAll('.tp-item');
  items.forEach(item => {
    if (item.dataset.val === String(value)) {
      // Scroll the item to center
      const colHeight = colEl.clientHeight;
      const itemOffset = item.offsetTop - colEl.querySelector('.tp-col-inner').offsetTop;
      const scrollTarget = itemOffset - (colHeight / 2) + (item.clientHeight / 2);
      colEl.scrollTop = scrollTarget;
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function openTimePicker() {
  // Parse existing value from the hidden input
  const currentVal = document.getElementById('field-time').value;
  if (currentVal) {
    const [hStr, mStr] = currentVal.split(':');
    let h = parseInt(hStr);
    const m = parseInt(mStr);
    if (h === 0) { tpHour = 12; tpPeriod = 'AM'; }
    else if (h === 12) { tpHour = 12; tpPeriod = 'PM'; }
    else if (h > 12) { tpHour = h - 12; tpPeriod = 'PM'; }
    else { tpHour = h; tpPeriod = 'AM'; }
    // Round minute to nearest 5
    tpMinute = Math.round(m / 5) * 5;
    if (tpMinute >= 60) tpMinute = 55;
  } else {
    tpHour = 12; tpMinute = 0; tpPeriod = 'AM';
  }

  document.getElementById('tp-overlay').classList.add('open');
  document.body.dataset.scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${window.scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  applyLang();

  // Scroll to values after the modal is visible
  requestAnimationFrame(() => {
    setTimeout(() => {
      scrollToValue(document.getElementById('tp-hour'), tpHour);
      scrollToValue(document.getElementById('tp-minute'), tpMinute);
      scrollToValue(document.getElementById('tp-period'), tpPeriod);
    }, 50);
  });
}

function closeTimePicker() {
  document.getElementById('tp-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
}
window.closeTimePicker = closeTimePicker;

function confirmTimePicker() {
  // Convert to 24h for the hidden input
  let h24 = tpHour;
  if (tpPeriod === 'AM' && tpHour === 12) h24 = 0;
  else if (tpPeriod === 'PM' && tpHour !== 12) h24 = tpHour + 12;

  const timeValue = String(h24).padStart(2, '0') + ':' + String(tpMinute).padStart(2, '0');
  document.getElementById('field-time').value = timeValue;
  updateTimeDisplay(timeValue);
  closeTimePicker();
}

function updateTimeDisplay(timeValue) {
  const displayEl = document.getElementById('field-time-display');
  const textEl = document.getElementById('field-time-text');

  if (!timeValue) {
    textEl.textContent = textEl.getAttribute('data-' + lang + '-placeholder') || 'Select time';
    displayEl.classList.remove('has-value');
    return;
  }

  const [hStr, mStr] = timeValue.split(':');
  let h = parseInt(hStr);
  const m = parseInt(mStr);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;

  textEl.textContent = `${h}:${String(m).padStart(2, '0')} ${period}`;
  displayEl.classList.add('has-value');
}

/* ═══════════════════════════════════
   INVENTORY TAB
   ═══════════════════════════════════ */
async function loadInventoryTab() {
  const banner = document.getElementById('inv-source-banner');
  const summary = document.getElementById('inv-summary');
  const form = document.getElementById('inv-load-form');

  banner.innerHTML = '';
  summary.innerHTML = `<div class="empty-state">${lang === 'es' ? 'Cargando inventario...' : 'Loading inventory...'}</div>`;
  form.style.display = 'none';

  await loadInventoryData();

  if (inventoryLoaded) {
    renderInventoryBanner();
    renderInventorySummary();
    form.style.display = 'none';
  } else {
    banner.innerHTML = '';
    summary.innerHTML = '';
    form.style.display = 'block';
    renderManualLoadForm();
  }
  applyLang();
}

async function loadInventoryData() {
  if (!sb || !currentDriver) return;
  try {
    const today = getTodayStr();

    // Step 1: Check for picked_up orders today
    const { data: pickedUpOrders, error: e1 } = await sb
      .from('driver_orders')
      .select('id, order_number')
      .eq('driver_id', currentDriver.id)
      .eq('status', 'picked_up')
      .eq('pickup_date', today);

    if (!e1 && pickedUpOrders && pickedUpOrders.length > 0) {
      const orderIds = pickedUpOrders.map(o => o.id);
      const { data: orderItems, error: e2 } = await sb
        .from('driver_order_items')
        .select('product_key, quantity, adjusted_quantity')
        .in('order_id', orderIds);

      if (!e2 && orderItems && orderItems.length > 0) {
        // Aggregate by product_key (keep _nt separate)
        const loadMap = {};
        orderItems.forEach(item => {
          const qty = (item.adjusted_quantity !== null && item.adjusted_quantity !== undefined)
            ? item.adjusted_quantity : item.quantity;
          loadMap[item.product_key] = (loadMap[item.product_key] || 0) + qty;
        });

        // Get today's sold quantities
        const soldMap = await getTodaySoldMap();

        driverInventory = {};
        Object.entries(loadMap).forEach(([key, loaded]) => {
          const sold = soldMap[key] || 0;
          driverInventory[key] = { loaded, sold, remaining: loaded - sold };
        });

        const orderNums = pickedUpOrders
          .map(o => o.order_number ? '#' + o.order_number : null)
          .filter(Boolean);
        inventorySource = 'order:' + (orderNums.length > 0 ? orderNums.join(', ') : 'Order');
        inventoryLoaded = true;
        return;
      }
    }

    // Step 2: Fall back to manual driver_inventory
    const { data: loadRows, error: e3 } = await sb
      .from('driver_inventory')
      .select('product_key, morning_load')
      .eq('driver_id', currentDriver.id)
      .eq('date', today);

    if (!e3 && loadRows && loadRows.length > 0) {
      const soldMap = await getTodaySoldMap();
      driverInventory = {};
      loadRows.forEach(row => {
        const sold = soldMap[row.product_key] || 0;
        driverInventory[row.product_key] = { loaded: row.morning_load, sold, remaining: row.morning_load - sold };
      });
      inventorySource = 'manual';
      inventoryLoaded = true;
      return;
    }

    // No inventory for today
    inventoryLoaded = false;
  } catch (e) {
    console.error('Inventory load error:', e);
    inventoryLoaded = false;
  }
}

async function getTodaySoldMap() {
  const soldMap = {};
  if (!sb || !currentDriver) return soldMap;
  try {
    const today = getTodayStr();
    const { data: sales } = await sb
      .from('driver_sales')
      .select('id')
      .eq('driver_id', currentDriver.id)
      .gte('created_at', today + 'T00:00:00');

    if (sales && sales.length > 0) {
      const saleIds = sales.map(s => s.id);
      const { data: items } = await sb
        .from('driver_sale_items')
        .select('product_key, quantity')
        .in('sale_id', saleIds);

      if (items) {
        items.forEach(it => {
          soldMap[it.product_key] = (soldMap[it.product_key] || 0) + it.quantity;
        });
      }
    }
  } catch (e) { console.error('Sold map error:', e); }
  return soldMap;
}

function renderInventoryBanner() {
  const banner = document.getElementById('inv-source-banner');
  if (!banner) return;

  const isOrder = inventorySource.indexOf('order:') === 0;
  const label = isOrder
    ? '📦 ' + inventorySource.replace('order:', lang === 'es' ? 'Cargado de Pedido ' : 'From Order ')
    : '✏️ ' + (lang === 'es' ? 'Carga Manual' : 'Manual Entry');
  const cls = isOrder ? 'inv-banner order' : 'inv-banner manual';

  banner.innerHTML = `<div class="${cls}">${label}</div>`;
}

function renderInventorySummary() {
  const container = document.getElementById('inv-summary');
  if (!container) return;

  const keys = Object.keys(driverInventory);
  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-state">${lang === 'es' ? 'Sin inventario hoy' : 'No inventory today'}</div>`;
    return;
  }

  // Build a product_key → label map from PRODUCTS catalog
  const labelMap = {};
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      labelMap[item.key] = L(item);
      // For redondo sub-variants
      if (item.cols) {
        item.cols.forEach(col => {
          const subKey = item.key + '_' + col;
          const isNT = col.endsWith('_nt');
          const base = isNT ? col.replace('_nt', '') : col;
          const colLabel = base.charAt(0).toUpperCase() + base.slice(1);
          labelMap[subKey] = L(item) + ' — ' + colLabel + (isNT ? ' NT' : '');
        });
      }
    });
  });

  // Group by category
  let html = '';
  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    // Find items in this category that are in inventory
    const matching = [];
    sec.items.forEach(item => {
      // Check base key
      if (driverInventory[item.key]) {
        matching.push({ key: item.key, label: labelMap[item.key] || item.key, ...driverInventory[item.key] });
      }
      // Check sub-variants (redondo)
      if (item.cols) {
        item.cols.forEach(col => {
          const subKey = item.key + '_' + col;
          if (driverInventory[subKey]) {
            matching.push({ key: subKey, label: labelMap[subKey] || subKey, ...driverInventory[subKey] });
          }
        });
      }
    });

    if (matching.length === 0) return;

    html += `<div class="inv-category">`;
    html += `<div class="inv-cat-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</div>`;
    matching.forEach(p => {
      const statusClass = p.remaining <= 0 ? 'out' : p.remaining < 3 ? 'low' : '';
      html += `<div class="inv-card ${statusClass}">`;
      html += `<div class="inv-card-name">${_esc(p.label)}</div>`;
      html += `<div class="inv-card-counts">`;
      html += `<span class="inv-count-loaded">${p.loaded}</span>`;
      html += `<span class="inv-count-sep">→</span>`;
      html += `<span class="inv-count-remaining ${statusClass}">${p.remaining}</span>`;
      html += `</div>`;
      html += `</div>`;
    });
    html += `</div>`;
  });

  // Also show any keys that didn't match a known category
  const knownKeys = new Set();
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      knownKeys.add(item.key);
      if (item.cols) item.cols.forEach(col => knownKeys.add(item.key + '_' + col));
    });
  });
  const unknown = keys.filter(k => !knownKeys.has(k));
  if (unknown.length > 0) {
    html += `<div class="inv-category"><div class="inv-cat-title">Other</div>`;
    unknown.forEach(k => {
      const p = driverInventory[k];
      const statusClass = p.remaining <= 0 ? 'out' : p.remaining < 3 ? 'low' : '';
      html += `<div class="inv-card ${statusClass}">`;
      html += `<div class="inv-card-name">${_esc(labelMap[k] || k)}</div>`;
      html += `<div class="inv-card-counts">`;
      html += `<span class="inv-count-loaded">${p.loaded}</span>`;
      html += `<span class="inv-count-sep">→</span>`;
      html += `<span class="inv-count-remaining ${statusClass}">${p.remaining}</span>`;
      html += `</div></div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

function renderManualLoadForm() {
  const container = document.getElementById('inv-load-form');
  if (!container) return;

  let html = `<div class="inv-form-intro">`;
  html += `<p data-en="Enter how many of each product you're loading today." data-es="Ingresa cuántos de cada producto cargas hoy.">${lang === 'es' ? 'Ingresa cuántos de cada producto cargas hoy.' : "Enter how many of each product you're loading today."}</p>`;
  html += `</div>`;

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    const visibleItems = sec.items.filter(item => !hiddenProducts.has(item.key));
    if (visibleItems.length === 0) return;

    html += `<div class="inv-form-section">`;
    html += `<div class="inv-form-cat" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</div>`;

    visibleItems.forEach(item => {
      if (sec.type === 'redondo' && item.cols) {
        // Redondo sub-variants
        item.cols.forEach(col => {
          const subKey = item.key + '_' + col;
          const isNT = col.endsWith('_nt');
          const base = isNT ? col.replace('_nt', '') : col;
          const colLabel = base.charAt(0).toUpperCase() + base.slice(1);
          const fullLabel = L(item) + ' — ' + colLabel + (isNT ? ' NT' : '');
          html += `<div class="inv-form-row">`;
          html += `<span class="inv-form-label">${_esc(fullLabel)}</span>`;
          html += `<input type="number" class="inv-form-input" data-pk="${subKey}" min="0" value="0" inputmode="numeric">`;
          html += `</div>`;
        });
      } else {
        html += `<div class="inv-form-row">`;
        html += `<span class="inv-form-label" data-en="${item.en}" data-es="${item.es}">${L(item)}</span>`;
        html += `<input type="number" class="inv-form-input" data-pk="${item.key}" min="0" value="0" inputmode="numeric">`;
        html += `</div>`;
      }
    });

    html += `</div>`;
  });

  html += `<button class="inv-save-btn" id="inv-save-btn" data-en="Save Inventory" data-es="Guardar Inventario">${lang === 'es' ? 'Guardar Inventario' : 'Save Inventory'}</button>`;

  container.innerHTML = html;

  // Bind save
  document.getElementById('inv-save-btn').addEventListener('click', saveManualLoad);

  // Focus behavior on inputs
  container.querySelectorAll('.inv-form-input').forEach(inp => {
    inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; });
    inp.addEventListener('blur', () => { if (inp.value === '') inp.value = '0'; });
  });
}

async function saveManualLoad() {
  if (!sb || !currentDriver) return;
  const btn = document.getElementById('inv-save-btn');
  btn.disabled = true;
  btn.textContent = lang === 'es' ? 'Guardando...' : 'Saving...';

  try {
    const today = getTodayStr();
    const rows = [];
    document.querySelectorAll('.inv-form-input').forEach(inp => {
      const val = parseInt(inp.value) || 0;
      if (val > 0) {
        rows.push({
          driver_id: currentDriver.id,
          product_key: inp.dataset.pk,
          morning_load: val,
          date: today
        });
      }
    });

    if (rows.length === 0) {
      showToast(lang === 'es' ? 'Ingresa al menos un producto' : 'Enter at least one product', 'error');
      btn.disabled = false;
      btn.textContent = lang === 'es' ? 'Guardar Inventario' : 'Save Inventory';
      return;
    }

    const { error } = await sb
      .from('driver_inventory')
      .upsert(rows, { onConflict: 'driver_id,product_key,date' });

    if (error) throw error;

    // Set in-memory state
    driverInventory = {};
    rows.forEach(r => {
      driverInventory[r.product_key] = { loaded: r.morning_load, sold: 0, remaining: r.morning_load };
    });
    inventorySource = 'manual';
    inventoryLoaded = true;

    showToast(lang === 'es' ? 'Inventario guardado' : 'Inventory saved', 'success');
    loadInventoryTab();
  } catch (e) {
    console.error('Save inventory error:', e);
    showToast(lang === 'es' ? 'Error al guardar' : 'Error saving inventory', 'error');
    btn.disabled = false;
    btn.textContent = lang === 'es' ? 'Guardar Inventario' : 'Save Inventory';
  }
}
