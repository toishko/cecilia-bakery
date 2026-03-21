// update-password.js — Handles the password update after clicking the reset link
import { supabase } from './supabase-client.js';
import { showFeedback, setLoading, setupPasswordToggle, storeButtonText } from './auth-helpers.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('updatePasswordForm');
    const expiredEl = document.getElementById('linkExpired');
    if (!form) return;

    // Hide form until we verify a valid recovery session
    form.style.display = 'none';

    let recoveryDetected = false;

    // Listen for the PASSWORD_RECOVERY event from the token in the URL
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            recoveryDetected = true;
            form.style.display = '';             // Show form
            if (expiredEl) expiredEl.style.display = 'none';
        }
    });

    // If no recovery event fires within 3s, show expired/invalid message
    setTimeout(() => {
        if (!recoveryDetected) {
            form.style.display = 'none';
            if (expiredEl) expiredEl.style.display = '';
        }
    }, 3000);

    // Set up password toggle for the new password field
    setupPasswordToggle(form);
    storeButtonText(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPw   = document.getElementById('newPassword')?.value;
        const confPw  = document.getElementById('confirmPassword')?.value;
        const btn     = form.querySelector('button[type="submit"]');

        // Validate passwords match
        if (newPw !== confPw) {
            showFeedback(form, 'Passwords do not match.', true);
            return;
        }

        // Validate password length
        if (newPw.length < 6) {
            showFeedback(form, 'Password must be at least 6 characters.', true);
            return;
        }

        setLoading(btn, true, 'Updating…');

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPw,
            });

            if (error) {
                showFeedback(form, error.message, true);
                setLoading(btn, false);
            } else {
                showFeedback(
                    form,
                    'Password updated successfully! Redirecting to login…',
                    false
                );
                // Disable form to prevent repeated submissions
                document.getElementById('newPassword').disabled = true;
                document.getElementById('confirmPassword').disabled = true;
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.textContent = 'Updated ✓';

                // Clean up auth listener
                subscription.unsubscribe();

                // Redirect to login after a short delay
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2500);
            }
        } catch (err) {
            showFeedback(form, 'Something went wrong. Please try again.', true);
            setLoading(btn, false);
            console.error('Update password error:', err);
        }
    });
});
