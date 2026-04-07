// Vercel Serverless Function — handles wholesale partner applications
// Replaces the direct client-side Supabase insert with server-side validation,
// honeypot detection, time-based bot check, IP logging, and rate limiting.

import { createClient } from '@supabase/supabase-js';

// ── In-memory rate limiter ──
const rateMap = new Map();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 3; // max 3 applications per IP per minute (generous for humans, tight for bots)

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

// ── Allowed origins ──
const ALLOWED_ORIGINS = [
  'ceciliabakery.com',
  'www.ceciliabakery.com',
  'localhost',
  '127.0.0.1',
  '.vercel.app',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));
}

// ── Minimum time (ms) a human would need to fill out the form ──
const MIN_FILL_TIME_MS = 3000; // 3 seconds

// ── Valid business types ──
const VALID_BUSINESS_TYPES = [
  'supermarket', 'restaurant', 'grocery_store',
  'events_catering', 'coffee_shop', 'other',
];

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Origin check
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  if (!isOriginAllowed(origin)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  // Extract client IP
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';

  // Rate limit
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please wait and try again.' });
  }

  // Validate env
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dykztphptnytbihpavpa.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  // Parse body
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid request.' });
  }

  // ═══════════════════════════════════════
  // BOT DETECTION
  // ═══════════════════════════════════════

  // 1. Honeypot — if the hidden "website" field has any value, it's a bot
  if (body.website && String(body.website).trim().length > 0) {
    // Return fake success so the bot thinks it worked
    console.log(`[BOT BLOCKED] Honeypot triggered from IP: ${clientIp}`);
    return res.status(200).json({ success: true, message: 'Application received.' });
  }

  // 2. Time check — if form was submitted too fast, it's a bot
  const loadedAt = body._t;
  if (loadedAt && typeof loadedAt === 'number') {
    const elapsed = Date.now() - loadedAt;
    if (elapsed < MIN_FILL_TIME_MS) {
      console.log(`[BOT BLOCKED] Time check failed (${elapsed}ms) from IP: ${clientIp}`);
      return res.status(200).json({ success: true, message: 'Application received.' });
    }
  }

  // ═══════════════════════════════════════
  // FIELD VALIDATION
  // ═══════════════════════════════════════

  const {
    business_name, contact_name, email, phone,
    address, city, state, zip, business_type,
    heard, notes,
  } = body;

  // Required string fields
  const requiredFields = [
    { key: 'business_name', val: business_name, label: 'Business name' },
    { key: 'contact_name', val: contact_name, label: 'Contact name' },
    { key: 'email', val: email, label: 'Email' },
    { key: 'phone', val: phone, label: 'Phone' },
    { key: 'address', val: address, label: 'Address' },
    { key: 'city', val: city, label: 'City' },
    { key: 'state', val: state, label: 'State' },
    { key: 'zip', val: zip, label: 'ZIP' },
    { key: 'business_type', val: business_type, label: 'Business type' },
  ];

  for (const f of requiredFields) {
    if (!f.val || typeof f.val !== 'string' || f.val.trim().length === 0) {
      return res.status(400).json({ success: false, message: `${f.label} is required.` });
    }
  }

  // Email format
  const emailClean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    return res.status(400).json({ success: false, message: 'Valid email is required.' });
  }

  // Business type must be from allowed list
  if (!VALID_BUSINESS_TYPES.includes(business_type.trim())) {
    return res.status(400).json({ success: false, message: 'Invalid business type.' });
  }

  // ═══════════════════════════════════════
  // SUPABASE INSERT
  // ═══════════════════════════════════════

  try {
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Duplicate email check ──
    const { data: existing, error: lookupErr } = await sbAdmin
      .from('wholesale_accounts')
      .select('status')
      .ilike('email', emailClean)
      .maybeSingle();

    if (lookupErr) {
      console.error('Wholesale lookup error:', lookupErr);
    }

    if (existing) {
      // Return status-specific messages (same logic as before, but server-side)
      const status = existing.status;
      if (status === 'pending') {
        return res.status(200).json({
          success: false,
          duplicate: true,
          status: 'pending',
          message: 'We already have your application on file. We\'ll be in touch soon!',
        });
      } else if (status === 'approved') {
        return res.status(200).json({
          success: false,
          duplicate: true,
          status: 'approved',
          message: 'You\'re already approved! Sign in to access the wholesale portal.',
        });
      } else if (status === 'rejected') {
        return res.status(200).json({
          success: false,
          duplicate: true,
          status: 'rejected',
          message: 'We\'re unable to approve your application at this time. Please contact us directly.',
        });
      } else {
        return res.status(200).json({
          success: false,
          duplicate: true,
          status: status,
          message: 'We already have your application on file.',
        });
      }
    }

    // ── Build notes field ──
    const heardClean = heard ? String(heard).trim().slice(0, 500) : '';
    const notesClean = notes ? String(notes).trim().slice(0, 2000) : '';
    let notesParts = [];
    if (heardClean) notesParts.push('How they heard about us: ' + heardClean);
    if (notesClean) notesParts.push(notesClean);

    // ── Insert ──
    const payload = {
      business_name: business_name.trim().slice(0, 200),
      contact_name: contact_name.trim().slice(0, 200),
      email: emailClean,
      phone: phone.trim().slice(0, 30),
      address: address.trim().slice(0, 300),
      city: city.trim().slice(0, 100),
      state: state.trim().slice(0, 50),
      zip: zip.trim().slice(0, 20),
      business_type: business_type.trim(),
      notes: notesParts.join('\n\n') || null,
      status: 'pending',
      ip_address: clientIp,
    };

    const { error: insertErr } = await sbAdmin
      .from('wholesale_accounts')
      .insert(payload);

    if (insertErr) {
      console.error('Wholesale insert error:', insertErr);
      return res.status(500).json({
        success: false,
        message: 'There was an error submitting your application. Please try again.',
      });
    }

    console.log(`[WHOLESALE] New application from "${payload.business_name}" (${emailClean}) IP: ${clientIp}`);

    return res.status(200).json({
      success: true,
      message: 'Application received.',
    });

  } catch (err) {
    console.error('wholesale-apply error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
}
