const XLSX = require('xlsx');

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const EXCEL_FILE = 'c:\\Users\\N6745\\Music\\Cloud\\CRM (18).xlsx';

async function fetchSupabase(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res;
}

async function getSupabaseCount() {
  const res = await fetchSupabase('/contacts?select=id', {
    headers: { 'Prefer': 'count=exact', 'Range': '0-0' }
  });
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

async function getAllSupabaseData() {
  console.log('Fetching all Supabase data...');
  const allData = [];
  let rangeStart = 0;
  const rangeSize = 1000;
  
  while (true) {
    const res = await fetchSupabase(`/contacts?select=id,data&limit=${rangeSize}&offset=${rangeStart}`);
    const rows = await res.json();
    if (rows.length === 0) break;
    
    for (const row of rows) {
      allData.push({
        id: row.id,
        acctNo: String(row.data['ACCT NO'] || '').trim(),
        data: row.data
      });
    }
    
    if (rows.length < rangeSize) break;
    rangeStart += rangeSize;
    if (rangeStart % 5000 === 0) {
      console.log(`  Fetched ${allData.length} records...`);
    }
  }
  
  return allData;
}

function processExcelValue(key, value) {
  if (value instanceof Date) {
    const d = value.getDate().toString().padStart(2, '0');
    const m = (value.getMonth() + 1).toString().padStart(2, '0');
    const y = value.getFullYear();
    return `${d}/${m}/${y}`;
  }
  if (typeof value === 'number' && value > 30000 && value < 60000 && !Number.isInteger(value * 100)) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y >= 1900 && parsed.y <= 2100) {
        return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
      }
    } catch (e) {}
  }
  return value === null || value === undefined ? '' : String(value).trim();
}

function readExcel() {
  console.log('Reading Excel file...');
  const wb = XLSX.readFile(EXCEL_FILE, { cellDates: true });
  const ws = wb.Sheets['CRM'];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  
  const rows = rawRows.map(row => {
    const obj = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.includes('_EMPTY_') || key.startsWith('__')) continue;
      obj[key] = processExcelValue(key, value);
    }
    return obj;
  });
  
  console.log(`Excel rows: ${rows.length}`);
  return rows;
}

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

async function main() {
  try {
    const supabaseCount = await getSupabaseCount();
    console.log('Supabase count:', supabaseCount);
    
    const excelRows = readExcel();
    const supabaseRows = await getAllSupabaseData();
    
    console.log(`\nSupabase records fetched: ${supabaseRows.length}`);
    
    // Build maps
    const excelMap = new Map();
    for (const row of excelRows) {
      const acctNo = normalizeValue(row['ACCT NO']);
      if (acctNo) excelMap.set(acctNo, row);
    }
    
    const supabaseMap = new Map();
    for (const row of supabaseRows) {
      if (row.acctNo) supabaseMap.set(row.acctNo, row);
    }
    
    // Find differences
    let newRecords = 0;
    let missingFromExcel = 0;
    let changedRecords = 0;
    let unchangedRecords = 0;
    const changesDetail = [];
    const sampleChanges = [];
    
    // Check Excel vs Supabase
    for (const [acctNo, excelRow] of excelMap) {
      const supabaseRow = supabaseMap.get(acctNo);
      if (!supabaseRow) {
        newRecords++;
        continue;
      }
      
      const dbData = supabaseRow.data;
      let hasChanges = false;
      const fieldChanges = [];
      
      for (const key of Object.keys(excelRow)) {
        const excelVal = normalizeValue(excelRow[key]);
        const dbVal = normalizeValue(dbData[key]);
        
        if (excelVal !== dbVal) {
          hasChanges = true;
          fieldChanges.push({
            field: key,
            excel: excelVal,
            db: dbVal
          });
        }
      }
      
      // Also check if Supabase has extra fields not in Excel
      for (const key of Object.keys(dbData)) {
        if (!(key in excelRow)) {
          // Excel doesn't have this field - that's OK, we preserve extra fields
        }
      }
      
      if (hasChanges) {
        changedRecords++;
        changesDetail.push({ acctNo, changes: fieldChanges });
        if (sampleChanges.length < 5) {
          sampleChanges.push({ acctNo, changes: fieldChanges.slice(0, 3) });
        }
      } else {
        unchangedRecords++;
      }
    }
    
    // Check Supabase records missing from Excel
    for (const [acctNo, supabaseRow] of supabaseMap) {
      if (!excelMap.has(acctNo)) {
        missingFromExcel++;
      }
    }
    
    console.log('\n========== COMPARISON REPORT ==========');
    console.log(`Excel records: ${excelRows.length}`);
    console.log(`Supabase records: ${supabaseRows.length}`);
    console.log(`New records in Excel (not in Supabase): ${newRecords}`);
    console.log(`Records in Supabase but missing from Excel: ${missingFromExcel}`);
    console.log(`Changed records: ${changedRecords}`);
    console.log(`Unchanged records: ${unchangedRecords}`);
    
    if (sampleChanges.length > 0) {
      console.log('\n========== SAMPLE CHANGES ==========');
      for (const sample of sampleChanges) {
        console.log(`\nACCT NO: ${sample.acctNo}`);
        for (const c of sample.changes) {
          console.log(`  ${c.field}: "${c.db}" -> "${c.excel}"`);
        }
      }
    }
    
    if (changedRecords === 0 && newRecords === 0) {
      console.log('\nNo changes detected. CRM is already up to date.');
    } else {
      console.log(`\n${changedRecords + newRecords} records need updating.`);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
