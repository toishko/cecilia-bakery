-- Notification Log for idempotency
-- Prevents the Edge Function from sending duplicate push notifications
-- if it gets invoked twice for the same order event
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id text NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Unique constraint to prevent duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_unique
  ON notification_log(order_id, event_type);

-- Auto-cleanup: delete old entries after 24 hours (optional cron job)
-- For now, the Edge Function checks entries within the last 60 seconds only

-- RLS: allow service role full access
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON notification_log FOR ALL
  USING (true)
  WITH CHECK (true);
