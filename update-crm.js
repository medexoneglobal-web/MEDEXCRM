const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// =============================================================================
// CONFIGURATION
// =============================================================================
const EXCEL_FILE = 'C:/Users/N6745/Music/Cloud/CRM (18).xlsx';
const DB_PATH = path.join(__dirname, 'crm.db');
const BATCH_SIZE = 100;

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const SUPABASE_REST = `${SUPABASE_URL}/rest/v1/contacts`;

// Fields that identify a record
const KEY_ACCT = 'ACCT NO';
const KEY_NAME = 'CLINIC NAME';
const KEY_PHONE = 'PHONE';

// =============================================================================
// HELPERS
// =============================================================================

function normalize(val) {
  return String(val || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatDate(val) {
  if (val instanceof Date) {
    return `${String(val.getDate()).padStart(2,'0')}/${String(val.getMonth()+1).padStart(2,'0')}/${val.getFullYear()}`;
  }
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    try {
      const parsed = XLSX.SSF.parse_date_code(val);
      if (parsed && parsed.y >= 1900 && parsed.y <= 2100) {
        return `${String(parsed.d).padStart(2,'0')}/${String(parsed.m).padStart(2,'0')}/${parsed.y}`;
      }
    } catch (e) { /* ignore */ }
    const d = new Date((val - 25569) * 86400000);
    return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
  }
  return val !== undefined && val !== null ? String(val) : '';
}

function processExcelValue(key, value) {
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'number' && key && key.match(/DATE|START|END|LIVE/i)) {
    return formatDate(value);
  }
  return value !== undefined && value !== null ? String(value) : '';
}

function rowsEqual(a, b, headers) {
  for (const h of headers) {
    if (!h) continue;
    if ((a[h] || '') !== (b[h] || '')) return false;
  }
  return true;
}

function findChanges(oldRow, newRow, headers) {
  const changed = [];
  for (const h of headers) {
    if (!h) continue;
    const ov = String(oldRow[h] || '');
    const nv = String(newRow[h] || '');
    if (ov !== nv) changed.push(h);
  }
  return changed;
}

// =============================================================================
// SQLITE UPSERT
// =============================================================================

function upsertSQLite(excelRows, headers) {
  console.log('\n--- SQLite Upsert ---');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Load all existing records
  const existingRows = db.prepare('SELECT id, data FROM crm_data').all();
  console.log(`  Existing DB records: ${existingRows.length}`);

  // Build lookup maps
  const byAcct = new Map();
  const byNamePhone = new Map();

  for (const row of existingRows) {
    const data = JSON.parse(row.data);
    const id = row.id;
    const acct = normalize(data[KEY_ACCT]);
    const name = normalize(data[KEY_NAME]);
    const phone = normalize(data[KEY_PHONE]);

    if (acct) byAcct.set(acct, { id, data });
    if (name && phone) byNamePhone.set(`${name}|${phone}`, { id, data });
  }

  const insertStmt = db.prepare('INSERT INTO crm_data (data) VALUES (?)');
  const updateStmt = db.prepare('UPDATE crm_data SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const auditStmt = db.prepare('INSERT INTO crm_audit_log (crm_data_id, action, changed_by, old_data, new_data, changed_fields) VALUES (?, ?, ?, ?, ?, ?)');

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const insertBatch = [];

  for (const excelRow of excelRows) {
    const acct = normalize(excelRow[KEY_ACCT]);
    const name = normalize(excelRow[KEY_NAME]);
    const phone = normalize(excelRow[KEY_PHONE]);

    let match = null;
    if (acct) match = byAcct.get(acct);
    if (!match && name && phone) match = byNamePhone.get(`${name}|${phone}`);

    if (!match) {
      // NEW RECORD
      insertBatch.push(JSON.stringify(excelRow));
      if (insertBatch.length >= BATCH_SIZE) {
        const tx = db.transaction((rows) => {
          for (const r of rows) {
            const result = insertStmt.run(r);
            auditStmt.run(result.lastInsertRowid, 'CREATE', 'system', null, r, JSON.stringify(Object.keys(JSON.parse(r))));
          }
        });
        tx(insertBatch);
        inserted += insertBatch.length;
        insertBatch.length = 0;
      }
    } else {
      // EXISTING RECORD - check for changes
      if (rowsEqual(match.data, excelRow, headers)) {
        unchanged++;
      } else {
        const changes = findChanges(match.data, excelRow, headers);
        updateStmt.run(JSON.stringify(excelRow), match.id);
        auditStmt.run(match.id, 'UPDATE', 'system', JSON.stringify(match.data), JSON.stringify(excelRow), JSON.stringify(changes));
        updated++;
      }
    }
  }

  // Flush remaining inserts
  if (insertBatch.length > 0) {
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const result = insertStmt.run(r);
        auditStmt.run(result.lastInsertRowid, 'CREATE', 'system', null, r, JSON.stringify(Object.keys(JSON.parse(r))));
      }
    });
    tx(insertBatch);
    inserted += insertBatch.length;
  }

  db.close();

  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);

  return { inserted, updated, unchanged };
}

// =============================================================================
// SUPABASE SYNC
// =============================================================================

