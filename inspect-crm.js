const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

// Inspect Excel
const wb = XLSX.readFile('C:/Users/N6745/Music/Cloud/CRM (18).xlsx', { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
console.log('Excel rows:', rows.length);
console.log('Headers:', rows[0]);

// Inspect DB
const db = new Database(path.join(__dirname, 'crm.db'));
const count = db.prepare('SELECT COUNT(*) as c FROM crm_data').get();
console.log('DB rows:', count.c);

const sample = db.prepare('SELECT data FROM crm_data LIMIT 1').get();
if (sample) {
  const data = JSON.parse(sample.data);
  console.log('Sample keys:', Object.keys(data));
}
db.close();
