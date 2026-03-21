# Auth System Improvements — Implementation Plan

This document outlines step-by-step improvements to the Cecilia Bakery authentication system. All existing login flows are functional — these changes harden security, improve UX, and reduce code duplication.

---

## Phase 1: Extract Shared Auth Helpers

> **Goal**: Eliminate copy-pasted code across 5 auth files. Create a single source of truth for UI helpers.

- [ ] **Create `auth-helpers.js`** — A shared module exporting:
    - `showFeedback(formEl, message, isError)` — Creates/updates the feedback banner below a form. Currently copy-pasted identically in `customer-auth.js`, `partner-auth.js`, `driver-auth.js`, `admin-auth.js`, and `staff-auth.js`.
    - `setLoading(btn, loading)` — Toggles button disabled state and text. Also duplicated across all 5 files.
    - `setupPasswordToggle(formEl)` — The password visibility toggle logic (eye icon SVG swap). Duplicated across all 5 files.
- [ ] **Refactor `customer-auth.js`** — Remove local `showFeedback`, `setLoading`, and toggle logic. Import from `auth-helpers.js`.
- [ ] **Refactor `partner-auth.js`** — Same refactor.
- [ ] **Refactor `driver-auth.js`** — Same refactor.
- [ ] **Refactor `admin-auth.js`** — Same refactor.
- [ ] **Refactor `staff-auth.js`** — Same refactor.
- [ ] **Smoke test**: Verify all 5 login pages still work (feedback + loading state + password toggle) after refactor.

---

## Phase 2: Forgot Password / Reset Flow

> **Goal**: Let users reset their password via email. Uses Supabase's built-in `resetPasswordForEmail()`.

- [ ] **Add "Forgot Password?" link to all login pages** — Place below the password field (or below the submit button). Style consistently with existing form typography. Add to:
    - `login.html`
    - `partner-login.html`
    - `driver-login.html`
    - `admin-login.html`
    - `staff-login.html`
- [ ] **Create `reset-password.html`** — A standalone page where users enter their email to request a password reset link. Uses the same premium dark-card layout and auth-theme as login pages. Contains:
    - Email input field
    - "Send Reset Link" button
    - Success/error feedback area
    - "Back to Login" link
- [ ] **Create `reset-password.js`** — Handles the form submission:
    - Call `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://your-domain.com/update-password.html' })`.
    - Show success message: "If an account exists with that email, you'll receive a reset link."
    - Use shared `showFeedback()` from `auth-helpers.js`.
- [ ] **Create `update-password.html`** — The page users land on after clicking the email link. Supabase appends a token to the URL automatically. Contains:
    - New Password input
    - Confirm Password input
    - "Update Password" button
    - Success/error feedback
- [ ] **Create `update-password.js`** — Handles the new password submission:
    - On page load: Supabase auto-detects the recovery token from the URL hash and establishes a session.
    - Listen for `PASSWORD_RECOVERY` event via `supabase.auth.onAuthStateChange()`.
    - On form submit: Call `supabase.auth.updateUser({ password: newPassword })`.
    - On success: Show confirmation, then redirect to the appropriate login page after 3 seconds.
- [ ] **Add `reset-password.html` and `update-password.html` to `vite.config.js`** — Add both as Rollup input entries so they're included in production builds.
- [ ] **Configure Supabase redirect URL** — In Supabase Dashboard → Authentication → URL Configuration, add the `update-password.html` URL to the list of allowed redirect URLs.

> 📝 **Note**: The "Forgot Password?" link text should be translatable — add `data-en` / `data-es` attributes to match the existing i18n system (`auth-i18n.js`).

---

## Phase 3: Already-Logged-In Redirect

> **Goal**: If a user is already signed in and visits a login page, redirect them to their dashboard instead of showing the login form.

- [ ] **Add session check to `customer-auth.js`** — On `DOMContentLoaded`, before showing the form:
    - Call `supabase.auth.getUser()`.
    - If a valid session exists, fetch the user's profile role.
    - If `role === 'customer'`, redirect to `index.html`.
    - Otherwise, show the form normally (they may be signing into a different account).
- [ ] **Add session check to `partner-auth.js`** — Same pattern:
    - If `role === 'partner'`, redirect to `partner-dashboard.html`.
- [ ] **Add session check to `driver-auth.js`** — Same pattern:
    - If `role === 'driver'`, redirect to `bulk-orders.html`.
