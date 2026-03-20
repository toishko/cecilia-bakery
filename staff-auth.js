// staff-auth.js — Handles Login ONLY for /staff-login.html
// No public signup. Accounts are manually created and assigned 'staff' in Supabase dashboard.
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
        email:      form.querySelector('input[type="email"]'),
        password:   form.querySelector('input[type="password"]'),
        rememberMe: form.querySelector('#remember-me'),
    };

    const savedEmail = localStorage.getItem('cecilia_staff_email');
    if (savedEmail && inputs.email && inputs.rememberMe) {
        inputs.email.value = savedEmail;
        inputs.rememberMe.checked = true;
    }

    const toggleBtn = form.querySelector('.password-toggle');
    if (toggleBtn && inputs.password) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = inputs.password.type === 'password';
            inputs.password.type = isPassword ? 'text' : 'password';
            toggleBtn.innerHTML = isPassword 
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.578 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
        });
    }

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
        if (inputs.rememberMe?.checked) {
            localStorage.setItem('cecilia_staff_email', email);
        } else {
            localStorage.removeItem('cecilia_staff_email');
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            showFeedback('Invalid credentials.', true);
            setLoading(submitBtn, false);
            return;
        }

        // Step 2: Verify staff role — if not staff or admin, immediately sign out
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (!profile || (profile.role !== 'staff' && profile.role !== 'admin')) {
            await supabase.auth.signOut();
            showFeedback('Access Denied. This portal is restricted to staff members.', true);
            setLoading(submitBtn, false);
            return;
        }

        // Step 3: Confirmed staff — redirect to dashboard
        window.location.href = 'staff-dashboard.html';
    });
});
