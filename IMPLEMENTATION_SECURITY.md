# Security Hardening — Future TODO

> Current status: ✅ Core security is solid (RLS, role guard trigger, rate limits, password rules).
> These are extra hardening layers to add when time allows.

---

## 1. CSP Security Headers
**Priority:** High | **Effort:** 5 min | **Cost:** Free

Create `vercel.json` with Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy headers. Blocks XSS and clickjacking.

**Steps:**
- [ ] Create `vercel.json` with security headers
- [ ] Deploy and verify at [securityheaders.com](https://securityheaders.com)

---

## 2. CAPTCHA (Cloudflare Turnstile)
**Priority:** High | **Effort:** 30 min | **Cost:** Free

Add invisible CAPTCHA to all 5 login/signup forms to stop bots.

**Steps:**
- [ ] Create free Cloudflare account → [dash.cloudflare.com/turnstile](https://dash.cloudflare.com/sign-up?redirect_uri=https://dash.cloudflare.com/turnstile)
- [ ] Get Site Key (public) + Secret Key (private)
- [ ] Paste Secret Key in Supabase → Auth → Attack Protection → Enable Turnstile
- [ ] Add Turnstile script + widget to: `login.html`, `admin-login.html`, `staff-login.html`, `partner-login.html`, `driver-login.html`
- [ ] Pass `captchaToken` in each auth JS file's `signInWithPassword` / `signUp` calls
- [ ] Test all login flows

---

## 3. MFA on Supabase Dashboard
**Priority:** High | **Effort:** 5 min | **Cost:** Free

The Supabase dashboard (`toishkosmf@gmail.com`) is the master key to ALL data. Enable 2FA:

**Steps:**
- [ ] Enable MFA on the Gmail account (Google → Security → 2FA)
- [ ] Enable MFA on Supabase account (Account Settings → Security)

---

## 4. Database Backups
**Priority:** Medium | **Effort:** Varies | **Cost:** $25/mo (Pro plan)

Free tier = daily backups, no point-in-time recovery. Pro plan adds PITR.

**Steps:**
- [ ] Upgrade to Supabase Pro when budget allows
- [ ] Until then, periodically export critical tables from Supabase Dashboard → Table Editor → Export CSV

---

## 5. Content Security Policy (CSP) Details
When implementing `vercel.json`, use these headers:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

---

## What's Already Protected ✅
- RLS on all tables (profiles, orders, driver_orders, driver_route_clients)
- `guard_profile_role` trigger prevents role escalation
- `is_staff()` / `is_admin()` helper functions for access control
- Client-side rate limiting (5 attempts → 30s lockout)
- Server-side rate limiting (15/5min sign-ins, 60/h emails)
- Password strength validation (8+ chars, mixed case, numbers)
- Idle session timeout
- Email confirmation on signup
- Expired reset link handling
- SPF + DKIM DNS records
- HTTPS via Vercel
- `.env` gitignored, no service_role key exposed
