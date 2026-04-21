const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/license-key/data/:acctNo
router.get('/data/:acctNo', (req, res) => {
  const rows = db.prepare('SELECT field_key, field_value FROM license_key_data WHERE acct_no = ?').all(req.params.acctNo);
  const data = {};
  rows.forEach(r => { data[r.field_key] = r.field_value; });
  res.json(data);
});

// PUT /api/license-key/data/:acctNo
router.put('/data/:acctNo', (req, res) => {
  const { fields } = req.body; // { fieldKey: fieldValue, ... }
  const upsert = db.prepare('INSERT INTO license_key_data (acct_no, field_key, field_value) VALUES (?, ?, ?) ON CONFLICT(acct_no, field_key) DO UPDATE SET field_value = ?');
  const saveAll = db.transaction((acctNo, data) => {
    for (const [key, value] of Object.entries(data)) {
      upsert.run(acctNo, key, value, value);
    }
  });
  saveAll(req.params.acctNo, fields);
  res.json({ success: true });
});

module.exports = router;
