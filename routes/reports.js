const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/reports/maintenance
router.get('/maintenance', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM crm_data').all();
  const records = rows.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  res.json(records);
});

// GET /api/reports/einvoice
router.get('/einvoice', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM crm_data').all();
  const records = rows.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  res.json(records);
});

module.exports = router;
