// ═══════════════════════════════════
//  Swipe-to-Dismiss for Modals
//  Drag anywhere near top of modal to dismiss
// ═══════════════════════════════════
(function() {
  const DISMISS_THRESHOLD = 100;

  // Block ALL interactions briefly after dismiss
  let blockAll = false;
  document.addEventListener('click', (e) => {
    if (blockAll) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener('touchstart', (e) => {
    if (blockAll) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  function initSwipeDismiss(overlay, modal, closeFn) {
    if (!modal || !overlay) return;

    let startY = 0;
    let currentTranslate = 0;
    let dragging = false;

    function isInDragZone(touchY) {
      const modalRect = modal.getBoundingClientRect();
      return touchY < (modalRect.top + 60);
    }

    modal.addEventListener('touchstart', (e) => {
      if (blockAll) return;
      if (!isInDragZone(e.touches[0].clientY)) return;
      dragging = true;
      startY = e.touches[0].clientY;
      currentTranslate = 0;
      // Kill any CSS animation and transition immediately
      modal.style.animation = 'none';
      modal.style.transition = 'none';
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const deltaY = e.touches[0].clientY - startY;
      currentTranslate = Math.max(0, deltaY);
      modal.style.transform = `translateY(${currentTranslate}px)`;
      const opacity = Math.max(0, 1 - (currentTranslate / 300));
      overlay.style.backgroundColor = `rgba(0,0,0,${opacity * 0.5})`;
    }, { passive: true });

    modal.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;

      if (currentTranslate > DISMISS_THRESHOLD) {
        // === DISMISS ===
        blockAll = true;
        window._swipeDismissCooldown = true;

        // 1) Remove .open FIRST so CSS animation rule no longer applies
        overlay.classList.remove('open');

        // 2) But keep it visible with inline display:flex
        overlay.style.display = 'flex';

        // 3) Slide modal out
        modal.style.transition = 'transform .25s ease-out';
        modal.style.transform = 'translateY(100vh)';

        // 4) After slide-out animation, fully close
        setTimeout(() => {
          // Hide overlay
          overlay.style.display = '';
          overlay.style.backgroundColor = '';

          // Reset modal styles
          modal.style.transform = '';
          modal.style.transition = '';
          modal.style.animation = '';

          // Call close to clean up state (body scroll, etc.)
          // But .open is already removed, so no animation re-trigger
          closeFn();

          // Unblock after generous delay
          setTimeout(() => {
            blockAll = false;
            window._swipeDismissCooldown = false;
          }, 400);
        }, 260);

      } else {
        // === SNAP BACK ===
        modal.style.transition = 'transform .2s ease';
        modal.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => {
          modal.style.transition = '';
          modal.style.animation = '';
        }, 220);
      }
      currentTranslate = 0;
    }, { passive: true });
  }

  // Attach to all modals on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    // Admin: detail modal
    const adminOverlay = document.getElementById('detail-overlay');
    if (adminOverlay) {
      initSwipeDismiss(
        adminOverlay,
        adminOverlay.querySelector('.detail-modal'),
        () => { if (typeof closeDetailModal === 'function') closeDetailModal(); }
      );
    }

    // Driver: summary overlay
    const summaryOverlay = document.getElementById('summary-overlay');
    if (summaryOverlay) {
      initSwipeDismiss(
        summaryOverlay,
        summaryOverlay.querySelector('.summary-modal'),
        () => { if (typeof closeSummary === 'function') closeSummary(); }
      );
    }

    // Driver: order detail overlay
    const orderDetailOverlay = document.getElementById('order-detail-overlay');
    if (orderDetailOverlay) {
      initSwipeDismiss(
        orderDetailOverlay,
        orderDetailOverlay.querySelector('.order-detail-modal'),
        () => { if (typeof closeOrderDetail === 'function') closeOrderDetail(); }
      );
    }

    // Driver: balance modal overlay
    const balanceOverlay = document.getElementById('balance-modal-overlay');
    if (balanceOverlay) {
      initSwipeDismiss(
        balanceOverlay,
        balanceOverlay.querySelector('.balance-modal'),
        () => { if (typeof closeBalanceBreakdown === 'function') closeBalanceBreakdown(); }
      );
    }

    // Driver: time picker overlay
    const tpOverlay = document.getElementById('tp-overlay');
    if (tpOverlay) {
      initSwipeDismiss(
        tpOverlay,
        tpOverlay.querySelector('.tp-modal'),
        () => { if (typeof closeTimePicker === 'function') closeTimePicker(); }
      );
    }
  });
})();
