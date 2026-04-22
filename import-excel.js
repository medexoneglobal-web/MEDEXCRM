const XLSX = require('xlsx');

// =============================================================================
// CONFIGURATION
// =============================================================================
const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const BUCKET = 'CRM';
const FILE_NAME = 'CRM (12).xlsx';
const BATCH_SIZE = 100;

const PUBLIC_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(FILE_NAME)}`;
const AUTH_URL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(FILE_NAME)}`;
const REST_URL = `${SUPABASE_URL}/rest/v1/contacts`;

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
  // If xlsx already converted it to a Date object
  if (value instanceof Date) {
    return formatDate(value);
  }

  // Heuristic: raw Excel serial date numbers (range roughly 1 = 1900 to 50000 = 2040s)
  // Common CRM dates fall between ~37000 (2001) and ~50000 (2040s)
  if (typeof value === 'number' && value > 30000 && value < 60000 && !Number.isInteger(value * 100)) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y >= 1900 && parsed.y <= 2100) {
        return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
      }
    } catch (e) {
      // ignore, return original value
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

async function downloadFile() {
  console.log(`Downloading "${FILE_NAME}" from bucket "${BUCKET}"...`);

  // Try public URL first
  console.log('  Trying public URL...');
  try {
    const res = await fetch(PUBLIC_URL);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      console.log(`  Public URL OK (${buffer.length} bytes)`);
      return buffer;
    }
    console.log(`  Public URL failed: HTTP ${res.status}`);
  } catch (err) {
    console.log(`  Public URL error: ${err.message}`);
  }

  // Fallback to authenticated endpoint
  console.log('  Trying authenticated endpoint...');
  const res = await fetch(AUTH_URL, {
    headers: {
      'Authorization': `Bearer ${ANON_KEY}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authenticated download failed: HTTP ${res.status} ${text}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`  Authenticated endpoint OK (${buffer.length} bytes)`);
  return buffer;
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
    // Step 1: Download file
    const buffer = await downloadFile();

    // Step 2: Parse Excel
    console.log('\nParsing Excel file...');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    console.log(`  Sheet name: ${sheetName}`);

    // Convert to JSON with headers as keys
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    console.log(`  Total rows read: ${rawRows.length}`);

    if (rawRows.length === 0) {
      console.log('No data found in the first sheet.');
      return;
    }

    // Show column headers from first row
    const headers = Object.keys(rawRows[0]);
    console.log(`  Columns detected: ${headers.join(', ')}`);

    // Step 3: Process rows (handle dates)
    const rows = rawRows.map(processRow);

    // Step 4: Check and clear existing data
    const existingCount = await getContactsCount();
    console.log(`\nExisting contacts in table: ${existingCount}`);
    if (existingCount > 0) {
      await clearContacts();
    }

    // Step 5: Batch insert
    const totalRows = rows.length;
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
    console.log(`\nImporting ${totalRows} rows in ${totalBatches} batch(es)...`);

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      await insertBatch(batch, batchNumber, totalBatches);
    }

    // Step 6: Verify
    const finalCount = await getContactsCount();
    console.log(`\nImport complete!`);
    console.log(`  Rows imported: ${totalRows}`);
    console.log(`  Contacts table count: ${finalCount}`);

    if (finalCount !== totalRows) {
      console.warn(`  WARNING: Count mismatch! Expected ${totalRows}, got ${finalCount}`);
    }

  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
