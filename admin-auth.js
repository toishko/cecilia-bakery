// admin-auth.js — Handles Login ONLY for /admin-login.html
// No public signup. Accounts are manually created in Supabase dashboard.
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
        document.getElementById('adminAuthForm').after(box);
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
    btn.textContent = loading ? 'Verifying…' : btn.dataset.originalText;
}

// ── Main Logic ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('adminAuthForm');

    const inputs = {
        email:    form.querySelector('input[type="email"]'),
        password: form.querySelector('input[type="password"]'),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.dataset.originalText = submitBtn.textContent;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email    = inputs.email?.value?.trim();
        const password = inputs.password?.value;

        if (!email || !password) {
            showFeedback('Email and password are required.', true);
            return;
        }

        setLoading(submitBtn, true);

        // Step 1: Attempt login
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            showFeedback('Invalid credentials.', true);
            setLoading(submitBtn, false);
            return;
        }

        // Step 2: Verify admin role — if not admin, immediately sign out
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (!profile || profile.role !== 'admin') {
            await supabase.auth.signOut();
            showFeedback('⛔ Access Denied. This portal is restricted to administrators.', true);
            setLoading(submitBtn, false);
            return;
        }

        // Step 3: Confirmed admin — redirect to dashboard
        window.location.href = 'admin-dashboard.html';
    });
});
