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
-- END OF MIGRATION
-- =============================================================================
