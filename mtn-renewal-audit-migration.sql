-- MTN Renewal Audit Trail Table
-- Run this in Supabase SQL Editor to create the audit table

CREATE TABLE IF NOT EXISTS mtn_renewal_audit (
  id BIGSERIAL PRIMARY KEY,
  contacts_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  old_start_date TEXT,
  old_end_date TEXT,
  new_start_date TEXT,
  new_end_date TEXT,
  edited_by VARCHAR(100),
  edited_at TIMESTAMPTZ DEFAULT NOW(),
  action VARCHAR(50),
  remarks TEXT
);

-- Enable Row Level Security
ALTER TABLE mtn_renewal_audit ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read and insert
CREATE POLICY "Allow authenticated users to read audit trail" ON mtn_renewal_audit
  FOR SELECT USING (true);

CREATE POLICY "Allow authenticated users to insert audit trail" ON mtn_renewal_audit
  FOR INSERT WITH CHECK (true);

-- Create index for faster lookups by contacts_id
CREATE INDEX IF NOT EXISTS idx_mtn_renewal_audit_contacts_id ON mtn_renewal_audit(contacts_id);

-- Create index for faster lookups by edited_at
CREATE INDEX IF NOT EXISTS idx_mtn_renewal_audit_edited_at ON mtn_renewal_audit(edited_at DESC);