async function fetchAllSupabaseContacts() {
  console.log('\n  Fetching Supabase contacts...');
  const all = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    const to = from + limit - 1;
    const res = await fetch(`${SUPABASE_REST}?select=id,data&order=id&limit=${limit}&offset=${from}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase fetch failed: HTTP ${res.status} ${text}`);
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < limit) break;
    from += limit;
  }

  console.log(`  Fetched ${all.length} contacts from Supabase`);
  return all;
}

async function upsertSupabase(excelRows, headers) {
  console.log('\n--- Supabase Upsert ---');

  const existing = await fetchAllSupabaseContacts();

  // Build lookup maps
  const byAcct = new Map();
  const byNamePhone = new Map();

  for (const row of existing) {
    const data = row.data || {};
    const acct = normalize(data[KEY_ACCT]);
    const name = normalize(data[KEY_NAME]);
    const phone = normalize(data[KEY_PHONE]);

    if (acct) byAcct.set(acct, row);
    if (name && phone) byNamePhone.set(`${name}|${phone}`, row);
  }

  const toInsert = [];
  const toUpdate = [];

  for (const excelRow of excelRows) {
    const acct = normalize(excelRow[KEY_ACCT]);
    const name = normalize(excelRow[KEY_NAME]);
    const phone = normalize(excelRow[KEY_PHONE]);

    let match = null;
    if (acct) match = byAcct.get(acct);
    if (!match && name && phone) match = byNamePhone.get(`${name}|${phone}`);

    if (!match) {
      toInsert.push({ data: excelRow });
    } else {
      if (!rowsEqual(match.data, excelRow, headers)) {
        toUpdate.push({ id: match.id, data: excelRow });
      }
    }
  }

  // Batch insert new
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const res = await fetch(SUPABASE_REST, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`  Insert batch failed: HTTP ${res.status} ${text}`);
    } else {
      inserted += batch.length;
      console.log(`  Inserted batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} rows`);
    }
  }

  // Update existing (individual PATCH)
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < toUpdate.length; i++) {
    const row = toUpdate[i];
    const res = await fetch(`${SUPABASE_REST}?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ data: row.data })
    });
    if (!res.ok) {
      failed++;
      if (failed <= 5) {
        const text = await res.text();
        console.error(`  Update failed id=${row.id}: HTTP ${res.status} ${text}`);
      }
    } else {
      updated++;
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  Updated ${i + 1}/${toUpdate.length}...`);
    }
  }

  console.log(`  Supabase inserted: ${inserted}`);
  console.log(`  Supabase updated: ${updated}`);
  if (failed) console.log(`  Supabase failed: ${failed}`);

  return { inserted, updated, failed };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('========================================');
  console.log('CRM UPSERT FROM EXCEL');
  console.log('========================================');

  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`Excel file not found: ${EXCEL_FILE}`);
    process.exit(1);
  }

  // Step 1: Read Excel
  console.log('\nStep 1: Reading Excel...');
  const workbook = XLSX.readFile(EXCEL_FILE, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length < 2) {
    console.error('Excel file has no data rows.');
    process.exit(1);
  }

  let headers = rawData[0].map(h => String(h || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());

  // Deduplicate headers
  const seen = {};
  headers = headers.map(h => {
    if (!h) return h;
    if (seen[h]) { seen[h]++; return h + ' (' + seen[h] + ')'; }
    seen[h] = 1;
    return h;
  });

  console.log(`  Rows: ${rawData.length - 1}`);
  console.log(`  Columns: ${headers.filter(Boolean).length}`);

  // Process rows
  const excelRows = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = {};
    headers.forEach((h, j) => {
      if (h) row[h] = processExcelValue(h, rawData[i][j]);
    });
    // Skip completely empty rows
    const hasData = Object.values(row).some(v => String(v || '').trim() !== '');
    if (hasData) excelRows.push(row);
  }

  // Step 2: SQLite Upsert
  const sqliteResult = upsertSQLite(excelRows, headers);

  // Step 3: Supabase Upsert
  let supabaseResult;
  try {
    supabaseResult = await upsertSupabase(excelRows, headers);
  } catch (err) {
    console.error('\nSupabase sync failed:', err.message);
    supabaseResult = { inserted: 0, updated: 0, failed: 0, error: err.message };
  }

  // Step 4: Final verification
  console.log('\n========================================');
  console.log('IMPORT SUMMARY');
  console.log('========================================');
  console.log(`Excel total rows:      ${excelRows.length}`);
  console.log(`SQLite inserted:       ${sqliteResult.inserted}`);
  console.log(`SQLite updated:        ${sqliteResult.updated}`);
  console.log(`SQLite unchanged:      ${sqliteResult.unchanged}`);
  if (supabaseResult) {
    console.log(`Supabase inserted:     ${supabaseResult.inserted}`);
    console.log(`Supabase updated:      ${supabaseResult.updated}`);
    if (supabaseResult.failed) console.log(`Supabase failed:       ${supabaseResult.failed}`);
  }

  // Verify DB count
  const db = new Database(DB_PATH);
  const finalCount = db.prepare('SELECT COUNT(*) as c FROM crm_data').get();
  db.close();
  console.log(`Final DB row count:    ${finalCount.c}`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
