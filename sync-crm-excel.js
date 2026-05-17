const XLSX = require('xlsx');

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const EXCEL_FILE = 'c:\\Users\\N6745\\Music\\Cloud\\CRM (18).xlsx';
const BATCH_SIZE = 50;

// Fields that the admin typically updates in Excel (exclude system-generated/auto-computed fields if any)
// We'll sync ALL fields that exist in Excel, but preserve DB fields not in Excel

function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function processExcelValue(value) {
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function readExcel() {
  console.log('Reading Excel file...');
  const wb = XLSX.readFile(EXCEL_FILE, { cellDates: true });
  const ws = wb.Sheets['CRM'];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  
  const rows = [];
  const excelColumns = new Set();
  
  for (const rawRow of rawRows) {
    const obj = {};
    for (const [key, value] of Object.entries(rawRow)) {
      if (key.includes('_EMPTY_') || key.startsWith('__')) continue;
      obj[key] = processExcelValue(value);
      excelColumns.add(key);
    }
    rows.push(obj);
  }
  
  console.log(`Excel rows: ${rows.length}, columns: ${excelColumns.size}`);
  return { rows, excelColumns };
}

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

async function getAllSupabaseData() {
  console.log('Fetching all Supabase data...');
  const allData = [];
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    const res = await fetchSupabase(`/contacts?select=id,data&limit=${limit}&offset=${offset}`);
    const rows = await res.json();
    if (rows.length === 0) break;
    
    for (const row of rows) {
      allData.push({
        id: row.id,
        acctNo: String(row.data['ACCT NO'] || '').trim(),
        data: row.data
      });
    }
    
    if (rows.length < limit) break;
    offset += limit;
    if (offset % 5000 === 0) {
      console.log(`  Fetched ${allData.length} records...`);
    }
  }
  
  console.log(`Total Supabase records fetched: ${allData.length}`);
  return allData;
}

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

async function main() {
  try {
    const { rows: excelRows, excelColumns } = readExcel();
    const supabaseRows = await getAllSupabaseData();
    
    const excelMap = new Map();
    for (const row of excelRows) {
      const acct = row['ACCT NO'];
      if (acct) excelMap.set(acct, row);
    }
    
    const supabaseMap = new Map();
    for (const row of supabaseRows) {
      if (row.acctNo) supabaseMap.set(row.acctNo, row);
    }
    
    // Find records to update
    const updates = [];
    const newRecords = [];
    const unchanged = [];
    const missingFromExcel = [];
    
    for (const [acctNo, excelRow] of excelMap) {
      const sbRow = supabaseMap.get(acctNo);
      if (!sbRow) {
        newRecords.push(acctNo);
        continue;
      }
      
      const dbData = sbRow.data;
      let mergedData = { ...dbData };
      let hasChanges = false;
      const changedFields = [];
      
      for (const key of excelColumns) {
        const excelVal = excelRow[key] || '';
        const dbVal = normalizeValue(dbData[key]);
        
        if (excelVal !== dbVal) {
          hasChanges = true;
          mergedData[key] = excelVal;
          changedFields.push({ field: key, old: dbVal, new: excelVal });
        }
      }
      
      if (hasChanges) {
        updates.push({ id: sbRow.id, acctNo, mergedData, changedFields });
      } else {
        unchanged.push(acctNo);
      }
    }
    
    for (const [acctNo, sbRow] of supabaseMap) {
      if (!excelMap.has(acctNo)) {
        missingFromExcel.push(acctNo);
      }
    }
    
    console.log('\n========== SYNC REPORT ==========');
    console.log(`Excel records: ${excelRows.length}`);
    console.log(`Supabase records: ${supabaseRows.length}`);
    console.log(`Records to update: ${updates.length}`);
    console.log(`New records (not in Supabase): ${newRecords.length}`);
    console.log(`Unchanged records: ${unchanged.length}`);
    console.log(`In Supabase but missing from Excel: ${missingFromExcel.length}`);
    
    if (updates.length > 0) {
      console.log('\n========== SAMPLE CHANGES ==========');
      for (let i = 0; i < Math.min(5, updates.length); i++) {
        const u = updates[i];
        console.log(`\n${u.acctNo} (${u.changedFields.length} fields):`);
        for (const c of u.changedFields.slice(0, 5)) {
          console.log(`  ${c.field}: "${c.old}" -> "${c.new}"`);
        }
        if (u.changedFields.length > 5) {
          console.log(`  ... and ${u.changedFields.length - 5} more fields`);
        }
      }
      
      // Show field-level summary
      const fieldSummary = {};
      for (const u of updates) {
        for (const c of u.changedFields) {
          if (!fieldSummary[c.field]) fieldSummary[c.field] = 0;
          fieldSummary[c.field]++;
        }
      }
      console.log('\n========== FIELDS CHANGED ==========');
      const sorted = Object.entries(fieldSummary).sort((a, b) => b[1] - a[1]);
      for (const [field, count] of sorted) {
        console.log(`${field}: ${count} records`);
      }
    }
    
    if (updates.length === 0 && newRecords.length === 0) {
      console.log('\nNo changes detected. CRM is already up to date.');
      return;
    }
    
    // Perform updates in batches
    if (updates.length > 0) {
      console.log(`\n========== UPDATING ${updates.length} RECORDS ==========`);
      let updated = 0;
      let failed = 0;
      
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        
        for (const item of batch) {
          try {
            const res = await fetchSupabase(`/contacts?id=eq.${item.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify({ data: item.mergedData })
            });
            
            if (res.ok) {
              updated++;
            } else {
              failed++;
              console.error(`  Failed ${item.acctNo}: HTTP ${res.status}`);
            }
          } catch (err) {
            failed++;
            console.error(`  Error ${item.acctNo}: ${err.message}`);
          }
        }
        
        if ((i + BATCH_SIZE) % 100 === 0 || (i + BATCH_SIZE) >= updates.length) {
          console.log(`  Progress: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
        }
      }
      
      console.log(`\nUpdate complete: ${updated} succeeded, ${failed} failed`);
    }
    
    if (newRecords.length > 0) {
      console.log(`\nWARNING: ${newRecords.length} records in Excel are not in Supabase. Skipping (UPSERT-only policy).`);
      console.log('New records:', newRecords.slice(0, 10).join(', '));
    }
    
    if (missingFromExcel.length > 0) {
      console.log(`\nNOTE: ${missingFromExcel.length} records in Supabase are not in Excel. Preserving them.`);
    }
    
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
