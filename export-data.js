const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const outputPath = path.join(__dirname, 'supabase-data-migration.sql');

const db = new Database(dbPath);

// Field mapping from JSON keys to PostgreSQL column names
const fieldMapping = {
  'ACCT NO': 'acct_no',
  'CLINIC NAME': 'clinic_name',
  'PHONE': 'phone',
  'CMS/MHIS MTN START DATE': 'cms_mhis_mtn_start_date',
  'CMS/MHIS MTN END DATE': 'cms_mhis_mtn_end_date',
  'CLOUD START DATE': 'cloud_start_date',
  'CLOUD END DATE': 'cloud_end_date',
  'PC TOTAL': 'pc_total',
  'M1G/ DEALER CASE': 'm1g_dealer_case',
  'RENEWAL STATUS 2': 'renewal_status_2',
  'PRODUCT': 'product',
  'PRODUCT TYPE': 'product_type',
  'GROUP': 'group_name',
  'COMPANY NAME': 'company_name',
  'CO. REG & BRN': 'co_reg_brn',
  'State': 'state',
  'Contact Name': 'contact_name',
  'Contact Tel1': 'contact_tel1',
  'EMAIL ID MAIN': 'email_id_main',
  'EMAIL ID 2': 'email_id_2',
  'STATUS RENEWAL': 'status_renewal',
  'REMARKS - FOLLOW UP': 'remarks_follow_up'
};

// Helper: Escape single quotes for SQL
function escapeSql(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/'/g, "''");
}

// Helper: Convert DD/MM/YYYY to YYYY-MM-DD
function convertDate(dateStr) {
  if (!dateStr || dateStr === '' || dateStr === null || dateStr === undefined) {
    return null;
  }
  // Handle DD/MM/YYYY format
  const match = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  // If already in ISO format or other, try to parse
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return null;
}

// Helper: Format value for SQL INSERT
function formatValue(value, type = 'text') {
  if (value === null || value === undefined || value === '') {
    return 'NULL';
  }
  if (type === 'date') {
    const converted = convertDate(value);
    if (converted === null) return 'NULL';
    return `'${converted}'`;
  }
  if (type === 'json') {
    if (typeof value === 'string') {
      return `'${escapeSql(value)}'::jsonb`;
    }
    return `'${escapeSql(JSON.stringify(value))}'::jsonb`;
  }
  if (type === 'numeric') {
    const num = parseFloat(value);
    if (isNaN(num)) return 'NULL';
    return num.toString();
  }
  if (type === 'timestamp') {
    return `'${escapeSql(value)}'`;
  }
  // text
  return `'${escapeSql(value)}'`;
}

let sqlOutput = [];

// Start transaction
sqlOutput.push('-- =============================================================================');
sqlOutput.push('-- SUPABASE DATA MIGRATION SQL');
sqlOutput.push('-- Generated from SQLite crm.db');
sqlOutput.push('-- =============================================================================');
sqlOutput.push('');
sqlOutput.push('BEGIN;');
sqlOutput.push('');

