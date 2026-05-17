const XLSX = require('xlsx');

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

async function fetchSupabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
  });
  return res.json();
}

const wb = XLSX.readFile('c:\\Users\\N6745\\Music\\Cloud\\CRM (18).xlsx', { cellDates: true });
const ws = wb.Sheets['CRM'];
const excelRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const excelMap = new Map();
for (const row of excelRows) {
  const acct = String(row['ACCT NO'] || '').trim();
  if (acct) excelMap.set(acct, row);
}

const dateFields = ['CMS/MHIS MTN START DATE', 'CMS/MHIS MTN END DATE', 'CMS INSTALL DATE/LIVE DATE', 'CLOUD START DATE', 'CLOUD END DATE'];

fetchSupabase('/contacts?select=data&limit=20').then(rows => {
  for (const row of rows) {
    const dbData = row.data;
    const acct = String(dbData['ACCT NO'] || '').trim();
    const excelRow = excelMap.get(acct);
    if (!excelRow) continue;
    
    console.log(`\nACCT NO: ${acct}`);
    for (const field of dateFields) {
      const excelRaw = excelRow[field];
      const dbRaw = dbData[field];
      console.log(`  ${field}:`);
      console.log(`    Excel: "${excelRaw}" (type: ${typeof excelRaw})`);
      console.log(`    DB:    "${dbRaw}" (type: ${typeof dbRaw})`);
    }
  }
});
