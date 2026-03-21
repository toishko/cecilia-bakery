// idle-timeout.js — Shared idle timeout module for all dashboards
// Signs out the user after a period of inactivity.
import { supabase } from './supabase-client.js';

const WARNING_BEFORE_MS = 2 * 60 * 1000; // warn 2 minutes before timeout

/**
 * Initializes an idle timeout that signs out the user after the specified duration.
 * Shows a warning toast 2 minutes before the timeout triggers.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 20 minutes)
 */
export function initIdleTimeout(timeoutMs = 20 * 60 * 1000) {
    let idleTimer;
    let warningTimer;
    let warningToast = null;

    function removeWarning() {
        if (warningToast && warningToast.parentNode) {
            warningToast.parentNode.removeChild(warningToast);
            warningToast = null;
        }
    }

    function showWarning() {
        removeWarning();
        warningToast = document.createElement('div');
        warningToast.id = 'idle-warning-toast';
        warningToast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 9999;
            background: rgba(200, 16, 46, 0.95); color: #fff;
            padding: 16px 24px; border-radius: 10px;
            font-family: 'Outfit', sans-serif; font-size: 0.9rem;
            font-weight: 500; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            animation: fadeUp 0.3s ease forwards;
        `;
        warningToast.textContent = 'Your session will expire in 2 minutes due to inactivity.';
        document.body.appendChild(warningToast);
    }

    function resetIdleTimer() {
        clearTimeout(idleTimer);
        clearTimeout(warningTimer);
        removeWarning();

        // Set warning timer (fires 2 min before timeout)
        if (timeoutMs > WARNING_BEFORE_MS) {
            warningTimer = setTimeout(showWarning, timeoutMs - WARNING_BEFORE_MS);
        }

        // Set the actual timeout
        idleTimer = setTimeout(async () => {
            console.warn('Session timed out due to inactivity.');
            removeWarning();
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        }, timeoutMs);
    }

    // Attach listeners
    ['mousemove', 'keydown', 'scroll', 'click'].forEach(evt => {
        document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    // Start the timer
    resetIdleTimer();
}
