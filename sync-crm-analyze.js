const XLSX = require('xlsx');

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const EXCEL_FILE = 'c:\\Users\\N6745\\Music\\Cloud\\CRM (18).xlsx';

async function fetchSupabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
  });
  return res.json();
}

async function getAllSupabaseData() {
  const allData = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const rows = await fetchSupabase(`/contacts?select=id,data&limit=${limit}&offset=${offset}`);
    if (rows.length === 0) break;
    for (const row of rows) {
      allData.push({ id: row.id, acctNo: String(row.data['ACCT NO'] || '').trim(), data: row.data });
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return allData;
}

function readExcel() {
  const wb = XLSX.readFile(EXCEL_FILE, { cellDates: true });
  const ws = wb.Sheets['CRM'];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rawRows.map(row => {
    const obj = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.includes('_EMPTY_') || key.startsWith('__')) continue;
      obj[key] = value === null || value === undefined ? '' : String(value).trim();
    }
    return obj;
  });
}

async function main() {
  const excelRows = readExcel();
  const supabaseRows = await getAllSupabaseData();
  
  const excelMap = new Map();
  for (const row of excelRows) {
    if (row['ACCT NO']) excelMap.set(row['ACCT NO'], row);
  }
  
  const fieldStats = {};
  let checked = 0;
  
  for (const sbRow of supabaseRows) {
    const excelRow = excelMap.get(sbRow.acctNo);
    if (!excelRow) continue;
    checked++;
    
    for (const key of Object.keys(excelRow)) {
      const excelVal = excelRow[key];
      const dbVal = String(sbRow.data[key] || '').trim();
      if (excelVal !== dbVal) {
        if (!fieldStats[key]) fieldStats[key] = { count: 0, excelEmpty: 0, dbEmpty: 0 };
        fieldStats[key].count++;
        if (excelVal === '') fieldStats[key].excelEmpty++;
        if (dbVal === '') fieldStats[key].dbEmpty++;
      }
    }
  }
  
  console.log('Checked records:', checked);
  console.log('\nFields with differences (sorted by count):');
  const sorted = Object.entries(fieldStats).sort((a, b) => b[1].count - a[1].count);
  for (const [field, stats] of sorted) {
    console.log(`${field}: ${stats.count} diffs (Excel empty: ${stats.excelEmpty}, DB empty: ${stats.dbEmpty})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
