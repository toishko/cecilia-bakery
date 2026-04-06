-- Make sure anon role can access the table
GRANT ALL ON drivers TO anon;
GRANT ALL ON drivers TO authenticated;

-- Ensure RLS is enabled
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'Allow anyone to select drivers'
    ) THEN
        CREATE POLICY "Allow anyone to select drivers" ON drivers FOR SELECT USING (true);
    END IF;
END
$$;

-- Policy for UPDATE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'Allow anyone to update drivers'
    ) THEN
        CREATE POLICY "Allow anyone to update drivers" ON drivers FOR UPDATE USING (true);
    END IF;
END
$$;

-- Policy for INSERT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'Allow anyone to insert drivers'
    ) THEN
        CREATE POLICY "Allow anyone to insert drivers" ON drivers FOR INSERT WITH CHECK (true);
    END IF;
END
$$;