// =============================================================================
// 1. USERS TABLE
// =============================================================================
console.log('Exporting users...');
const users = db.prepare('SELECT * FROM users').all();
if (users.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Users');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const user of users) {
    const id = formatValue(user.id, 'uuid');
    const username = formatValue(user.username);
    const password = formatValue(user.password); // Keep bcrypt hash as-is
    const name = formatValue(user.name);
    const role = formatValue(user.role || 'user');
    const status = formatValue(user.status || 'active');
    const created_at = formatValue(user.created_at, 'timestamp');
    const updated_at = formatValue(user.updated_at || user.created_at, 'timestamp');
    
    sqlOutput.push(`INSERT INTO users (id, username, password, name, role, status, created_at, updated_at) VALUES (uuid_generate_v4(), ${username}, ${password}, ${name}, ${role}, ${status}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');
}

// =============================================================================
// 2. CRM_DATA TABLE
// =============================================================================
console.log('Exporting crm_data...');
const crmDataRows = db.prepare('SELECT * FROM crm_data').all();
const acctNoToOldIdMap = new Map(); // Map old integer ID to acct_no for audit log reference

if (crmDataRows.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- CRM Data');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Create a temporary mapping table for old ID to acct_no');
  sqlOutput.push('CREATE TEMP TABLE temp_crm_id_mapping (old_id INTEGER PRIMARY KEY, acct_no TEXT);');
  sqlOutput.push('');
  
  for (const row of crmDataRows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      console.warn(`Failed to parse JSON for crm_data row ${row.id}:`, e.message);
      continue;
    }
    
    // Store mapping for audit log
    const acctNo = data['ACCT NO'];
    if (acctNo) {
      acctNoToOldIdMap.set(row.id, acctNo);
    }
    
    const acct_no = formatValue(data['ACCT NO']);
    const clinic_name = formatValue(data['CLINIC NAME']);
    const phone = formatValue(data['PHONE']);
    const cms_mhis_mtn_start_date = formatValue(data['CMS/MHIS MTN START DATE'], 'date');
    const cms_mhis_mtn_end_date = formatValue(data['CMS/MHIS MTN END DATE'], 'date');
    const cloud_start_date = formatValue(data['CLOUD START DATE'], 'date');
    const cloud_end_date = formatValue(data['CLOUD END DATE'], 'date');
    const pc_total = formatValue(data['PC TOTAL']);
    const m1g_dealer_case = formatValue(data['M1G/ DEALER CASE']);
    const renewal_status_2 = formatValue(data['RENEWAL STATUS 2']);
    const product = formatValue(data['PRODUCT']);
    const product_type = formatValue(data['PRODUCT TYPE']);
    const group_name = formatValue(data['GROUP']);
    const company_name = formatValue(data['COMPANY NAME']);
    const co_reg_brn = formatValue(data['CO. REG & BRN']);
    const state = formatValue(data['State']);
    const contact_name = formatValue(data['Contact Name']);
    const contact_tel1 = formatValue(data['Contact Tel1']);
    const email_id_main = formatValue(data['EMAIL ID MAIN']);
    const email_id_2 = formatValue(data['EMAIL ID 2']);
    const status_renewal = formatValue(data['STATUS RENEWAL']);
    const remarks_follow_up = formatValue(data['REMARKS - FOLLOW UP']);
    const created_at = formatValue(row.created_at, 'timestamp');
    const updated_at = formatValue(row.updated_at || row.created_at, 'timestamp');
    
    sqlOutput.push(`INSERT INTO crm_data (id, acct_no, clinic_name, phone, cms_mhis_mtn_start_date, cms_mhis_mtn_end_date, cloud_start_date, cloud_end_date, pc_total, m1g_dealer_case, renewal_status_2, product, product_type, group_name, company_name, co_reg_brn, state, contact_name, contact_tel1, email_id_main, email_id_2, status_renewal, remarks_follow_up, created_at, updated_at) VALUES (uuid_generate_v4(), ${acct_no}, ${clinic_name}, ${phone}, ${cms_mhis_mtn_start_date}, ${cms_mhis_mtn_end_date}, ${cloud_start_date}, ${cloud_end_date}, ${pc_total}, ${m1g_dealer_case}, ${renewal_status_2}, ${product}, ${product_type}, ${group_name}, ${company_name}, ${co_reg_brn}, ${state}, ${contact_name}, ${contact_tel1}, ${email_id_main}, ${email_id_2}, ${status_renewal}, ${remarks_follow_up}, ${created_at}, ${updated_at});`);
    
    // Insert into temp mapping table
    if (acctNo) {
      sqlOutput.push(`INSERT INTO temp_crm_id_mapping (old_id, acct_no) VALUES (${row.id}, ${acct_no});`);
    }
  }
  sqlOutput.push('');
}

// =============================================================================
// 3. JOBSHEETS TABLE
// =============================================================================
console.log('Exporting jobsheets...');
const jobsheets = db.prepare('SELECT * FROM jobsheets').all();
if (jobsheets.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Jobsheets');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const row of jobsheets) {
    const js_no = formatValue(row.js_no);
    const date = formatValue(row.date, 'date');
    const time_start = formatValue(row.time_start);
    const time_end = formatValue(row.time_end);
    const clinic_acct_no = formatValue(row.clinic_acct_no);
    const clinic_name = formatValue(row.clinic_name);
    const clinic_address = formatValue(row.clinic_address);
    const service_by = formatValue(row.service_by);
    const contact_person = formatValue(row.contact_person);
    const tel_no = formatValue(row.tel_no);
    const doctor_name = formatValue(row.doctor_name);
    const doctor_hp = formatValue(row.doctor_hp);
    const email = formatValue(row.email);
    const medex_program = formatValue(row.medex_program);
    const pro_db_ver = formatValue(row.pro_db_ver);
    const type_of_service = formatValue(row.type_of_service, 'json');
    const issue_detail = formatValue(row.issue_detail, 'json');
    const service_detail = formatValue(row.service_detail);
    const suggestion = formatValue(row.suggestion);
    const remark = formatValue(row.remark);
    const checklist = formatValue(row.checklist, 'json');
    const charges = formatValue(row.charges, 'numeric');
    const payment_method = formatValue(row.payment_method, 'json');
    const job_status = formatValue(row.job_status);
    const signature_by = formatValue(row.signature_by);
    const customer_rep = formatValue(row.customer_rep);
    const signed_file_path = formatValue(row.signed_file_path);
    const created_at = formatValue(row.created_at, 'timestamp');
    const updated_at = formatValue(row.updated_at || row.created_at, 'timestamp');
    
    sqlOutput.push(`INSERT INTO jobsheets (id, js_no, date, time_start, time_end, clinic_acct_no, clinic_name, clinic_address, service_by, contact_person, tel_no, doctor_name, doctor_hp, email, medex_program, pro_db_ver, type_of_service, issue_detail, service_detail, suggestion, remark, checklist, charges, payment_method, job_status, signature_by, customer_rep, signed_file_path, created_at, updated_at) VALUES (uuid_generate_v4(), ${js_no}, ${date}, ${time_start}, ${time_end}, ${clinic_acct_no}, ${clinic_name}, ${clinic_address}, ${service_by}, ${contact_person}, ${tel_no}, ${doctor_name}, ${doctor_hp}, ${email}, ${medex_program}, ${pro_db_ver}, ${type_of_service}, ${issue_detail}, ${service_detail}, ${suggestion}, ${remark}, ${checklist}, ${charges}, ${payment_method}, ${job_status}, ${signature_by}, ${customer_rep}, ${signed_file_path}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');
}

// =============================================================================
// 4. ACCESS_RIGHTS TABLE
// =============================================================================
console.log('Exporting access_rights...');
const accessRights = db.prepare('SELECT * FROM access_rights').all();
if (accessRights.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Access Rights');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const row of accessRights) {
    const config = formatValue(row.config, 'json');
    const created_at = row.created_at ? formatValue(row.created_at, 'timestamp') : 'now()';
    const updated_at = (row.updated_at || row.created_at) ? formatValue(row.updated_at || row.created_at, 'timestamp') : 'now()';
    
    sqlOutput.push(`INSERT INTO access_rights (id, config, created_at, updated_at) VALUES (uuid_generate_v4(), ${config}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');
}

// =============================================================================
// 5. MANDATORY_FIELDS TABLE
// =============================================================================
console.log('Exporting mandatory_fields...');
const mandatoryFields = db.prepare('SELECT * FROM mandatory_fields').all();
if (mandatoryFields.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Mandatory Fields');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const row of mandatoryFields) {
    const fields = formatValue(row.fields, 'json');
    const created_at = row.created_at ? formatValue(row.created_at, 'timestamp') : 'now()';
    const updated_at = (row.updated_at || row.created_at) ? formatValue(row.updated_at || row.created_at, 'timestamp') : 'now()';
    
    sqlOutput.push(`INSERT INTO mandatory_fields (id, fields, created_at, updated_at) VALUES (uuid_generate_v4(), ${fields}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');
}

// =============================================================================
// 6. LICENSE_KEY_DATA TABLE
// =============================================================================
console.log('Exporting license_key_data...');
const licenseKeyData = db.prepare('SELECT * FROM license_key_data').all();
if (licenseKeyData.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- License Key Data');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const row of licenseKeyData) {
    const acct_no = formatValue(row.acct_no);
    const field_key = formatValue(row.field_key);
    const field_value = formatValue(row.field_value);
    const created_at = formatValue(row.created_at, 'timestamp') || 'now()';
    const updated_at = formatValue(row.updated_at || row.created_at, 'timestamp') || 'now()';
    
    sqlOutput.push(`INSERT INTO license_key_data (id, acct_no, field_key, field_value, created_at, updated_at) VALUES (uuid_generate_v4(), ${acct_no}, ${field_key}, ${field_value}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');
}

// =============================================================================
// 7. CRM_AUDIT_LOG TABLE
// =============================================================================
console.log('Exporting crm_audit_log...');
let auditLogs = [];
try {
  auditLogs = db.prepare('SELECT * FROM crm_audit_log').all();
} catch (e) {
  console.log('  crm_audit_log table does not exist, skipping...');
}
if (auditLogs.length > 0) {
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- CRM Audit Log');
  sqlOutput.push('-- Uses subquery to reference crm_data by acct_no from temp mapping table');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  
  for (const row of auditLogs) {
    const action = formatValue(row.action);
    const changed_by = formatValue(row.changed_by);
    const changed_at = formatValue(row.changed_at, 'timestamp');
    const old_data = formatValue(row.old_data, 'json');
    const new_data = formatValue(row.new_data, 'json');
    const changed_fields = formatValue(row.changed_fields, 'json');
    const created_at = formatValue(row.created_at || row.changed_at, 'timestamp');
    
    // Use a subquery to get the UUID from crm_data based on the temp mapping
    sqlOutput.push(`INSERT INTO crm_audit_log (id, crm_data_id, action, changed_by, changed_at, old_data, new_data, changed_fields, created_at) VALUES (uuid_generate_v4(), (SELECT cd.id FROM crm_data cd INNER JOIN temp_crm_id_mapping tmp ON cd.acct_no = tmp.acct_no WHERE tmp.old_id = ${row.crm_data_id}), ${action}, ${changed_by}, ${changed_at}, ${old_data}, ${new_data}, ${changed_fields}, ${created_at});`);
  }
  sqlOutput.push('');
}

// Drop temp table
if (crmDataRows.length > 0) {
  sqlOutput.push('-- Drop temporary mapping table');
  sqlOutput.push('DROP TABLE temp_crm_id_mapping;');
  sqlOutput.push('');
}

// Commit transaction
sqlOutput.push('COMMIT;');
sqlOutput.push('');
sqlOutput.push('-- =============================================================================');
sqlOutput.push('-- END OF DATA MIGRATION');
sqlOutput.push('-- =============================================================================');

// Write to file
fs.writeFileSync(outputPath, sqlOutput.join('\n'), 'utf8');

console.log(`\nExport complete!`);
console.log(`Total records exported:`);
console.log(`  - Users: ${users.length}`);
console.log(`  - CRM Data: ${crmDataRows.length}`);
console.log(`  - Jobsheets: ${jobsheets.length}`);
console.log(`  - Access Rights: ${accessRights.length}`);
console.log(`  - Mandatory Fields: ${mandatoryFields.length}`);
console.log(`  - License Key Data: ${licenseKeyData.length}`);
console.log(`  - Audit Log: ${auditLogs.length}`);
console.log(`\nSQL file written to: ${outputPath}`);

db.close();
