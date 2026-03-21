// supabase-client.js — Shared Supabase client.
// Keys are read from .env via Vite's import.meta.env (never hardcoded).
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Compute the total for an order.
 * Prefers the stored total_amount column; falls back to summing from items JSONB.
 */
export function getOrderTotal(order) {
  if (order.total_amount != null && !isNaN(parseFloat(order.total_amount))) {
    return parseFloat(order.total_amount);
  }
  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item) => {
    const price = parseFloat(item.price || item.unit_price || 0);
    const qty = item.qty || item.quantity || 1;
    return sum + (price * qty);
  }, 0);
}
