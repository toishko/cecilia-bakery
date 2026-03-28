/**
 * pull-to-refresh.js  (served from /public/)
 * Custom pull-to-refresh for Cecilia Bakery PWA.
 * Visual: YouTube/Chrome-style thin progress bar below the nav.
 * Logic:  data-only refresh — never window.location.reload()
 */
(function initPullToRefresh() {

  /* ── Keyframes ──────────────────────────────────────────────────── */
  const kf = document.createElement('style');
  kf.id = 'ptr-keyframes';
  kf.textContent = `
    @keyframes ptrShimmer {
      0%   { opacity: 1; }
      50%  { opacity: 0.5; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(kf);

  /* ── Container — full-width strip flush with nav bottom ─────────── */
  const container = document.createElement('div');
  container.id = 'ptr-container';
  container.style.cssText = [
    'position: fixed',
    'top: 80px',          // corrected to real nav bottom in pinToNav()
    'left: 0',
    'right: 0',
    'height: 3px',
    'z-index: 499',       // just below nav (z-index 501)
    'pointer-events: none',
    'background: transparent',
  ].join(';');
  document.body.appendChild(container);

  /* ── Bar — grows across the container width ─────────────────────── */
  const bar = document.createElement('div');
  bar.id = 'ptr-bar';
  bar.style.cssText = [
    'height: 100%',
    'width: 0%',
    'background: #C8102E',
    'border-radius: 0 2px 2px 0',
    'opacity: 0',
    'transition: width 0.1s ease, opacity 0.4s ease',
  ].join(';');
  container.appendChild(bar);

  /* ── Pin container to actual nav bottom ─────────────────────────── */
  function pinToNav() {
    const navEl = document.querySelector('nav') ||
                  document.querySelector('.dash-header');
    if (navEl) {
      container.style.top = navEl.getBoundingClientRect().bottom + 'px';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pinToNav);
  } else {
    pinToNav();
  }
  window.addEventListener('resize', pinToNav, { passive: true });

  /* ── State ──────────────────────────────────────────────────────── */
  const THRESHOLD = 75;
  const MAX_PULL  = 120;
  let startY     = 0;
  let active     = false;
  let refreshing = false;

  /* ── Helpers ────────────────────────────────────────────────────── */
  function resetBar() {
    bar.style.animation  = 'none';
    bar.style.transition = 'width 0.1s ease, opacity 0.4s ease';
    bar.style.opacity    = '0';
    // Reset width after fade completes so it's invisible before next pull
    setTimeout(function () { bar.style.width = '0%'; }, 400);
  }

  /* ── Touch: start ───────────────────────────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0) return;
    pinToNav(); // re-measure in case status bar height changed
    startY = e.touches[0].clientY;
    active = true;
  }, { passive: true });

  /* ── Touch: move ────────────────────────────────────────────────── */
  document.addEventListener('touchmove', function (e) {
    if (!active || refreshing) return;

    const dist = Math.min(e.touches[0].clientY - startY, MAX_PULL);
    if (dist <= 0) {
      active = false;
      resetBar();
      return;
    }

    const progress = Math.min(dist / THRESHOLD, 1);

    bar.style.animation  = 'none';
    bar.style.transition = 'width 0.1s ease, opacity 0.15s ease';
    bar.style.width      = (progress * 100) + '%';
    bar.style.opacity    = String(progress);
  }, { passive: true });

  /* ── Touch: end ─────────────────────────────────────────────────── */
  document.addEventListener('touchend', async function (e) {
    if (!active || refreshing) return;
    active = false;

    const dist = e.changedTouches[0].clientY - startY;

    if (dist < THRESHOLD) {
      resetBar();
      return;
    }

    /* ── Threshold met — show loading state ── */
    refreshing = true;
    bar.style.transition = 'width 0.15s ease';
    bar.style.width      = '100%';
    bar.style.opacity    = '1';
    // Start shimmer after bar reaches full width
    setTimeout(function () {
      bar.style.transition = 'none';
      bar.style.animation  = 'ptrShimmer 0.8s ease-in-out infinite';
    }, 150);

    try {
      /* menu.html / index.html */
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
      resetBar();
      refreshing = false;
    }, 600);

  }, { passive: true });

})();
