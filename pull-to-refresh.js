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
    :root { --sat: env(safe-area-inset-top); }
    #ptr-indicator {
      position: fixed;
      top: 0;
      left: 50%;
      /* Start fully hidden above the safe-area notch */
      transform: translateX(-50%) translateY(-100px);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--bg-card, #fff);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      transition: transform 0.2s ease;
      pointer-events: none;
      opacity: 0;
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

  /* ── State ──────────────────────────────────────────────────────── */
  const THRESHOLD = 80;   // px to pull before triggering refresh
  const MAX_PULL  = 120;  // px max rubber-band distance
  let startY     = 0;
  let pulling    = false;
  let refreshing = false;

  /* ── Helpers ────────────────────────────────────────────────────── */
  function canPull() {
    // Only pull when scrolled to the very top
    return window.scrollY <= 0;
  }

  function snapBack() {
    indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    indicator.style.transform  = 'translateX(-50%) translateY(-100px)';
    indicator.style.opacity    = '0';
  }

  async function triggerRefresh() {
    refreshing = true;

    // Resolve safe-area height. getPropertyValue('--sat') returns the raw
    // string 'env(safe-area-inset-top)', not a number, so we probe a throw-
    // away element to get the computed pixel value instead.
    const safeTop = (function () {
      try {
        const el = document.createElement('div');
        el.style.cssText =
          'position:fixed;top:env(safe-area-inset-top);top:constant(safe-area-inset-top);' +
          'width:1px;height:1px;pointer-events:none;visibility:hidden';
        document.body.appendChild(el);
        const val = parseInt(getComputedStyle(el).top);
        document.body.removeChild(el);
        if (val > 0) return val;
      } catch (e) { /* ignore */ }
      // Fallback: 60px covers standard notch (44px), Dynamic Island (59px),
      // and any expanded status bar state.
      return 60;
    })();
    const activeY = safeTop + 20;

    // Show spinner locked just below the notch
    indicator.style.transition = 'transform 0.3s ease';
    indicator.style.transform  = 'translateX(-50%) translateY(' + activeY + 'px)';
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

    // Probe a throw-away element to get the real computed safe-area px value.
    const safeTop = (function () {
      try {
        const el = document.createElement('div');
        el.style.cssText =
          'position:fixed;top:env(safe-area-inset-top);top:constant(safe-area-inset-top);' +
          'width:1px;height:1px;pointer-events:none;visibility:hidden';
        document.body.appendChild(el);
        const val = parseInt(getComputedStyle(el).top);
        document.body.removeChild(el);
        if (val > 0) return val;
      } catch (e) { /* ignore */ }
      return 60; // safe minimum covering all iPhone notch/Dynamic Island heights
    })();
    const progress = Math.min(dist / THRESHOLD, 1);
    const yOffset  = safeTop + (dist * 0.5) - 20; // slides from below notch as user pulls

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
