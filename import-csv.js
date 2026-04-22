const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================
const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
const CSV_PATH = path.join('c:', 'Users', 'N6745', 'Music', 'Cloud', 'CRM(CRM).csv');
const REST_URL = `${SUPABASE_URL}/rest/v1/contacts`;
const BATCH_SIZE = 100;

// =============================================================================
// CSV PARSER (handles quoted fields, commas inside quotes, multiline values, BOM)
// =============================================================================

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        cell += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        cell += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
        i++;
      } else if (char === '\r' && nextChar === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i += 2;
      } else if (char === '\n' || char === '\r') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
      } else {
        cell += char;
        i++;
      }
    }
  }

  // Push any remaining cell/row
  row.push(cell);
  if (row.length > 1 || row[0] !== '' || rows.length === 0) {
    rows.push(row);
  }

  return rows;
}

function isEmptyRow(row) {
  return row.every(cell => cell.trim() === '');
}

// =============================================================================
// SUPABASE HELPERS
// =============================================================================

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
    // Step 1: Read and parse CSV
    console.log(`Reading CSV: ${CSV_PATH}`);
    const rawBuffer = fs.readFileSync(CSV_PATH);
    let text = rawBuffer.toString('utf-8');

    // Strip UTF-8 BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
      console.log('  UTF-8 BOM stripped.');
    }

    console.log('Parsing CSV...');
    const allRows = parseCSV(text);
    console.log(`  Total parsed rows (including header): ${allRows.length}`);

    if (allRows.length === 0) {
      console.log('No data found in CSV.');
      return;
    }

    // Step 2: Extract headers and data rows
    const rawHeaders = allRows[0];
    // Replace empty headers with Column_N so JSON keys are valid
    const headers = rawHeaders.map((h, idx) => {
      const trimmed = h.trim();
      return trimmed === '' ? `Column_${idx + 1}` : trimmed;
    });

    console.log(`  Columns detected: ${headers.length}`);
    console.log(`  Headers: ${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}`);

    const dataRows = allRows.slice(1).filter(row => !isEmptyRow(row));
    console.log(`  Data rows after skipping empties: ${dataRows.length}`);

    // Step 3: Build JSON objects
    const rows = dataRows.map((row, rowIdx) => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const value = i < row.length ? row[i] : '';
        obj[headers[i]] = value;
      }
      return obj;
    });

    // Step 4: Check and clear existing data
    const existingCount = await getContactsCount();
    console.log(`\nExisting contacts in table: ${existingCount}`);
    if (existingCount > 0) {
      await clearContacts();
    }

    // Step 5: Batch insert with progress logging every 1000 rows
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

    // Step 6: Verify
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
