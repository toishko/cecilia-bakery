/* ═══════════════════════════════════
   SUPABASE INIT
   ═══════════════════════════════════ */
const SUPABASE_URL = 'https://dykztphptnytbihpavpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w';

let sb = null;
try {
  const supabaseLib = window.supabase;
  if (supabaseLib && supabaseLib.createClient) {
    sb = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized');
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
  if (name === 'new-order') {
    initOrderForm();
    footer.style.display = 'flex';
  } else {
    footer.style.display = 'none';
  }
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
    errorEl.textContent = lang === 'es' ? 'Ingresa tu codigo' : 'Enter your code';
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
    localStorage.setItem('cecilia_driver', JSON.stringify(data));
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
}

function handleLogout() {
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
  console.log('DOMContentLoaded fired');
  applyTheme();
  applyLang();
  lucide.createIcons();

  // Restore font size
  const savedSize = localStorage.getItem('cecilia_font_size');
  if (savedSize) document.documentElement.style.fontSize = savedSize + 'px';

  // Check lockout
  if (Date.now() < lockoutUntil) startLockoutTimer();

  // Auto-login if session exists
  const saved = localStorage.getItem('cecilia_driver');
  if (saved) {
    try {
      currentDriver = JSON.parse(saved);
      enterDashboard();
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
const PRODUCTS = {
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
    html += `<button class="order-tab${i === activeOrderIdx ? ' active' : ''}" data-idx="${i}" data-en="${en}" data-es="${es}">${lang === 'es' ? es : en}</button>`;
  });
  html += `<button class="order-tab-add" id="add-order-btn">+</button>`;
  container.innerHTML = html;

  container.querySelectorAll('.order-tab').forEach(btn => {
    btn.addEventListener('click', () => switchOrder(parseInt(btn.dataset.idx)));
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
  updateSectionBadges();
}

/* ═══════════════════════════════════
   BUILD PRODUCT SECTIONS
   ═══════════════════════════════════ */
function buildProductSections() {
  const container = document.getElementById('product-sections');
  let html = '';

  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    html += `<div class="acc-section" data-section-key="${secKey}" id="sec-${secKey}">`;
    html += `<div class="acc-header"><span class="acc-title" data-en="${sec.en}" data-es="${sec.es}">${L(sec)}</span><div style="display:flex;align-items:center;gap:8px"><span class="acc-badge" data-badge="${secKey}" style="display:none">0</span><svg class="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div></div>`;
    html += `<div class="acc-body"><div class="prod-table">`;

    if (sec.type === 'redondo') {
      // Render as standard rows — split Inside/Top into separate sub-rows
      sec.items.forEach(item => {
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
    btn.addEventListener('click', () => {
      const inp = btn.parentElement.querySelector('.qty-input');
      const cur = parseInt(inp.value) || 0;
      const delta = btn.dataset.dir === '+' ? 1 : -1;
      inp.value = Math.max(0, cur + delta);
      updateRowHighlight(inp);
      updateSectionBadges();
      updateFooterCount();
    });
  });

  // Bind qty focus/blur
  container.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; });
    inp.addEventListener('blur', () => {
      if (inp.value === '') inp.value = '0';
      updateRowHighlight(inp);
      updateSectionBadges();
      updateFooterCount();
    });
  });

  lucide.createIcons();
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

function updateSectionBadges() {
  Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
    let count = 0;
    sec.items.forEach(item => {
      if (sec.type === 'redondo') {
        (item.cols || []).forEach(c => {
          const inp = document.querySelector(`.qty-input[data-key="${item.key}_${c}"]`);
          if (inp && parseInt(inp.value) > 0) count++;
        });
      } else {
        ['', '_nt'].forEach(suf => {
          const inp = document.querySelector(`.qty-input[data-key="${item.key}${suf}"]`);
          if (inp && parseInt(inp.value) > 0) count++;
        });
      }
    });
    const badge = document.querySelector(`[data-badge="${secKey}"]`);
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('active', count > 0);
      badge.style.display = count > 0 ? '' : 'none';
    }
  });
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
  saveFormToOrder(activeOrderIdx);
  summaryIdx = 0;
  renderSummaryOrder(0);
  document.getElementById('summary-overlay').classList.add('open');
  applyLang();
}

function closeSummary() {
  document.getElementById('summary-overlay').classList.remove('open');
}

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
            items.push({ name: `${L(item)} (${colLabel})`, qty: v, nt: isNT });
          }
        });
      } else {
        const v = o.qty[item.key] || 0;
        const vnt = o.qty[item.key + '_nt'] || 0;
        if (v > 0) items.push({ name: L(item), qty: v, nt: false });
        if (vnt > 0) items.push({ name: L(item), qty: vnt, nt: true });
      }
    });

    if (items.length > 0) {
      html += `<div class="summary-section"><div class="summary-section-title">${L(sec)}</div>`;
      items.forEach(it => {
        html += `<div class="summary-item"><span class="summary-item-name">${it.name}${it.nt ? `<span class="no-ticket-tag">${lang === 'es' ? 'Sin Ticket' : 'No Ticket'}</span>` : ''}</span><span class="summary-item-qty">×${it.qty}</span></div>`;
      });
      html += '</div>';
    }
  });

  if (!html) html = `<div class="empty-state">${lang === 'es' ? 'Sin articulos' : 'No items'}</div>`;

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
    const batchId = crypto.randomUUID();
    const editableUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];

      // Collect items with qty > 0
      const items = [];
      Object.entries(PRODUCTS).forEach(([secKey, sec]) => {
        sec.items.forEach(item => {
          if (sec.type === 'redondo') {
            (item.cols || []).forEach(col => {
              const k = item.key + '_' + col;
              const v = o.qty[k] || 0;
              if (v > 0) items.push({ product_key: k, product_label: `${item.en} (${col})`, quantity: v });
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

      // Insert order
      const { data: orderData, error: orderErr } = await sb
        .from('driver_orders')
        .insert({
          driver_id: currentDriver.id,
          batch_id: batchId,
          batch_index: i + 1,
          business_name: o.business || null,
          delivery_date: o.date || null,
          delivery_time: o.time || null,
          driver_ref: o.ref || null,
          notes: o.notes || null,
          status: 'pending',
          editable_until: editableUntil,
        })
        .select('id')
        .single();

      if (orderErr) throw orderErr;

      // Insert items
      const orderItems = items.map(it => ({
        order_id: orderData.id,
        product_key: it.product_key,
        product_label: it.product_label,
        quantity: it.quantity,
        price_at_order: 0,
      }));

      const { error: itemsErr } = await sb.from('driver_order_items').insert(orderItems);
      if (itemsErr) throw itemsErr;
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
  toast.innerHTML = `<span>${message}</span><button class="toast-close">✕</button>`;
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
}

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
