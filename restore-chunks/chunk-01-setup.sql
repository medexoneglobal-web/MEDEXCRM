BEGIN;
-- Users
-- -----------------------------------------------------------------------------
INSERT INTO users (username, password, name, email, phone, role, status, created_at) VALUES ('admin', '$2a$10$dF4wYSr9Ac0LlMMPEBOuFeRsuEOJ2O9SnPBuNj.As8qpnS/eUXHoy', 'Administrator', '', '', 'admin', 'active', '2026-04-10 07:15:05') ON CONFLICT DO NOTHING;
-- -----------------------------------------------------------------------------
-- Access Rights
-- -----------------------------------------------------------------------------
INSERT INTO access_rights (config) VALUES ('{"crm":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"licenseKey":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"jobsheet":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}}}'::jsonb) ON CONFLICT DO NOTHING;
-- -----------------------------------------------------------------------------
-- Mandatory Fields
-- -----------------------------------------------------------------------------
INSERT INTO mandatory_fields (fields) VALUES ('[]'::jsonb) ON CONFLICT DO NOTHING;
-- -----------------------------------------------------------------------------
COMMIT;