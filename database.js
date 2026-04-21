const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'crm.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobsheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    js_no TEXT UNIQUE NOT NULL,
    date TEXT,
    time_start TEXT,
    time_end TEXT,
    clinic_acct_no TEXT,
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
    type_of_service JSON,
    issue_detail JSON,
    service_detail TEXT,
    suggestion TEXT,
    remark TEXT,
    checklist JSON,
    charges REAL,
    payment_method JSON,
    job_status TEXT,
    signature_by TEXT,
    customer_rep TEXT,
    signed_file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS access_rights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config JSON NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mandatory_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fields JSON NOT NULL
  );

  CREATE TABLE IF NOT EXISTS license_key_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acct_no TEXT,
    field_key TEXT,
    field_value TEXT,
    UNIQUE(acct_no, field_key)
  );

  CREATE TABLE IF NOT EXISTS crm_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crm_data_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    old_data JSON,
    new_data JSON,
    changed_fields JSON
  );
`);

// Insert default admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, name, role, status) VALUES (?, ?, ?, ?, ?)').run('admin', hashedPassword, 'Administrator', 'admin', 'active');
}

// Insert default access rights if not exists
const rightsExist = db.prepare('SELECT id FROM access_rights LIMIT 1').get();
if (!rightsExist) {
  const defaultRights = {
    crm: { admin: { view: true, edit: true, delete: true }, user: { view: true, edit: true, delete: false }, viewer: { view: true, edit: false, delete: false } },
    licenseKey: { admin: { view: true, edit: true, delete: true }, user: { view: true, edit: true, delete: false }, viewer: { view: true, edit: false, delete: false } },
    jobsheet: { admin: { view: true, edit: true, delete: true }, user: { view: true, edit: true, delete: false }, viewer: { view: true, edit: false, delete: false } }
  };
  db.prepare('INSERT INTO access_rights (config) VALUES (?)').run(JSON.stringify(defaultRights));
}

// Insert default mandatory fields if not exists
const fieldsExist = db.prepare('SELECT id FROM mandatory_fields LIMIT 1').get();
if (!fieldsExist) {
  db.prepare('INSERT INTO mandatory_fields (fields) VALUES (?)').run(JSON.stringify([]));
}

module.exports = db;
