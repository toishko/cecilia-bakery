// customer-auth.js — Handles Login & Signup for /login.html
import { supabase } from './supabase-client.js';

// ── Helpers ──────────────────────────────────────────────────
function showFeedback(message, isError = false) {
    let box = document.getElementById('auth-feedback');
    if (!box) {
        box = document.createElement('div');
        box.id = 'auth-feedback';
        box.style.cssText = `
            margin-top: 14px; padding: 12px 16px; border-radius: 10px;
            font-family: 'Outfit', sans-serif; font-size: 0.88rem;
            font-weight: 500; text-align: center; transition: all 0.3s;
        `;
        document.getElementById('customerAuthForm').after(box);
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

function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
    btn.textContent = loading ? 'Please wait…' : btn.dataset.originalText;
}

// ── Main Logic ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const form     = document.getElementById('customerAuthForm');
    const authCard = document.getElementById('authCard');

    const inputs = {
        name:     form.querySelector('input[type="text"]'),
        email:    form.querySelector('input[type="email"]'),
        phone:    form.querySelector('input[type="tel"]'),
        password: form.querySelector('input[type="password"]'),
    };

    // Save original button text for reset after load
    form.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });

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
            showFeedback('Please fill in your email and password.', true);
            return;
        }

        setLoading(activeBtn, true);

        if (isSignup) {
            // ── SIGN UP ──────────────────────────────────────
            const { data, error } = await supabase.auth.signUp({ email, password });

            if (error) {
                showFeedback(error.message, true);
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
                showFeedback('Account created but profile setup failed. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            showFeedback('Account created! Check your email to confirm, then log in.');
            authCard.classList.remove('is-signup');
            setLoading(activeBtn, false);

        } else {
            // ── LOG IN ───────────────────────────────────────
            const { error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                showFeedback(error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            // Redirect to homepage
            window.location.href = 'index.html';
        }
    });
});
