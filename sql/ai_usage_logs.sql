-- ══════════════════════════════════════════════════════════════════
-- AI Usage & Waste Tracking Table
-- Tracks exact tokens, estimated dollar cost, model, latency,
-- and classifies wasted AI spend across Ticket Scanner & Voice Order.
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature TEXT NOT NULL,                     -- 'ticket_scanner' | 'voice_order'
  caller_role TEXT DEFAULT 'admin',          -- 'admin' | 'driver' | 'shortcut' | 'anonymous'
  caller_identifier TEXT,                    -- Admin email, driver name/code, or client IP
  provider TEXT NOT NULL,                    -- 'openai' | 'google_gemini'
  model TEXT NOT NULL,                       -- e.g. 'gpt-4o-2024-11-20', 'gemini-2.0-flash', 'gpt-4o-mini'
  call_type TEXT NOT NULL,                   -- 'parallel_slice', 'single_pass', 'fallback_cascade', 'voice_audio', 'voice_text'
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 6) DEFAULT 0.000000, -- e.g. 0.012540 ($0.0125)
  execution_ms INTEGER DEFAULT 0,            -- API duration in ms
  status TEXT NOT NULL,                      -- 'success' | 'zero_items' | 'api_error' | 'fallback_triggered' | 'rate_limited'
  is_waste BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE if call generated no value (empty results, failed fallback, errors)
  waste_reason TEXT,                         -- 'zero_items_extracted', 'fallback_redundancy', 'api_error', 'unrecognized_speech'
  metadata JSONB DEFAULT '{}'::jsonb         -- Extra context (e.g. items_count, total_boxes, image_res, error_msg)
);

-- Indexes for lightning-fast dashboard queries & analytics
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON public.ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_is_waste ON public.ai_usage_logs (is_waste);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON public.ai_usage_logs (feature);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON public.ai_usage_logs (model);

-- Enable RLS
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- 1. Anyone (Service Role / API backend / Anon backend) can insert logs
DROP POLICY IF EXISTS "Allow backend insert ai_usage_logs" ON public.ai_usage_logs;
CREATE POLICY "Allow backend insert ai_usage_logs"
  ON public.ai_usage_logs
  FOR INSERT
  WITH CHECK (true);

-- 2. Authenticated users / Admins can view AI usage logs
DROP POLICY IF EXISTS "Allow select ai_usage_logs" ON public.ai_usage_logs;
CREATE POLICY "Allow select ai_usage_logs"
  ON public.ai_usage_logs
  FOR SELECT
  USING (true);

-- 3. Enable Realtime broadcast so the Admin Dashboard updates live
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_usage_logs;

