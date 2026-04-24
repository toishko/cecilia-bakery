/* ═══════════════════════════════════
   SUPABASE INIT
   ═══════════════════════════════════ */
// M1: Production-safe logger — silences debug logs on production
const __DEV__ = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const _log = __DEV__ ? console.log.bind(console) : () => { };

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
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ═══════════════════════════════════
   SCREEN MANAGEMENT
   ═══════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

function showSection(name) {
  // Always scroll to top when switching sections
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Close any open settings sub-views (e.g. My Products)
  document.querySelectorAll('.settings-subview.open').forEach(sv => sv.classList.remove('open'));

  const toolsSections = ['sales', 'inventory', 'clients'];
  let activeSection = name;
  let activeTool = null;

  if (toolsSections.includes(name)) {
    activeSection = 'tools';
    activeTool = name;
  } else if (name === 'tools') {
    activeTool = 'inventory'; // Default
  }

  // Hide all sections, show target
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById('section-' + activeSection);
  if (target) target.style.display = 'block';

  // If a tool is active, switch panes
  if (activeTool) {
    document.querySelectorAll('.tool-pane').forEach(p => p.style.display = 'none');
    const pane = document.getElementById('tool-pane-' + activeTool);
    if (pane) pane.style.display = 'block';
    
    // Update pills
    document.querySelectorAll('#tools-nav-pills .insights-pill').forEach(btn => {
      if (btn.dataset.tool === activeTool) {
        btn.classList.add('active');
        // Update header name based on active tool
        const sectionNameEl = document.getElementById('mobile-section-name');
        if (sectionNameEl) {
          sectionNameEl.textContent = btn.getAttribute('data-' + lang) || btn.textContent;
          sectionNameEl.setAttribute('data-en', btn.getAttribute('data-en'));
          sectionNameEl.setAttribute('data-es', btn.getAttribute('data-es'));
        }
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Determine which bottom nav tab should be active
  const isSettings = name === 'settings';
  const bottomNavActiveTarget = isSettings ? 'settings' : activeSection;

  // Update active state on sidebar, bottom nav
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === name));
  document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === bottomNavActiveTarget));

  // Update mobile section name dynamically (if not handled by tool pill)
  if (!activeTool) {
    const sectionNameEl = document.getElementById('mobile-section-name');
    if (sectionNameEl) {
      const btn = document.querySelector(`.sidebar-nav-item[data-section="${name}"]`) || document.querySelector(`.bottom-nav-item[data-section="${name}"]`);
      if (btn) {
        const spanEl = btn.querySelector('span[data-en]');
        if (spanEl) {
          sectionNameEl.textContent = spanEl.getAttribute('data-' + lang) || spanEl.textContent;
          sectionNameEl.setAttribute('data-en', spanEl.getAttribute('data-en'));
          sectionNameEl.setAttribute('data-es', spanEl.getAttribute('data-es'));
        }
      } else if (name === 'settings') {
        sectionNameEl.textContent = lang === 'es' ? 'Configuración' : 'Settings';
        sectionNameEl.setAttribute('data-en', 'Settings');
        sectionNameEl.setAttribute('data-es', 'Configuración');
      }
    }
  }

  // Show/hide footer and init order form
  const footer = document.getElementById('form-footer');
  const saleFooter = document.getElementById('sale-footer');
  const mobileLogo = document.getElementById('mobile-logo');
  const headerBackBtn = document.getElementById('header-back-btn');

  if (name === 'new-order') {
    initOrderForm();
    footer.style.display = 'flex';
    saleFooter.style.display = 'none';
    document.body.classList.add('immersive-mode');
    if(mobileLogo) mobileLogo.style.display = 'none';
    if(headerBackBtn) headerBackBtn.style.display = 'none';
    // Transform FAB: + → mic if voice enabled
    _showVoiceFab(true);
  } else if (activeTool === 'sales') {
    footer.style.display = 'none';
    saleFooter.style.display = 'flex';
    initSalesSection();
    document.body.classList.remove('immersive-mode');
    if(mobileLogo) mobileLogo.style.display = 'none';
    if(headerBackBtn) headerBackBtn.style.display = 'inline-flex';
    _showVoiceFab(false);
  } else {
    footer.style.display = 'none';
    saleFooter.style.display = 'none';
    document.body.classList.remove('immersive-mode');
    if(mobileLogo) mobileLogo.style.display = 'block';
    if(headerBackBtn) headerBackBtn.style.display = 'none';
    _showVoiceFab(false);
  }

  // Execute loaders
  if (name === 'my-orders') {
    loadDriverBalance();
    loadMyOrders();
  }
  if (name === 'overview') {
    loadDriverBalance();
    loadRecentOrders();
    loadDriverClients();
    loadOverviewDashboard();
  }
  if (activeTool === 'clients') {
    loadDriverClients();
  }
  if (activeTool === 'inventory') {
    loadInventoryTab();
  }

  requestAnimationFrame(() => lucide.createIcons());
  window.scrollTo({ top: 0, behavior: 'instant' });
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
  showSection('overview');
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
  // Load overview analytics for all drivers
  loadDriverClients();
  loadOverviewDashboard();
  // Check scanner feature flag
  checkAdvancedFeatures();
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
  // Sidebar nav items (desktop fallback)
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // Bottom nav items
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      showSection(section);
    });
  });

  // Tools Sub-tabs
  document.querySelectorAll('#tools-nav-pills .insights-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      showSection(btn.dataset.tool);
    });
  });

  document.getElementById('new-order-cta')?.addEventListener('click', () => showSection('new-order'));

  // ── Quick action cards (overview) ──
  document.getElementById('qa-new-order')?.addEventListener('click', () => showSection('new-order'));
  document.getElementById('qa-log-sale')?.addEventListener('click', () => showSection('sales'));
  document.getElementById('qa-inventory')?.addEventListener('click', () => showSection('inventory'));
  document.getElementById('qa-clients')?.addEventListener('click', () => showSection('clients'));

  // ── Overview filter ──
  document.getElementById('overview-filter')?.addEventListener('change', (e) => {
    loadOverviewDashboard(e.target.value);
  });

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
    showScreen('dashboard');
    showSection('sales');
    document.getElementById('bottom-nav').style.display = 'flex';
  });

  document.getElementById('receipt-delete-btn')?.addEventListener('click', async () => {
    if (!window._currentReceiptSaleId) return;
    const msg = lang === 'es' 
      ? '¿Estás seguro de que quieres borrar esta venta? Se eliminará permanentemente y el inventario se restaurará.' 
      : 'Are you sure you want to delete this sale? It will be permanently removed and inventory will be restored.';
    if (!confirm(msg)) return;

    try {
      const deleteBtn = document.getElementById('receipt-delete-btn');
      deleteBtn.disabled = true;

      // Delete items first (just in case no CASCADE)
      const { error: err1 } = await sb.from('driver_sale_items').delete().eq('sale_id', window._currentReceiptSaleId);
      if (err1) throw err1;
      
      // Delete sale
      const { error: err2 } = await sb.from('driver_sales').delete().eq('id', window._currentReceiptSaleId);
      if (err2) throw err2;

      showToast(lang === 'es' ? 'Venta borrada' : 'Sale deleted', 'success');

      // Force inventory recalculation
      inventoryLoaded = false;
      driverInventory = {};

      // Close receipt
      showScreen('dashboard');
      
      // If we came from 'my-orders' (sales filter), refresh it
      if (document.getElementById('section-my-orders').style.display === 'block') {
        loadMyOrders();
      } else {
        showSection('sales');
      }
      document.getElementById('bottom-nav').style.display = 'flex';

    } catch (e) {
      console.error('Error deleting sale:', e);
      showToast(lang === 'es' ? 'Error al borrar' : 'Error deleting', 'error');
    } finally {
      document.getElementById('receipt-delete-btn').disabled = false;
    }
  });

  document.getElementById('receipt-print-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('receipt-share-btn')?.addEventListener('click', async () => {
    if (!window._cachedReceiptSale) return;
    const sale = window._cachedReceiptSale;
    const itemsText = sale.driver_sale_items ? sale.driver_sale_items.map(it => `${it.quantity}x ${it.product_label} - $${parseFloat(it.line_total).toFixed(2)}`).join('\n') : '';
    
    const text = `Cecilia Bakery\n${lang === 'es' ? 'Recibo #' : 'Receipt #'}: ${sale.receipt_number || 'N/A'}\n${lang === 'es' ? 'Total:' : 'Total:'} $${parseFloat(sale.total).toFixed(2)}\n\n${lang === 'es' ? 'Artículos:' : 'Items:'}\n${itemsText}\n\n${lang === 'es' ? '¡Gracias!' : 'Thank you!'}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: lang === 'es' ? 'Recibo de Cecilia Bakery' : 'Cecilia Bakery Receipt',
          text: text
        });
      } catch (e) {
        // AbortError is thrown when user cancels the share dialog, no need to toast.
        console.error('Share aborted or failed:', e);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(text);
        showToast(lang === 'es' ? 'Recibo copiado al portapapeles' : 'Receipt copied to clipboard', 'success');
      } catch (e) {
        showToast(lang === 'es' ? 'No se pudo compartir' : 'Could not share', 'error');
      }
    }
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
  document.getElementById('balance-modal-close')?.addEventListener('click', closeBalanceBreakdown);
  document.getElementById('balance-modal-overlay')?.addEventListener('click', (e) => {
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
  document.getElementById('footer-cancel-btn').addEventListener('click', () => {
    document.querySelector('.bottom-nav-item[data-section=overview]').click();
  });
  _initClientProfileEvents();
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
      { key: 'pina', en: 'Piña', es: 'Piña', cols: ['inside', 'inside_nt', 'top', 'top_nt'] },
      { key: 'guava', en: 'Guava', es: 'Guayaba', cols: ['inside', 'inside_nt', 'top', 'top_nt'] },
      { key: 'dulce', en: 'Dulce De Leche', es: 'Dulce De Leche', cols: ['inside', 'inside_nt'] },
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
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
  const total = orders.length;
  orders.forEach((_, i) => {
    const en = `Order ${i + 1}`;
    const es = `Pedido ${i + 1}`;
    html += `<button class="order-tab${i === activeOrderIdx ? ' active' : ''}" data-idx="${i}" data-en="${en}" data-es="${es}">${lang === 'es' ? es : en}`;
    if (orders.length > 1) {
      html += `<span class="order-tab-delete" data-delidx="${i}" title="${lang === 'es' ? 'Eliminar' : 'Remove'}">✕</span>`;
    }
    html += `</button>`;
  });
  html += `<button class="order-tab-add" id="add-order-btn">`;
  html += `+ <span class="tab-count-badge">${total} ${lang === 'es' ? 'Total' : 'Total'}</span>`;
  html += `</button>`;
  container.innerHTML = html;

  // Fluid slide-in animation if a new tab was just added
  if (container._lastTabCount !== undefined && total > container._lastTabCount) {
    const tabs = container.querySelectorAll('.order-tab');
    if (tabs.length > 0) {
      const newTab = tabs[tabs.length - 1];
      newTab.style.transform = 'translateY(8px)';
      newTab.style.opacity = '0';
      requestAnimationFrame(() => {
        newTab.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        newTab.style.transform = 'translateY(0)';
        newTab.style.opacity = '1';
      });
      // Smoothly scroll container to the right edge to show the new tab
      setTimeout(() => {
        container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
      }, 50);
    }
  }
  container._lastTabCount = total;

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

// Map B2B tag_en values to hardcoded PRODUCTS section keys
const _DRIVER_TAG_MAP = {
  'Round': 'redondo', 'Redondo': 'redondo',
  'Plain': 'plain',
  'Tres Leche': 'tresleche',
  'Pieces': 'piezas', 'Piezas': 'piezas',
  'Frosted Pieces': 'frostin', 'Piezas Frostin': 'frostin',
  'HB Big': 'hb_big', 'HB Grande': 'hb_big', 'Happy Birthday — BIG': 'hb_big',
  'HB Small': 'hb_small', 'HB Pequeño': 'hb_small', 'Happy Birthday — SMALL': 'hb_small',
  'Square': 'cuadrao', 'Cuadrao': 'cuadrao',
  'Cups': 'basos', 'Basos': 'basos',
  'Family Size': 'familiar', 'Familiar': 'familiar',
};

async function loadDriverProducts() {
  // The hardcoded PRODUCTS catalog above uses canonical keys (e.g. hb_s_pina,
  // pz_pina, fr_pina) that match driver_prices exactly.
  // B2B products use 'b2b_{uuid}' keys that NEVER collide with hardcoded keys.
  _log('Driver: merging B2B products into hardcoded catalog');

  try {
    const { data: b2bRowsRaw } = await sb.from('b2b_products')
      .select('product_key, name_en, name_es, tag_en, tag_es, type, sold_out')
      .not('product_key', 'is', null)
      .order('sort_order', { ascending: true });

    if (b2bRowsRaw && b2bRowsRaw.length > 0) {
      const b2bRows = b2bRowsRaw.filter(r => r.sold_out !== true);
      // Collect all existing keys for fast dedup
      const existingKeys = new Set();
      Object.values(PRODUCTS).forEach(sec => {
        sec.items.forEach(item => existingKeys.add(item.key));
      });

      // Build name sets per section for name-based dedup
      // (B2B table mirrors hardcoded products but with different keys like b2b_{uuid})
      const sectionNameSets = {};
      Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
        const names = new Set();
        sec.items.forEach(item => {
          const baseName = item.en.replace(/\s*\(NT\)$/i, '').replace(/\s*\(ST\)$/i, '')
            .replace(/\s*(Inside|Top|Interior|Arriba)$/i, '').trim().toLowerCase();
          names.add(baseName);
        });
        sectionNameSets[secKey] = names;
      });

      b2bRows.forEach(row => {
        if (!row.product_key || existingKeys.has(row.product_key)) return;

        // Find matching section
        const secKey = _DRIVER_TAG_MAP[row.tag_en];
        let targetSec;

        if (secKey && PRODUCTS[secKey]) {
          // Skip if the same product name already exists in this section
          const nameNorm = (row.name_en || '').trim().toLowerCase();
          if (sectionNameSets[secKey] && sectionNameSets[secKey].has(nameNorm)) return;
          targetSec = PRODUCTS[secKey];
        } else {
          // New category — create a section on the fly
          const slug = 'b2b_cat_' + (row.tag_en || 'other').toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (!PRODUCTS[slug]) {
            PRODUCTS[slug] = {
              en: row.tag_en || 'Other',
              es: row.tag_es || row.tag_en || 'Otro',
              type: 'standard',
              items: []
            };
            sectionNameSets[slug] = new Set();
          }
          targetSec = PRODUCTS[slug];
        }

        // Append — all B2B products default to standard type
        targetSec.items.push({
          key: row.product_key,
          en: row.name_en,
          es: row.name_es || row.name_en,
        });
        existingKeys.add(row.product_key);
      });
    }
  } catch(e) {
    _log('Driver: B2B merge skipped — ' + e.message);
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
  const countEl = document.getElementById('footer-item-count');
  const btn = document.getElementById('footer-continue-btn');
  if (countEl) countEl.textContent = total > 0 ? total : '';
  if (btn) btn.disabled = total === 0;
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
  try {
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
  } catch(e) {
    console.error('[openSummary] Error:', e);
  }
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
  titleEl.textContent = (lang === 'es' ? `Pedido ${idx + 1} de ${orders.length}` : `Order ${idx + 1} of ${orders.length}`);
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
              if (v > 0) { const colClean = col.replace('_nt', ''); const ntTag = col.endsWith('_nt') ? ' (No Ticket)' : ''; items.push({ product_key: k, product_label: `${item.en} (${colClean})${ntTag}`, quantity: v }); }
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
          ? `Pedido #${shortOrderId(driverEditOrderObj || driverEditOrderId)} actualizado`
          : `Order #${shortOrderId(driverEditOrderObj || driverEditOrderId)} updated`,
        'success'
      );
      driverEditOrderId = null;
      driverEditOrderObj = null;
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
        console.error(`Order ${i + 1} insert error:`, orderErr);
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
        console.error(`Order ${i + 1} items insert error:`, itemsErr);
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
  const content = document.querySelector('.main-content');
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
function shortOrderId(orderOrUuid) {
  if (!orderOrUuid) return '???';

  // If we passed the full order object and it has an order number, prefer it
  if (typeof orderOrUuid === 'object') {
    if (orderOrUuid.order_number) return orderOrUuid.order_number;
    if (!orderOrUuid.id) return '???';
    const clean = orderOrUuid.id.replace(/-/g, '');
    return clean.slice(-5).toUpperCase();
  }

  // Fallback: it's just the raw UUID string
  if (typeof orderOrUuid === 'string') {
    const clean = orderOrUuid.replace(/-/g, '');
    return clean.slice(-5).toUpperCase();
  }

  return '???';
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
  return { label: lang === 'es' ? 'Hora del Pedido' : 'Time Ordered', value: `${h12}:${String(m).padStart(2, '0')} ${period}` };
}

