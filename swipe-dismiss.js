// ═══════════════════════════════════
//  Swipe-to-Dismiss for Modals
//  Drag anywhere near top of modal to dismiss
// ═══════════════════════════════════
(function() {
  const DISMISS_THRESHOLD = 100;

  function initSwipeDismiss(overlay, modal, handle, closeFn) {
    if (!modal || !overlay) return;

    let startY = 0;
    let currentTranslate = 0;
    let dragging = false;

    // Make the handle a large, easy-to-grab touch zone
    if (handle) {
      handle.style.cursor = 'grab';
      handle.style.padding = '14px 0';
      handle.style.margin = '0 auto';
      handle.style.touchAction = 'none';
      handle.style.width = '100%';
      handle.style.display = 'flex';
      handle.style.justifyContent = 'center';
    }

    // The drag zone: handle + first child (usually the header area)
    // We listen on the whole modal but only start drag if touch is near the top
    function isInDragZone(e) {
      const touch = e.touches ? e.touches[0] : e;
      const modalRect = modal.getBoundingClientRect();
      // Top 60px of the modal is the drag zone
      return touch.clientY < (modalRect.top + 60);
    }

    // Also check if touch started on scrollable content
    function isOnScrollableContent(e) {
      let el = e.target;
      while (el && el !== modal) {
        // If the element is scrollable and not at the top, don't start drag
        if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    }

    modal.addEventListener('touchstart', (e) => {
      if (!isInDragZone(e)) return;
      if (isOnScrollableContent(e)) return;
      dragging = true;
      startY = e.touches[0].clientY;
      currentTranslate = 0;
      modal.style.transition = 'none';
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
        modal.style.transform = `translateY(100%)`;
        setTimeout(() => {
          modal.style.transform = '';
          modal.style.transition = '';
          overlay.style.backgroundColor = '';
          closeFn();
        }, 280);
      } else {
        modal.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => { modal.style.transition = ''; }, 300);
      }
      currentTranslate = 0;
    }, { passive: true });

    // Mouse support for desktop testing
    modal.addEventListener('mousedown', (e) => {
      const modalRect = modal.getBoundingClientRect();
      if (e.clientY > modalRect.top + 60) return;
      dragging = true;
      startY = e.clientY;
      currentTranslate = 0;
      modal.style.transition = 'none';
      e.preventDefault();
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

      if (currentTranslate > DISMISS_THRESHOLD) {
        modal.style.transform = `translateY(100%)`;
        setTimeout(() => {
          modal.style.transform = '';
          modal.style.transition = '';
          overlay.style.backgroundColor = '';
          closeFn();
        }, 280);
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
      initSwipeDismiss(orderDetailOverlay, modal, handle, () => {
        if (typeof closeOrderDetail === 'function') closeOrderDetail();
      });
    }

    // Driver: balance modal overlay
    const balanceOverlay = document.getElementById('balance-modal-overlay');
    if (balanceOverlay) {
      const modal = balanceOverlay.querySelector('.balance-modal');
      const handle = balanceOverlay.querySelector('[class*="handle"]');
      initSwipeDismiss(balanceOverlay, modal, handle, () => {
        if (typeof closeBalanceBreakdown === 'function') closeBalanceBreakdown();
      });
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
