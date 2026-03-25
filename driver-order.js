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
    document.getElementById('dash-nav').classList.toggle('open');
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
});

/* ═══════════════════════════════════
   PRODUCT CATALOG
   ═══════════════════════════════════ */
const PRODUCTS = {
  redondo: {
    label: 'Redondo', type: 'redondo',
    items: [
      { key: 'pina', label: 'Piña', cols: ['inside','inside_nt','top','top_nt'] },
      { key: 'guava', label: 'Guava', cols: ['inside','inside_nt','top','top_nt'] },
      { key: 'dulce', label: 'Dulce De Leche', cols: ['inside','inside_nt'] },
    ]
  },
  plain: {
    label: 'Plain', type: 'standard',
    items: [
      { key: 'plain', label: 'Plain' },
      { key: 'raisin', label: 'Raisin' },
    ]
  },
  tresleche: {
    label: 'Tres Leche', type: 'standard',
    items: [
      { key: 'tl', label: 'Tres Leche' },
      { key: 'tl_hershey', label: 'Tres Hershey' },
      { key: 'cuatro_leche', label: 'Cuatro Leche' },
      { key: 'tl_straw', label: 'TL Strawberry' },
      { key: 'tl_pina', label: 'TL Piña' },
    ]
  },
  piezas: {
    label: 'Piezas', type: 'standard',
    items: [
      { key: 'pz_rv', label: 'Red Velvet' },
      { key: 'pz_carrot', label: 'Carrot Cake' },
      { key: 'pz_cheese', label: 'Cheesecake' },
      { key: 'pz_pudin', label: 'Pudin' },
      { key: 'pz_pina', label: 'Piña' },
      { key: 'pz_guava', label: 'Guava' },
      { key: 'pz_chocoflan', label: 'Chocoflan' },
      { key: 'pz_flan', label: 'Flan' },
    ]
  },
  frostin: {
    label: 'Piezas Frostin', type: 'standard',
    items: [
      { key: 'fr_guava', label: 'Guava' },
      { key: 'fr_pina', label: 'Piña' },
      { key: 'fr_dulce', label: 'Dulce De Leche' },
      { key: 'fr_choco', label: 'Chocolate' },
    ]
  },
  hb_big: {
    label: 'Happy Birthday — BIG', type: 'standard',
    items: [
      { key: 'hb_b_pina', label: 'Piña' },
      { key: 'hb_b_guava', label: 'Guava' },
      { key: 'hb_b_dulce', label: 'Dulce De Leche' },
      { key: 'hb_b_choco', label: 'Chocolate' },
      { key: 'hb_b_straw', label: 'Strawberry' },
    ]
  },
  hb_small: {
    label: 'Happy Birthday — SMALL', type: 'standard',
    items: [
      { key: 'hb_s_pina', label: 'Piña' },
      { key: 'hb_s_guava', label: 'Guava' },
      { key: 'hb_s_dulce', label: 'Dulce De Leche' },
      { key: 'hb_s_choco', label: 'Chocolate' },
      { key: 'hb_s_straw', label: 'Strawberry' },
    ]
  },
  cuadrao: {
    label: 'Cuadrao', type: 'standard',
    items: [
      { key: 'cdr_pudin', label: 'Pudin' },
      { key: 'cdr_plain', label: 'Plain' },
      { key: 'cdr_raisin', label: 'Raisin' },
      { key: 'cdr_maiz', label: 'Maiz' },
    ]
  },
  basos: {
    label: 'Basos', type: 'standard',
    items: [
      { key: 'bas_tl', label: 'Tres Leche' },
      { key: 'bas_cl', label: 'Cuatro Leche' },
      { key: 'bas_hershey', label: 'Hershey' },
    ]
  },
};

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
  return { business: '', date: '', time: '', ref: '', notes: '', qty };
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
    html += `<div class="acc-header"><span class="acc-title">${sec.label}</span><div style="display:flex;align-items:center;gap:8px"><span class="acc-badge" data-badge="${secKey}">0</span><svg class="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div></div>`;
    html += `<div class="acc-body"><div class="prod-table">`;

    if (sec.type === 'redondo') {
      html += `<div class="redondo-header"><span class="rh-name"></span>`;
      html += `<span style="width:74px">Inside</span><span style="width:74px">No Tkt</span>`;
      html += `<span style="width:74px">Top</span><span style="width:74px">No Tkt</span></div>`;
      sec.items.forEach(item => {
        html += `<div class="prod-row" data-product="${item.key}"><span class="prod-name">${item.label}</span>`;
        const allCols = ['inside','inside_nt','top','top_nt'];
        allCols.forEach(col => {
          const k = item.key + '_' + col;
          if (item.cols.includes(col)) {
            html += qtyControl(k);
          } else {
            html += `<div style="width:74px;text-align:center;color:var(--tx-faint)">—</div>`;
          }
        });
        html += `</div>`;
      });
    } else {
      sec.items.forEach(item => {
        html += `<div class="prod-row" data-product="${item.key}"><span class="prod-name">${item.label}</span>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">Qty</span>${qtyControl(item.key)}</div>`;
        html += `<div class="prod-qty-group"><span class="prod-qty-label">No Tkt</span>${qtyControl(item.key + '_nt')}</div>`;
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
            const colLabel = col.replace('_nt', ' NT').replace('inside', 'In').replace('top', 'Top');
            const isNT = col.includes('nt');
            items.push({ name: `${item.label} (${colLabel})`, qty: v, nt: isNT });
          }
        });
      } else {
        const v = o.qty[item.key] || 0;
        const vnt = o.qty[item.key + '_nt'] || 0;
        if (v > 0) items.push({ name: item.label, qty: v, nt: false });
        if (vnt > 0) items.push({ name: item.label, qty: vnt, nt: true });
      }
    });

    if (items.length > 0) {
      html += `<div class="summary-section"><div class="summary-section-title">${sec.label}</div>`;
      items.forEach(it => {
        html += `<div class="summary-item"><span class="summary-item-name">${it.name}${it.nt ? '<span class="no-ticket-tag">No Ticket</span>' : ''}</span><span class="summary-item-qty">×${it.qty}</span></div>`;
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
              if (v > 0) items.push({ product_key: k, product_label: `${item.label} (${col})`, quantity: v });
            });
          } else {
            const v = o.qty[item.key] || 0;
            const vnt = o.qty[item.key + '_nt'] || 0;
            if (v > 0) items.push({ product_key: item.key, product_label: item.label, quantity: v });
            if (vnt > 0) items.push({ product_key: item.key + '_nt', product_label: item.label + ' (No Ticket)', quantity: vnt });
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
    alert(lang === 'es' ? 'Error al enviar los pedidos. Intenta de nuevo.' : 'Error submitting orders. Please try again.');
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