function formatDate(d) {
  const months = lang === 'es'
    ? ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(timeStr) {
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr);
  const m = parseInt(mStr);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
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
let currentOrdersFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  const filterBtns = document.querySelectorAll('#driver-orders-filter .insights-pill');
  if (filterBtns.length > 0) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentOrdersFilter = e.target.dataset.filter;
        loadMyOrders();
      });
    });
  }
});

async function loadMyOrders() {
  if (!sb || !currentDriver) return;
  const container = document.getElementById('all-orders');
  try {
    if (currentOrdersFilter === 'sales') {
      const { data: sales, error: salesErr } = await sb
        .from('driver_sales')
        .select(`*, driver_sale_items(*)`)
        .eq('driver_id', currentDriver.id)
        .order('created_at', { ascending: false });
        
      if (salesErr) { console.error('Sales error:', salesErr); return; }
      
      if (!sales || sales.length === 0) {
        container.innerHTML = `<div class="empty-state" data-en="No sales yet" data-es="Sin ventas aún">${lang === 'es' ? 'Sin ventas aún' : 'No sales yet'}</div>`;
        return;
      }
      
      window._cachedDriverSales = sales; // Cache for receipt viewing
      container.innerHTML = sales.map(s => renderDriverSaleCard(s)).join('');
      requestAnimationFrame(() => lucide.createIcons());
      return;
    }

    const { data, error } = await sb
      .from('driver_orders')
      .select('*, driver_order_items(*)')
      .eq('driver_id', currentDriver.id)
      .order('created_at', { ascending: false });

    if (error) { console.error('My orders error:', error); return; }

    let filteredData = data || [];
    if (currentOrdersFilter === 'paid') {
      filteredData = filteredData.filter(o => o.payment_status === 'paid');
    } else if (currentOrdersFilter === 'unpaid') {
      filteredData = filteredData.filter(o => o.payment_status !== 'paid');
    }

    if (filteredData.length === 0) {
      container.innerHTML = `<div class="empty-state" data-en="No orders yet" data-es="Aún no hay pedidos">${lang === 'es' ? 'Aún no hay pedidos' : 'No orders yet'}</div>`;
      return;
    }

    const batches = groupOrdersByBatch(filteredData);
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

function getDriverDisplayName(o, lang) {
  let n = (o.business_name || '').trim();
  const lower = n.toLowerCase();
  if (n === '' || lower === 'no name' || lower === 'sin nombre' || lower === 'noname') {
    return lang === 'es' ? 'Cliente Minorista' : 'Retail Customer';
  }
  return n;
}

// ── RENDER ORDER CARD ──
window.toggleBatch = function(el) {
  const wrapper = el.closest('.oca-batch-wrapper');
  if (!wrapper) return;
  const children = wrapper.querySelector('.oca-batch-children');
  const chevron = wrapper.querySelector('.oca-chevron');
  if (wrapper.classList.contains('open')) {
    wrapper.classList.remove('open');
    children.style.display = 'none';
    if(chevron) chevron.style.transform = 'rotate(0deg)';
  } else {
    wrapper.classList.add('open');
    children.style.display = 'block';
    if(chevron) chevron.style.transform = 'rotate(180deg)';
  }
};

function renderSingleOcaCard(primary, isChild = false) {
  const dateInfo = smartDateLabel(primary);
  const timeInfo = smartTimeLabel(primary);

  let payClass = 'unpaid', payText = lang === 'es' ? 'No Pagado' : 'Not Paid';
  if (primary.payment_status === 'paid') { payClass = 'paid'; payText = lang === 'es' ? 'Pagado' : 'Paid'; }
  else if (primary.payment_status === 'partial') { payClass = 'partial'; payText = lang === 'es' ? 'Parcial' : 'Partial'; }

  const s = primary.status;
  let statusBadge = '';
  if (s === 'confirmed') statusBadge = `<span class="oca-status-pill confirmed">${lang === 'es' ? 'Confirmado' : 'Confirmed'}</span>`;
  else if (s === 'sent') statusBadge = `<span class="oca-status-pill sent">${lang === 'es' ? 'Enviado' : 'Sent'}</span>`;
  else if (s === 'picked_up') statusBadge = `<span class="oca-status-pill picked-up">${lang === 'es' ? 'Recogido' : 'Picked Up'}</span>`;

  function getOrderName(o) {
    if (o.business_name && o.business_name.trim()) return o.business_name.trim();
    return lang === 'es' ? 'Sin negocio' : 'No business';
  }

  function getInit(name) {
    if (!name || name === 'Sin negocio' || name === 'No business') return '#';
    const w = name.trim().split(/\s+/);
    return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
  }

  const bizDisplay = _esc(getOrderName(primary));
  const driverInitials = getInit(currentDriver ? currentDriver.name : '');
  const avatarHtml = `<div class="oca-avatar">${driverInitials}</div>`;
  const totalStr = parseFloat(primary.total_amount || 0) > 0 ? `$${parseFloat(primary.total_amount).toFixed(2)}` : '$0.00';
  const orderNum = primary.order_number ? `#${primary.order_number}` : `#${shortOrderId(primary)}`;

  let editHtml = '';
  if (primary.status === 'pending') {
    const minLeft = getEditTimeRemaining(primary);
    if (minLeft !== null) {
      editHtml = `<div class="oca-edit active"><i data-lucide="pencil"></i> ${minLeft} min</div>`;
    }
  }

  const refHtml = primary.driver_ref ? `<div class="oca-ref">#${_esc(primary.driver_ref)}</div>` : '';

  return `
    <div class="oca-card ${isChild ? 'oca-child' : ''}" onclick="showOrderDetail('${primary.id}')">
      ${refHtml}
      ${avatarHtml}
      <div class="oca-body">
        <div class="oca-name">${bizDisplay}</div>
        <div class="oca-time">${orderNum} · ${dateInfo.value}</div>
        <div class="oca-badges">${statusBadge}</div>
      </div>
      <div class="oca-right">
        <div class="oca-price">${totalStr}</div>
        <div class="oca-pill ${payClass}">${payText}</div>
        ${editHtml}
      </div>
    </div>`;
}

// ── RENDER DRIVER SALE CARD ──
function renderDriverSaleCard(s) {
  const dt = new Date(s.created_at);
  const dateStr = dt.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric' });
  const timeStr = dt.toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  
  let bizDisplay = lang === 'es' ? 'Venta Directa' : 'Direct Sale';
  if (s.client_id && typeof _clientsList !== 'undefined') {
    const c = _clientsList.find(x => x.id === s.client_id);
    if (c) bizDisplay = _esc(c.business_name);
  }
  
  let payClass = 'unpaid', payText = lang === 'es' ? 'No Pagado' : 'Not Paid';
  if (s.payment_status === 'paid') { payClass = 'paid'; payText = lang === 'es' ? 'Pagado' : 'Paid'; }
  else if (s.payment_status === 'partial' || s.payment_status === 'on_account') { payClass = 'partial'; payText = lang === 'es' ? 'A Cuenta' : 'On Account'; }
  
  const totalStr = parseFloat(s.total || 0) > 0 ? `$${parseFloat(s.total).toFixed(2)}` : '$0.00';
  const statusBadge = `<span class="oca-status-pill picked-up">${lang === 'es' ? 'Completado' : 'Completed'}</span>`;
  const receiptNum = s.receipt_number ? `#${_esc(s.receipt_number)}` : '';

  return `
    <div class="oca-card" onclick="viewPastSaleReceipt('${s.id}')">
      <div class="oca-body">
        <div class="oca-name">${bizDisplay}</div>
        <div class="oca-time">${receiptNum} · ${dateStr} ${timeStr}</div>
        <div class="oca-badges">${statusBadge}</div>
      </div>
      <div class="oca-right">
        <div class="oca-price">${totalStr}</div>
        <div class="oca-pill ${payClass}">${payText}</div>
      </div>
    </div>`;
}

window.viewPastSaleReceipt = function(saleId) {
  if (!window._cachedDriverSales) return;
  const sale = window._cachedDriverSales.find(s => s.id === saleId);
  if (!sale) return;
  
  let client = null;
  if (sale.client_id && typeof _clientsList !== 'undefined') {
    client = _clientsList.find(x => x.id === sale.client_id);
  }
  
  const items = sale.driver_sale_items || [];
  renderReceipt(sale, items, client);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-receipt').classList.add('active');
  document.getElementById('bottom-nav').style.display = 'none';
};

// ── RENDER ORDER CARD (Admin-style avatar row) ──
// `batch` is an array of orders (1 for solo, N for batch)
function renderOrderCard(batch) {
  if (batch.length === 1) return renderSingleOcaCard(batch[0]);

  const primary = batch[0];
  const dateInfo = smartDateLabel(primary);
  const timeInfo = smartTimeLabel(primary);

  // Payment badge — use worst status in batch
  let payStatus = 'paid';
  batch.forEach(o => {
    if (o.payment_status !== 'paid' && o.payment_status !== 'partial') payStatus = 'not_paid';
    if (o.payment_status === 'partial' && payStatus === 'paid') payStatus = 'partial';
  });
  let payClass = 'unpaid', payText = lang === 'es' ? 'No Pagado' : 'Not Paid';
  if (payStatus === 'paid') { payClass = 'paid'; payText = lang === 'es' ? 'Pagado' : 'Paid'; }
  else if (payStatus === 'partial') { payClass = 'partial'; payText = lang === 'es' ? 'Parcial' : 'Partial'; }

  // Status badge
  const s = primary.status;
  let statusBadge = '';
  if (s === 'confirmed') statusBadge = `<span class="oca-status-pill confirmed">${lang === 'es' ? 'Confirmado' : 'Confirmed'}</span>`;
  else if (s === 'sent') statusBadge = `<span class="oca-status-pill sent">${lang === 'es' ? 'Enviado' : 'Sent'}</span>`;
  else if (s === 'picked_up') statusBadge = `<span class="oca-status-pill picked-up">${lang === 'es' ? 'Recogido' : 'Picked Up'}</span>`;

  function getOrderName(o) {
    if (o.business_name && o.business_name.trim()) return o.business_name.trim();
    return lang === 'es' ? 'Sin negocio' : 'No business';
  }

  function getInit(name) {
    if (!name || name === 'Sin negocio' || name === 'No business') return '#';
    const w = name.trim().split(/\s+/);
    return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
  }

  const driverInitials = getInit(currentDriver ? currentDriver.name : '');
  let avatarHtml = `<div class="oca-avatar">${driverInitials}</div>`;

  let bizDisplay = '';
  const n1 = getOrderName(batch[0]);
  if (batch.length === 2) {
    const n2 = getOrderName(batch[1]);
    if (n1 && n2) bizDisplay = _esc(`${n1} & ${n2}`);
    else if (n1 || n2) bizDisplay = _esc(n1 || n2);
    else bizDisplay = "";
  } else {
    const moreText = lang === 'es' ? 'más' : 'more';
    if (n1) bizDisplay = _esc(`${n1} +${batch.length - 1} ${moreText}`);
    else bizDisplay = ""; 
  }

  // Combined total
  const combinedTotal = batch.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const totalStr = combinedTotal > 0 ? `$${combinedTotal.toFixed(2)}` : '$0.00';

  const batchLabel = `${batch.length} ${lang === 'es' ? 'pedidos' : 'orders'}`;

  // Edit indicator
  let editHtml = '';
  if (primary.status === 'pending') {
    const minLeft = getEditTimeRemaining(primary);
    if (minLeft !== null) {
      editHtml = `<div class="oca-edit active"><i data-lucide="pencil"></i> ${minLeft} min</div>`;
    }
  }

  return `
    <div class="oca-batch-wrapper">
      <div class="oca-card batch-header" onclick="toggleBatch(this)">
        ${avatarHtml}
        <div class="oca-body">
          <div class="oca-name">${bizDisplay}</div>
          <div class="oca-time">${batchLabel} · ${dateInfo.value}</div>
          <div class="oca-badges">${statusBadge}</div>
        </div>
        <div class="oca-right">
          <div class="oca-price">${totalStr}</div>
          <div class="oca-pill ${payClass}">${payText}</div>
          ${editHtml}
        </div>
        <div class="oca-chevron" style="margin-left: 8px; color: var(--tx-muted); transition: transform 0.2s;"><i data-lucide="chevron-down"></i></div>
      </div>
      <div class="oca-batch-children" style="display:none; background: rgba(0,0,0,0.02); border-top: 1px solid var(--bd);">
        ${batch.map(o => renderSingleOcaCard(o, true)).join('')}
      </div>
    </div>`;
}

// ── ORDER DETAIL MODAL ──
let driverEditOrderId = null; // Track which order is being edited
let driverEditOrderObj = null; // Track the full object for order number

// Batch detail state
let _batchOrders = [];
let _batchIdx = 0;

window.showOrderDetail = async function (orderIdStr) {
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

window.batchDetailNav = function (dir) {
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
    `${lang === 'es' ? 'Pedido' : 'Order'} #${shortOrderId(order)}`;

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
  const bizName = _esc(getDriverDisplayName(order, lang));
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
window.editOrder = async function (orderId) {
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
    driverEditOrderObj = order;

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
        ? `Editando pedido #${shortOrderId(driverEditOrderObj || orderId)}. Haz cambios y presiona Continuar.`
        : `Editing order #${shortOrderId(driverEditOrderObj || orderId)}. Make changes and press Continue.`,
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

// ── BALANCE REDIRECT ──
window.goToUnpaidOrders = function () {
  // Navigate to My Orders section
  showSection('my-orders');

  // Set filter to unpaid
  currentOrdersFilter = 'unpaid';

  // Update pills UI
  const filterBtns = document.querySelectorAll('#driver-orders-filter .insights-pill');
  filterBtns.forEach(b => {
    if (b.dataset.filter === 'unpaid') b.classList.add('active');
    else b.classList.remove('active');
  });

  // Reload orders to apply filter immediately
  loadMyOrders();
};

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

      // Chime if order was just picked up
      if (payload.eventType === 'UPDATE' && payload.new && payload.new.status === 'picked_up') {
        // Simple check to avoid duplicate chimes if we already know it's picked up locally
        const localOrder = _ordersList.find(o => o.id === payload.new.id);
        if (!localOrder || localOrder.status !== 'picked_up') {
          if (notificationsEnabled) {
            playChime();
            const msg = lang === 'es'
              ? 'Tu pedido ha sido agregado a tu inventario'
              : 'Your order has been added to your inventory';
            showToast(msg, 'success');
            showBrowserNotification(
              lang === 'es' ? 'Inventario Actualizado' : 'Inventory Updated',
              msg,
              'my-orders'
            );
          }
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

  // Ensure inventory is loaded so stock limits work
  if (!inventoryLoaded || Object.keys(driverInventory).length === 0) {
    await loadInventoryData();
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

  dropdown.onchange = async () => {
    _saleClientId = dropdown.value || null;
    await loadActiveClientPrices(_saleClientId);
    buildSaleProducts();
    updateSaleFooter();
    applyLang();
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
    // Build a flat list of sale-able items for this section
    const flatItems = [];

    if (sec.type === 'redondo') {
      sec.items.forEach(item => {
        if (hiddenProducts.has(item.key)) return;
        (item.cols || []).forEach(col => {
          if (col.endsWith('_nt')) return; // Only process base items
          const compositeKey = item.key + '_' + col;
          const colEn = col.charAt(0).toUpperCase() + col.slice(1);
          const colEs = col === 'inside' ? 'Adentro' : col === 'top' ? 'Arriba' : colEn;
          flatItems.push({
            key: compositeKey,
            en: `${item.en} — ${colEn}`,
            es: `${item.es} — ${colEs}`,
          });
        });
      });
    } else {
      sec.items.forEach(item => {
        if (!hiddenProducts.has(item.key)) {
          flatItems.push(item);
        }
      });
    }

    if (flatItems.length === 0) return;

    html += `<div class="sale-acc" data-section-key="${secKey}">`;
    html += `<div class="sale-acc-header"><span class="sale-acc-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span><svg class="sale-acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>`;
    html += `<div class="sale-acc-body">`;

    flatItems.forEach(item => {
      const price = getSalePrice(item.key);
      const hasPrice = price != null && price > 0;
      const priceStr = hasPrice ? `$${price.toFixed(2)}` : (lang === 'es' ? 'Sin precio' : 'No price');
      
      const keyReg = item.key;
      const keyNT = item.key + '_nt';

      const qtyReg = _saleQty[keyReg] || 0;
      const qtyNT = _saleQty[keyNT] || 0;

      const maxInvReg = driverInventory[keyReg] ? Math.max(0, driverInventory[keyReg].remaining) : 0;
      const maxInvNT = driverInventory[keyNT] ? Math.max(0, driverInventory[keyNT].remaining) : 0;

      const availReg = Math.max(0, maxInvReg - qtyReg);
      const availNT = Math.max(0, maxInvNT - qtyNT);

      const lineTotalReg = hasPrice && qtyReg > 0 ? qtyReg * price : 0;
      const lineTotalNT = hasPrice && qtyNT > 0 ? qtyNT * price : 0;
      const lineTotal = lineTotalReg + lineTotalNT;
      const lineTotalStr = lineTotal > 0 ? '$' + lineTotal.toFixed(2) : '';

      html += `<div class="sale-prod-row${qtyReg > 0 || qtyNT > 0 ? ' has-value' : ''}" data-parent-key="${item.key}">`;
      html += `  <div class="sale-prod-header">`;
      html += `    <div class="sale-prod-info">`;
      html += `      <div class="sale-prod-name" data-en="${item.en}" data-es="${item.es}">${L(item)}</div>`;
      html += `      <div class="sale-prod-price${hasPrice ? '' : ' no-price'}">${priceStr}</div>`;
      html += `    </div>`;
      html += `    <span class="sale-line-total" data-group-key="${item.key}">${lineTotalStr}</span>`;
      html += `  </div>`;

      html += `  <div class="sale-prod-controls">`;
      // Regular Group
      html += `    <div class="sale-qty-group">`;
      html += `      <span class="sale-qty-lbl">Reg <small class="sale-avail-lbl ${availReg===0?'out':''}" data-key="${keyReg}">${availReg}</small></span>`;
      html += `      <div class="sale-qty-wrap"><button class="sale-qty-btn" data-dir="-" data-key="${keyReg}">−</button><input type="number" class="sale-qty-input" data-key="${keyReg}" data-parent-key="${item.key}" value="${qtyReg}" min="0"><button class="sale-qty-btn" data-dir="+" data-key="${keyReg}">+</button></div>`;
      html += `    </div>`;

      // No-Ticket (NT) Group
      html += `    <div class="sale-qty-group">`;
      html += `      <span class="sale-qty-lbl">NT <small class="sale-avail-lbl ${availNT===0?'out':''}" data-key="${keyNT}">${availNT}</small></span>`;
      html += `      <div class="sale-qty-wrap"><button class="sale-qty-btn" data-dir="-" data-key="${keyNT}">−</button><input type="number" class="sale-qty-input" data-key="${keyNT}" data-parent-key="${item.key}" value="${qtyNT}" min="0"><button class="sale-qty-btn" data-dir="+" data-key="${keyNT}">+</button></div>`;
      html += `    </div>`;
      html += `  </div>`;
      
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

      const maxInv = driverInventory[key] ? Math.max(0, driverInventory[key].remaining) : 0;
      let newVal = Math.max(0, cur + delta);
      if (newVal > maxInv) newVal = maxInv;

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

      const key = inp.dataset.key;
      const maxInv = driverInventory[key] ? Math.max(0, driverInventory[key].remaining) : 0;
      let newVal = parseInt(inp.value) || 0;
      if (newVal > maxInv) {
        newVal = maxInv;
        inp.value = newVal;
        if (newVal === 0) showToast(lang === 'es' ? 'Sin inventario disponible' : 'No inventory available', 'error');
      }

      _saleQty[key] = newVal;
      updateSaleRow(key);
      updateSaleFooter();
    });
  });
}

function updateSaleRow(key) {
  // Find the input to get its parent-key
  const inp = document.querySelector(`.sale-qty-input[data-key="${key}"]`);
  if (!inp) return;
  const parentKey = inp.dataset.parentKey;
  
  const row = document.querySelector(`.sale-prod-row[data-parent-key="${parentKey}"]`);
  if (!row) return;

  const keyReg = parentKey;
  const keyNT = parentKey + '_nt';

  const qtyReg = _saleQty[keyReg] || 0;
  const qtyNT = _saleQty[keyNT] || 0;
  const price = getSalePrice(keyReg); // Price is same for both
  const hasPrice = price != null && price > 0;

  const lineTotal = hasPrice ? (qtyReg + qtyNT) * price : 0;
  const lineEl = row.querySelector('.sale-line-total');
  
  if (lineEl) {
    lineEl.textContent = lineTotal > 0 ? '$' + lineTotal.toFixed(2) : '';
  }
  
  // Update live inventory numbers on the badges
  if (driverInventory) {
    const maxReg = driverInventory[keyReg] ? Math.max(0, driverInventory[keyReg].remaining) : 0;
    const availReg = Math.max(0, maxReg - qtyReg);
    const lblReg = row.querySelector(`.sale-avail-lbl[data-key="${keyReg}"]`);
    if (lblReg) {
      lblReg.textContent = availReg;
      lblReg.className = `sale-avail-lbl ${availReg === 0 ? 'out' : ''}`;
    }

    const maxNT = driverInventory[keyNT] ? Math.max(0, driverInventory[keyNT].remaining) : 0;
    const availNT = Math.max(0, maxNT - qtyNT);
    const lblNT = row.querySelector(`.sale-avail-lbl[data-key="${keyNT}"]`);
    if (lblNT) {
      lblNT.textContent = availNT;
      lblNT.className = `sale-avail-lbl ${availNT === 0 ? 'out' : ''}`;
    }
  }

  row.classList.toggle('has-value', qtyReg > 0 || qtyNT > 0);
}

function getSaleTotal() {
  let total = 0;
  Object.entries(_saleQty).forEach(([key, qty]) => {
    if (qty > 0) {
      const price = getSalePrice(key);
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

  updateSalesTicker();
}

function updateSalesTicker() {
  const ticker = document.getElementById('sales-ticker');
  if (!ticker || !inventoryLoaded) return;

  const tickerItems = [];
  const labelMap = {};
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      labelMap[item.key] = L(item);
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

  Object.keys(driverInventory).forEach(k => {
    const inv = driverInventory[k];
    const totalLoaded = parseInt(inv.loaded) || 0;
    const initiallyRemaining = parseInt(inv.remaining) || 0;
    // Map to _saleQty which holds the Sales tab cart!
    const inCart = _saleQty[k] || 0;

    // Calculate true live remaining based on what they are currently typing in
    const trulyRemaining = Math.max(0, initiallyRemaining - inCart);

    if (totalLoaded > 0 || initiallyRemaining > 0) {
      tickerItems.push({
        key: k,
        label: labelMap[k] || k,
        remaining: trulyRemaining
      });
    }
  });

  if (tickerItems.length === 0) {
    ticker.style.display = 'none';
    return;
  }

  ticker.style.display = 'flex';
  tickerItems.sort((a, b) => a.remaining - b.remaining);

  let html = '';
  tickerItems.forEach(item => {
    const statusClass = item.remaining <= 0 ? 'out' : item.remaining <= 3 ? 'low' : '';
    html += `<div class="ticker-item ${statusClass}">
      <span class="ticker-val">${item.remaining}</span>
      <span class="ticker-lbl">${_esc(item.label)}</span>
    </div>`;
  });
  ticker.innerHTML = html;
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
    // Build a full label map including composite redondo keys
    const saleLabelMap = {};
    Object.values(PRODUCTS).forEach(sec => {
      sec.items.forEach(item => {
        saleLabelMap[item.key] = item.en;
        if (sec.type === 'redondo' && item.cols) {
          item.cols.forEach(col => {
            const compositeKey = item.key + '_' + col;
            const isNT = col.endsWith('_nt');
            const base = isNT ? col.replace('_nt', '') : col;
            const colLabel = base.charAt(0).toUpperCase() + base.slice(1);
            saleLabelMap[compositeKey] = `${item.en} — ${colLabel}${isNT ? ' NT' : ''}`;
          });
        }
      });
    });

    Object.entries(_saleQty).forEach(([key, qty]) => {
      if (qty > 0) {
        const price = getSalePrice(key);
        items.push({
          product_key: key,
          product_label: saleLabelMap[key] || key,
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
  window._cachedReceiptSale = { ...sale, driver_sale_items: items };

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

  const deleteBtn = document.getElementById('receipt-delete-btn');
  if (deleteBtn) {
    if (sale.id) {
      window._currentReceiptSaleId = sale.id;
      deleteBtn.style.display = 'flex';
    } else {
      window._currentReceiptSaleId = null;
      deleteBtn.style.display = 'none';
    }
  }

  applyLang();
}

/* ═══════════════════════════════════
   CLIENTS — SUPABASE FUNCTIONS
   ═══════════════════════════════════ */
let _clientsList = [];
let _editingClientId = null;
let _editFromProfile = false;

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

    html += `<div class="client-card" data-client-id="${c.id}" onclick="openClientProfile('${c.id}')" style="cursor:pointer">
      <div class="client-card-row1">
        <div class="client-card-name">${name}</div>
        <div class="client-card-actions">
          <button class="client-card-edit" onclick="event.stopPropagation();openClientProfile('${c.id}')" title="${lang === 'es' ? 'Editar' : 'Edit'}"><i data-lucide="pencil"></i></button>
          <button class="client-card-delete" onclick="event.stopPropagation();confirmDeleteClient('${c.id}','${name.replace(/'/g, "\\'")}')" title="${lang === 'es' ? 'Eliminar' : 'Delete'}"><i data-lucide="trash-2"></i></button>
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

  // If we came from the profile, return to it instead of restoring scroll
  if (_editFromProfile && _cpClientId) {
    _editFromProfile = false;
    _editingClientId = null;
    return;
  }

  _editFromProfile = false;
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
    const wasFromProfile = _editFromProfile;
    const editedId = _editingClientId;
    closeClientModal();
    showToast(
      editedId
        ? (lang === 'es' ? 'Cliente actualizado' : 'Client updated')
        : (lang === 'es' ? 'Cliente agregado' : 'Client added'),
      'success'
    );
    await loadDriverClients();
    // Refresh the profile with updated data if we came from there
    if (wasFromProfile && editedId) {
      openClientProfile(editedId);
    }
  } else {
    showToast(lang === 'es' ? 'Error al guardar el cliente' : 'Error saving client', 'error');
  }
}

window.confirmDeleteClient = function (clientId, clientName) {
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
   CLIENT PROFILE — Apple-style Sheet
   ═══════════════════════════════════ */
let _cpClientId = null;
let _cpPrices = {};       // product_key → price for the currently viewed client
let _cpHasCustom = false; // whether custom pricing is enabled
let _cpDirty = false;     // unsaved changes flag

function openClientProfile(clientId) {
  const client = _clientsList.find(c => c.id === clientId);
  if (!client) return;
  _cpClientId = clientId;
  _cpDirty = false;

  // Populate header
  const initials = (client.business_name || '??')
    .split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('cp-avatar').textContent = initials;
  document.getElementById('cp-name').textContent = client.business_name;
  document.getElementById('cp-subtitle').textContent = client.address || '';

  // Populate details
  const showRow = (id, val) => {
    const row = document.getElementById(id);
    if (val) { row.style.display = ''; } else { row.style.display = 'none'; }
  };
  showRow('cp-row-phone', client.phone);
  showRow('cp-row-address', client.address);
  showRow('cp-row-contact', client.contact_name);
  showRow('cp-row-notes', client.notes);
  if (client.phone) document.getElementById('cp-phone-val').textContent = client.phone;
  if (client.address) document.getElementById('cp-address-val').textContent = client.address;
  if (client.contact_name) document.getElementById('cp-contact-val').textContent = client.contact_name;
  if (client.notes) document.getElementById('cp-notes-val').textContent = client.notes;

  // Load prices from DB then open
  _loadClientPrices(clientId).then(() => {
    _cpRenderPriceEditor();
    document.getElementById('cp-overlay').classList.add('open');
    document.body.dataset.scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    applyLang();
    lucide.createIcons();

    // Load sales history async (don't block opening)
    _loadClientSalesHistory(clientId);
  });
}
window.openClientProfile = openClientProfile;

function closeClientProfile() {
  document.getElementById('cp-overlay').classList.remove('open');
  const scrollY = document.body.dataset.scrollY || '0';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, parseInt(scrollY));
  _cpClientId = null;
  _cpDirty = false;
}

// ── Load client prices from Supabase ──
async function _loadClientPrices(clientId) {
  _cpPrices = {};
  _cpHasCustom = false;
  if (!sb || !currentDriver) return;
  try {
    const { data, error } = await sb
      .from('client_prices')
      .select('product_key, price')
      .eq('client_id', clientId)
      .eq('driver_id', currentDriver.id);
    if (error) { console.error('Load client prices error:', error); return; }
    if (data && data.length > 0) {
      _cpHasCustom = true;
      data.forEach(p => { _cpPrices[p.product_key] = parseFloat(p.price); });
    }
  } catch (e) { console.error('Client prices error:', e); }

  // Sync toggle
  const toggle = document.getElementById('cp-custom-toggle');
  if (toggle) toggle.checked = _cpHasCustom;
  _cpTogglePricingUI(_cpHasCustom);
}

// ── Save client prices to Supabase ──
async function _saveClientPrices() {
  if (!sb || !currentDriver || !_cpClientId) return;
  const btn = document.getElementById('cp-save-prices-btn');
  btn.disabled = true;
  btn.textContent = lang === 'es' ? 'Guardando...' : 'Saving...';

  try {
    // Delete existing prices for this client
    const { error: delErr } = await sb.from('client_prices')
      .delete()
      .eq('client_id', _cpClientId)
      .eq('driver_id', currentDriver.id);
    if (delErr) throw delErr;

    if (_cpHasCustom) {
      // Insert new prices
      const rows = [];
      Object.entries(_cpPrices).forEach(([key, price]) => {
        if (price != null && price > 0) {
          rows.push({
            client_id: _cpClientId,
            driver_id: currentDriver.id,
            product_key: key,
            price: price,
          });
        }
      });
      if (rows.length > 0) {
        const { error } = await sb.from('client_prices').insert(rows);
        if (error) throw error;
      }
    }

    _cpDirty = false;

    // ✓ Success feedback — green button, then auto-close
    btn.style.background = '#34C759';
    btn.style.boxShadow = '0 4px 24px rgba(52,199,89,.35),0 1px 4px rgba(0,0,0,.12)';
    btn.textContent = lang === 'es' ? '✓ Guardado' : '✓ Saved';
    showToast(lang === 'es' ? 'Precios guardados' : 'Prices saved', 'success');

    setTimeout(() => {
      btn.style.background = '';
      btn.style.boxShadow = '';
      btn.textContent = lang === 'es' ? 'Guardar Precios' : 'Save Prices';
      btn.disabled = false;
      closeClientProfile();
    }, 1000);
    return;

  } catch (e) {
    console.error('Save client prices error:', e);

    // ✗ Error feedback — shake + red flash
    btn.textContent = lang === 'es' ? '✗ Error' : '✗ Error';
    showToast(lang === 'es' ? 'Error al guardar precios' : 'Error saving prices', 'error');

    setTimeout(() => {
      btn.textContent = lang === 'es' ? 'Guardar Precios' : 'Save Prices';
      btn.disabled = false;
    }, 2000);
  }
}

// ── Toggle pricing UI visibility ──
function _cpTogglePricingUI(on) {
  const editor = document.getElementById('cp-price-editor');
  const saveBar = document.getElementById('cp-save-bar');
  const templateBar = document.getElementById('cp-template-bar');
  const hint = document.getElementById('cp-pricing-hint');

  editor.style.display = on ? 'block' : 'none';
  saveBar.style.display = on ? 'block' : 'none';
  templateBar.style.display = on ? 'block' : 'none';
  hint.style.display = on ? 'none' : 'block';
}

// ── Render the price editor (inset grouped by category) ──
function _cpRenderPriceEditor() {
  const container = document.getElementById('cp-price-editor');
  let html = '';

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    // Build flat item list (same logic as sales)
    const flatItems = [];
    if (sec.type === 'redondo') {
      sec.items.forEach(item => {
        if (hiddenProducts.has(item.key)) return;
        (item.cols || []).forEach(col => {
          if (col.endsWith('_nt')) return;
          const compositeKey = item.key + '_' + col;
          const colEn = col.charAt(0).toUpperCase() + col.slice(1);
          const colEs = col === 'inside' ? 'Adentro' : col === 'top' ? 'Arriba' : colEn;
          flatItems.push({ key: compositeKey, en: `${item.en} — ${colEn}`, es: `${item.es} — ${colEs}` });
        });
      });
    } else {
      sec.items.forEach(item => {
        if (!hiddenProducts.has(item.key)) flatItems.push(item);
      });
    }
    if (flatItems.length === 0) return;

    html += `<div class="cp-price-section">`;
    html += `<div class="cp-price-section-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</div>`;
    html += `<div class="cp-price-list">`;

    flatItems.forEach(item => {
      const price = _cpPrices[item.key];
      const val = (price != null && price > 0) ? price.toFixed(2) : '';
      const fallback = driverPriceMap[item.key];
      const placeholder = (fallback != null && fallback > 0) ? fallback.toFixed(2) : '0.00';

      html += `<div class="cp-price-row">
        <span class="cp-price-row-name" data-en="${item.en}" data-es="${item.es}">${L(item)}</span>
        <input type="number" inputmode="decimal" step="0.01" min="0"
          class="cp-price-input" data-key="${item.key}"
          value="${val}" placeholder="$${placeholder}">
      </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;

  // Bind price inputs
  container.querySelectorAll('.cp-price-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.key;
      const val = parseFloat(inp.value);
      if (!isNaN(val) && val >= 0) {
        _cpPrices[key] = val;
      } else {
        delete _cpPrices[key];
      }
      _cpDirty = true;
    });
    // Select all text on focus for quick editing
    inp.addEventListener('focus', () => inp.select());
  });
}

// ── Client Sales History ──
async function _loadClientSalesHistory(clientId) {
  const container = document.getElementById('cp-sales-history');
  if (!container || !sb || !currentDriver) return;

  try {
    const { data: sales, error } = await sb
      .from('driver_sales')
      .select('id, receipt_number, total, payment_method, payment_status, created_at')
      .eq('driver_id', currentDriver.id)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!sales || sales.length === 0) {
      container.innerHTML = `<div class="cp-row" style="justify-content:center;color:var(--tx-faint);font-size:.85rem"
        data-en="No sales yet" data-es="Sin ventas aún">${lang === 'es' ? 'Sin ventas aún' : 'No sales yet'}</div>`;
      return;
    }

    let html = '';
    sales.forEach(sale => {
      const dt = new Date(sale.created_at);
      const dateStr = dt.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const timeStr = dt.toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', {
        hour: 'numeric', minute: '2-digit'
      });

      const statusIcon = sale.payment_status === 'paid' ? '✓' : '○';
      const statusCls = sale.payment_status === 'paid' ? 'cp-sale-paid' : 'cp-sale-unpaid';

      html += `<div class="cp-sale-row" data-sale-id="${sale.id}">
        <div class="cp-sale-main">
          <div class="cp-sale-left">
            <span class="cp-sale-date">${dateStr}</span>
            <span class="cp-sale-meta">${sale.receipt_number || timeStr}</span>
          </div>
          <div class="cp-sale-right">
            <span class="cp-sale-total">$${parseFloat(sale.total).toFixed(2)}</span>
            <span class="cp-sale-status ${statusCls}">${statusIcon} ${sale.payment_status === 'paid' ? (lang === 'es' ? 'Pagado' : 'Paid') : (lang === 'es' ? 'Pendiente' : 'Unpaid')}</span>
          </div>
        </div>
        <div class="cp-sale-detail" id="cp-sale-detail-${sale.id}" style="display:none"></div>
      </div>`;
    });

    container.innerHTML = html;

    // Bind tap to expand/collapse sale details
    container.querySelectorAll('.cp-sale-row').forEach(row => {
      row.addEventListener('click', () => _toggleSaleDetail(row.dataset.saleId));
    });

  } catch (e) {
    console.error('Client sales history error:', e);
    container.innerHTML = `<div class="cp-row" style="justify-content:center;color:var(--tx-faint);font-size:.85rem">Error</div>`;
  }
}

async function _toggleSaleDetail(saleId) {
  const detail = document.getElementById('cp-sale-detail-' + saleId);
  if (!detail) return;

  // Toggle visibility
  if (detail.style.display !== 'none') {
    detail.style.display = 'none';
    return;
  }

  // Load items if not already loaded
  if (!detail.dataset.loaded) {
    try {
      const { data: items } = await sb
        .from('driver_sale_items')
        .select('product_label, quantity, unit_price, line_total')
        .eq('sale_id', saleId);

      if (items && items.length > 0) {
        let html = '';
        items.forEach(it => {
          html += `<div class="cp-sale-item">
            <span class="cp-sale-item-name">${_esc(it.product_label)}</span>
            <span class="cp-sale-item-qty">${it.quantity} × $${parseFloat(it.unit_price).toFixed(2)}</span>
            <span class="cp-sale-item-total">$${parseFloat(it.line_total).toFixed(2)}</span>
          </div>`;
        });
        detail.innerHTML = html;
      } else {
        detail.innerHTML = `<div class="cp-sale-item" style="color:var(--tx-faint)">${lang === 'es' ? 'Sin detalles' : 'No details'}</div>`;
      }
      detail.dataset.loaded = '1';
    } catch (e) {
      console.error('Load sale items error:', e);
    }
  }

  detail.style.display = 'block';
}

// ── Template Action Sheet ──
function _cpOpenTemplateSheet() {
  const list = document.getElementById('cp-action-list');
  let html = '';

  // "Use Driver Prices" option
  html += `<button class="cp-action-item" data-source="driver" data-en="My Default Prices" data-es="Mis Precios Base">${lang === 'es' ? 'Mis Precios Base' : 'My Default Prices'}</button>`;

  // List other clients that have custom pricing
  _clientsList.forEach(c => {
    if (c.id === _cpClientId) return; // skip self
    html += `<button class="cp-action-item" data-source="${c.id}">${_esc(c.business_name)}</button>`;
  });

  list.innerHTML = html;
  document.getElementById('cp-action-sheet-overlay').classList.add('open');

  // Bind clicks
  list.querySelectorAll('.cp-action-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const source = btn.dataset.source;
      _cpCloseTemplateSheet();
      await _cpApplyTemplate(source);
    });
  });

  applyLang();
}

function _cpCloseTemplateSheet() {
  document.getElementById('cp-action-sheet-overlay').classList.remove('open');
}

async function _cpApplyTemplate(source) {
  if (source === 'driver') {
    // Copy from driver's standard prices
    _cpPrices = {};
    Object.entries(driverPriceMap).forEach(([key, price]) => {
      if (price > 0) _cpPrices[key] = price;
    });
  } else {
    // Copy from another client's prices
    if (!sb || !currentDriver) return;
    try {
      const { data, error } = await sb
        .from('client_prices')
        .select('product_key, price')
        .eq('client_id', source)
        .eq('driver_id', currentDriver.id);
      if (error) throw error;
      _cpPrices = {};
      if (data && data.length > 0) {
        data.forEach(p => { _cpPrices[p.product_key] = parseFloat(p.price); });
      } else {
        // Client has no custom prices — copy driver defaults
        Object.entries(driverPriceMap).forEach(([key, price]) => {
          if (price > 0) _cpPrices[key] = price;
        });
        showToast(lang === 'es' ? 'Este cliente usa precios estándar — copiando los tuyos' : 'This client uses standard prices — copying yours');
      }
    } catch (e) {
      console.error('Template load error:', e);
      showToast(lang === 'es' ? 'Error al copiar precios' : 'Error copying prices', 'error');
      return;
    }
  }

  _cpDirty = true;
  _cpRenderPriceEditor();
  showToast(lang === 'es' ? 'Precios copiados — revisa y guarda' : 'Prices copied — review & save');
}

// ── Wire up Client Profile events ──
function _initClientProfileEvents() {
  document.getElementById('cp-back').addEventListener('click', () => {
    if (_cpDirty) {
      showAppConfirm(
        lang === 'es' ? '¿Salir sin guardar los cambios de precios?' : 'Leave without saving price changes?',
        () => closeClientProfile()
      );
    } else {
      closeClientProfile();
    }
  });

  document.getElementById('cp-edit-btn').addEventListener('click', () => {
    const id = _cpClientId;
    if (id) {
      _editFromProfile = true;
      openClientModal(id);
    }
  });

  document.getElementById('cp-custom-toggle').addEventListener('change', (e) => {
    _cpHasCustom = e.target.checked;
    _cpTogglePricingUI(_cpHasCustom);
    _cpDirty = true;
    if (_cpHasCustom && Object.keys(_cpPrices).length === 0) {
      // Pre-fill with driver's standard prices
      Object.entries(driverPriceMap).forEach(([key, price]) => {
        if (price > 0) _cpPrices[key] = price;
      });
      _cpRenderPriceEditor();
    }
  });

  document.getElementById('cp-template-btn').addEventListener('click', _cpOpenTemplateSheet);
  document.getElementById('cp-action-cancel').addEventListener('click', _cpCloseTemplateSheet);
  document.getElementById('cp-action-sheet-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) _cpCloseTemplateSheet();
  });
  document.getElementById('cp-save-prices-btn').addEventListener('click', _saveClientPrices);
}

// ── Sales Tab: get price for a product, checking client prices first ──
let _activeClientPrices = null; // cached prices for the selected sale client

async function loadActiveClientPrices(clientId) {
  _activeClientPrices = null;
  if (!sb || !currentDriver || !clientId) return;
  try {
    const { data } = await sb
      .from('client_prices')
      .select('product_key, price')
      .eq('client_id', clientId)
      .eq('driver_id', currentDriver.id);
    if (data && data.length > 0) {
      _activeClientPrices = {};
      data.forEach(p => { _activeClientPrices[p.product_key] = parseFloat(p.price); });
    }
  } catch (e) { console.error('Load active client prices error:', e); }
}

function getSalePrice(productKey) {
  // Client-specific price takes precedence
  if (_activeClientPrices && _activeClientPrices[productKey] != null) {
    return _activeClientPrices[productKey];
  }
  // Fallback to driver's standard price
  return driverPriceMap[productKey] || 0;
}

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
  let skels = '';
  for (let i = 0; i < 5; i++) {
    skels += `<div class="inv-skeleton-row"><div class="inv-sk-left"><div class="inv-sk-line" style="width:${Math.floor(Math.random() * 40 + 30)}%"></div><div class="inv-sk-line thin" style="width:60%"></div></div><div class="inv-sk-ring"></div></div>`;
  }
  summary.innerHTML = skels;
  summary.style.display = 'block';
  form.style.display = 'none';

  await loadInventoryData();

  summary.style.display = 'block';
  renderInventoryBanner();
  renderInventorySummary();
  form.style.display = 'none';

  applyLang();

  // Update sales ticker since inventory data is ready
  updateSalesTicker();
}

async function loadInventoryData() {
  if (!sb || !currentDriver) return;
  try {
    const today = getTodayStr();

    // Step 1: Load manual inventory adjustments
    const { data: loadRows, error: e3 } = await sb
      .from('driver_inventory')
      .select('product_key, morning_load')
      .eq('driver_id', currentDriver.id)
      .eq('date', today);

    const manualMap = {};
    if (!e3 && loadRows) {
      loadRows.forEach(row => {
        manualMap[row.product_key] = row.morning_load;
      });
    }

    // Step 2: Check for picked_up orders today
    const { data: pickedUpOrders, error: e1 } = await sb
      .from('driver_orders')
      .select('id, order_number')
      .eq('driver_id', currentDriver.id)
      .eq('status', 'picked_up')
      .eq('pickup_date', today);

    const loadMap = {};
    const orderNums = [];

    if (!e1 && pickedUpOrders && pickedUpOrders.length > 0) {
      pickedUpOrders.forEach(o => { if (o.order_number) orderNums.push('#' + o.order_number); });
      const orderIds = pickedUpOrders.map(o => o.id);
      const { data: orderItems, error: e2 } = await sb
        .from('driver_order_items')
        .select('product_key, quantity, adjusted_quantity')
        .in('order_id', orderIds);

      if (!e2 && orderItems) {
        orderItems.forEach(item => {
          const qty = (item.adjusted_quantity !== null && item.adjusted_quantity !== undefined)
            ? item.adjusted_quantity : item.quantity;
          loadMap[item.product_key] = (loadMap[item.product_key] || 0) + qty;
        });
      }
    }

    // Merge manual overrides into loadMap
    let hasManual = false;
    Object.keys(manualMap).forEach(key => {
      loadMap[key] = manualMap[key]; // Manual override takes precedence
      hasManual = true;
    });

    if (Object.keys(loadMap).length > 0) {
      // Get today's sold quantities
      const soldMap = await getTodaySoldMap();

      driverInventory = {};
      Object.entries(loadMap).forEach(([key, loaded]) => {
        const sold = soldMap[key] || 0;
        driverInventory[key] = { loaded, sold, remaining: loaded - sold };
      });

      // Determine source string
      if (orderNums.length > 0 && hasManual) {
        inventorySource = 'order:' + orderNums.join(', ') + ' (+ Adjusted)';
      } else if (orderNums.length > 0) {
        inventorySource = 'order:' + orderNums.join(', ');
      } else {
        inventorySource = 'manual';
      }
      
      inventoryLoaded = true;
      return;
    }

    // No inventory for today
    inventorySource = '';
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

  let sourceHtml = '';
  if (inventorySource) {
    if (isOrder) {
      const orderLabel = inventorySource.replace('order:', lang === 'es' ? 'Cargado de Pedido ' : 'From Order ');
      sourceHtml = `<div class="inv-banner order">📦 ${orderLabel}</div>`;
    } else {
      // Small pill badge for manual adjustments
      sourceHtml = `<span class="inv-adjusted-badge"><i data-lucide="pencil"></i> ${lang === 'es' ? 'Ajustado' : 'Adjusted'}</span>`;
    }
  } else {
    sourceHtml = `<span style="font-size:0.85rem; color:var(--tx-faint); font-weight:600;"><i data-lucide="package" style="width:14px; height:14px; margin-right:4px; vertical-align:middle; display:inline-block; margin-top:-2px"></i>${lang === 'es' ? 'Sin recoger pedidos' : 'No orders picked up yet'}</span>`;
  }

  const addMoreEn = 'Edit Inventory';
  const addMoreEs = 'Editar Inventario';

  const clearEn = 'Clear';
  const clearEs = 'Borrar';

  banner.innerHTML = `<div class="inv-banner-row">${sourceHtml}
    <div style="display: flex; gap: 4px; align-items: center;">
      ${inventorySource ? `
      <button class="inv-clear-btn" id="inv-clear-btn" data-en="${clearEn}" data-es="${clearEs}">
        ${lang === 'es' ? clearEs : clearEn}
      </button>` : ''}
      <button class="inv-add-more-btn" id="inv-add-more-btn" style="margin-top: 0" data-en="${addMoreEn}" data-es="${addMoreEs}">
        <i data-lucide="pencil"></i> ${lang === 'es' ? addMoreEs : addMoreEn}
      </button>
    </div>
  </div>`;

  document.getElementById('inv-add-more-btn')?.addEventListener('click', () => {
    const form = document.getElementById('inv-load-form');
    const summary = document.getElementById('inv-summary');
    summary.style.display = 'none';
    banner.querySelector('.inv-add-more-btn').style.display = 'none';
    if(banner.querySelector('.inv-clear-btn')) banner.querySelector('.inv-clear-btn').style.display = 'none';
    form.style.display = 'block';
    renderManualLoadForm();
  });

  document.getElementById('inv-clear-btn')?.addEventListener('click', async () => {
    const msg = lang === 'es' 
      ? '¿Estás seguro de que quieres borrar tu inventario actual? Tendrás que cargarlo de nuevo.' 
      : 'Are you sure you want to clear your current inventory? You will have to load it again.';
    if (!confirm(msg)) return;

    try {
      const btn = document.getElementById('inv-clear-btn');
      btn.disabled = true;
      btn.textContent = '...';

      const { error } = await sb.from('driver_inventory').delete().eq('driver_id', currentDriver.id);
      if (error) throw error;

      showToast(lang === 'es' ? 'Inventario borrado' : 'Inventory cleared', 'success');
      
      // Reset state
      driverInventory = {};
      inventorySource = '';
      inventoryLoaded = false;
      
      // Reload inventory view
      loadInventoryTab();
    } catch (e) {
      console.error('Error clearing inventory:', e);
      showToast(lang === 'es' ? 'Error al borrar' : 'Error clearing inventory', 'error');
      const btn = document.getElementById('inv-clear-btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = lang === 'es' ? clearEs : clearEn;
      }
    }
  });

  requestAnimationFrame(() => lucide.createIcons());
}

function renderInventorySummary() {
  const container = document.getElementById('inv-summary');
  if (!container) return;

  const keys = Object.keys(driverInventory);
  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-state">${lang === 'es' ? 'Aún no se han recogido pedidos' : 'No orders picked up yet'}</div>`;
    return;
  }

  // Build a product_key → label map from PRODUCTS catalog
  const labelMap = {};
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      labelMap[item.key] = L(item);
      // Add _nt label for standard items
      if (sec.type !== 'redondo') {
        labelMap[item.key + '_nt'] = L(item) + ' (NT)';
      }
      if (item.cols) {
        item.cols.forEach(col => {
          const subKey = item.key + '_' + col;
          const isNT = col.endsWith('_nt');
          const base = isNT ? col.replace('_nt', '') : col;
          const colLabel = base.charAt(0).toUpperCase() + base.slice(1);
          labelMap[subKey] = L(item) + ' — ' + colLabel + (isNT ? ' (NT)' : '');
        });
      }
    });
  });

  // Render a single compact row
  function renderInvRow(p) {
    const statusClass = p.remaining <= 0 ? 'out' : p.remaining < 3 ? 'low' : '';
    const pct = p.loaded > 0 ? Math.max(0, (p.remaining / p.loaded) * 100) : 0;
    const offset = 119.38 - (pct / 100) * 119.38; // 2 * PI * 19 = 119.38
    const ringColor = p.remaining <= 0 ? '#c0392b' : p.remaining < 3 ? '#d4a017' : '#2a9d5c';

    const lblLoaded = lang === 'es' ? 'cargado' : 'loaded';
    const lblSold = lang === 'es' ? 'vendido' : 'sold';
    const lblLeft = lang === 'es' ? 'restante' : 'left';
    const subtitle = `${p.loaded} ${lblLoaded} &nbsp;&middot;&nbsp; ${p.sold} ${lblSold}`;

    return `<div class="inv-row ${statusClass}">
      <div class="inv-row-info">
        <div class="inv-row-name">${_esc(p.label)}</div>
        <div class="inv-row-sub">${subtitle}</div>
      </div>
      <div class="inv-row-right">
        <div class="inv-ring-container">
          <svg class="inv-ring-svg" width="44" height="44">
            <circle class="inv-ring-bg" cx="22" cy="22" r="19"></circle>
            <circle class="inv-ring-fill" cx="22" cy="22" r="19" stroke-dashoffset="${offset}" style="stroke: ${ringColor}"></circle>
          </svg>
          <div class="inv-row-num">${p.remaining}</div>
        </div>
        <div class="inv-row-lbl">${lblLeft}</div>
      </div>
    </div>`;
  }

  // Collect items, separate in-stock vs sold-out
  let html = '';
  const soldOutItems = [];

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    const matching = [];
    sec.items.forEach(item => {
      if (driverInventory[item.key]) {
        matching.push({ key: item.key, label: labelMap[item.key] || item.key, ...driverInventory[item.key] });
      }
      // Check _nt variant for standard items
      if (sec.type !== 'redondo') {
        const ntKey = item.key + '_nt';
        if (driverInventory[ntKey]) {
          matching.push({ key: ntKey, label: labelMap[ntKey] || ntKey, ...driverInventory[ntKey] });
        }
      }
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

    const inStock = matching.filter(p => p.remaining > 0);
    const outOfStock = matching.filter(p => p.remaining <= 0);
    outOfStock.forEach(p => soldOutItems.push({ ...p, catLabel: L(sec) }));

    if (inStock.length > 0) {
      const catTotalRem = inStock.reduce((sum, p) => sum + (parseInt(p.remaining) || 0), 0);
      const catTotalLd = inStock.reduce((sum, p) => sum + (parseInt(p.loaded) || 0), 0);
      const catPct = catTotalLd > 0 ? (catTotalRem / catTotalLd) * 100 : 0;
      const catOffset = 87.96 - (catPct / 100) * 87.96;
      const catColor = catTotalRem <= 0 ? '#c0392b' : catPct < 25 ? '#d4a017' : '#2a9d5c';

      html += `<div class="inv-category collapsed">`;
      html += `<div class="inv-cat-title" onclick="toggleInvCategory(this)">
                 <span data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span>
                 <div class="inv-cat-title-right">
                   <div class="inv-cat-total">
                     <div class="inv-ring-container" style="width:34px;height:34px;">
                       <svg class="inv-ring-svg" width="34" height="34">
                         <circle class="inv-ring-bg" cx="17" cy="17" r="14"></circle>
                         <circle class="inv-ring-fill" cx="17" cy="17" r="14" stroke-dashoffset="${catOffset}" style="stroke:${catColor};stroke-dasharray:87.96"></circle>
                       </svg>
                       <div class="inv-row-num" style="font-size:0.95rem;">${catTotalRem}</div>
                     </div>
                   </div>
                   <svg class="inv-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                 </div>
               </div>`;
      html += `<div class="inv-cat-content">`;
      inStock.sort((a, b) => a.remaining - b.remaining);
      inStock.forEach(p => { html += renderInvRow(p); });
      html += `</div></div>`;
    }
  });

  // Unknown keys
  const knownKeys = new Set();
  Object.values(PRODUCTS).forEach(sec => {
    sec.items.forEach(item => {
      knownKeys.add(item.key);
      if (item.cols) item.cols.forEach(col => knownKeys.add(item.key + '_' + col));
    });
  });
  const unknown = keys.filter(k => !knownKeys.has(k));
  if (unknown.length > 0) {
    const inStockUnknown = unknown.filter(k => driverInventory[k].remaining > 0);
    const outUnknown = unknown.filter(k => driverInventory[k].remaining <= 0);
    outUnknown.forEach(k => {
      const p = driverInventory[k];
      soldOutItems.push({ key: k, label: labelMap[k] || k, ...p, catLabel: lang === 'es' ? 'Otro' : 'Other' });
    });
    if (inStockUnknown.length > 0) {
      const catTotalRem = inStockUnknown.reduce((sum, k) => sum + (parseInt(driverInventory[k].remaining) || 0), 0);
      const catTotalLd = inStockUnknown.reduce((sum, k) => sum + (parseInt(driverInventory[k].loaded) || 0), 0);
      const catPct = catTotalLd > 0 ? (catTotalRem / catTotalLd) * 100 : 0;
      const catOffset = 87.96 - (catPct / 100) * 87.96;
      const catColor = catTotalRem <= 0 ? '#c0392b' : catPct < 25 ? '#d4a017' : '#2a9d5c';

      html += `<div class="inv-category collapsed">
                 <div class="inv-cat-title" onclick="toggleInvCategory(this)">
                   <span>${lang === 'es' ? 'Otro' : 'Other'}</span>
                   <div class="inv-cat-title-right">
                     <div class="inv-cat-total">
                       <div class="inv-ring-container" style="width:34px;height:34px;">
                         <svg class="inv-ring-svg" width="34" height="34">
                           <circle class="inv-ring-bg" cx="17" cy="17" r="14"></circle>
                           <circle class="inv-ring-fill" cx="17" cy="17" r="14" stroke-dashoffset="${catOffset}" style="stroke:${catColor};stroke-dasharray:87.96"></circle>
                         </svg>
                         <div class="inv-row-num" style="font-size:0.95rem;">${catTotalRem}</div>
                       </div>
                     </div>
                     <svg class="inv-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                   </div>
                 </div>
                 <div class="inv-cat-content">`;
      inStockUnknown.forEach(k => {
        const p = driverInventory[k];
        html += renderInvRow({ key: k, label: labelMap[k] || k, ...p });
      });
      html += `</div></div>`;
    }
  }

  // Sold-out section at bottom
  if (soldOutItems.length > 0) {
    html += `<div class="inv-category inv-sold-out-section collapsed">`;
    html += `<div class="inv-cat-title inv-cat-soldout" onclick="toggleInvCategory(this)">
               <span>${lang === 'es' ? 'Agotado' : 'Sold Out'}</span>
               <div class="inv-cat-title-right">
                 <span class="inv-soldout-count">${soldOutItems.length}</span>
                 <svg class="inv-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
               </div>
             </div>`;
    html += `<div class="inv-cat-content">`;
    soldOutItems.forEach(p => { html += renderInvRow(p); });
    html += `</div></div>`;
  }

  container.innerHTML = html;
}

window.toggleInvCategory = function (el) {
  const cat = el.closest('.inv-category');
  if (cat) cat.classList.toggle('collapsed');
};

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
          const fullLabel = L(item) + ' — ' + colLabel + (isNT ? ' (NT)' : '');
          html += `<div class="inv-form-row">`;
          html += `<span class="inv-form-label">${_esc(fullLabel)}</span>`;
          html += `<input type="number" class="inv-form-input" data-pk="${subKey}" min="0" value="0" inputmode="numeric">`;
          html += `</div>`;
        });
      } else {
        // Regular variant
        html += `<div class="inv-form-row">`;
        html += `<span class="inv-form-label" data-en="${item.en}" data-es="${item.es}">${L(item)}</span>`;
        html += `<input type="number" class="inv-form-input" data-pk="${item.key}" min="0" value="0" inputmode="numeric">`;
        html += `</div>`;
        // No-ticket variant
        html += `<div class="inv-form-row">`;
        html += `<span class="inv-form-label">${L(item)} (NT)</span>`;
        html += `<input type="number" class="inv-form-input" data-pk="${item.key}_nt" min="0" value="0" inputmode="numeric">`;
        html += `</div>`;
      }
    });

    html += `</div>`;
  });

  html += `<div class="inv-save-float" id="inv-save-float">
    <button class="inv-save-btn" id="inv-save-btn" data-en="Save Inventory" data-es="Guardar Inventario">${lang === 'es' ? 'Guardar Inventario' : 'Save Inventory'}</button>
  </div>`;

  container.innerHTML = html;

  // Pre-fill with existing inventory values
  if (inventoryLoaded && driverInventory) {
    container.querySelectorAll('.inv-form-input').forEach(inp => {
      const pk = inp.dataset.pk;
      if (driverInventory[pk] && driverInventory[pk].loaded > 0) {
        inp.value = driverInventory[pk].loaded;
      }
    });
  }

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

    // Delete existing manual inventory for today to allow clean insert and removals (setting to 0)
    await sb.from('driver_inventory')
      .delete()
      .eq('driver_id', currentDriver.id)
      .eq('date', today);

    const { error } = await sb
      .from('driver_inventory')
      .insert(rows);

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error('Save inventory error:', e);
    showToast(lang === 'es' ? 'Error al guardar' : 'Error saving inventory', 'error');
    btn.disabled = false;
    btn.textContent = lang === 'es' ? 'Guardar Inventario' : 'Save Inventory';
  }
}

/* ═══════════════════════════════════
   OVERVIEW ANALYTICS DASHBOARD
   ═══════════════════════════════════ */
let _driverRevenueChart = null;

async function loadOverviewDashboard(timeframe) {
  if (!sb || !currentDriver) return;
  if (!timeframe) timeframe = document.getElementById('overview-filter')?.value || 'this_month';

  const now = new Date();
  let startDate = null;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (timeframe === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (timeframe === 'this_week') {
    const dow = now.getDay();
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0);
  } else if (timeframe === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  } else if (timeframe === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }
  // all_time: startDate stays null

  try {
    // Fetch sales + sale items in parallel
    let salesQuery = sb.from('driver_sales')
      .select('id, total, client_id, created_at')
      .eq('driver_id', currentDriver.id);

    if (startDate) salesQuery = salesQuery.gte('created_at', startDate.toISOString());
    salesQuery = salesQuery.lte('created_at', endDate.toISOString());
    salesQuery = salesQuery.order('created_at', { ascending: false });

    const { data: sales, error: salesErr } = await salesQuery;
    if (salesErr) { console.error('Overview sales error:', salesErr); return; }

    const salesData = sales || [];

    // Compute stats
    let totalRevenue = 0;
    let totalCount = salesData.length;
    salesData.forEach(s => { totalRevenue += parseFloat(s.total || 0); });

    // Fetch all sale items for this period to get items sold + best sellers
    const saleIds = salesData.map(s => s.id);
    let allItems = [];
    if (saleIds.length > 0) {
      // Supabase .in() has a limit, so batch if needed
      const batchSize = 100;
      for (let i = 0; i < saleIds.length; i += batchSize) {
        const batch = saleIds.slice(i, i + batchSize);
        const { data: items } = await sb.from('driver_sale_items')
          .select('product_key, product_label, quantity, line_total, sale_id')
          .in('sale_id', batch);
        if (items) allItems = allItems.concat(items);
      }
    }

    let totalItemsSold = 0;
    allItems.forEach(it => { totalItemsSold += (it.quantity || 0); });

    // Update stat cards
    document.getElementById('ov-stat-revenue').textContent = '$' + totalRevenue.toFixed(2);
    document.getElementById('ov-stat-items').textContent = totalItemsSold;
    document.getElementById('ov-stat-count').textContent = totalCount;

    // Build chart
    renderOverviewChart(salesData, timeframe);

    // Build leaderboards
    renderBestSellers(allItems);
    renderTopClients(salesData);

  } catch (e) { console.error('Overview dashboard error:', e); }
}

function renderOverviewChart(salesData, timeframe) {
  const useMonthly = (timeframe === 'all_time' || timeframe === 'last_month');
  const buckets = {};

  salesData.forEach(s => {
    if (!s.created_at) return;
    const d = new Date(s.created_at);
    const key = useMonthly
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    buckets[key] = (buckets[key] || 0) + parseFloat(s.total || 0);
  });

  const sortedKeys = Object.keys(buckets).sort();
  const chartLabels = sortedKeys.map(k => {
    if (useMonthly) {
      const [y, m] = k.split('-');
      return new Date(y, m - 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
    }
    const [y, m, d] = k.split('-');
    return new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short', day: 'numeric' });
  });
  const chartValues = sortedKeys.map(k => buckets[k]);

  const ctx = document.getElementById('driverRevenueChart');
  if (_driverRevenueChart) { _driverRevenueChart.destroy(); _driverRevenueChart = null; }

  if (ctx && chartLabels.length > 0) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(200,16,46,.06)';
    const tickColor = isDark ? '#BFA0A8' : '#6B5057';

    _driverRevenueChart = new Chart(ctx, {
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
              label: c => '$' + c.parsed.y.toFixed(2)
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
  } else if (ctx) {
    // No data — show empty state in chart area
    const parent = ctx.parentElement;
    if (parent) parent.innerHTML = `<div class="empty-state" style="padding:40px 0">${lang === 'es' ? 'Sin datos de ventas' : 'No sales data'}</div>`;
  }
}

function renderBestSellers(allItems) {
  const container = document.getElementById('ov-best-sellers');
  if (!container) return;

  // Aggregate by product_key
  const productMap = {};
  allItems.forEach(it => {
    const key = it.product_key;
    if (!productMap[key]) {
      productMap[key] = { label: it.product_label || key, qty: 0, revenue: 0 };
    }
    productMap[key].qty += (it.quantity || 0);
    productMap[key].revenue += parseFloat(it.line_total || 0);
  });

  const sorted = Object.values(productMap).sort((a, b) => b.qty - a.qty);
  if (sorted.length === 0) {
    container.innerHTML = `<div class="empty-state" data-en="No sales data yet" data-es="Sin datos de ventas">${lang === 'es' ? 'Sin datos de ventas' : 'No sales data yet'}</div>`;
    return;
  }

  const topItems = sorted.slice(0, 8);
  const maxQty = topItems[0].qty;

  container.innerHTML = topItems.map((item, i) => {
    const barW = Math.max(3, (item.qty / maxQty) * 100);
    return `<div class="ov-lb-item">
      <span class="ov-lb-rank">${i + 1}</span>
      <div class="ov-lb-info">
        <div class="ov-lb-name">${_esc(item.label)}</div>
        <div class="ov-lb-bar-bg"><div class="ov-lb-bar" style="width:${barW}%"></div></div>
      </div>
      <div class="ov-lb-meta">
        <div class="ov-lb-amount">${item.qty}</div>
        <div class="ov-lb-sub">$${item.revenue.toFixed(2)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTopClients(salesData) {
  const container = document.getElementById('ov-top-clients');
  if (!container) return;

  // Aggregate by client_id
  const clientMap = {};
  salesData.forEach(s => {
    const cid = s.client_id;
    if (!cid) return;
    if (!clientMap[cid]) {
      clientMap[cid] = { id: cid, count: 0, revenue: 0 };
    }
    clientMap[cid].count++;
    clientMap[cid].revenue += parseFloat(s.total || 0);
  });

  const sorted = Object.values(clientMap).sort((a, b) => b.revenue - a.revenue);
  if (sorted.length === 0) {
    container.innerHTML = `<div class="empty-state" data-en="No client data yet" data-es="Sin datos de clientes">${lang === 'es' ? 'Sin datos de clientes' : 'No client data yet'}</div>`;
    return;
  }

  // Resolve client names from cached _clientsList
  const clientNameMap = {};
  if (_clientsList) {
    _clientsList.forEach(c => { clientNameMap[c.id] = c.business_name || c.name || 'Unknown'; });
  }

  const topClients = sorted.slice(0, 5);
  const maxRev = topClients[0].revenue;

  container.innerHTML = topClients.map((c, i) => {
    const name = clientNameMap[c.id] || (lang === 'es' ? 'Cliente' : 'Client');
    const barW = Math.max(3, (c.revenue / maxRev) * 100);
    const salesLabel = c.count === 1
      ? (lang === 'es' ? '1 venta' : '1 sale')
      : (lang === 'es' ? `${c.count} ventas` : `${c.count} sales`);
    return `<div class="ov-lb-item">
      <span class="ov-lb-rank">${i + 1}</span>
      <div class="ov-lb-info">
        <div class="ov-lb-name">${_esc(name)}</div>
        <div class="ov-lb-bar-bg"><div class="ov-lb-bar" style="width:${barW}%;background:var(--blue)"></div></div>
      </div>
      <div class="ov-lb-meta">
        <div class="ov-lb-amount">$${c.revenue.toFixed(2)}</div>
        <div class="ov-lb-sub">${salesLabel}</div>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════
   FEATURE FLAGS
   ═══════════════════════════════════ */
async function checkAdvancedFeatures() {
  if (!currentDriver) return;

  try {
    if (sb) {
      let data, error;
      ({ data, error } = await sb
        .from('drivers')
        .select('scanner_enabled, voice_order_enabled')
        .eq('id', currentDriver.id)
        .single());

      // Fallback if voice_order_enabled column doesn't exist yet
      if (error && error.message && error.message.includes('voice_order_enabled')) {
        ({ data, error } = await sb
          .from('drivers')
          .select('scanner_enabled')
          .eq('id', currentDriver.id)
          .single());
      }

      if (!error && data) {
        currentDriver.scanner_enabled = data.scanner_enabled;
        currentDriver.voice_order_enabled = data.voice_order_enabled || false;
        // Update local storage session so it persists
        const saved = localStorage.getItem('cecilia_driver');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            parsed.scanner_enabled = data.scanner_enabled;
            parsed.voice_order_enabled = data.voice_order_enabled || false;
            localStorage.setItem('cecilia_driver', JSON.stringify(parsed));
          } catch (e) { }
        }
      }
    }
  } catch (e) {
    _log('Error checking scanner features:', e);
  }

  // Show or hide scanner
  const scannerEnabled = !!currentDriver.scanner_enabled;
  document.querySelectorAll('.scanner-feature').forEach(el => {
    el.style.display = scannerEnabled ? '' : 'none';
  });

  // Show or hide voice ordering
  // NOTE: Do NOT force display:'' on .voice-feature elements when enabled —
  // that bleeds the mic/screen/overlay into non-order sections.
  // Instead, just hide everything when disabled. _showVoiceFab() handles
  // showing the footer mic only when on the New Order screen.
  const voiceEnabled = !!currentDriver.voice_order_enabled;
  if (!voiceEnabled) {
    document.querySelectorAll('.voice-feature').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Wire up scanner events if scanner is enabled
  if (scannerEnabled) {
    _initDriverScanner();
  }

  // Wire up voice ordering if voice is enabled
  if (voiceEnabled) {
    _initVoiceOrdering();
    // Re-check mic visibility for current section
    const isOnNewOrder = document.getElementById('section-new-order')?.classList.contains('active-section');
    _showVoiceFab(!!isOnNewOrder);
  }
}

/* ═══════════════════════════════════
   TICKET SCANNER (DRIVER)
   ═══════════════════════════════════ */
let _driverScannerInited = false;

function _initDriverScanner() {
  if (_driverScannerInited) return;
  _driverScannerInited = true;

  const scanBtn = document.getElementById('scan-ticket-btn');
  const scanInput = document.getElementById('scan-ticket-input');
  const scanClear = document.getElementById('scan-result-clear');
  const scanReviewBtn = document.getElementById('scan-review-btn');
  const scanReviewClose = document.getElementById('scan-review-close');
  const scanReviewBackdrop = document.getElementById('scan-review-backdrop');

  if (scanBtn && scanInput) {
    scanBtn.onclick = () => scanInput.click();
    scanInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await _driverScanTicketFile(file);
      scanInput.value = '';
    };
  }
  if (scanClear) {
    scanClear.onclick = () => _driverClearScanResults();
  }
  if (scanReviewBtn) {
    scanReviewBtn.onclick = () => _driverOpenScanReview();
  }
  if (scanReviewClose) {
    scanReviewClose.onclick = () => _driverCloseScanReview();
  }
  if (scanReviewBackdrop) {
    scanReviewBackdrop.onclick = () => _driverCloseScanReview();
  }
}

/* ── Image preprocessing (sharpen + contrast for OCR) ── */
async function _preprocessTicketImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 1200;
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;
      const factor = 1.8;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let val = ((gray / 255 - 0.5) * factor + 0.5) * 255;
        val = Math.max(0, Math.min(255, val));
        d[i] = d[i + 1] = d[i + 2] = val;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ── Scan a ticket file ── */
async function _driverScanTicketFile(file) {
  const btn = document.getElementById('scan-ticket-btn');
  const banner = document.getElementById('scan-result-banner');
  const bannerText = document.getElementById('scan-result-text');

  if (btn) { btn.classList.add('scanning'); btn.querySelector('span').textContent = lang === 'es' ? 'Procesando...' : 'Processing...'; }

  try {
    const rawBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64 = await _preprocessTicketImage(rawBase64);

    const resp = await fetch('/api/scan-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Scan failed');

    if (data.items.length === 0) {
      if (banner && bannerText) {
        banner.style.display = 'flex';
        banner.className = 'scan-result-banner has-warnings';
        bannerText.textContent = lang === 'es' ? 'No se encontraron productos en la imagen.' : 'No products found in image.';
      }
      return;
    }

    // Save current form state first
    saveFormToOrder(activeOrderIdx);
    const order = orders[activeOrderIdx];
    let filled = 0, uncertain = 0, unmatched = 0;

    data.items.forEach(item => {
      if (!item.matched || !item.systemKey) { unmatched++; return; }
      const key = item.systemKey;
      const rawQty = parseFloat(item.qty) || 0;
      if (rawQty <= 0) return;

      const isBirthdayCake = key.startsWith('hb_');
      const qty = isBirthdayCake ? rawQty : Math.round(rawQty * 12);

      if (key in order.qty) {
        order.qty[key] = qty;
        filled++;
      } else if ((key + '_inside') in order.qty) {
        order.qty[key + '_inside'] = qty;
        filled++;
      } else {
        unmatched++;
        return;
      }
      if (!item.confident) uncertain++;
    });

    // Reload form from data
    loadOrderToForm(activeOrderIdx);

    // Re-apply scan highlights
    data.items.forEach(item => {
      if (!item.matched || !item.systemKey) return;
      const key = item.systemKey;
      const input = document.querySelector(`.qty-input[data-key="${key}"], .qty-input[data-key="${key}_inside"]`);
      if (input && (parseFloat(item.qty) || 0) > 0) {
        input.classList.add(item.confident !== false ? 'scan-filled' : 'scan-uncertain');
      }
    });

    updateFooterCount();

    // Store scan data in the order object
    const currentOrder = orders[activeOrderIdx];
    if (currentOrder) {
      currentOrder.scanData = data.items.map(item => {
        const key = item.systemKey;
        const rawQty = parseFloat(item.qty) || 0;
        const isBirthdayCake = key && key.startsWith('hb_');
        return {
          code: item.code,
          description: item.description,
          rawQty,
          convertedQty: (key && rawQty > 0) ? (isBirthdayCake ? rawQty : Math.round(rawQty * 12)) : 0,
          confident: item.confident,
          matched: item.matched,
          isBirthdayCake,
        };
      });
    }

    // Show result banner
    if (banner && bannerText) {
      banner.style.display = 'flex';
      let msg = lang === 'es'
        ? `${filled} producto(s) escaneado(s)`
        : `${filled} product(s) scanned`;
      if (uncertain > 0) msg += lang === 'es' ? `, ${uncertain} por revisar` : `, ${uncertain} to review`;
      if (unmatched > 0) msg += lang === 'es' ? `, ${unmatched} sin coincidencia` : `, ${unmatched} unmatched`;

      const hasMismatch = data.mismatch && data.mismatch.expected !== undefined;
      if (hasMismatch) {
        const m = data.mismatch;
        const label = m.type === 'total_boxes' ? 'Total Boxes' : 'Total Units';
        msg += lang === 'es'
          ? ` ⚠️ ${label}: ticket=${m.expected}, escaneo=${m.computed}`
          : ` ⚠️ ${label}: ticket=${m.expected}, scan=${m.computed}`;
      }

      bannerText.textContent = msg;
      banner.className = (uncertain > 0 || unmatched > 0 || hasMismatch)
        ? 'scan-result-banner has-warnings'
        : 'scan-result-banner';
    }

  } catch (err) {
    console.error('Ticket scan error:', err);
    if (banner && bannerText) {
      banner.style.display = 'flex';
      banner.className = 'scan-result-banner has-warnings';
      bannerText.textContent = err.message || (lang === 'es' ? 'Error al escanear' : 'Scan failed');
    }
  } finally {
    if (btn) {
      btn.classList.remove('scanning');
      btn.querySelector('span').textContent = lang === 'es' ? 'Adjuntar Ticket' : 'Attach Ticket';
    }
  }
}

/* ── Clear scan results ── */
function _driverClearScanResults() {
  const banner = document.getElementById('scan-result-banner');
  if (banner) banner.style.display = 'none';
  // Remove scan highlights
  document.querySelectorAll('.scan-filled, .scan-uncertain').forEach(el => {
    el.classList.remove('scan-filled', 'scan-uncertain');
  });
  // Clear scan data from current order
  const order = orders[activeOrderIdx];
  if (order) order.scanData = null;
}

/* ── Open scan review sheet ── */
function _driverOpenScanReview() {
  const overlay = document.getElementById('scan-review-overlay');
  const body = document.getElementById('scan-review-body');
  const order = orders[activeOrderIdx];
  const scanData = order && order.scanData;
  if (!overlay || !body || !scanData || scanData.length === 0) return;

  let html = '';
  let totalItems = 0, uncertainCount = 0;

  scanData.forEach(item => {
    if (item.rawQty <= 0 && item.matched) return;
    const isUncertain = !item.confident;
    if (isUncertain) uncertainCount++;
    if (item.matched && item.rawQty > 0) totalItems++;

    const rowClass = isUncertain ? 'scan-review-row uncertain' : 'scan-review-row';
    const badge = isUncertain ? '<span class="scan-review-badge">⚠</span>' : '';
    const rawLabel = item.isBirthdayCake
      ? ''
      : `<span class="scan-review-raw">(${item.rawQty} on ticket)</span>`;

    html += `<div class="${rowClass}">
      <span class="scan-review-code">${item.code}</span>
      <span class="scan-review-desc">${item.description}${badge}</span>
      <span class="scan-review-qty">${item.convertedQty}${rawLabel}</span>
    </div>`;
  });

  let summary = lang === 'es'
    ? `${totalItems} producto(s)`
    : `${totalItems} item(s)`;
  if (uncertainCount > 0) {
    summary += lang === 'es'
      ? ` · ${uncertainCount} incierto(s)`
      : ` · ${uncertainCount} uncertain`;
  }
  html += `<div class="scan-review-summary">${summary}</div>`;

  body.innerHTML = html;
  overlay.classList.add('open');
  body.scrollTop = 0;
  document.documentElement.dataset.scrollY = window.scrollY;
  document.body.style.top = `-${window.scrollY}px`;
  document.documentElement.classList.add('scroll-locked');
}

/* ── Close scan review sheet ── */
function _driverCloseScanReview() {
  const overlay = document.getElementById('scan-review-overlay');
  if (overlay) overlay.classList.remove('open');
  document.documentElement.classList.remove('scroll-locked');
  const scrollY = document.documentElement.dataset.scrollY || '0';
  document.body.style.top = '';
  window.scrollTo(0, parseInt(scrollY));
}

/* ═══════════════════════════════════
   AI VOICE ORDERING (Driver)
   Audio recording → Gemini parsing
   ═══════════════════════════════════ */
let _voiceInited = false;
let _voiceState = 'idle'; // idle | recording | processing | confirming
let _voiceConversation = []; // multi-turn history
let _pendingActions = []; // actions waiting for confirmation
let _voiceTooltipShown = false;
let _mediaRecorder = null;
let _audioChunks = [];
let _voiceStream = null;
let _recTimerInterval = null;
let _recStartTime = 0;

/* Show/hide the footer mic button */
function _showVoiceFab(onNewOrder) {
  const voiceEnabled = currentDriver && !!currentDriver.voice_order_enabled;
  const micBtn = document.getElementById('footer-mic-btn');
  const tooltip = document.getElementById('voice-tooltip');

  if (!micBtn) return;

  if (onNewOrder && voiceEnabled) {
    micBtn.style.display = 'flex';

    // Show tooltip once
    if (tooltip && !_voiceTooltipShown) {
      tooltip.style.display = 'block';
      _voiceTooltipShown = true;
      setTimeout(() => {
        tooltip.style.opacity = '0';
        setTimeout(() => { tooltip.style.display = 'none'; }, 500);
      }, 4000);
    }
  } else {
    micBtn.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    // Close voice screen & overlays if open
    const screen = document.getElementById('voice-screen');
    if (screen) screen.style.display = 'none';
    const confirmOv = document.getElementById('voice-confirm-overlay');
    if (confirmOv) { confirmOv.classList.remove('active'); confirmOv.style.display = 'none'; }
    _cancelRecording();
    _voiceState = 'idle';
  }
}

function _initVoiceOrdering() {
  if (_voiceInited) return;
  _voiceInited = true;

  // Footer mic button opens voice screen
  const footerMic = document.getElementById('footer-mic-btn');
  if (footerMic) {
    footerMic.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _openVoiceScreen();
    });
  }

  // Voice screen mic toggles recording
  const screenMic = document.getElementById('voice-screen-mic');
  if (screenMic) {
    screenMic.addEventListener('click', () => {
      if (_voiceState === 'recording') {
        _stopRecording();
      } else if (_voiceState === 'idle' || _voiceState === 'paused') {
        _startRecording();
      }
    });
  }

  // Close button
  const closeBtn = document.getElementById('voice-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => _closeVoiceScreen());
  }

  // Process Order button
  const processBtn = document.getElementById('voice-process-btn');
  if (processBtn) {
    processBtn.addEventListener('click', () => {
      _processVoiceAudio();
    });
  }

  // Confirm button on confirmation card
  const confirmBtn = document.getElementById('voice-confirm-accept');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => _applyVoiceActions());
  }
}

