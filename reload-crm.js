const Database = require('better-sqlite3');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const db = new Database(dbPath);

// Path to latest CRM file
const latestFile = path.join('c:\\Users\\N6745\\Music\\Cloud', 'CRM (18).xlsx');

function processValue(key, value) {
  if (value instanceof Date) {
    const d = value.getDate().toString().padStart(2, '0');
    const m = (value.getMonth() + 1).toString().padStart(2, '0');
    const y = value.getFullYear();
    return `${d}/${m}/${y}`;
  }
  if (typeof value === 'number' && value > 40000 && value < 60000 && String(key).match(/DATE|START|END/i)) {
    const d = new Date((value - 25569) * 86400000);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }
  if (typeof value === 'number' && value > 30000 && value < 60000 && !Number.isInteger(value * 100)) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y >= 1900 && parsed.y <= 2100) {
        return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
      }
    } catch (e) {
      // ignore
    }
  }
  return value !== undefined && value !== null ? String(value) : '';
}

function main() {
  console.log('Step 1: Counting existing CRM records...');
  const beforeCount = db.prepare('SELECT COUNT(*) as count FROM crm_data').get();
  console.log(`  Existing records: ${beforeCount.count}`);

  console.log('\nStep 2: Clearing existing CRM data...');
  db.prepare('DELETE FROM crm_data').run();
  console.log('  CRM data cleared.');

  console.log('\nStep 3: Reading Excel file...');
  if (!fs.existsSync(latestFile)) {
    console.error(`  File not found: ${latestFile}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(latestFile, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length < 2) {
    console.error('  File has no data rows.');
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

  console.log(`  Sheet: ${sheetName}`);
  console.log(`  Columns: ${headers.filter(Boolean).length}`);
  console.log(`  Data rows: ${rawData.length - 1}`);

  console.log('\nStep 4: Importing rows...');
  const insert = db.prepare('INSERT INTO crm_data (data) VALUES (?)');
  const insertMany = db.transaction((rows) => {
    for (const row of rows) { insert.run(JSON.stringify(row)); }
  });

  const records = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = {};
    headers.forEach((h, j) => {
      if (h) {
        row[h] = processValue(h, rawData[i][j]);
      }
    });
    records.push(row);
  }

  insertMany(records);

  const afterCount = db.prepare('SELECT COUNT(*) as count FROM crm_data').get();
  console.log(`  Inserted: ${records.length}`);
  console.log(`  Total in DB: ${afterCount.count}`);

  db.close();
  console.log('\nDone! CRM data reloaded successfully.');
}

main();
