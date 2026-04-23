-- =============================================================================
-- ADD PROFILE COLUMNS TO USERS TABLE
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor
-- =============================================================================

-- Add profile columns if they don't already exist
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- =============================================================================
-- RLS POLICY UPDATE (only needed if Row Level Security is enabled)
-- =============================================================================
-- The default schema only allows admin to UPDATE users.
-- If you want non-admin users to update their own profile,
-- run the policy update below.
-- =============================================================================

-- Drop the old UPDATE policy if it exists (admin-only)
DROP POLICY IF EXISTS users_update_policy ON users;
DROP POLICY IF EXISTS users_update_self_policy ON users;

-- Create new UPDATE policy: admin can update any user, users can update themselves
CREATE POLICY users_update_policy ON users
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR id = auth.uid()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR id = auth.uid()
  );

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
