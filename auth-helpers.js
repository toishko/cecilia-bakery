// auth-helpers.js — Shared authentication UI helpers
// Used by customer-auth.js, partner-auth.js, driver-auth.js, admin-auth.js, staff-auth.js

// ── SVG Icons ────────────────────────────────────────────────
const EYE_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_CLOSED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.578 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

// ── Feedback Banner ──────────────────────────────────────────
/**
 * Shows inline success/error feedback below a form.
 * @param {HTMLElement} formEl - The form element to anchor the feedback to
 * @param {string} message - The message to display
 * @param {boolean} isError - True for error styling, false for success
 */
export function showFeedback(formEl, message, isError = false) {
    let box = document.getElementById('auth-feedback');
    if (!box) {
        box = document.createElement('div');
        box.id = 'auth-feedback';
        box.style.cssText = `
            margin-top: 14px; padding: 12px 16px; border-radius: 10px;
            font-family: 'Outfit', sans-serif; font-size: 0.88rem;
            font-weight: 500; text-align: center; transition: all 0.3s;
        `;
        formEl.after(box);
    }
    box.textContent = message;
    box.style.background = isError
        ? 'rgba(220, 53, 69, 0.15)'
        : 'rgba(40, 167, 69, 0.15)';
    box.style.color  = isError ? '#ff6b7a' : '#6fcf97';
    box.style.border = isError
        ? '1px solid rgba(220,53,69,0.3)'
        : '1px solid rgba(40,167,69,0.3)';
    box.style.display = 'block';
}

// ── Button Loading State ─────────────────────────────────────
/**
 * Toggles a button's loading state.
 * @param {HTMLButtonElement} btn - The button to toggle
 * @param {boolean} loading - True to show loading, false to reset
 * @param {string} [loadingText='Please wait…'] - Text shown while loading
 */
export function setLoading(btn, loading, loadingText = 'Please wait…') {
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
    btn.textContent = loading ? loadingText : btn.dataset.originalText;
}

// ── Password Toggle ──────────────────────────────────────────
/**
 * Sets up the password visibility toggle button within a form.
 * @param {HTMLFormElement} formEl - The form containing the toggle and password input
 */
export function setupPasswordToggle(formEl) {
    const toggleBtn = formEl.querySelector('.password-toggle');
    const passwordInput = formEl.querySelector('input[type="password"]');
    if (!toggleBtn || !passwordInput) return;

    toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        toggleBtn.innerHTML = isPassword ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
    });
}

// ── Store Original Button Text ───────────────────────────────
/**
 * Saves original button text so setLoading can restore it.
 * @param {HTMLFormElement} formEl - The form containing submit buttons
 */
export function storeButtonText(formEl) {
    formEl.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });
}

// ── Password Strength Validation ─────────────────────────────
/**
 * Validates a password against strength rules.
 * @param {string} password - The password to validate
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export function validatePassword(password) {
    const rules = [
        { test: p => p.length >= 8, msg: 'At least 8 characters' },
        { test: p => /[A-Z]/.test(p), msg: 'At least one uppercase letter' },
        { test: p => /[a-z]/.test(p), msg: 'At least one lowercase letter' },
        { test: p => /[0-9]/.test(p), msg: 'At least one number' },
    ];

    const errors = rules.filter(r => !r.test(password)).map(r => r.msg);
    return { isValid: errors.length === 0, errors, rules };
}

/**
 * Sets up real-time password strength indicators on a signup form.
 * @param {HTMLFormElement} formEl - The form containing the password input
 * @param {HTMLElement} passwordInput - The password input element
 */
export function setupPasswordStrength(formEl, passwordInput) {
    if (!formEl || !passwordInput) return;

    // Create the strength indicator container
    const container = document.createElement('div');
    container.className = 'password-strength show-on-signup';
    container.style.cssText = `
        margin-top: -12px; margin-bottom: 16px; padding: 0;
        font-family: 'Outfit', sans-serif; font-size: 0.78rem;
    `;

    const { rules } = validatePassword('');
    const items = rules.map((_rule, i) => {
        const item = document.createElement('div');
        item.className = `pw-rule pw-rule-${i}`;
        item.style.cssText = `
            color: var(--tx-faint); transition: color 0.2s;
            padding: 2px 0;
        `;
        item.textContent = `○ ${_rule.msg}`;
        container.appendChild(item);
        return item;
    });

    // Insert after the password input group
    const passwordGroup = passwordInput.closest('.input-group');
    if (passwordGroup) {
        passwordGroup.after(container);
    }

    // Listen for real-time input
    passwordInput.addEventListener('input', () => {
        const val = passwordInput.value;
        const result = validatePassword(val);

        items.forEach((item, i) => {
            const passed = result.rules[i].test(val);
            item.style.color = passed ? '#6fcf97' : 'var(--tx-faint)';
            item.textContent = `${passed ? '✓' : '○'} ${result.rules[i].msg}`;
        });
    });
}

// ── Login Rate Limiting ──────────────────────────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const STORAGE_KEY = 'cecilia_login_attempts';

/**
 * Checks if login is currently rate-limited. Returns { blocked, remainingMs }.
 */
export function checkRateLimit() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { blocked: false, remainingMs: 0 };

    const { count, lockedUntil } = JSON.parse(raw);

    if (lockedUntil) {
        const remaining = lockedUntil - Date.now();
        if (remaining > 0) return { blocked: true, remainingMs: remaining };
        // Lockout expired — reset
        sessionStorage.removeItem(STORAGE_KEY);
        return { blocked: false, remainingMs: 0 };
    }
    return { blocked: false, remainingMs: 0 };
}

/**
 * Records a failed login attempt. Returns the current rate limit status.
 */
export function recordFailedAttempt() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    let data = raw ? JSON.parse(raw) : { count: 0, lockedUntil: null };

    data.count += 1;

    if (data.count >= MAX_ATTEMPTS) {
        data.lockedUntil = Date.now() + LOCKOUT_MS;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return checkRateLimit();
}

/**
 * Resets the rate limiter (called on successful login).
 */
export function resetRateLimit() {
    sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Starts a countdown on a submit button during rate limiting.
 * @param {HTMLButtonElement} btn - The submit button
 * @param {number} remainingMs - Time remaining in ms
 * @param {HTMLFormElement} formEl - The form element for feedback
 */
export function startRateLimitCountdown(btn, remainingMs, formEl) {
    btn.disabled = true;
    btn.style.opacity = '0.6';

    const update = () => {
        const { blocked, remainingMs: ms } = checkRateLimit();
        if (!blocked) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.textContent = btn.dataset.originalText;
            return;
        }
        const secs = Math.ceil(ms / 1000);
        btn.textContent = `Too many attempts (${secs}s)`;
        showFeedback(formEl, `Too many failed attempts. Try again in ${secs} seconds.`, true);
        setTimeout(update, 1000);
    };

    update();
}

// ── Email Confirmation Banner ────────────────────────────────
/**
 * Checks if the URL contains ?confirmed=true and shows a success banner.
 * @param {HTMLFormElement} formEl - The form element to insert the banner near
 */
export function checkEmailConfirmation(formEl) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('confirmed') === 'true') {
        showFeedback(formEl, 'Email confirmed! You can now log in.');
        // Clean the URL
        const url = new URL(window.location);
        url.searchParams.delete('confirmed');
        window.history.replaceState({}, '', url);
    }
}