/* ── Voice Screen Management ── */
function _openVoiceScreen() {
  const screen = document.getElementById('voice-screen');
  if (!screen) return;

  // Reset
  _audioChunks = [];
  const timer = document.getElementById('voice-rec-timer');
  if (timer) timer.textContent = '0:00';
  const status = document.getElementById('voice-rec-status');
  if (status) {
    status.textContent = lang === 'es' ? 'Escuchando...' : 'Listening...';
    status.classList.remove('stopped');
  }
  const pulse = document.getElementById('voice-rec-pulse');
  if (pulse) pulse.classList.remove('stopped');
  const processBtn = document.getElementById('voice-process-btn');
  if (processBtn) processBtn.style.display = 'none';

  document.getElementById('voice-processing').style.display = 'none';
  document.getElementById('voice-screen-footer').style.display = 'flex';

  screen.style.display = 'flex';
  applyLang();

  // Auto-start recording
  setTimeout(() => _startRecording(), 400);
}

function _closeVoiceScreen() {
  _cancelRecording();
  const screen = document.getElementById('voice-screen');
  if (screen) screen.style.display = 'none';
  _voiceState = 'idle';
}

/* ── Audio Recording ── */
async function _startRecording() {
  try {
    _voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      }
    });
  } catch (err) {
    console.error('Mic permission error:', err);
    showToast(lang === 'es' ? 'Permiso de micrófono denegado' : 'Microphone permission denied', 'error');
    return;
  }

  // Pick the best codec
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  let mimeType = '';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
  }

  _audioChunks = [];
  _mediaRecorder = new MediaRecorder(_voiceStream, mimeType ? { mimeType } : {});

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) _audioChunks.push(e.data);
  };

  _mediaRecorder.onstop = () => {
    // Recording stopped — chunks are ready
  };

  _mediaRecorder.start(500); // Collect in 500ms chunks for safety
  _voiceState = 'recording';

  // Update UI
  const indicator = document.getElementById('voice-listening-ind');
  if (indicator) indicator.classList.add('active');
  const micBtn = document.getElementById('voice-screen-mic');
  if (micBtn) { micBtn.classList.add('listening'); micBtn.classList.remove('stopped'); }
  const pulse = document.getElementById('voice-rec-pulse');
  if (pulse) pulse.classList.remove('stopped');
  const status = document.getElementById('voice-rec-status');
  if (status) {
    status.textContent = lang === 'es' ? 'Escuchando...' : 'Listening...';
    status.classList.remove('stopped');
  }

  // Start timer
  _recStartTime = Date.now();
  _recTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _recStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timer = document.getElementById('voice-rec-timer');
    if (timer) timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 500);

  // Show process button after a moment
  setTimeout(() => {
    const processBtn = document.getElementById('voice-process-btn');
    if (processBtn && _voiceState === 'recording') processBtn.style.display = '';
  }, 1000);
}

