-- =============================================================================
-- SUPABASE SQL SCHEMA FOR CRM SYSTEM
-- =============================================================================
-- This file contains the complete PostgreSQL DDL for the CRM system.
-- Copy and paste the entire contents into the Supabase SQL Editor.
-- =============================================================================

-- =============================================================================
-- 1. EXTENSION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 2. TRIGGER FUNCTION FOR AUTO-UPDATING updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. ALL 7 TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: users
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Table: crm_data (NORMALIZED - 22 columns instead of JSON)
-- -----------------------------------------------------------------------------
CREATE TABLE crm_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  acct_no TEXT UNIQUE NOT NULL,
  clinic_name TEXT NOT NULL,
  phone TEXT,
  cms_mhis_mtn_start_date DATE,
  cms_mhis_mtn_end_date DATE,
  cloud_start_date DATE,
  cloud_end_date DATE,
  pc_total TEXT,
  m1g_dealer_case TEXT,
  renewal_status_2 TEXT,
  product TEXT,
  product_type TEXT,
  group_name TEXT,
  company_name TEXT,
  co_reg_brn TEXT,
  state TEXT,
  contact_name TEXT,
  contact_tel1 TEXT,
  email_id_main TEXT,
  email_id_2 TEXT,
  status_renewal TEXT,
  remarks_follow_up TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Table: jobsheets
-- -----------------------------------------------------------------------------
CREATE TABLE jobsheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  js_no TEXT UNIQUE NOT NULL,
  date DATE,
  time_start TIME,
  time_end TIME,
  clinic_acct_no TEXT NOT NULL REFERENCES crm_data(acct_no) ON DELETE RESTRICT,
  clinic_name TEXT,
  clinic_address TEXT,
  service_by TEXT,
  contact_person TEXT,
  tel_no TEXT,
  doctor_name TEXT,
  doctor_hp TEXT,
  email TEXT,
  medex_program TEXT,
  pro_db_ver TEXT,
  type_of_service JSONB,
  issue_detail JSONB,
  service_detail TEXT,
  suggestion TEXT,
  remark TEXT,
  checklist JSONB,
  charges NUMERIC(10,2),
  payment_method JSONB,
  job_status TEXT,
  signature_by TEXT,
  customer_rep TEXT,
  signed_file_path TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Table: access_rights
-- -----------------------------------------------------------------------------
CREATE TABLE access_rights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Table: mandatory_fields
-- -----------------------------------------------------------------------------
CREATE TABLE mandatory_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fields JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Table: license_key_data
-- -----------------------------------------------------------------------------
CREATE TABLE license_key_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  acct_no TEXT NOT NULL REFERENCES crm_data(acct_no) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_value TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(acct_no, field_key)
);

-- -----------------------------------------------------------------------------
-- Table: crm_audit_log
-- -----------------------------------------------------------------------------
CREATE TABLE crm_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crm_data_id UUID NOT NULL REFERENCES crm_data(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT now(),
  old_data JSONB,
  new_data JSONB,
  changed_fields JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- =============================================================================
-- 4. TRIGGERS (apply updated_at trigger to all tables except crm_audit_log)
-- =============================================================================

-- Trigger for users
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for crm_data
CREATE TRIGGER update_crm_data_updated_at
  BEFORE UPDATE ON crm_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for jobsheets
CREATE TRIGGER update_jobsheets_updated_at
  BEFORE UPDATE ON jobsheets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for access_rights
CREATE TRIGGER update_access_rights_updated_at
  BEFORE UPDATE ON access_rights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for mandatory_fields
CREATE TRIGGER update_mandatory_fields_updated_at
  BEFORE UPDATE ON mandatory_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for license_key_data
CREATE TRIGGER update_license_key_data_updated_at
  BEFORE UPDATE ON license_key_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. PERFORMANCE INDEXES
-- =============================================================================

-- Indexes for users
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- Indexes for crm_data
CREATE INDEX idx_crm_data_acct_no ON crm_data(acct_no);
CREATE INDEX idx_crm_data_clinic_name ON crm_data(clinic_name);
CREATE INDEX idx_crm_data_company_name ON crm_data(company_name);
CREATE INDEX idx_crm_data_state ON crm_data(state);
CREATE INDEX idx_crm_data_status_renewal ON crm_data(status_renewal);
CREATE INDEX idx_crm_data_product ON crm_data(product);
CREATE INDEX idx_crm_data_status_renewal_cloud_end_date ON crm_data(status_renewal, cloud_end_date);

-- Indexes for jobsheets
CREATE INDEX idx_jobsheets_js_no ON jobsheets(js_no);
CREATE INDEX idx_jobsheets_clinic_acct_no ON jobsheets(clinic_acct_no);
CREATE INDEX idx_jobsheets_date ON jobsheets(date);
CREATE INDEX idx_jobsheets_job_status ON jobsheets(job_status);
CREATE INDEX idx_jobsheets_service_by ON jobsheets(service_by);
CREATE INDEX idx_jobsheets_clinic_acct_no_date ON jobsheets(clinic_acct_no, date);

-- Indexes for license_key_data
CREATE INDEX idx_license_key_data_acct_no ON license_key_data(acct_no);
CREATE INDEX idx_license_key_data_acct_no_field_key ON license_key_data(acct_no, field_key);

-- Indexes for crm_audit_log
CREATE INDEX idx_crm_audit_log_crm_data_id ON crm_audit_log(crm_data_id);
CREATE INDEX idx_crm_audit_log_changed_at ON crm_audit_log(changed_at);
CREATE INDEX idx_crm_audit_log_action ON crm_audit_log(action);
CREATE INDEX idx_crm_audit_log_changed_by ON crm_audit_log(changed_by);
CREATE INDEX idx_crm_audit_log_crm_data_id_changed_at ON crm_audit_log(crm_data_id, changed_at);

-- =============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on all 7 tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobsheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_rights ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandatory_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_key_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_audit_log ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- RLS Policies for crm_data
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated users can SELECT
CREATE POLICY crm_data_select_policy ON crm_data
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: admin and user roles can INSERT
CREATE POLICY crm_data_insert_policy ON crm_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- UPDATE: admin and user roles can UPDATE
CREATE POLICY crm_data_update_policy ON crm_data
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- DELETE: Only admin can DELETE
CREATE POLICY crm_data_delete_policy ON crm_data
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for jobsheets
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated users can SELECT
CREATE POLICY jobsheets_select_policy ON jobsheets
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: admin and user roles can INSERT
CREATE POLICY jobsheets_insert_policy ON jobsheets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- UPDATE: admin and user roles can UPDATE
CREATE POLICY jobsheets_update_policy ON jobsheets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- DELETE: Only admin can DELETE
CREATE POLICY jobsheets_delete_policy ON jobsheets
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for license_key_data
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated users can SELECT
CREATE POLICY license_key_data_select_policy ON license_key_data
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: admin and user roles can INSERT
CREATE POLICY license_key_data_insert_policy ON license_key_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- UPDATE: admin and user roles can UPDATE
CREATE POLICY license_key_data_update_policy ON license_key_data
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'user'))
  );

