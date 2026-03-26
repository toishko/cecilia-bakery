// ═══════════════════════════════════
//  Swipe-to-Dismiss for Modals
//  Attach to modal handles for native feel
// ═══════════════════════════════════
(function() {
  const DISMISS_THRESHOLD = 120;

  function initSwipeDismiss(overlay, modal, handle, closeFn) {
    if (!handle || !modal || !overlay) return;

    let startY = 0;
    let currentTranslate = 0;
    let dragging = false;

    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';

    handle.addEventListener('touchstart', (e) => {
      dragging = true;
      startY = e.touches[0].clientY;
      currentTranslate = 0;
      modal.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const deltaY = e.touches[0].clientY - startY;
      // Only allow dragging down
      currentTranslate = Math.max(0, deltaY);
      modal.style.transform = `translateY(${currentTranslate}px)`;
      // Fade overlay as modal is dragged
      const opacity = Math.max(0, 1 - (currentTranslate / 300));
      overlay.style.backgroundColor = `rgba(0,0,0,${opacity * 0.5})`;
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      modal.style.transition = 'transform .3s ease';

      if (currentTranslate > DISMISS_THRESHOLD) {
        // Dismiss: slide all the way down
        modal.style.transform = `translateY(100%)`;
        setTimeout(() => {
          modal.style.transform = '';
          modal.style.transition = '';
          overlay.style.backgroundColor = '';
          closeFn();
        }, 300);
      } else {
        // Snap back
        modal.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => { modal.style.transition = ''; }, 300);
      }
      currentTranslate = 0;
    }, { passive: true });

    // Also support mouse (for desktop testing)
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      currentTranslate = 0;
      modal.style.transition = 'none';
      handle.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      currentTranslate = Math.max(0, e.clientY - startY);
      modal.style.transform = `translateY(${currentTranslate}px)`;
      const opacity = Math.max(0, 1 - (currentTranslate / 300));
      overlay.style.backgroundColor = `rgba(0,0,0,${opacity * 0.5})`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      modal.style.transition = 'transform .3s ease';
      handle.style.cursor = 'grab';

      if (currentTranslate > DISMISS_THRESHOLD) {
        modal.style.transform = `translateY(100%)`;
        setTimeout(() => {
          modal.style.transform = '';
          modal.style.transition = '';
          overlay.style.backgroundColor = '';
          closeFn();
        }, 300);
      } else {
        modal.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => { modal.style.transition = ''; }, 300);
      }
      currentTranslate = 0;
    });
  }

  // Wait for DOM then attach to all modals
  document.addEventListener('DOMContentLoaded', () => {
    // Admin: detail modal
    const adminOverlay = document.getElementById('detail-overlay');
    if (adminOverlay) {
      const modal = adminOverlay.querySelector('.detail-modal');
      const handle = adminOverlay.querySelector('.detail-handle');
      initSwipeDismiss(adminOverlay, modal, handle, () => {
        if (typeof closeDetailModal === 'function') closeDetailModal();
      });
    }

    // Driver: summary overlay
    const summaryOverlay = document.getElementById('summary-overlay');
    if (summaryOverlay) {
      const modal = summaryOverlay.querySelector('.summary-modal');
      const handle = summaryOverlay.querySelector('.summary-handle');
      initSwipeDismiss(summaryOverlay, modal, handle, () => {
        if (typeof closeSummary === 'function') closeSummary();
      });
    }

    // Driver: order detail overlay
    const orderDetailOverlay = document.getElementById('order-detail-overlay');
    if (orderDetailOverlay) {
      const modal = orderDetailOverlay.querySelector('.order-detail-modal');
      const handle = orderDetailOverlay.querySelector('[class*="handle"]');
      if (modal && handle) {
        initSwipeDismiss(orderDetailOverlay, modal, handle, () => {
          if (typeof closeOrderDetail === 'function') closeOrderDetail();
        });
      }
    }

    // Driver: balance modal overlay
    const balanceOverlay = document.getElementById('balance-modal-overlay');
    if (balanceOverlay) {
      const modal = balanceOverlay.querySelector('.balance-modal');
      const handle = balanceOverlay.querySelector('[class*="handle"]');
      if (modal && handle) {
        initSwipeDismiss(balanceOverlay, modal, handle, () => {
          if (typeof closeBalanceBreakdown === 'function') closeBalanceBreakdown();
        });
      }
    }

    // Driver: time picker overlay
    const tpOverlay = document.getElementById('tp-overlay');
    if (tpOverlay) {
      const modal = tpOverlay.querySelector('.tp-modal');
      const handle = tpOverlay.querySelector('.tp-handle');
      initSwipeDismiss(tpOverlay, modal, handle, () => {
        if (typeof closeTimePicker === 'function') closeTimePicker();
      });
    }
  });
})();