function _stopRecording() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
  _voiceState = 'paused';

  // Stop timer
  clearInterval(_recTimerInterval);

  // Update UI to paused state
  const indicator = document.getElementById('voice-listening-ind');
  if (indicator) indicator.classList.remove('active');
  const micBtn = document.getElementById('voice-screen-mic');
  if (micBtn) { micBtn.classList.remove('listening'); micBtn.classList.add('stopped'); }
  const pulse = document.getElementById('voice-rec-pulse');
  if (pulse) pulse.classList.add('stopped');
  const status = document.getElementById('voice-rec-status');
  if (status) {
    status.textContent = lang === 'es' ? 'Pausado' : 'Paused';
    status.classList.add('stopped');
  }

  // Keep stream alive so they can resume
}

function _cancelRecording() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    try { _mediaRecorder.stop(); } catch(e) {}
  }
  _mediaRecorder = null;
  if (_voiceStream) {
    _voiceStream.getTracks().forEach(t => t.stop());
    _voiceStream = null;
  }
  clearInterval(_recTimerInterval);
  _audioChunks = [];
}

/* ── Send audio to Gemini ── */
async function _processVoiceAudio() {
  // Stop recording if still going
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
  clearInterval(_recTimerInterval);

  // Wait a beat for the last chunk
  await new Promise(r => setTimeout(r, 300));

  if (_audioChunks.length === 0) {
    showToast(lang === 'es' ? 'No se grabó audio' : 'No audio recorded', 'error');
    _voiceState = 'idle';
    return;
  }

  _voiceState = 'processing';

  // Show processing state
  document.getElementById('voice-screen-footer').style.display = 'none';
  document.getElementById('voice-processing').style.display = 'flex';

  const indicator = document.getElementById('voice-listening-ind');
  if (indicator) indicator.classList.remove('active');

  try {
    // Build audio blob
    const blob = new Blob(_audioChunks, { type: _audioChunks[0]?.type || 'audio/webm' });

    // Convert to base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const products = _getDriverProducts();
    const currentOrder = _getCurrentDriverOrderState();

    const res = await fetch('/api/voice-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: base64,
        products,
        currentOrder,
        conversationHistory: _voiceConversation,
      }),
    });

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      const rawText = await res.text().catch(() => '');
      console.error('Voice order: failed to parse response', res.status, rawText.substring(0, 200));
      throw new Error('Server returned invalid response (HTTP ' + res.status + ')');
    }

    // Hide processing
    document.getElementById('voice-processing').style.display = 'none';

    if (!data.success || !data.actions || data.actions.length === 0) {
      _voiceState = 'idle';
      document.getElementById('voice-screen-footer').style.display = 'flex';
      const detail = data.debug ? ` (${data.debug})` : '';
      showToast((data.message || (lang === 'es' ? 'No entendí, intenta de nuevo' : "Didn't catch that, try again")) + detail, 'error');
      // Reset for retry
      _audioChunks = [];
      const timer = document.getElementById('voice-rec-timer');
      if (timer) timer.textContent = '0:00';
      const processBtn = document.getElementById('voice-process-btn');
      if (processBtn) processBtn.style.display = 'none';
      return;
    }

    // Add to conversation history
    _voiceConversation.push({ role: 'user', transcript: data.understood_text || '' });
    _voiceConversation.push({ role: 'assistant', actions: data.actions });

    // Merge with pending actions
    _pendingActions = _mergeVoiceActions(_pendingActions, data.actions);

    // Close voice screen, show confirmation card
    const screen = document.getElementById('voice-screen');
    if (screen) screen.style.display = 'none';

    // Clean up stream
    if (_voiceStream) {
      _voiceStream.getTracks().forEach(t => t.stop());
      _voiceStream = null;
    }

    _showVoiceConfirmation(data);

    // TTS readback
    if (data.readback) _voiceSpeak(data.readback, data.readback_lang || 'es');

    _voiceState = 'confirming';
  } catch (err) {
    console.error('Voice order processing error:', err);
    document.getElementById('voice-processing').style.display = 'none';
    document.getElementById('voice-screen-footer').style.display = 'flex';
    _voiceState = 'idle';
    // Reset for retry
    _audioChunks = [];
    const timer = document.getElementById('voice-rec-timer');
    if (timer) timer.textContent = '0:00';
    const processBtn = document.getElementById('voice-process-btn');
    if (processBtn) processBtn.style.display = 'none';
    const errMsg = err.message || 'Unknown error';
    showToast((lang === 'es' ? 'Error: ' : 'Error: ') + errMsg, 'error');
  }
}

