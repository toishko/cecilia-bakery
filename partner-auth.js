// partner-auth.js — Handles Login & Application for /partner-login.html
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
        document.getElementById('partnerAuthForm').after(box);
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
    const form     = document.getElementById('partnerAuthForm');
    const authCard = document.getElementById('authCard');

    const inputs = {
        businessName: form.querySelector('input[type="text"]:nth-of-type(1)'),
        contactName:  form.querySelector('input[type="text"]:nth-of-type(2)'),
        phone:        form.querySelector('input[type="tel"]'),
        email:        form.querySelector('input[type="email"]'),
        password:     form.querySelector('input[type="password"]'),
    };

    form.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const isApply    = authCard.classList.contains('is-signup');
        const email      = inputs.email?.value?.trim();
        const password   = inputs.password?.value;

        const activeBtn = form.querySelector(
            isApply ? '.btn-submit.show-on-signup' : '.btn-submit.hide-on-signup'
        );

        if (!email || !password) {
            showFeedback('Please fill in your email and password.', true);
            return;
        }

        setLoading(activeBtn, true);

        if (isApply) {
            // ── APPLY FOR WHOLESALE ACCOUNT ──────────────────
            const businessName = inputs.businessName?.value?.trim();
            const contactName  = inputs.contactName?.value?.trim();
            const phone        = inputs.phone?.value?.trim();

            if (!businessName || !contactName || !phone) {
                showFeedback('All fields are required to apply.', true);
                setLoading(activeBtn, false);
                return;
            }

            const { data, error } = await supabase.auth.signUp({ email, password });

            if (error) {
                showFeedback(error.message, true);
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
                showFeedback('Signup error. Please contact support.', true);
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
                showFeedback('Profile saved, but details failed. Please contact support.', true);
                setLoading(activeBtn, false);
                return;
            }

            showFeedback('Application submitted! We\'ll review and contact you soon.');
            setLoading(activeBtn, false);

        } else {
            // ── LOG IN ───────────────────────────────────────
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                showFeedback(error.message, true);
                setLoading(activeBtn, false);
                return;
            }

            // Verify the user actually has the partner role
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (!profile || profile.role !== 'partner') {
                await supabase.auth.signOut();
                showFeedback('This account does not have partner access.', true);
                setLoading(activeBtn, false);
                return;
            }

            window.location.href = 'partner-dashboard.html';
        }
    });
});
