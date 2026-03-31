// Vercel Serverless Function — updates a user's role in the profiles table
// Uses the Supabase service role key to bypass RLS + the guard_profile_role trigger
// Only allows requests from verified admins.

import { createClient } from '@supabase/supabase-js';

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

// ── In-memory rate limiter ──
const rateMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

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

// Valid roles that can be assigned
const VALID_ROLES = ['admin', 'staff', 'customer'];

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

  // Rate limit
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, message: 'Too many requests' });
  }

  // Validate env
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dykztphptnytbihpavpa.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  // Parse body
  const { clerk_user_id, role, admin_clerk_user_id } = req.body || {};

  if (!clerk_user_id || typeof clerk_user_id !== 'string') {
    return res.status(400).json({ success: false, message: 'clerk_user_id is required' });
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (!admin_clerk_user_id || typeof admin_clerk_user_id !== 'string') {
    return res.status(400).json({ success: false, message: 'admin_clerk_user_id is required' });
  }

  // Prevent self-demotion by admins
  if (clerk_user_id === admin_clerk_user_id && role !== 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot change your own role' });
  }

  try {
    // Create service-role client (bypasses RLS)
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Step 1: Verify the requesting user is an admin ──
    const { data: adminProfile, error: adminErr } = await sbAdmin
      .from('profiles')
      .select('role')
      .eq('clerk_user_id', admin_clerk_user_id)
      .maybeSingle();

    if (adminErr) {
      console.error('Admin lookup error:', adminErr);
      return res.status(500).json({ success: false, message: 'Server error verifying admin' });
    }

    if (!adminProfile || adminProfile.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can change user roles' });
    }

    // ── Step 2: Update the target user's role ──
    const { data: updated, error: updateErr } = await sbAdmin
      .from('profiles')
      .update({ role })
      .eq('clerk_user_id', clerk_user_id)
      .select('id, clerk_user_id, email, role')
      .maybeSingle();

    if (updateErr) {
      console.error('Role update error:', updateErr);
      return res.status(500).json({ success: false, message: 'Failed to update role' });
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Role updated to "${role}"`,
      profile: {
        id: updated.id,
        clerk_user_id: updated.clerk_user_id,
        email: updated.email,
        role: updated.role,
      },
    });
  } catch (err) {
    console.error('update-staff-role error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
