const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// =============================================================================
// CONFIGURATION
// =============================================================================
const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const CRM_FILE = path.join('c:', 'Users', 'N6745', 'Music', 'Cloud', 'CRM (13).xlsx');
const REST_URL = `${SUPABASE_URL}/rest/v1/contacts`;
const BATCH_SIZE = 100;

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function processValue(key, value) {
  if (value instanceof Date) {
    return formatDate(value);
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
  return value;
}

function processRow(row) {
  const obj = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes('_EMPTY_') || key.startsWith('__')) {
      continue;
    }
    if (value === null || value === undefined) {
      obj[key] = '';
      continue;
    }
    obj[key] = processValue(key, value);
  }
  return obj;
}

async function getContactsCount() {
  const res = await fetch(`${REST_URL}?select=id`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Prefer': 'count=exact',
      'Range': '0-0'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get count: HTTP ${res.status} ${text}`);
  }
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

async function clearContacts() {
  console.log('Clearing existing contacts data...');
  const res = await fetch(`${REST_URL}?id=not.is.null`, {
    method: 'DELETE',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Prefer': 'return=minimal'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to clear contacts: HTTP ${res.status} ${text}`);
  }
  console.log('  Existing data cleared.');
}

async function insertBatch(batch, batchNumber, totalBatches) {
  const body = batch.map(row => ({ data: row }));
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Batch ${batchNumber} insert failed: HTTP ${res.status} ${text}`);
  }
  console.log(`  Batch ${batchNumber}/${totalBatches} inserted (${batch.length} rows)`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  try {
    // Step 1: Read Excel
    console.log(`Reading Excel: ${CRM_FILE}`);
    if (!fs.existsSync(CRM_FILE)) {
      throw new Error(`File not found: ${CRM_FILE}`);
    }
    const workbook = XLSX.readFile(CRM_FILE, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    console.log(`  Sheet name: ${sheetName}`);

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    console.log(`  Total rows read: ${rawRows.length}`);

    if (rawRows.length === 0) {
      console.log('No data found in the first sheet.');
      return;
    }

    const headers = Object.keys(rawRows[0]);
    console.log(`  Columns detected: ${headers.length}`);
    console.log(`  Headers: ${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}`);

    // Step 2: Process rows
    const rows = rawRows.map(processRow);

    // Step 3: Check and clear existing data
    const existingCount = await getContactsCount();
    console.log(`\nExisting contacts in table: ${existingCount}`);
    if (existingCount > 0) {
      await clearContacts();
    }

    // Step 4: Batch insert with progress logging
    const totalRows = rows.length;
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
    console.log(`\nImporting ${totalRows} rows in ${totalBatches} batch(es)...`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

      try {
        await insertBatch(batch, batchNumber, totalBatches);
        successCount += batch.length;
      } catch (err) {
        console.error(`  ERROR in batch ${batchNumber}: ${err.message}`);
        failCount += batch.length;
      }

      if (successCount % 1000 === 0 || (successCount > 0 && successCount < 1000 && batchNumber === totalBatches)) {
        console.log(`  ... ${successCount} rows imported so far`);
      }
    }

    // Step 5: Verify
    const finalCount = await getContactsCount();
    console.log(`\nImport complete!`);
    console.log(`  Rows processed: ${totalRows}`);
    console.log(`  Rows succeeded: ${successCount}`);
    console.log(`  Rows failed:    ${failCount}`);
    console.log(`  Contacts table count: ${finalCount}`);

    if (finalCount !== totalRows) {
      console.warn(`  WARNING: Count mismatch! Expected ${totalRows}, got ${finalCount}`);
    }

  } catch (err) {
    console.error(`\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
