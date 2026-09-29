/**
 * WhatsApp module API routes.
 * Mounted in server.js at /api/whatsapp. These endpoints only exist on the
 * always-on Node backend (Render/Railway/local) — not on Vercel serverless.
 */

const express = require('express');
const router = express.Router();

// Lazy load: server.js must still start when whatsapp-web.js is not installed.
function getWA() {
    try {
        return require('../whatsapp-service');
    } catch (e) {
        return null;
    }
}

function unavailable(res) {
    return res.status(503).json({ error: 'WhatsApp backend is not available on this server (dependency missing).' });
}

// CORS + preflight
router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.WA_CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wa-secret');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// Shared secret on mutating endpoints (skipped when WA_API_SECRET is unset — dev mode)
function requireSecret(req, res, next) {
    const secret = process.env.WA_API_SECRET;
    if (!secret) return next();
    if (req.headers['x-wa-secret'] === secret) return next();
    return res.status(401).json({ error: 'Unauthorized' });
}

function asyncWrap(fn) {
    return (req, res) => fn(req, res).catch(err => {
        console.error('WhatsApp API error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message, rejected: err.rejected || undefined });
    });
}

// GET /api/whatsapp/status — connection state + current QR (frontend polls this)
router.get('/status', asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    res.json(wa.getStatus());
}));

// POST /api/whatsapp/connect — start client / generate QR
router.post('/connect', requireSecret, asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    await wa.ensureStarted();
    res.json(wa.getStatus());
}));

// POST /api/whatsapp/reconnect — fresh session (new QR)
router.post('/reconnect', requireSecret, asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    await wa.reconnect();
    res.json(wa.getStatus());
}));

// POST /api/whatsapp/disconnect — logout and clear session
router.post('/disconnect', requireSecret, asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    await wa.disconnect();
    res.json(wa.getStatus());
}));

// POST /api/whatsapp/send — create a blast (validated server-side) and enqueue it
router.post('/send', requireSecret, asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    const { message, attachment, sender, recipients } = req.body || {};
    const result = await wa.sendBlast({ message, attachment, sender, recipients });
    res.json({ success: true, ...result });
}));

// GET /api/whatsapp/blasts/:id — blast + per-recipient statuses (live progress)
router.get('/blasts/:id', asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    const data = await wa.getBlast(req.params.id);
    if (!data.blast) return res.status(404).json({ error: 'Blast not found' });
    res.json(data);
}));

// POST /api/whatsapp/blasts/:id/cancel
router.post('/blasts/:id/cancel', requireSecret, asyncWrap(async (req, res) => {
    const wa = getWA();
    if (!wa) return unavailable(res);
    await wa.cancelBlast(req.params.id);
    res.json({ success: true });
}));

module.exports = router;
