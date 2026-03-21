// customer-auth.js — Handles Login & Signup for /login.html
import { supabase } from './supabase-client.js';
import { showFeedback, setLoading, setupPasswordToggle, storeButtonText, validatePassword, setupPasswordStrength, checkRateLimit, recordFailedAttempt, resetRateLimit, startRateLimitCountdown, checkEmailConfirmation } from './auth-helpers.js';

// ── Main Logic ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const form     = document.getElementById('customerAuthForm');
    const authCard = document.getElementById('authCard');

    // ── Already-logged-in redirect ─────────────────────────
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            if (profile && profile.role === 'customer') {
                window.location.href = 'customer-dashboard.html';
                return;
            }
        }
    } catch (_) { /* no session — show login form */ }

    const inputs = {
        name:       form.querySelector('input[type="text"]'),
        email:      form.querySelector('input[type="email"]'),
        phone:      form.querySelector('input[type="tel"]'),
        password:   form.querySelector('input[type="password"]'),
        rememberMe: form.querySelector('#remember-me')
    };

    // Restore saved email if present
    const savedEmail = localStorage.getItem('cecilia_customer_email');
    if (savedEmail && inputs.email && inputs.rememberMe) {
        inputs.email.value = savedEmail;
        inputs.rememberMe.checked = true;
    }

    setupPasswordToggle(form);
    setupPasswordStrength(form, inputs.password);
    storeButtonText(form);
    checkEmailConfirmation(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const isSignup    = authCard.classList.contains('is-signup');
        const email       = inputs.email?.value?.trim();
        const password    = inputs.password?.value;
        const fullName    = inputs.name?.value?.trim();
        const phone       = inputs.phone?.value?.trim();

        // Determine which submit button is active
        const activeBtn = form.querySelector(
            isSignup ? '.btn-submit.show-on-signup' : '.btn-submit.hide-on-signup'
        );

        if (!email || !password) {
            showFeedback(form, 'Please fill in your email and password.', true);
            return;
        }

        setLoading(activeBtn, true);

        if (isSignup) {
            // ── Validate password strength ─────────────────────
            const { isValid, errors } = validatePassword(password);
            if (!isValid) {
                showFeedback(form, 'Password too weak: ' + errors.join(', '), true);
                setLoading(activeBtn, false);
                return;
            }

            // ── SIGN UP ──────────────────────────────────────
            const { data, error } = await supabase.auth.signUp({ email, password });

            if (error) {
                showFeedback(form, error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            // Upsert profile with customer role
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                    id:        data.user.id,
                    role:      'customer',
                    full_name: fullName || null,
                    phone:     phone    || null,
                });

            if (profileError) {
                showFeedback(form, 'Account created but profile setup failed. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            showFeedback(form, 'Account created! Check your email to confirm, then log in.');
            authCard.classList.remove('is-signup');
            setLoading(activeBtn, false);

        } else {
            // ── LOG IN ───────────────────────────────────────
            if (inputs.rememberMe?.checked) {
                localStorage.setItem('cecilia_customer_email', email);
            } else {
                localStorage.removeItem('cecilia_customer_email');
            }

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                const rl = recordFailedAttempt();
                if (rl.blocked) {
                    startRateLimitCountdown(activeBtn, rl.remainingMs, form);
                } else {
                    showFeedback(form, error.message, true);
                }
                setLoading(activeBtn, false);
                return;
            }

            resetRateLimit();

            // Verify the user actually has the customer role
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (!profile || profile.role !== 'customer') {
                await supabase.auth.signOut();
                showFeedback(form, 'This account does not have customer access. Please use the correct portal.', true);
                setLoading(activeBtn, false);
                return;
            }

            // Redirect to customer dashboard
            window.location.href = 'customer-dashboard.html';
        }
    });
});
