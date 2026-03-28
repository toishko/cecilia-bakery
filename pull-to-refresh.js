/**
 * pull-to-refresh.js
 * Custom pull-to-refresh for Cecilia Bakery PWA (menu.html + driver-order.html).
 * Replaces native iOS bounce/navigate behaviour in standalone PWA mode.
 * - Pure touch events, passive listeners only (no scroll blocking)
 * - Triggers DATA refresh only — never window.location.reload()
 * - Pull threshold: 80 px; max rubber-band pull: 120 px
 */
(function initPullToRefresh() {
  /* ── Inject CSS ─────────────────────────────────────────────────── */
  const STYLE = `
    #ptr-indicator {
      position: fixed;
      top: env(safe-area-inset-top);
      left: 50%;
      /* Hidden: -80px pulls it entirely above the safe-area boundary */
      transform: translateX(-50%) translateY(-80px);
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--bg-card, #fff);
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      pointer-events: none;
      transition: none;
    }
    #ptr-indicator .ptr-icon {
      width: 20px;
      height: 20px;
      border: 2.5px solid var(--red, #C8102E);
      border-top-color: transparent;
      border-radius: 50%;
    }
    #ptr-indicator.ptr-spinning .ptr-icon {
      animation: ptrSpin 0.7s linear infinite;
    }
    @keyframes ptrSpin {
      to { transform: rotate(360deg); }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  /* ── Inject HTML ────────────────────────────────────────────────── */
  const indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.innerHTML = '<div class="ptr-icon"></div>';
  document.body.prepend(indicator);

  /* ── Constants ───────────────────────────────────────────────────── */
  const THRESHOLD = 80;   // px to pull before triggering refresh
  const MAX_PULL  = 120;  // px max rubber-band distance
  // No SAFE_TOP constant — CSS handles env(safe-area-inset-top) natively.
  // All translateY values are relative to the safe-area boundary:

  /* ── State ───────────────────────────────────────────────────────── */
  let startY     = 0;
  let pulling    = false;
  let refreshing = false;

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function canPull() {
    // Only pull when scrolled to the very top
    return window.scrollY <= 0;
  }

  function snapBack() {
    indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    // -80px hides the 44px disc above the safe-area boundary
    indicator.style.transform  = 'translateX(-50%) translateY(-80px)';
    indicator.style.opacity    = '0';
  }

  async function triggerRefresh() {
    refreshing = true;

    // Park spinner 16px below the safe-area boundary.
    // CSS top:env(safe-area-inset-top) means translateY(0) = boundary,
    // so translateY(16px) = exactly 16px into visible content.
    indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    indicator.style.transform  = 'translateX(-50%) translateY(16px)';
    indicator.style.opacity    = '1';
    indicator.classList.add('ptr-spinning');

    try {
      /* ── menu.html: re-fetch + re-render ── */
      if (typeof loadProductsFromSupabase === 'function') {
        await loadProductsFromSupabase();
        if (typeof renderMenu === 'function') renderMenu();
      }

      /* ── driver-order.html: re-fetch + rebuild ── */
      if (typeof loadDriverProducts === 'function') {
        await loadDriverProducts();
        if (typeof buildProductSections === 'function') buildProductSections();
      }
    } catch (e) {
      // Silently swallow errors — PTR must never break the page
    }

    // Hide indicator after a short dwell so the user sees the spinner complete
    setTimeout(function () {
      indicator.classList.remove('ptr-spinning');
      snapBack();
      refreshing = false;
    }, 600);
  }

  /* ── Touch Listeners (all passive: true) ────────────────────────── */
  document.addEventListener('touchstart', function (e) {
    if (!canPull()) return;
    startY  = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!pulling || refreshing) return;

    const dist = Math.min(e.touches[0].clientY - startY, MAX_PULL);
    if (dist <= 0) {
      // Swiping up — cancel
      pulling = false;
      snapBack();
      return;
    }

    // translateY is relative to top:env(safe-area-inset-top).
    // At dist=0  → translateY(-10px) — just above boundary, fades in
    // At dist=80 → translateY(30px)  — threshold, fully visible
    const progress = Math.min(dist / THRESHOLD, 1);
    const yOffset  = (dist * 0.5) - 10;

    indicator.style.transition = 'none';
    indicator.style.transform  =
      'translateX(-50%) translateY(' + yOffset + 'px) rotate(' + (dist * 2) + 'deg)';
    indicator.style.opacity    = String(progress);
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!pulling || refreshing) return;
    pulling = false;

    const dist = e.changedTouches[0].clientY - startY;

    if (dist < THRESHOLD) {
      // Not pulled far enough — snap back
      snapBack();
      return;
    }

    // Pulled past threshold — trigger data-only refresh
    triggerRefresh();
  }, { passive: true });
})();
