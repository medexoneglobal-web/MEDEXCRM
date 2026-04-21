const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/settings/access-rights
router.get('/access-rights', (req, res) => {
  const row = db.prepare('SELECT config FROM access_rights ORDER BY id DESC LIMIT 1').get();
  res.json(row ? JSON.parse(row.config) : {});
});

// PUT /api/settings/access-rights
router.put('/access-rights', (req, res) => {
  const existing = db.prepare('SELECT id FROM access_rights ORDER BY id DESC LIMIT 1').get();
  if (existing) {
    db.prepare('UPDATE access_rights SET config = ? WHERE id = ?').run(JSON.stringify(req.body), existing.id);
  } else {
    db.prepare('INSERT INTO access_rights (config) VALUES (?)').run(JSON.stringify(req.body));
  }
  res.json({ success: true });
});

// GET /api/settings/mandatory-fields
router.get('/mandatory-fields', (req, res) => {
  const row = db.prepare('SELECT fields FROM mandatory_fields ORDER BY id DESC LIMIT 1').get();
  res.json(row ? JSON.parse(row.fields) : []);
});

// PUT /api/settings/mandatory-fields
router.put('/mandatory-fields', (req, res) => {
  const existing = db.prepare('SELECT id FROM mandatory_fields ORDER BY id DESC LIMIT 1').get();
  if (existing) {
    db.prepare('UPDATE mandatory_fields SET fields = ? WHERE id = ?').run(JSON.stringify(req.body.fields), existing.id);
  } else {
    db.prepare('INSERT INTO mandatory_fields (fields) VALUES (?)').run(JSON.stringify(req.body.fields));
  }
  res.json({ success: true });
});

module.exports = router;
