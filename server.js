const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 80;

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, 'uploads', 'jobsheets');
fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: 'crm-system-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/crm', requireAuth, require('./routes/crm'));
app.use('/api/jobsheets', requireAuth, require('./routes/jobsheet'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/reports', requireAuth, require('./routes/reports'));
app.use('/api/license-key', requireAuth, require('./routes/licenseKey'));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const portSuffix = PORT === 80 ? '' : `:${PORT}`;
  console.log(`CRM Server running on http://medexone.ddns.net${portSuffix}`);
});
