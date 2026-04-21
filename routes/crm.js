const express = require('express');
const router = express.Router();
const db = require('../database');
const XLSX = require('xlsx');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/crm/data — return all CRM records
router.get('/data', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM crm_data').all();
  const records = rows.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  res.json(records);
});

// POST /api/crm/import — upload Excel/CSV and import
router.post('/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (rawData.length < 2) return res.status(400).json({ error: 'File has no data rows' });
    
    // Normalize headers
    let headers = rawData[0].map(h => String(h || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
    
    // Deduplicate headers
    const seen = {};
    headers = headers.map(h => {
      if (!h) return h;
      if (seen[h]) { seen[h]++; return h + ' (' + seen[h] + ')'; }
      seen[h] = 1; return h;
    });
    
    // Insert rows (APPEND mode - new records are added alongside existing ones)
    const insert = db.prepare('INSERT INTO crm_data (data) VALUES (?)');
    const insertMany = db.transaction((rows) => {
      for (const row of rows) { insert.run(JSON.stringify(row)); }
    });
    
    const records = [];
    for (let i = 1; i < rawData.length; i++) {
      const row = {};
      headers.forEach((h, j) => {
        if (h) {
          let val = rawData[i][j];
          // Convert Excel date serial numbers
          if (typeof val === 'number' && val > 40000 && val < 60000 && h.match(/DATE|START|END/i)) {
            const d = new Date((val - 25569) * 86400000);
            val = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
          }
          row[h] = val !== undefined && val !== null ? String(val) : '';
        }
      });
      records.push(row);
    }
    
    insertMany(records);
    res.json({ success: true, count: records.length, columns: headers.filter(Boolean).length });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// POST /api/crm/data — add new customer
router.post('/data', (req, res) => {
  const result = db.prepare('INSERT INTO crm_data (data) VALUES (?)').run(JSON.stringify(req.body.data));
  
  // Insert audit log for creation
  db.prepare('INSERT INTO crm_audit_log (crm_data_id, action, changed_by, new_data) VALUES (?, ?, ?, ?)')
    .run(result.lastInsertRowid, 'CREATE', (req.session.user && req.session.user.username) || 'unknown', JSON.stringify(req.body.data));
  
  res.json({ success: true, id: result.lastInsertRowid });
});

// GET /api/crm/data/:id/history — get audit history for a record
router.get('/data/:id/history', (req, res) => {
  const logs = db.prepare('SELECT * FROM crm_audit_log WHERE crm_data_id = ? ORDER BY changed_at DESC').all(req.params.id);
  res.json(logs);
});

// PUT /api/crm/data/:id — update record
router.put('/data/:id', (req, res) => {
  // Fetch old record before update
  const oldRow = db.prepare('SELECT data FROM crm_data WHERE id = ?').get(req.params.id);
  const oldData = oldRow ? JSON.parse(oldRow.data) : {};
  
  // Perform update
  db.prepare('UPDATE crm_data SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(req.body.data), req.params.id);
  
  // Compare old vs new to find changed fields
  const changedFields = [];
  const newData = req.body.data;
  for (const key of Object.keys(newData)) {
    if (oldData[key] !== newData[key]) changedFields.push(key);
  }
  
  // Insert audit log
  db.prepare('INSERT INTO crm_audit_log (crm_data_id, action, changed_by, old_data, new_data, changed_fields) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, 'UPDATE', (req.session.user && req.session.user.username) || 'unknown', JSON.stringify(oldData), JSON.stringify(newData), JSON.stringify(changedFields));
  
  res.json({ success: true });
});

// DELETE /api/crm/data/:id — delete single record
router.delete('/data/:id', (req, res) => {
  // Fetch old record before delete
  const oldRow = db.prepare('SELECT data FROM crm_data WHERE id = ?').get(req.params.id);
  
  db.prepare('DELETE FROM crm_data WHERE id = ?').run(req.params.id);
  
  // Insert audit log for deletion
  if (oldRow) {
    db.prepare('INSERT INTO crm_audit_log (crm_data_id, action, changed_by, old_data) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'DELETE', (req.session.user && req.session.user.username) || 'unknown', oldRow.data);
  }
  
  res.json({ success: true });
});

// POST /api/crm/data/bulk-delete — bulk delete
router.post('/data/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
  const placeholders = ids.map(() => '?').join(',');
  
  // Fetch old records before delete
  const oldRows = db.prepare(`SELECT id, data FROM crm_data WHERE id IN (${placeholders})`).all(...ids);
  
  db.prepare(`DELETE FROM crm_data WHERE id IN (${placeholders})`).run(...ids);
  
  // Insert audit logs for each deletion
  const username = (req.session.user && req.session.user.username) || 'unknown';
  for (const row of oldRows) {
    db.prepare('INSERT INTO crm_audit_log (crm_data_id, action, changed_by, old_data) VALUES (?, ?, ?, ?)')
      .run(row.id, 'DELETE', username, row.data);
  }
  
  res.json({ success: true, deleted: ids.length });
});

module.exports = router;
