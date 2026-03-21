// admin-auth.js — Handles Login ONLY for /admin-login.html
// No public signup. Accounts are manually created in Supabase dashboard.
import { supabase } from './supabase-client.js';
import { showFeedback, setLoading, setupPasswordToggle, storeButtonText, checkRateLimit, recordFailedAttempt, resetRateLimit, startRateLimitCountdown, checkEmailConfirmation } from './auth-helpers.js';

// ── Main Logic ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('adminAuthForm');

    // ── Already-logged-in redirect ─────────────────────────
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            if (profile && profile.role === 'admin') {
                window.location.href = 'admin-dashboard.html';
                return;
            }
        }
    } catch (_) { /* no session — show login form */ }

    const inputs = {
        email:      form.querySelector('input[type="email"]'),
        password:   form.querySelector('input[type="password"]'),
        rememberMe: form.querySelector('#remember-me'),
    };

    const savedEmail = localStorage.getItem('cecilia_admin_email');
    if (savedEmail && inputs.email && inputs.rememberMe) {
        inputs.email.value = savedEmail;
        inputs.rememberMe.checked = true;
    }

    setupPasswordToggle(form);
    storeButtonText(form);
    checkEmailConfirmation(form);

    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email    = inputs.email?.value?.trim();
        const password = inputs.password?.value;

        if (!email || !password) {
            showFeedback(form, 'Email and password are required.', true);
            return;
        }

        setLoading(submitBtn, true, 'Verifying…');

        // Step 1: Attempt login
        if (inputs.rememberMe?.checked) {
            localStorage.setItem('cecilia_admin_email', email);
        } else {
            localStorage.removeItem('cecilia_admin_email');
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            const rl = recordFailedAttempt();
            if (rl.blocked) {
                startRateLimitCountdown(submitBtn, rl.remainingMs, form);
            } else {
                showFeedback(form, 'Invalid credentials.', true);
            }
            setLoading(submitBtn, false, 'Verifying…');
            return;
        }

        resetRateLimit();

        // Step 2: Verify admin role — if not admin, immediately sign out
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (!profile || profile.role !== 'admin') {
            await supabase.auth.signOut();
            showFeedback(form, 'Access Denied. This portal is restricted to administrators.', true);
            setLoading(submitBtn, false, 'Verifying…');
            return;
        }

        // Step 3: Confirmed admin — redirect to dashboard
        window.location.href = 'admin-dashboard.html';
    });
});
