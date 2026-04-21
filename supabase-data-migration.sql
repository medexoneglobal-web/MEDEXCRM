-- =============================================================================
-- SUPABASE DATA MIGRATION SQL
-- Generated from SQLite crm.db
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
INSERT INTO users (id, username, password, name, role, status, created_at, updated_at) VALUES (uuid_generate_v4(), 'admin', '$2a$10$dF4wYSr9Ac0LlMMPEBOuFeRsuEOJ2O9SnPBuNj.As8qpnS/eUXHoy', 'Administrator', 'admin', 'active', '2026-04-10 07:15:05', '2026-04-10 07:15:05');

-- -----------------------------------------------------------------------------
-- Access Rights
-- -----------------------------------------------------------------------------
INSERT INTO access_rights (id, config, created_at, updated_at) VALUES (uuid_generate_v4(), '{"crm":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"licenseKey":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"jobsheet":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}}}'::jsonb, now(), now());

-- -----------------------------------------------------------------------------
-- Mandatory Fields
-- -----------------------------------------------------------------------------
INSERT INTO mandatory_fields (id, fields, created_at, updated_at) VALUES (uuid_generate_v4(), '[]'::jsonb, now(), now());

COMMIT;

-- =============================================================================
-- END OF DATA MIGRATION
-- =============================================================================