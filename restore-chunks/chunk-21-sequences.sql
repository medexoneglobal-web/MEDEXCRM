BEGIN;
-- Fix audit log entries referencing non-existent contacts
UPDATE audit_log SET contacts_id = NULL WHERE contacts_id NOT IN (SELECT id FROM contacts);
-- Reset sequences so future auto-increment IDs don't conflict
SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1));
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));
SELECT setval('access_rights_id_seq', COALESCE((SELECT MAX(id) FROM access_rights), 1));
SELECT setval('mandatory_fields_id_seq', COALESCE((SELECT MAX(id) FROM mandatory_fields), 1));
SELECT setval('audit_log_id_seq', COALESCE((SELECT MAX(id) FROM audit_log), 1));
SELECT setval('license_key_data_id_seq', COALESCE((SELECT MAX(id) FROM license_key_data), 1));
SELECT setval('jobsheets_id_seq', COALESCE((SELECT MAX(id) FROM jobsheets), 1));
SELECT setval('isp_checklists_id_seq', COALESCE((SELECT MAX(id) FROM isp_checklists), 1));
COMMIT;