const sqlite3 = require('sqlite3').verbose();

const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

async function fetchSupabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
  });
  return res.json();
}

async function getAllSupabaseData() {
  console.log('Fetching Supabase data...');
  const allData = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const rows = await fetchSupabase(`/contacts?select=id,data&limit=${limit}&offset=${offset}`);
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
    if (offset % 5000 === 0) console.log(`  Fetched ${allData.length}...`);
  }
  console.log(`Supabase records: ${allData.length}`);
  return allData;
}

function getLocalData(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, data FROM crm_data', [], (err, rows) => {
      if (err) { reject(err); return; }
      const result = [];
      for (const row of rows) {
        try {
          const data = JSON.parse(row.data);
          result.push({ id: row.id, acctNo: String(data['ACCT NO'] || '').trim(), data });
        } catch (e) {
          console.error('Parse error for id', row.id);
        }
      }
      resolve(result);
    });
  });
}

function updateLocalRecord(db, id, data) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE crm_data SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(data), id],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

async function main() {
  const db = new sqlite3.Database('crm.db');
  
  try {
    const supabaseRows = await getAllSupabaseData();
    const localRows = await getLocalData(db);
    
    console.log(`Local records: ${localRows.length}`);
    
    const localMap = new Map();
    for (const row of localRows) {
      if (row.acctNo) localMap.set(row.acctNo, row);
    }
    
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    
    for (const sbRow of supabaseRows) {
      const localRow = localMap.get(sbRow.acctNo);
      if (!localRow) {
        notFound++;
        continue;
      }
      
      const localData = localRow.data;
      const sbData = sbRow.data;
      let hasChanges = false;
      
      // Check all keys in Supabase data
      for (const key of Object.keys(sbData)) {
        const sbVal = normalizeValue(sbData[key]);
        const localVal = normalizeValue(localData[key]);
        if (sbVal !== localVal) {
          hasChanges = true;
          localData[key] = sbData[key];
        }
      }
      
      // Also remove keys from local that don't exist in Supabase (optional - but let's keep them to be safe)
      // Actually, let's preserve local-only keys
      
      if (hasChanges) {
        const changes = await updateLocalRecord(db, localRow.id, localData);
        if (changes > 0) updated++;
      } else {
        unchanged++;
      }
    }
    
    console.log('\n========== SQLITE SYNC REPORT ==========');
    console.log(`Updated: ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Not found in local DB: ${notFound}`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    db.close();
  }
}

main();
