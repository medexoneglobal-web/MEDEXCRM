const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'crm.db');
const outputPath = path.join(__dirname, 'restore-supabase-data.sql');

const db = new sqlite3.Database(dbPath);

function escapeSql(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/'/g, "''");
}

function formatJson(value) {
  if (value === null || value === undefined) return "'{}'::jsonb";
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${escapeSql(json)}'::jsonb`;
}

function formatText(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${escapeSql(value)}'`;
}

function queryAll(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function queryGet(sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function main() {
  let sqlOutput = [];
  sqlOutput.push('-- =============================================================================');
  sqlOutput.push('-- DATA RESTORATION SQL - Generated from crm.db');
  sqlOutput.push('-- Run this in Supabase Dashboard > SQL Editor AFTER running supabase-migration.sql');
  sqlOutput.push('-- =============================================================================');
  sqlOutput.push('');
  sqlOutput.push('BEGIN;');
  sqlOutput.push('');

  // 1. USERS
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Users');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  const users = await queryAll('SELECT * FROM users');
  for (const user of users) {
    const username = formatText(user.username);
    const password = formatText(user.password);
    const name = formatText(user.name || '');
    const email = formatText(user.email || '');
    const phone = formatText(user.phone || '');
    const role = formatText(user.role || 'user');
    const status = formatText(user.status || 'active');
    const created_at = formatText(user.created_at);
    sqlOutput.push(`INSERT INTO users (username, password, name, email, phone, role, status, created_at) VALUES (${username}, ${password}, ${name}, ${email}, ${phone}, ${role}, ${status}, ${created_at});`);
  }
  sqlOutput.push('');

  // 2. ACCESS RIGHTS
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Access Rights');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  const rights = await queryAll('SELECT * FROM access_rights');
  for (const row of rights) {
    const config = formatJson(row.config);
    const created_at = formatText(row.created_at || new Date().toISOString());
    sqlOutput.push(`INSERT INTO access_rights (config, created_at) VALUES (${config}, ${created_at});`);
  }
  sqlOutput.push('');

  // 3. MANDATORY FIELDS
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Mandatory Fields');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  try {
    const fields = await queryAll('SELECT * FROM mandatory_fields');
    for (const row of fields) {
      const f = formatJson(row.fields);
      const created_at = formatText(row.created_at || new Date().toISOString());
      sqlOutput.push(`INSERT INTO mandatory_fields (fields, created_at) VALUES (${f}, ${created_at});`);
    }
  } catch (e) {
    sqlOutput.push('-- No mandatory_fields table found, skipping');
  }
  sqlOutput.push('');

  // 4. CONTACTS (CRM Data)
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Contacts (CRM Data)');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  const crmData = await queryAll('SELECT * FROM crm_data');
  for (const row of crmData) {
    const data = formatJson(row.data);
    const created_at = formatText(row.created_at);
    const updated_at = formatText(row.updated_at || row.created_at);
    sqlOutput.push(`INSERT INTO contacts (id, data, created_at, updated_at) VALUES (${row.id}, ${data}, ${created_at}, ${updated_at});`);
  }
  sqlOutput.push('');

  // 5. AUDIT LOG
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Audit Log');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  try {
    const auditLogs = await queryAll('SELECT * FROM crm_audit_log');
    for (const row of auditLogs) {
      const contacts_id = row.crm_data_id || 'NULL';
      const action = formatText(row.action);
      const changed_by = formatText(row.changed_by);
      const changed_at = formatText(row.changed_at);
      const old_data = formatJson(row.old_data);
      const new_data = formatJson(row.new_data);
      const changed_fields = formatJson(row.changed_fields);
      const created_at = formatText(row.changed_at || row.created_at);
      sqlOutput.push(`INSERT INTO audit_log (contacts_id, action, changed_by, changed_at, old_data, new_data, changed_fields, created_at) VALUES (${contacts_id}, ${action}, ${changed_by}, ${changed_at}, ${old_data}, ${new_data}, ${changed_fields}, ${created_at});`);
    }
  } catch (e) {
    sqlOutput.push('-- No crm_audit_log table found, skipping');
  }
  sqlOutput.push('');

  // 6. JOBSHEETS
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- Jobsheets');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  try {
    const jobsheets = await queryAll('SELECT * FROM jobsheets');
    for (const row of jobsheets) {
      const data = {};
      const fields = ['js_no','date','time_start','time_end','clinic_acct_no','clinic_name','clinic_address','service_by','contact_person','tel_no','doctor_name','doctor_hp','email','medex_program','pro_db_ver','type_of_service','issue_detail','service_detail','suggestion','remark','checklist','charges','payment_method','job_status','signature_by','customer_rep','signed_file_path'];
      fields.forEach(f => { if (row[f] !== undefined && row[f] !== null) data[f] = row[f]; });
      const json = formatJson(data);
      const created_at = formatText(row.created_at);
      const updated_at = formatText(row.updated_at || row.created_at);
      sqlOutput.push(`INSERT INTO jobsheets (data, created_at, updated_at) VALUES (${json}, ${created_at}, ${updated_at});`);
    }
  } catch (e) {
    sqlOutput.push('-- No jobsheets table found, skipping');
  }
  sqlOutput.push('');

  // 7. LICENSE KEY DATA
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  sqlOutput.push('-- License Key Data');
  sqlOutput.push('-- -----------------------------------------------------------------------------');
  try {
    const licenseKeys = await queryAll('SELECT * FROM license_key_data');
    for (const row of licenseKeys) {
      const data = {};
      if (row.acct_no) data.acct_no = row.acct_no;
      if (row.field_key) data.field_key = row.field_key;
      if (row.field_value) data.field_value = row.field_value;
      const json = formatJson(data);
      const created_at = formatText(row.created_at || new Date().toISOString());
      sqlOutput.push(`INSERT INTO license_key_data (data, created_at) VALUES (${json}, ${created_at});`);
    }
  } catch (e) {
    sqlOutput.push('-- No license_key_data table found, skipping');
  }
  sqlOutput.push('');

  sqlOutput.push('COMMIT;');
  sqlOutput.push('');
  sqlOutput.push('-- =============================================================================');
  sqlOutput.push('-- END OF RESTORATION');
  sqlOutput.push('-- =============================================================================');

  fs.writeFileSync(outputPath, sqlOutput.join('\n'), 'utf8');

  const jobsheetCount = await queryGet('SELECT COUNT(*) as c FROM jobsheets').catch(() => ({c: 0}));
  const licenseCount = await queryGet('SELECT COUNT(*) as c FROM license_key_data').catch(() => ({c: 0}));

  console.log(`\nRestoration SQL generated!`);
  console.log(`Total records:`);
  console.log(`  - Users: ${users.length}`);
  console.log(`  - Access Rights: ${rights.length}`);
  console.log(`  - Contacts (CRM): ${crmData.length}`);
  console.log(`  - Jobsheets: ${jobsheetCount.c}`);
  console.log(`  - License Keys: ${licenseCount.c}`);
  console.log(`\nSQL file written to: ${outputPath}`);

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  db.close();
  process.exit(1);
});