-- DELETE: Only admin can DELETE
CREATE POLICY license_key_data_delete_policy ON license_key_data
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for users
-- -----------------------------------------------------------------------------

-- SELECT: Users can read all profiles (needed for admin to manage users)
CREATE POLICY users_select_policy ON users
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only admin can INSERT
CREATE POLICY users_insert_policy ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- UPDATE: Only admin can UPDATE
CREATE POLICY users_update_policy ON users
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- DELETE: Only admin can DELETE
CREATE POLICY users_delete_policy ON users
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for access_rights
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated can SELECT
CREATE POLICY access_rights_select_policy ON access_rights
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only admin can INSERT
CREATE POLICY access_rights_insert_policy ON access_rights
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- UPDATE: Only admin can UPDATE
CREATE POLICY access_rights_update_policy ON access_rights
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- DELETE: Only admin can DELETE
CREATE POLICY access_rights_delete_policy ON access_rights
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for mandatory_fields
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated can SELECT
CREATE POLICY mandatory_fields_select_policy ON mandatory_fields
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only admin can INSERT
CREATE POLICY mandatory_fields_insert_policy ON mandatory_fields
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- UPDATE: Only admin can UPDATE
CREATE POLICY mandatory_fields_update_policy ON mandatory_fields
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- DELETE: Only admin can DELETE
CREATE POLICY mandatory_fields_delete_policy ON mandatory_fields
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies for crm_audit_log
-- -----------------------------------------------------------------------------

-- SELECT: All authenticated can SELECT
CREATE POLICY crm_audit_log_select_policy ON crm_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: INSERT allowed for authenticated users (needed for audit logging from frontend)
CREATE POLICY crm_audit_log_insert_policy ON crm_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No UPDATE or DELETE policies (immutable)

-- =============================================================================
-- 7. DEFAULT DATA INSERTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Default admin user
-- Password: admin123 (bcrypt hashed)
-- -----------------------------------------------------------------------------
INSERT INTO users (username, password, name, role, status)
VALUES (
  'admin',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS8og.9QSLK1m',
  'Administrator',
  'admin',
  'active'
);

-- -----------------------------------------------------------------------------
-- Default access_rights config
-- -----------------------------------------------------------------------------
INSERT INTO access_rights (config)
VALUES (
  '{"crm":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"licenseKey":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}},"jobsheet":{"admin":{"view":true,"edit":true,"delete":true},"user":{"view":true,"edit":true,"delete":false},"viewer":{"view":true,"edit":false,"delete":false}}}'::jsonb
);

-- -----------------------------------------------------------------------------
-- Default mandatory_fields (empty array)
-- -----------------------------------------------------------------------------
INSERT INTO mandatory_fields (fields)
VALUES ('[]'::jsonb);

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
