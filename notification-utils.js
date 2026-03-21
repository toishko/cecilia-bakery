/**
 * notification-utils.js — Shared Notification System for Cecilia Bakery
 * 
 * Provides: sounds (with distinct tones), browser notifications, mute toggle,
 * debounce, tab title blink, and notification history.
 * 
 * Usage:
 *   import { playSound, showBrowserNotification, requestNotificationPermission,
 *            toggleMute, isMuted, startTitleBlink, addToHistory, getHistory,
 *            renderNotificationPanel, initNotificationUI } from './notification-utils.js';
 */

// ── Mute State (persisted in localStorage) ──────────────────────────────

export function isMuted() {
    return localStorage.getItem('cecilia_notif_muted') === 'true';
}

export function toggleMute() {
    const muted = !isMuted();
    localStorage.setItem('cecilia_notif_muted', muted.toString());
    updateMuteButton(muted);
    return muted;
}

function updateMuteButton(muted) {
    const btn = document.getElementById('notif-mute-btn');
    if (!btn) return;
    btn.innerHTML = muted
        ? '<i data-lucide="bell-off" class="icon" style="width:18px;height:18px;"></i>'
        : '<i data-lucide="bell" class="icon" style="width:18px;height:18px;"></i>';
    btn.title = muted ? 'Notifications muted' : 'Notifications on';
    btn.setAttribute('aria-label', muted ? 'Unmute notifications' : 'Mute notifications');
    // Re-render lucide icons for the new SVG
    if (window.lucide) window.lucide.createIcons();
}

// ── Sound Debounce ──────────────────────────────────────────────────────

let lastSoundTimestamp = 0;
const DEBOUNCE_MS = 3000;

// ── Synthesized Chime Tones ─────────────────────────────────────────────

/**
 * Play a notification chime.
 * @param {'order'|'status'|'alert'} type - Chime type
 *   - 'order'  → ascending C6→E6 double-chime (new order)
 *   - 'status' → single soft G5 chime (status change)
 *   - 'alert'  → triple descending E6→C6→A5 (urgent/rejection)
 */
export function playSound(type = 'order') {
    if (isMuted()) return;

    const now = Date.now();
    if (now - lastSoundTimestamp < DEBOUNCE_MS) return;
    lastSoundTimestamp = now;

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        const playTone = (freq, startTime, duration, volume = 0.3) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        const t = ctx.currentTime;

        switch (type) {
            case 'order':
                // Ascending major third double-chime
                playTone(1046.50, t, 0.3);          // C6
                playTone(1318.51, t + 0.12, 0.5);   // E6
                break;
            case 'status':
                // Single soft chime
                playTone(783.99, t, 0.5, 0.2);      // G5
                break;
            case 'alert':
                // Triple descending quick chime
                playTone(1318.51, t, 0.25, 0.35);        // E6
                playTone(1046.50, t + 0.1, 0.25, 0.3);   // C6
                playTone(880.00, t + 0.2, 0.4, 0.25);    // A5
                break;
            default:
                playTone(1046.50, t, 0.3);
                playTone(1318.51, t + 0.12, 0.5);
        }
    } catch (e) {
        console.error('Notification sound failed:', e);
    }
}

// ── Browser Notifications ───────────────────────────────────────────────

export function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

export function showBrowserNotification(title, body) {
    if (isMuted()) return;
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: '/assets/images/Logo.png',
            badge: '/assets/images/Logo.png'
        });
    }
}

// ── Tab Title Blink ─────────────────────────────────────────────────────

let originalTitle = '';
let blinkInterval = null;
let blinkState = false;

export function startTitleBlink(message) {
    if (!document.hidden) return; // Only blink if tab is not focused
    if (blinkInterval) return;   // Don't stack multiple blinks

    originalTitle = document.title;

    blinkInterval = setInterval(() => {
        blinkState = !blinkState;
        document.title = blinkState ? `🔔 ${message}` : originalTitle;
    }, 1500);

    // Auto-stop on tab focus
    const stopOnFocus = () => {
        stopTitleBlink();
        document.removeEventListener('visibilitychange', stopOnFocus);
    };
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) stopOnFocus();
    });
}

export function stopTitleBlink() {
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
        blinkState = false;
        if (originalTitle) document.title = originalTitle;
    }
}

// ── Notification History ────────────────────────────────────────────────

const MAX_HISTORY = 50;
let notificationHistory = [];
let unreadCount = 0;

/**
 * Add a notification to the in-memory history.
 * @param {'order'|'status'|'alert'|'info'} type
 * @param {string} title
 * @param {string} body
 */