- [ ] **Add session check to `admin-auth.js`** — Same pattern:
    - If `role === 'admin'`, redirect to `admin-dashboard.html`.
- [ ] **Add session check to `staff-auth.js`** — Same pattern:
    - If `role === 'staff'`, redirect to `staff-dashboard.html`.
- [ ] **UX consideration**: Show a brief "Redirecting…" message while checking session rather than a blank page. The auth form should remain hidden (via CSS or `display: none`) until we confirm no session exists.

---

## Phase 4: Password Strength Validation

> **Goal**: Give users real-time feedback on password requirements during signup.

- [ ] **Add `validatePassword(password)` to `auth-helpers.js`** — Returns an object with:
    - `isValid` (boolean)
    - `errors` (array of strings, e.g. `"At least 8 characters"`, `"At least one uppercase letter"`)
    - Rules: minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 number.
- [ ] **Add password requirements UI** to all signup forms — A small list below the password field that updates in real-time as the user types:
    - ✅ green text when requirement is met
    - ⚪ muted text when not yet met
    - Applied to: `login.html`, `partner-login.html`, `driver-login.html` (the 3 pages with signup)
- [ ] **Add client-side validation on submit** — Before calling `supabase.auth.signUp()`, validate the password. If invalid, show `showFeedback()` error and do not submit.
- [ ] **Style to match existing form design** — Use `font-family: 'Outfit'`, `0.8rem` font size, existing color tokens.

---

## Phase 5: Idle Timeout on All Dashboards

> **Goal**: Add the same 20-minute idle timeout that `admin-dashboard.js` already uses to the partner, driver, customer, and staff dashboards.

- [ ] **Create `idle-timeout.js`** — A shared module that any dashboard can import:
    - Exports `initIdleTimeout(timeoutMs)` which sets up `mousemove`, `keydown`, `scroll`, `click` listeners.
    - On timeout: Calls `supabase.auth.signOut()` and redirects to `index.html`.
    - Shows a warning toast 2 minutes before timeout: "Your session will expire in 2 minutes due to inactivity."
- [ ] **Integrate into `partner-dashboard.js`** — Import and call `initIdleTimeout(20 * 60 * 1000)`.
- [ ] **Integrate into `driver-dashboard.js`** — Same.
- [ ] **Integrate into `customer-dashboard.js`** — Same.
- [ ] **Integrate into `staff-dashboard.js`** — Same.
- [ ] **Refactor `admin-dashboard.js`** — Replace the inline idle timeout code (lines 110–126) with the shared `idle-timeout.js` import.

---

## Phase 6: Polish & Miscellaneous

> **Goal**: Remaining quality-of-life improvements.

### 6a: Customer Login Redirect Destination
- [ ] **Update `customer-auth.js`** — Change the post-login redirect from `index.html` to `customer-dashboard.html` so customers land on their personal dashboard (order history, profile, settings) rather than the public homepage.
- [ ] **Update `IMPLEMENTATION_LOGIN.md`** — Reflect the new redirect destination.

### 6b: Email Confirmation UX
- [ ] **Add `?confirmed=true` handling to login pages** — After a user confirms their email via the Supabase link, they get redirected back. Check `window.location.search` for `confirmed=true` on page load and show a success banner: "Email confirmed! You can now log in."
- [ ] **Configure Supabase email confirmation redirect** — In Supabase Dashboard → Authentication → URL Configuration, set the email confirmation redirect URL to the login page with `?confirmed=true`.

### 6c: Login Rate Limiting
- [ ] **Add rate limiting logic to `auth-helpers.js`** — Track failed login attempts in `sessionStorage`. After 5 consecutive failures:
    - Disable the submit button for 30 seconds.
    - Show a countdown message: "Too many attempts. Try again in 30s."
    - Reset the counter on successful login or page reload.

### 6d: Loading Skeleton for Dashboards
- [ ] **Add a loading spinner/skeleton to each dashboard HTML** — Replace the blank white flash (from `document.body.style.display = 'none'`) with a centered loading animation visible by default. Each dashboard JS removes/hides the spinner after auth verification completes.
- [ ] Apply to: `admin-dashboard.html`, `partner-dashboard.html`, `bulk-orders.html` (driver), `customer-dashboard.html`, `staff-dashboard.html`.

### 6e: Fix Test Credentials Doc
- [ ] **Update `PRIVATE_TEST_CREDENTIALS.local.md`** — Change `/customer-login.html` references to `/login.html` to match the actual file.

