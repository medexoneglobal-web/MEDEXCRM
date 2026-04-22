-- =============================================================================
-- SUPABASE MIGRATION SCRIPT FOR CRM SYSTEM
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor
-- =============================================================================

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS access_rights CASCADE;
DROP TABLE IF EXISTS mandatory_fields CASCADE;
DROP TABLE IF EXISTS license_key_data CASCADE;
DROP TABLE IF EXISTS jobsheets CASCADE;

-- =============================================================================
-- 1. TABLE DEFINITIONS
-- =============================================================================

-- Contacts (CRM customer records)
CREATE TABLE contacts (
    id BIGSERIAL PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (authentication)
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access Rights (role-permission config)
CREATE TABLE access_rights (
    id BIGSERIAL PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}'
);

-- Audit Log (change history)
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    contacts_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    changed_by TEXT NOT NULL DEFAULT 'unknown',
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    old_data JSONB,
    new_data JSONB,
    changed_fields JSONB
);

-- Mandatory Fields (field configuration)
CREATE TABLE mandatory_fields (
    id BIGSERIAL PRIMARY KEY,
    fields JSONB NOT NULL DEFAULT '[]'
);

-- License Key Data
CREATE TABLE license_key_data (
    id BIGSERIAL PRIMARY KEY,
    acct_no TEXT,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobsheets
CREATE TABLE jobsheets (
    id BIGSERIAL PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 2. ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable Row Level Security on all tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_rights ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandatory_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_key_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobsheets ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for anon key (app handles auth)
CREATE POLICY "Allow all for anon" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON access_rights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON mandatory_fields FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON license_key_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON jobsheets FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. TRIGGERS
-- =============================================================================

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jobsheets_updated_at BEFORE UPDATE ON jobsheets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 4. SEED DATA
-- =============================================================================

-- Seed default admin user (password: bcrypt hash of 'admin123')
INSERT INTO users (username, password, name, role, status) 
VALUES ('admin', '$2a$10$7vVyA4BGuZVGwvFPrzWtYe.QA1PPu6XNnJWtmEnlO/Y8xNjAgklTW', 'Administrator', 'admin', 'active')
ON CONFLICT (username) DO NOTHING;

-- Seed default access rights
INSERT INTO access_rights (config) VALUES ('{
    "admin": {"crm": {"view": true, "edit": true, "delete": true}, "licenseKey": {"view": true, "edit": true, "delete": true}, "jobsheet": {"view": true, "edit": true, "delete": true}},
    "user": {"crm": {"view": true, "edit": true, "delete": false}, "licenseKey": {"view": true, "edit": true, "delete": false}, "jobsheet": {"view": true, "edit": true, "delete": false}},
    "viewer": {"crm": {"view": true, "edit": false, "delete": false}, "licenseKey": {"view": true, "edit": false, "delete": false}, "jobsheet": {"view": true, "edit": false, "delete": false}}
}');

-- Seed default mandatory fields (empty array)
INSERT INTO mandatory_fields (fields) VALUES ('[]'::jsonb);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
