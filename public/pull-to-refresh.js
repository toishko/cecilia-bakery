/**
 * pull-to-refresh.js
 * Custom pull-to-refresh for Cecilia Bakery PWA (menu.html + driver-order.html).
 * Replaces native iOS bounce/navigate behaviour in standalone PWA mode.
 *
 * APPROACH: position:fixed container anchored at the bottom edge of the nav.
 * z-index 499 keeps it just below the nav (501) so the spinner "peels out"
 * from under the bar — fully visible, no compositing layer conflicts.
 *
 * - Pure touch events, passive: true on all listeners (no scroll blocking)
 * - DATA refresh only — never window.location.reload()
 */
(function initPullToRefresh() {

  /* ── Spin keyframes ─────────────────────────────────────────────── */
  const kf = document.createElement('style');
  kf.id = 'ptr-keyframes';
  kf.textContent = '@keyframes ptrSpin { to { transform: rotate(360deg); } }';
  document.head.appendChild(kf);

  /* ── Container ──────────────────────────────────────────────────── */
  const container = document.createElement('div');
  container.id = 'ptr-container';
  // Initial top — will be corrected to nav bottom after DOMContentLoaded.
  container.style.cssText = [
    'position: fixed',
    'top: 80px',            // sensible default before nav height is known
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 499',         // just below nav (501) — slides out from under it
    'pointer-events: none',
    'height: 0',
    'overflow: visible',
    'display: flex',
    'justify-content: center',
  ].join(';');
  document.body.appendChild(container);

  /* ── Spinner ────────────────────────────────────────────────────── */
  const spinner = document.createElement('div');
  spinner.id = 'ptr-spinner';
  spinner.style.cssText = [
    'width: 36px',
    'height: 36px',
    'border-radius: 50%',
    'background: #fff',
    'box-shadow: 0 2px 12px rgba(0,0,0,0.25)',
    'border: 2.5px solid #C8102E',
    'border-top-color: transparent',
    'opacity: 0',
    'transform: translateY(-60px)',  // hidden above container origin
    'transition: opacity 0.2s, transform 0.2s',
    'pointer-events: none',
  ].join(';');
  container.appendChild(spinner);

  /* ── Pin container top to actual nav bottom ─────────────────────── */
  function pinToNav() {
    // menu.html: <nav>; driver-order.html: .dash-header (sticky top bar)
    const bar = document.querySelector('nav') ||
                document.querySelector('.dash-header');
    if (bar) {
      // getBoundingClientRect().bottom = px from viewport top to bar's bottom edge
      const bottom = bar.getBoundingClientRect().bottom;
      container.style.top = bottom + 'px';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pinToNav);
  } else {
    pinToNav();
  }
  // Re-pin on resize/orientation change (safe-area inset may change)
  window.addEventListener('resize', pinToNav, { passive: true });

  /* ── State ──────────────────────────────────────────────────────── */
  const THRESHOLD = 75;
  const MAX_PULL  = 120;
  let startY     = 0;
  let active     = false;
  let refreshing = false;

  /* ── Helpers ────────────────────────────────────────────────────── */
  function snapBack() {
    spinner.style.transition = 'opacity 0.3s, transform 0.3s';
    spinner.style.opacity    = '0';
    spinner.style.transform  = 'translateY(-60px)';
  }

  /* ── Touch: start ───────────────────────────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0) return;
    // Re-pin in case the nav height changed (e.g. music player bar appeared)
    pinToNav();
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
    const offset   = Math.min(dist * 0.4, 40); // slides 0 → 40px below nav

    spinner.style.transition = 'none';
    spinner.style.opacity    = String(progress);
    spinner.style.transform  = 'translateY(' + offset + 'px)';
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

    /* ── Trigger data refresh ── */
    refreshing = true;
    spinner.style.transition = 'transform 0.2s';
    spinner.style.transform  = 'translateY(20px)';
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
