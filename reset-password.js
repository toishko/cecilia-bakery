// reset-password.js — Sends a Supabase password-reset email
import { supabase } from './supabase-client.js';
import { showFeedback, setLoading, storeButtonText } from './auth-helpers.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    if (!form) return;

    storeButtonText(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = form.querySelector('#resetEmail');
        const email = emailInput?.value.trim();
        const btn = form.querySelector('button[type="submit"]');

        if (!email) {
            showFeedback(form, 'Please enter your email address.', true);
            return;
        }

        setLoading(btn, true, 'Sending…');

        try {
            // Build the redirect URL for the update-password page
            const origin = window.location.origin;
            const redirectTo = `${origin}/update-password.html`;

            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo,
            });

            if (error) {
                showFeedback(form, error.message, true);
            } else {
                showFeedback(
                    form,
                    'If that email exists, a reset link has been sent. Check your inbox!',
                    false
                );
                // Disable the form after success to prevent repeated submissions
                emailInput.disabled = true;
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.textContent = 'Email Sent ✓';
            }
        } catch (err) {
            showFeedback(form, 'Something went wrong. Please try again.', true);
            console.error('Reset password error:', err);
        } finally {
            // Only reset loading if the email wasn't successfully sent
            if (!btn.textContent.includes('✓')) {
                setLoading(btn, false);
            }
        }
    });
});