/* ── Helper functions ── */
function _getDriverProducts() {
  const products = [];
  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        (item.cols || []).forEach(col => {
          const isNT = col.endsWith('_nt');
          const colClean = col.replace('_nt', '');
          const suffix = colClean === 'inside' ? (lang === 'es' ? ' Adentro' : ' Inside') : (lang === 'es' ? ' Arriba' : ' Top');
          const ntSuffix = isNT ? (lang === 'es' ? ' (Sin Ticket)' : ' (No Ticket)') : '';
          products.push({
            key: item.key + '_' + col,
            en: item.en + suffix.replace(' Adentro', ' Inside').replace(' Arriba', ' Top') + ntSuffix.replace('(Sin Ticket)', '(No Ticket)'),
            es: item.es + suffix + ntSuffix,
            category: sec.es || sec.en
          });
        });
      } else {
        products.push({ key: item.key, en: item.en, es: item.es, category: sec.es || sec.en });
        products.push({
          key: item.key + '_nt',
          en: item.en + ' (No Ticket)',
          es: item.es + ' (Sin Ticket)',
          category: sec.es || sec.en
        });
      }
    });
  });
  return products;
}

function _getCurrentDriverOrderState() {
  const state = {};
  document.querySelectorAll('#section-new-order .qty-input').forEach(inp => {
    const val = parseInt(inp.value) || 0;
    if (val > 0) state[inp.dataset.key] = val;
  });
  return state;
}

