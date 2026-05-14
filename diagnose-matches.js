const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

const EXCEL_FILE = 'C:/Users/N6745/Music/Cloud/CRM (18).xlsx';
const DB_PATH = path.join(__dirname, 'crm.db');

const db = new Database(DB_PATH);
const existingRows = db.prepare('SELECT id, data FROM crm_data').all();

const workbook = XLSX.readFile(EXCEL_FILE, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

let headers = rawData[0].map(h => String(h || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
const seen = {};
headers = headers.map(h => {
  if (!h) return h;
  if (seen[h]) { seen[h]++; return h + ' (' + seen[h] + ')'; }
  seen[h] = 1;
  return h;
});

function normalize(val) {
  return String(val || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const byAcct = new Map();
const byNamePhone = new Map();

for (const row of existingRows) {
  const data = JSON.parse(row.data);
  const acct = normalize(data['ACCT NO']);
  const name = normalize(data['CLINIC NAME']);
  const phone = normalize(data['PHONE']);
  if (acct) {
    if (!byAcct.has(acct)) byAcct.set(acct, []);
    byAcct.get(acct).push({ id: row.id, name, phone });
  }
  if (name && phone) {
    const key = `${name}|${phone}`;
    if (!byNamePhone.has(key)) byNamePhone.set(key, []);
    byNamePhone.get(key).push({ id: row.id, acct });
  }
}

let unmatched = 0;
let emptyAcct = 0;
let emptyPhone = 0;
let emptyBoth = 0;

for (let i = 1; i < rawData.length; i++) {
  const row = {};
  headers.forEach((h, j) => { if (h) row[h] = rawData[i][j]; });
  const acct = normalize(row['ACCT NO']);
  const name = normalize(row['CLINIC NAME']);
  const phone = normalize(row['PHONE']);

  let match = null;
  if (acct) match = byAcct.get(acct);
  if (!match && name && phone) match = byNamePhone.get(`${name}|${phone}`);

  if (!match) {
    unmatched++;
    if (!acct) emptyAcct++;
    if (!phone) emptyPhone++;
    if (!acct && !phone) emptyBoth++;
    if (unmatched <= 20) {
      console.log(`Row ${i}: ACCT="${row['ACCT NO']}", NAME="${row['CLINIC NAME']}", PHONE="${row['PHONE']}"`);
    }
  }
}

console.log(`\nTotal unmatched (first 50): ${unmatched}`);
console.log(`Empty ACCT: ${emptyAcct}, Empty PHONE: ${emptyPhone}, Empty Both: ${emptyBoth}`);
console.log(`DB total: ${existingRows.length}`);

db.close();
