const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status !== 'active') return res.status(401).json({ error: 'Account is inactive' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ success: true, user: req.session.user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// GET /api/auth/users (admin only)
router.get('/users', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const users = db.prepare('SELECT id, username, name, role, status, created_at FROM users').all();
  res.json(users);
});

// POST /api/auth/users (create user)
router.post('/users', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { username, password, name, role } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(username, hashedPassword, name, role || 'user');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

// PUT /api/auth/users/:id (edit user)
router.put('/users/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, role, password } = req.body;
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name = ?, role = ?, password = ? WHERE id = ?').run(name, role, hashedPassword, req.params.id);
  } else {
    db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(name, role, req.params.id);
  }
  res.json({ success: true });
});

// PUT /api/auth/users/:id/toggle (activate/deactivate)
router.put('/users/:id/toggle', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const user = db.prepare('SELECT status FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newStatus = user.status === 'active' ? 'inactive' : 'active';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, req.params.id);
  res.json({ success: true, status: newStatus });
});

module.exports = router;