function _mergeVoiceActions(existing, newActions) {
  const map = new Map();
  existing.forEach(a => map.set(a.key, a));
  newActions.forEach(a => {
    if (a.type === 'delete') {
      map.set(a.key, { ...a, qty: 0 });
    } else if (a.type === 'add') {
      const prev = map.get(a.key);
      const prevQty = prev ? (prev.qty || 0) : 0;
      map.set(a.key, { ...a, type: 'set', qty: prevQty + (a.qty || 0) });
    } else {
      map.set(a.key, a);
    }
  });
  return [...map.values()].filter(a => a.type === 'delete' || a.qty > 0);
}

function _showVoiceConfirmation(data) {
  const overlay = document.getElementById('voice-confirm-overlay');
  const itemsEl = document.getElementById('voice-confirm-items');
  const transcriptEl = document.getElementById('voice-confirm-transcript');

  if (transcriptEl) {
    transcriptEl.textContent = data.understood_text ? `"${data.understood_text}"` : '';
  }

  if (itemsEl) {
    let html = '';
    _pendingActions.forEach(a => {
      const icon = a.type === 'delete' ? '✕' : '✓';
      const cls = a.type === 'delete' ? 'voice-item-delete' : 'voice-item-add';
      const qtyText = a.type === 'delete' ? (lang === 'es' ? 'Borrado' : 'Removed') : `×${a.qty}`;
      html += `<div class="voice-confirm-item ${cls}">
        <span class="voice-item-icon">${icon}</span>
        <span class="voice-item-name">${a.label || a.key}</span>
        <span class="voice-item-qty">${qtyText}</span>
      </div>`;
    });
    itemsEl.innerHTML = html;
  }

  if (overlay) {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('active'));
  }
}

function _applyVoiceActions() {
  _pendingActions.forEach(a => {
    const input = document.querySelector(`#section-new-order .qty-input[data-key="${a.key}"]`);
    if (!input) return;

    if (a.type === 'delete') {
      input.value = '0';
    } else {
      input.value = a.qty;
    }

    const row = input.closest('.prod-row');
    if (row) {
      row.classList.add('voice-highlight');
      setTimeout(() => row.classList.remove('voice-highlight'), 1500);
    }
    updateRowHighlight(input);
  });

  updateFooterCount();

  _pendingActions = [];
  _voiceConversation = [];
  _voiceState = 'idle';

  const overlay = document.getElementById('voice-confirm-overlay');
  if (overlay) { overlay.classList.remove('active'); setTimeout(() => overlay.style.display = 'none', 300); }

  showToast(lang === 'es' ? 'Pedido aplicado ✓' : 'Order applied ✓', 'success');
}

function _voiceSpeak(text, speechLang) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = speechLang === 'en' ? 'en-US' : 'es-MX';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}
