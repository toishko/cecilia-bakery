// ═══════════════════════════════════
//  Pull-to-Refresh for PWA
//  Adds native-feeling refresh gesture
//  Disabled when any modal/overlay is open
// ═══════════════════════════════════
(function() {
  // Only enable in standalone PWA mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (!isStandalone) return;

  let startY = 0;
  let pulling = false;
  let pullDistance = 0;
  const THRESHOLD = 80;

  // Check if any modal/overlay is open
  function isModalOpen() {
    // Body is position:fixed when a modal is open (our scroll lock)
    if (document.body.style.position === 'fixed') return true;
    // Also check for any overlay with .open class
    const openOverlay = document.querySelector(
      '.detail-overlay.open, .summary-overlay.open, ' +
      '[id$="-overlay"].open, [id$="-modal-overlay"].open'
    );
    return !!openOverlay;
  }

  // Create indicator
  const indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.innerHTML = '<div class="ptr-spinner">↓</div>';
  indicator.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:9998;
    display:flex;align-items:center;justify-content:center;
    height:0;overflow:hidden;
    background:linear-gradient(180deg,rgba(200,16,46,.08),transparent);
    transition:height .2s ease;
    pointer-events:none;
  `;
  const spinner = indicator.querySelector('.ptr-spinner');
  spinner.style.cssText = `
    width:32px;height:32px;border-radius:50%;
    background:var(--red,#C8102E);color:#fff;
    display:flex;align-items:center;justify-content:center;
    font-size:16px;font-weight:700;
    transition:transform .2s ease;
    box-shadow:0 2px 8px rgba(200,16,46,.3);
  `;
  document.body.appendChild(indicator);

  document.addEventListener('touchstart', (e) => {
    // Don't activate if a modal is open or not at top
    if (isModalOpen()) return;
    if (window.scrollY > 5) return;
    startY = e.touches[0].clientY;
    pulling = true;
    pullDistance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const currentY = e.touches[0].clientY;
    pullDistance = Math.max(0, currentY - startY);

    if (pullDistance > 10) {
      const height = Math.min(pullDistance * 0.5, 60);
      indicator.style.height = height + 'px';

      const progress = Math.min(pullDistance / THRESHOLD, 1);
      spinner.style.transform = `rotate(${progress * 360}deg)`;

      if (pullDistance >= THRESHOLD) {
        spinner.textContent = '↻';
        spinner.style.background = '#2f8a4c';
      } else {
        spinner.textContent = '↓';
        spinner.style.background = 'var(--red,#C8102E)';
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;

    if (pullDistance >= THRESHOLD) {
      spinner.textContent = '↻';
      indicator.style.height = '50px';
      spinner.style.animation = 'ptr-spin .6s linear infinite';

      // Add spin animation if not exists
      if (!document.getElementById('ptr-style')) {
        const style = document.createElement('style');
        style.id = 'ptr-style';
        style.textContent = '@keyframes ptr-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
      }

      // Reload after brief delay
      setTimeout(() => window.location.reload(), 400);
    } else {
      indicator.style.height = '0';
    }
    pullDistance = 0;
  }, { passive: true });
})();