### 6f: Update `vite.config.js`
- [ ] **Add missing pages to Rollup inputs** — The following pages exist but aren't in `vite.config.js`, meaning they won't be included in production builds:
    - `staff-login.html`
    - `admin-dashboard.html`
    - `partner-dashboard.html`
    - `bulk-orders.html`
    - `customer-dashboard.html`
    - `staff-dashboard.html`
    - `reset-password.html` (new, from Phase 2)
    - `update-password.html` (new, from Phase 2)

---

## Verification Plan

### Automated (Browser-Based)
> All login and redirect flows will be verified using headless browser testing against the live dev server + Supabase instance.

- [ ] **Phase 1**: Log into each portal → verify feedback messages, loading states, and password toggle still work.
- [ ] **Phase 2**: Use "Forgot Password?" link → verify email is sent → click reset link → set new password → log in with new password.
- [ ] **Phase 3**: Sign in as customer → navigate to customer login → verify automatic redirect to homepage. Repeat for each role.
- [ ] **Phase 4**: Attempt signup with weak passwords (e.g., `123`, `password`) → verify client-side validation blocks submission. Use a strong password → verify it works.
- [ ] **Phase 5**: Log into partner dashboard → remain idle for 20+ minutes → verify session expires and user is redirected.
- [ ] **Phase 6**: Verify customer login redirects to `customer-dashboard.html`, not `index.html`. Verify `vite build` includes all pages.

### Manual (User Testing)
- [ ] **Phase 2**: After implementation, the user should manually verify that the password reset email arrives and the link works from their actual email inbox.
- [ ] **Phase 6b**: The user should confirm the Supabase email confirmation redirect URL is configured correctly in their Supabase Dashboard settings.

---

## File Summary

| File | Action | Phase |
|------|--------|-------|
| `auth-helpers.js` | **[NEW]** Shared helpers | Phase 1 |
| `reset-password.html` | **[NEW]** Reset request page | Phase 2 |
| `reset-password.js` | **[NEW]** Reset request logic | Phase 2 |
| `update-password.html` | **[NEW]** New password page | Phase 2 |
| `update-password.js` | **[NEW]** New password logic | Phase 2 |
| `idle-timeout.js` | **[NEW]** Shared idle timeout | Phase 5 |
| `customer-auth.js` | **[MODIFY]** Refactor + session check + redirect | Phases 1, 3, 6a |
| `partner-auth.js` | **[MODIFY]** Refactor + session check | Phases 1, 3 |
| `driver-auth.js` | **[MODIFY]** Refactor + session check | Phases 1, 3 |
| `admin-auth.js` | **[MODIFY]** Refactor + session check | Phases 1, 3 |
| `staff-auth.js` | **[MODIFY]** Refactor + session check | Phases 1, 3 |
| `login.html` | **[MODIFY]** Forgot password link + password strength UI | Phases 2, 4 |
| `partner-login.html` | **[MODIFY]** Forgot password link + password strength UI | Phases 2, 4 |
| `driver-login.html` | **[MODIFY]** Forgot password link + password strength UI | Phases 2, 4 |
| `admin-login.html` | **[MODIFY]** Forgot password link | Phase 2 |
| `staff-login.html` | **[MODIFY]** Forgot password link | Phase 2 |
| `admin-dashboard.js` | **[MODIFY]** Use shared idle timeout | Phase 5 |
| `partner-dashboard.js` | **[MODIFY]** Add idle timeout | Phase 5 |
| `driver-dashboard.js` | **[MODIFY]** Add idle timeout | Phase 5 |
| `customer-dashboard.js` | **[MODIFY]** Add idle timeout | Phase 5 |
| `staff-dashboard.js` | **[MODIFY]** Add idle timeout | Phase 5 |
| `admin-dashboard.html` | **[MODIFY]** Loading skeleton | Phase 6d |
| `partner-dashboard.html` | **[MODIFY]** Loading skeleton | Phase 6d |
| `bulk-orders.html` | **[MODIFY]** Loading skeleton | Phase 6d |
| `customer-dashboard.html` | **[MODIFY]** Loading skeleton | Phase 6d |
| `staff-dashboard.html` | **[MODIFY]** Loading skeleton | Phase 6d |
| `vite.config.js` | **[MODIFY]** Add missing page entries | Phase 6f |
| `PRIVATE_TEST_CREDENTIALS.local.md` | **[MODIFY]** Fix URL references | Phase 6e |
