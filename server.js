const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '12mb' }));

// WhatsApp module API (whatsapp-web.js — requires the always-on backend host)
app.use('/api/whatsapp', require('./routes/whatsapp'));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CRM Server running on http://localhost:${PORT}`);
});