export function addToHistory(type, title, body) {
    const entry = {
        id: Date.now() + Math.random(),
        type,
        title,
        body,
        timestamp: new Date(),
        read: false
    };
    notificationHistory.unshift(entry);
    if (notificationHistory.length > MAX_HISTORY) {
        notificationHistory = notificationHistory.slice(0, MAX_HISTORY);
    }
    unreadCount++;
    updateBellBadge();
    renderNotificationPanel();
}

export function getHistory() {
    return notificationHistory;
}

export function markAllRead() {
    notificationHistory.forEach(n => n.read = true);
    unreadCount = 0;
    updateBellBadge();
    renderNotificationPanel();
}

function updateBellBadge() {
    const badge = document.getElementById('notif-bell-badge');
    if (!badge) return;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// ── Sidebar Notification Badges ─────────────────────────────────────────

const tabBadgeCounts = {};

/**
 * Increment a notification badge on a sidebar tab.
 * @param {string} tabHash - The hash of the tab, e.g., '#driverorders'
 */
export function incrementTabBadge(tabHash) {
    tabBadgeCounts[tabHash] = (tabBadgeCounts[tabHash] || 0) + 1;
    const link = document.querySelector(`.sidebar-link[href="${tabHash}"]`);
    if (!link) return;

    // Check if this tab is currently active
    if (link.classList.contains('active')) {
        tabBadgeCounts[tabHash] = 0;
        return;
    }

    let badge = link.querySelector('.tab-notif-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tab-notif-badge';
        link.style.position = 'relative';
        link.appendChild(badge);
    }
    badge.textContent = tabBadgeCounts[tabHash] > 9 ? '9+' : tabBadgeCounts[tabHash];
    badge.style.display = 'flex';
}

/**
 * Clear the notification badge when a tab is clicked.
 * @param {string} tabHash
 */
export function clearTabBadge(tabHash) {
    tabBadgeCounts[tabHash] = 0;
    const link = document.querySelector(`.sidebar-link[href="${tabHash}"]`);
    if (!link) return;
    const badge = link.querySelector('.tab-notif-badge');
    if (badge) badge.style.display = 'none';
}

// ── Notification Panel Rendering ────────────────────────────────────────

function getRelativeTime(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function getTypeIcon(type) {
    switch (type) {
        case 'order':  return '🛒';
        case 'status': return '📋';
        case 'alert':  return '⚠️';
        case 'info':   return 'ℹ️';
        default:       return '🔔';
    }
}

export function renderNotificationPanel() {
    const panel = document.getElementById('notif-history-panel');
    if (!panel) return;

    const list = panel.querySelector('.notif-list');
    if (!list) return;

    if (notificationHistory.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: var(--tx-muted); font-size: 0.85rem;">
                <div style="font-size: 1.5rem; margin-bottom: 8px;">🔔</div>
                No notifications yet
            </div>`;
        return;
    }

    list.innerHTML = notificationHistory.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
            <span class="notif-item-icon">${getTypeIcon(n.type)}</span>
            <div class="notif-item-content">
                <div class="notif-item-title">${n.title}</div>
                <div class="notif-item-body">${n.body}</div>
            </div>
            <span class="notif-item-time">${getRelativeTime(n.timestamp)}</span>
        </div>
    `).join('');
}

// ── UI Initialization ───────────────────────────────────────────────────

/**
 * Call once on DOMContentLoaded. Sets up mute button, bell panel, and 
 * wires sidebar tab badge clearing.
 */
export function initNotificationUI() {
    // Initialize mute button state
    updateMuteButton(isMuted());

    // Wire mute button
    const muteBtn = document.getElementById('notif-mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', () => toggleMute());
    }

    // Wire bell button → toggle panel
    const bellBtn = document.getElementById('notif-bell-btn');
    const panel = document.getElementById('notif-history-panel');
    if (bellBtn && panel) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.classList.toggle('open');
            if (isOpen) {
                markAllRead();
            }
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !bellBtn.contains(e.target)) {
                panel.classList.remove('open');
            }
        });
    }

    // Wire sidebar links to clear badges on click
    document.querySelectorAll('.sidebar-link[href]').forEach(link => {
        link.addEventListener('click', () => {
            const hash = link.getAttribute('href');
            if (hash) clearTabBadge(hash);
        });
    });

    // Request notification permission
    requestNotificationPermission();
}

// ── Convenience: Full Notification (sound + browser + history + blink) ──

/**
 * Fire a complete notification: sound + browser notification + history + title blink.
 * @param {'order'|'status'|'alert'} type
 * @param {string} title
 * @param {string} body
 * @param {string} [blinkMessage] - Message for tab title blink (defaults to title)
 */
export function fireNotification(type, title, body, blinkMessage) {
    playSound(type);
    showBrowserNotification(title, body);
    addToHistory(type, title, body);
    startTitleBlink(blinkMessage || title);
}
