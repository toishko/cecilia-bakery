// driver-auth.js — Handles Login & Signup for /driver-login.html
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
        document.getElementById('driverAuthForm').after(box);
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
    const form     = document.getElementById('driverAuthForm');
    const authCard = document.getElementById('authCard');

    const inputs = {
        name:       form.querySelector('input[type="text"]'),
        phone:      form.querySelector('input[type="tel"]'),
        email:      form.querySelector('input[type="email"]'),
        password:   form.querySelector('input[type="password"]'),
        rememberMe: form.querySelector('#remember-me'),
    };

    const savedEmail = localStorage.getItem('cecilia_driver_email');
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

    form.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const isSignup = authCard.classList.contains('is-signup');
        const email    = inputs.email?.value?.trim();
        const password = inputs.password?.value;

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
            const fullName = inputs.name?.value?.trim();
            const phone    = inputs.phone?.value?.trim();

            if (!fullName || !phone) {
                showFeedback('Name and phone number are required for drivers.', true);
                setLoading(activeBtn, false);
                return;
            }

            const { data, error } = await supabase.auth.signUp({ email, password });

            if (error) {
                showFeedback(error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                    id:        data.user.id,
                    role:      'driver',
                    full_name: fullName,
                    phone:     phone,
                });

            if (profileError) {
                showFeedback('Account created but profile setup failed. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            showFeedback('Driver account created! Check your email to confirm, then log in.');
            authCard.classList.remove('is-signup');
            setLoading(activeBtn, false);

        } else {
            // ── LOG IN ───────────────────────────────────────
            if (inputs.rememberMe?.checked) {
                localStorage.setItem('cecilia_driver_email', email);
            } else {
                localStorage.removeItem('cecilia_driver_email');
            }

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                showFeedback(error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            // Verify driver role
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (!profile || profile.role !== 'driver') {
                await supabase.auth.signOut();
                showFeedback('This account does not have driver access.', true);
                setLoading(activeBtn, false);
                return;
            }

            window.location.href = 'bulk-orders.html';
        }
    });
});
