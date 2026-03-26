// ═══════════════════════════════════
//  Swipe-to-Dismiss for Modals
//  Drag anywhere near top of modal to dismiss
//  Handle keeps its original small pill look
// ═══════════════════════════════════
(function() {
  const DISMISS_THRESHOLD = 100;

  function initSwipeDismiss(overlay, modal, closeFn) {
    if (!modal || !overlay) return;

    let startY = 0;
    let currentTranslate = 0;
    let dragging = false;
    let dismissing = false;

    // The drag zone: top ~60px of the modal
    function isInDragZone(touchY) {
      const modalRect = modal.getBoundingClientRect();
      return touchY < (modalRect.top + 60);
    }

    modal.addEventListener('touchstart', (e) => {
      if (dismissing) return;
      if (!isInDragZone(e.touches[0].clientY)) return;
      dragging = true;
      startY = e.touches[0].clientY;
      currentTranslate = 0;
      modal.style.transition = 'none';
      modal.style.animation = 'none';
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const deltaY = e.touches[0].clientY - startY;
      currentTranslate = Math.max(0, deltaY);

      if (currentTranslate > 0) {
        modal.style.transform = `translateY(${currentTranslate}px)`;
        const opacity = Math.max(0, 1 - (currentTranslate / 300));
        overlay.style.backgroundColor = `rgba(0,0,0,${opacity * 0.5})`;
      }
    }, { passive: true });

    modal.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      modal.style.transition = 'transform .3s ease';

      if (currentTranslate > DISMISS_THRESHOLD) {
        // Dismiss — set global cooldown to prevent touch-through reopen
        dismissing = true;
        window._swipeDismissCooldown = true;
        modal.style.transform = `translateY(100%)`;
        setTimeout(() => {
          closeFn();
          setTimeout(() => {
            modal.style.transform = '';
            modal.style.transition = '';
            modal.style.animation = '';
            overlay.style.backgroundColor = '';
            dismissing = false;
          }, 50);
          // Clear cooldown after a delay
          setTimeout(() => { window._swipeDismissCooldown = false; }, 500);
        }, 280);
      } else {
        // Snap back
        modal.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => { modal.style.transition = ''; modal.style.animation = ''; }, 300);
      }
      currentTranslate = 0;
    }, { passive: true });
  }

  // Wait for DOM then attach to all modals
  document.addEventListener('DOMContentLoaded', () => {
    // Admin: detail modal
    const adminOverlay = document.getElementById('detail-overlay');
    if (adminOverlay) {
      const modal = adminOverlay.querySelector('.detail-modal');
      initSwipeDismiss(adminOverlay, modal, () => {
        if (typeof closeDetailModal === 'function') closeDetailModal();
      });
    }

    // Driver: summary overlay
    const summaryOverlay = document.getElementById('summary-overlay');
    if (summaryOverlay) {
      const modal = summaryOverlay.querySelector('.summary-modal');
      initSwipeDismiss(summaryOverlay, modal, () => {
        if (typeof closeSummary === 'function') closeSummary();
      });
    }

    // Driver: order detail overlay
    const orderDetailOverlay = document.getElementById('order-detail-overlay');
    if (orderDetailOverlay) {
      const modal = orderDetailOverlay.querySelector('.order-detail-modal');
      initSwipeDismiss(orderDetailOverlay, modal, () => {
        if (typeof closeOrderDetail === 'function') closeOrderDetail();
      });
    }

    // Driver: balance modal overlay
    const balanceOverlay = document.getElementById('balance-modal-overlay');
    if (balanceOverlay) {
      const modal = balanceOverlay.querySelector('.balance-modal');
      initSwipeDismiss(balanceOverlay, modal, () => {
        if (typeof closeBalanceBreakdown === 'function') closeBalanceBreakdown();
      });
    }

    // Driver: time picker overlay
    const tpOverlay = document.getElementById('tp-overlay');
    if (tpOverlay) {
      const modal = tpOverlay.querySelector('.tp-modal');
      initSwipeDismiss(tpOverlay, modal, () => {
        if (typeof closeTimePicker === 'function') closeTimePicker();
      });
    }
  });
})();
