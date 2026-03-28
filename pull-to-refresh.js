/**
 * pull-to-refresh.js
 * Custom pull-to-refresh for Cecilia Bakery PWA (menu.html + driver-order.html).
 * Replaces native iOS bounce/navigate behaviour in standalone PWA mode.
 *
 * APPROACH: Fixed-height container anchored at top:env(safe-area-inset-top).
 * The spinner lives inside it and translates vertically into/out of view.
 * This avoids the position:fixed coordinate-system ambiguity on iOS PWA.
 *
 * - Pure touch events, passive: true on all listeners (no scroll blocking)
 * - DATA refresh only — never window.location.reload()
 */
(function initPullToRefresh() {

  /* ── Container — fixed at safe-area boundary ────────────────────── */
  const container = document.createElement('div');
  container.id = 'ptr-container';
  container.style.cssText = [
    'position: fixed',
    'left: 0',
    'right: 0',
    'display: flex',
    'justify-content: center',
    'align-items: flex-end',
    'pointer-events: none',
    // 99999 ensures we beat the nav (z-index:501) and its backdrop-filter
    // compositing layer which iOS promotes to a separate GPU layer.
    'z-index: 99999',
    'height: 0',
    'overflow: visible',
    'top: env(safe-area-inset-top)',
  ].join(';');
  // IMPORTANT: append (not prepend) so the container is the LAST child of
  // <body>. On iOS PWA, backdrop-filter creates a GPU compositing layer that
  // paints over earlier siblings regardless of z-index. Being the last DOM
  // child ensures this element is painted on top in the GPU layer stack.
  function mount() {
    document.body.appendChild(container);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ── Spinner — lives inside the container ───────────────────────── */
  const spinner = document.createElement('div');
  spinner.id = 'ptr-spinner';
  spinner.style.cssText = [
    'width: 36px',
    'height: 36px',
    'border-radius: 50%',
    'background: #fff',
    'box-shadow: 0 2px 12px rgba(0,0,0,0.2)',
    'border: 2.5px solid #C8102E',
    'border-top-color: transparent',
    'opacity: 0',
    'transform: translateY(-50px)',
    'transition: opacity 0.2s, transform 0.2s',
  ].join(';');
  container.appendChild(spinner);

  /* ── Spin keyframes (injected once) ─────────────────────────────── */
  const kf = document.createElement('style');
  kf.id = 'ptr-keyframes';
  kf.textContent = '@keyframes ptrSpin { to { transform: translateY(20px) rotate(360deg); } }';
  document.head.appendChild(kf);

  /* ── State ──────────────────────────────────────────────────────── */
  const THRESHOLD = 75;
  let startY     = 0;
  let active     = false;
  let refreshing = false;

  /* ── Touch: start ───────────────────────────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    active = true;
  }, { passive: true });

  /* ── Touch: move ────────────────────────────────────────────────── */
  document.addEventListener('touchmove', function (e) {
    if (!active || refreshing) return;

    const dist = Math.min(e.touches[0].clientY - startY, 120);
    if (dist <= 0) return;

    const progress = Math.min(dist / THRESHOLD, 1);
    const offset   = Math.min(dist * 0.4, 40);

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
      // Not pulled far enough — snap back
      spinner.style.transition = 'opacity 0.3s, transform 0.3s';
      spinner.style.opacity    = '0';
      spinner.style.transform  = 'translateY(-50px)';
      return;
    }

    /* ── Trigger refresh ── */
    refreshing = true;
    spinner.style.transition = 'transform 0.2s';
    spinner.style.transform  = 'translateY(20px)';
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
      spinner.style.animation  = 'none';
      spinner.style.transition = 'opacity 0.3s, transform 0.3s';
      spinner.style.opacity    = '0';
      spinner.style.transform  = 'translateY(-50px)';
      refreshing = false;
    }, 600);

  }, { passive: true });

})();
