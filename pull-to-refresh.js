/**
 * pull-to-refresh.js
 * Custom pull-to-refresh for Cecilia Bakery PWA (menu.html + driver-order.html).
 * Replaces native iOS bounce/navigate behaviour in standalone PWA mode.
 *
 * APPROACH: Inject the spinner as a child of the page's top bar element
 * (nav in menu.html, .dash-header in driver-order.html). This guarantees
 * the spinner shares the same GPU compositing layer as the bar and always
 * renders above page content — bypassing the iOS WebKit backdrop-filter
 * stacking-context bug that causes position:fixed children of <body> to
 * render beneath elements that have backdrop-filter.
 *
 * - Pure touch events, passive: true on all listeners (no scroll blocking)
 * - DATA refresh only — never window.location.reload()
 */
(function initPullToRefresh() {

  /* ── Spin keyframes (injected once into <head>) ─────────────────── */
  const kf = document.createElement('style');
  kf.id = 'ptr-keyframes';
  kf.textContent = '@keyframes ptrSpin { to { transform: translateY(20px) rotate(360deg); } }';
  document.head.appendChild(kf);

  /* ── Spinner element ────────────────────────────────────────────── */
  const spinner = document.createElement('div');
  spinner.id = 'ptr-spinner';
  spinner.style.cssText = [
    // Position: centered horizontally, peeking just below the bar's bottom edge
    'position: absolute',
    'left: 50%',
    'top: 100%',            // flush with bottom of the parent bar
    'transform: translateX(-50%) translateY(-60px)', // start hidden above bar bottom
    // Appearance
    'width: 36px',
    'height: 36px',
    'border-radius: 50%',
    'background: #fff',
    'box-shadow: 0 2px 12px rgba(0,0,0,0.25)',
    'border: 2.5px solid #C8102E',
    'border-top-color: transparent',
    // State
    'opacity: 0',
    'transition: opacity 0.2s, transform 0.2s',
    'pointer-events: none',
    'z-index: 9999',
  ].join(';');

  /* ── Mount: inject into the top bar so we share its GPU layer ───── */
  function mount() {
    // menu.html uses <nav>; driver-order.html uses .dash-header
    const parent = document.querySelector('nav') ||
                   document.querySelector('.dash-header') ||
                   document.body;

    // The parent must have position:relative/absolute/fixed/sticky so that
    // our absolute-positioned spinner uses it as the containing block.
    // nav already has position:fixed; .dash-header has position:sticky — both fine.
    parent.style.overflow = 'visible'; // ensure child isn't clipped
    parent.appendChild(spinner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ── State ──────────────────────────────────────────────────────── */
  const THRESHOLD = 75;  // px of pull to trigger refresh
  const MAX_PULL  = 120; // px cap on rubber-band distance
  let startY     = 0;
  let active     = false;
  let refreshing = false;

  /* ── Helpers ────────────────────────────────────────────────────── */
  function snapBack() {
    spinner.style.transition = 'opacity 0.3s, transform 0.3s';
    spinner.style.opacity    = '0';
    // translateX(-50%) keeps horizontal centering; Y goes back above bar
    spinner.style.transform  = 'translateX(-50%) translateY(-60px)';
  }

  /* ── Touch: start ───────────────────────────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    active = true;
  }, { passive: true });

  /* ── Touch: move ────────────────────────────────────────────────── */
  document.addEventListener('touchmove', function (e) {
    if (!active || refreshing) return;

    const dist = Math.min(e.touches[0].clientY - startY, MAX_PULL);
    if (dist <= 0) {
      active = false;
      snapBack();
      return;
    }

    const progress = Math.min(dist / THRESHOLD, 1);
    const offset   = Math.min(dist * 0.4, 40); // 0 → 40 px below bar bottom

    spinner.style.transition = 'none';
    spinner.style.opacity    = String(progress);
    // translateX(-50%) keeps horizontal center; Y slides down from bar bottom
    spinner.style.transform  = 'translateX(-50%) translateY(' + offset + 'px)';
  }, { passive: true });

  /* ── Touch: end ─────────────────────────────────────────────────── */
  document.addEventListener('touchend', async function (e) {
    if (!active || refreshing) return;
    active = false;

    const dist = e.changedTouches[0].clientY - startY;

    if (dist < THRESHOLD) {
      snapBack();
      return;
    }

    /* ── Pull past threshold — trigger data refresh ── */
    refreshing = true;
    spinner.style.transition = 'transform 0.2s';
    spinner.style.transform  = 'translateX(-50%) translateY(20px)';
    spinner.style.opacity    = '1';
    spinner.style.animation  = 'ptrSpin 0.7s linear infinite';

    try {
      /* menu.html */
      if (typeof loadProductsFromSupabase === 'function') {
        await loadProductsFromSupabase();
        if (typeof renderMenu === 'function') renderMenu();
      }
      /* driver-order.html */
      if (typeof loadDriverProducts === 'function') {
        await loadDriverProducts();
        if (typeof buildProductSections === 'function') buildProductSections();
      }
    } catch (err) {
      // Silently swallow — PTR must never break the page
    }

    setTimeout(function () {
      spinner.style.animation = 'none';
      snapBack();
      refreshing = false;
    }, 600);

  }, { passive: true });

})();
