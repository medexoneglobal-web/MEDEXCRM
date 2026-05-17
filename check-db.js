const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('crm.db');

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
  if (err) { console.error(err); db.close(); return; }
  console.log('Tables:', rows.map(r => r.name).join(', '));

  db.all("PRAGMA table_info(crm_data)", [], (err, cols) => {
    if (err) { console.error(err); db.close(); return; }
    console.log('crm_data columns:', cols.map(c => c.name).join(', '));

    db.get("SELECT COUNT(*) as count FROM crm_data", [], (err, row) => {
      if (err) { console.error(err); db.close(); return; }
      console.log('crm_data count:', row.count);
      db.close();
    });
  });
});
