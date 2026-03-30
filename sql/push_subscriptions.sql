-- Push Subscriptions table for Web Push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_type text NOT NULL CHECK (user_type IN ('admin', 'driver', 'customer')),
  user_id text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_type, user_id, endpoint)
);

-- Enable Row Level Security
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop the old wide-open policy if it exists
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON push_subscriptions;

-- Authenticated users can only manage their own subscriptions
CREATE POLICY "Authenticated users manage own subs"
  ON push_subscriptions FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Service role (used by Edge Functions) has full access (implicit, bypasses RLS)
-- No additional policy needed for service_role

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_type, user_id);
