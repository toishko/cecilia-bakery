// partner-auth.js — Handles Login & Application for /partner-login.html
import { supabase } from './supabase-client.js';
import { showFeedback, setLoading, setupPasswordToggle, storeButtonText, validatePassword, setupPasswordStrength, checkRateLimit, recordFailedAttempt, resetRateLimit, startRateLimitCountdown, checkEmailConfirmation } from './auth-helpers.js';

// ── Main Logic ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const form     = document.getElementById('partnerAuthForm');
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
            if (profile && profile.role === 'partner') {
                window.location.href = 'partner-dashboard.html';
                return;
            }
        }
    } catch (_) { /* no session — show login form */ }

    const inputs = {
        businessName: form.querySelector('input[type="text"]:nth-of-type(1)'),
        contactName:  form.querySelector('input[type="text"]:nth-of-type(2)'),
        phone:        form.querySelector('input[type="tel"]'),
        email:        form.querySelector('input[type="email"]'),
        password:     form.querySelector('input[type="password"]'),
        rememberMe:   form.querySelector('#remember-me'),
    };

    const savedEmail = localStorage.getItem('cecilia_partner_email');
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

        const isApply    = authCard.classList.contains('is-signup');
        const email      = inputs.email?.value?.trim();
        const password   = inputs.password?.value;

        const activeBtn = form.querySelector(
            isApply ? '.btn-submit.show-on-signup' : '.btn-submit.hide-on-signup'
        );

        if (!email || !password) {
            showFeedback(form, 'Please fill in your email and password.', true);
            return;
        }

        setLoading(activeBtn, true);

        if (isApply) {
            // ── APPLY FOR WHOLESALE ACCOUNT ──────────────────
            const businessName = inputs.businessName?.value?.trim();
            const contactName  = inputs.contactName?.value?.trim();
            const phone        = inputs.phone?.value?.trim();

            if (!businessName || !contactName || !phone) {
                showFeedback(form, 'All fields are required to apply.', true);
                setLoading(activeBtn, false);
                return;
            }

            // ── Validate password strength ─────────────────────
            const { isValid, errors } = validatePassword(password);
            if (!isValid) {
                showFeedback(form, 'Password too weak: ' + errors.join(', '), true);
                setLoading(activeBtn, false);
                return;
            }

            const { data, error } = await supabase.auth.signUp({ email, password });

            if (error) {
                showFeedback(form, error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            // Upsert base profile with partner role
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                    id:        data.user.id,
                    role:      'partner',
                    full_name: contactName,
                    phone:     phone,
                });

            if (profileError) {
                showFeedback(form, 'Signup error. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            // Insert partner_details row with pending status
            const { error: detailsError } = await supabase
                .from('partner_details')
                .insert({
                    id:            data.user.id,
                    business_name: businessName,
                    contact_name:  contactName,
                    status:        'pending',
                });

            if (detailsError) {
                showFeedback(form, 'Profile saved, but details failed. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            showFeedback(form, 'Application submitted! We\'ll review and contact you soon.');
            setLoading(activeBtn, false);

        } else {
            // ── LOG IN ───────────────────────────────────────
            if (inputs.rememberMe?.checked) {
                localStorage.setItem('cecilia_partner_email', email);
            } else {
                localStorage.removeItem('cecilia_partner_email');
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

            // Verify the user actually has the partner role
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (!profile || profile.role !== 'partner') {
                await supabase.auth.signOut();
                showFeedback(form, 'This account does not have partner access.', true);
                setLoading(activeBtn, false);
                return;
            }

            window.location.href = 'partner-dashboard.html';
        }
    });
});
