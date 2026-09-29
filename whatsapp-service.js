/**
 * WhatsApp Service — whatsapp-web.js backend for the CRM WhatsApp module.
 *
 * Responsibilities:
 *  - QR-pairing session lifecycle (LocalAuth, persistent session folder)
 *  - Blast queue: sequential sending with configurable delay + jitter
 *  - Delivery status tracking (message_ack -> sent/delivered/read/failed)
 *  - Server-side phone normalization, validation and de-duplication
 *
 * Requires env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).
 * Optional env: WA_SESSION_PATH (default ./whatsapp-session), WA_SEND_DELAY_MS (default 2000),
 *               WA_MAX_ATTACHMENT_BYTES (default 5MB).
 *
 * whatsapp-web.js is loaded lazily so server.js can still start when the
 * dependency is not installed (e.g. local static-only serving).
 */

const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, 'whatsapp-session');
const SEND_DELAY_MS = parseInt(process.env.WA_SEND_DELAY_MS || '2000', 10);
const MAX_ATTACHMENT_BYTES = parseInt(process.env.WA_MAX_ATTACHMENT_BYTES || String(5 * 1024 * 1024), 10);
const MAX_RECIPIENTS_PER_BLAST = 500;

// ---------------------------------------------------------------------------
// Lazy-loaded dependencies
// ---------------------------------------------------------------------------
let wweb = null;          // { Client, LocalAuth, MessageMedia }
let qrCodeLib = null;     // qrcode
let supabase = null;      // @supabase/supabase-js client

function loadSupabase() {
    if (!supabase) {
        const { createClient } = require('@supabase/supabase-js');
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!url || !key) {
            throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY environment variables.');
        }
        supabase = createClient(url, key);
    }
}

function loadDeps() {
    if (!wweb) {
        const ww = require('whatsapp-web.js');
        wweb = { Client: ww.Client, LocalAuth: ww.LocalAuth, MessageMedia: ww.MessageMedia };
        qrCodeLib = require('qrcode');
    }
    loadSupabase();
}

// ---------------------------------------------------------------------------
// Phone normalization (Malaysia-centric). MUST stay in sync with the copy in
// public/index.html (whatsapp module) — same rules, same results.
// ---------------------------------------------------------------------------
function normalizeMalaysiaPhone(raw) {
    if (raw === null || raw === undefined) return { ok: false, reason: 'blank' };
    let s = String(raw).trim();
    if (!s) return { ok: false, reason: 'blank' };
    s = s.replace(/[\s.\-()]/g, '').replace(/^\+/, '');
    if (s.startsWith('00')) s = s.slice(2);
    if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid characters' };
    if (/^60\d{8,10}$/.test(s)) return { ok: true, phone: s };
    if (/^0\d{8,10}$/.test(s)) return { ok: true, phone: '6' + s };
    if (/^1\d{8,9}$/.test(s)) return { ok: true, phone: '60' + s };
    return { ok: false, reason: 'invalid format' };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
const state = {
    connectionState: 'disconnected', // disconnected | qr | connecting | ready
    qr: null,                        // latest QR code as a data-URL
    sender: null,                    // { number, pushname } when ready
    lastError: null
};

let client = null;
let starting = false;
let initialized = false;

const blastQueue = [];
let processingQueue = false;
const cancelledBlasts = new Set();

function resetState() {
    state.connectionState = 'disconnected';
    state.qr = null;
    state.sender = null;
}

function getStatus() {
    return { state: state.connectionState, qr: state.qr, sender: state.sender, lastError: state.lastError };
}

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------
function wireEvents() {
    client.on('qr', async (qr) => {
        try {
            state.qr = await qrCodeLib.toDataURL(qr, { margin: 1, width: 280 });
        } catch (e) {
            console.error('QR generation error:', e.message);
        }
        state.connectionState = 'qr';
        console.log('WhatsApp QR generated — waiting for scan');
    });

    client.on('authenticated', () => {
        state.connectionState = 'connecting';
        state.qr = null;
    });

    client.on('ready', () => {
        state.connectionState = 'ready';
        state.qr = null;
        const info = client.info || {};
        state.sender = {
            number: info.wid ? info.wid.user : '',
            pushname: info.pushname || ''
        };
        state.lastError = null;
        console.log(`WhatsApp connected as ${state.sender.pushname || state.sender.number}`);
    });

    client.on('auth_failure', (msg) => {
        state.lastError = `Authentication failed: ${msg}`;
        state.connectionState = 'disconnected';
        console.error('WhatsApp auth_failure:', msg);
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp disconnected:', reason);
        state.lastError = `Disconnected: ${reason}`;
        teardownClient(false);
    });

    client.on('message_ack', async (msg, ack) => {
        try {
            if (!supabase) return;
            const waMsgId = msg && msg.id ? msg.id._serialized : null;
            if (!waMsgId) return;
            let status = null;
            if (ack === -1) status = 'failed';
            else if (ack === 2) status = 'delivered';
            else if (ack === 3 || ack === 4) status = 'read';
            if (!status) return;

            const update = { status, ack_at: new Date().toISOString() };
            if (status === 'failed') update.error = 'Delivery failed (ack error)';

            const { data } = await supabase
                .from('whatsapp_blast_recipients')
                .update(update)
                .eq('wa_message_id', waMsgId)
                .select('blast_id');
            if (data && data.length > 0) await refreshBlastCounts(data[0].blast_id);
        } catch (e) {
            console.error('message_ack update error:', e.message);
        }
    });
}

function teardownClient(clearSession) {
    const oldClient = client;
    client = null;
    starting = false;
    resetState();
    if (oldClient) {
        try { oldClient.destroy(); } catch (_) { /* ignore */ }
    }
    if (clearSession) {
        try { fs.rmSync(SESSION_PATH, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
}

async function ensureStarted() {
    loadDeps();
    if (state.connectionState === 'ready') return;
    if (starting || client) return; // initialization in progress or session exists
    starting = true;
    state.connectionState = 'connecting';
    client = new wweb.Client({
        authStrategy: new wweb.LocalAuth({ dataPath: SESSION_PATH }),
        puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });
    wireEvents();
    try {
        await client.initialize();
        initialized = true;
    } catch (e) {
        console.error('WhatsApp client initialize error:', e.message);
        state.lastError = `Initialize failed: ${e.message}`;
        teardownClient(false);
        throw e;
    } finally {
        starting = false;
    }
}

async function reconnect() {
    teardownClient(false);
    await ensureStarted();
}

async function disconnect() {
    cancelledBlasts.clear();
    if (client) {
        try { await client.logout(); } catch (_) { /* ignore */ }
    }
    teardownClient(true);
}

// ---------------------------------------------------------------------------
// Blast pipeline
// ---------------------------------------------------------------------------
async function refreshBlastCounts(blastId) {
    loadSupabase();
    const { data, error } = await supabase
        .from('whatsapp_blast_recipients')
        .select('status')
        .eq('blast_id', blastId);
    if (error) return;
    const counts = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
    data.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    await supabase.from('whatsapp_blasts').update({
        total_recipients: data.length,
        sent_count: counts.sent + counts.delivered + counts.read,
        delivered_count: counts.delivered + counts.read,
        read_count: counts.read,
        failed_count: counts.failed
    }).eq('id', blastId);
}

/**
 * Validate, de-duplicate and persist a blast, then enqueue it.
 * recipients: [{ acctNo, clinicName, contactName, productType, phone }]
 * Returns { blastId, accepted, rejected }.
 */
async function sendBlast({ message, attachment, sender, recipients }) {
    loadDeps();
    if (state.connectionState !== 'ready') {
        const err = new Error('WhatsApp is not connected. Connect and scan the QR code first.');
        err.statusCode = 409;
        throw err;
    }
    if (!message || !String(message).trim()) {
        const err = new Error('Message body is required.');
        err.statusCode = 400;
        throw err;
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
        const err = new Error('At least one recipient is required.');
        err.statusCode = 400;
        throw err;
    }
    if (recipients.length > MAX_RECIPIENTS_PER_BLAST) {
        const err = new Error(`Maximum ${MAX_RECIPIENTS_PER_BLAST} recipients per blast.`);
        err.statusCode = 400;
        throw err;
    }
    if (attachment && attachment.data) {
        const approxBytes = attachment.data.length * 3 / 4;
        if (approxBytes > MAX_ATTACHMENT_BYTES) {
            const err = new Error(`Attachment exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit.`);
            err.statusCode = 400;
            throw err;
        }
    }

    // Server-authoritative validation + de-duplication
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const r of recipients) {
        const norm = normalizeMalaysiaPhone(r.phone);
        if (!norm.ok) {
            rejected.push({ phone: r.phone, reason: norm.reason === 'blank' ? 'missing phone number' : norm.reason });
            continue;
        }
        if (seen.has(norm.phone)) {
            rejected.push({ phone: r.phone, reason: 'duplicate number' });
            continue;
        }
        seen.add(norm.phone);
        accepted.push({
            acct_no: r.acctNo || null,
            clinic_name: r.clinicName || null,
            contact_name: r.contactName || null,
            product_type: r.productType || null,
            phone_raw: String(r.phone || ''),
            phone_wa: norm.phone,
            status: 'queued'
        });
    }
    if (accepted.length === 0) {
        const err = new Error('No valid recipients after validation.');
        err.statusCode = 400;
        err.rejected = rejected;
        throw err;
    }

    const { data: blast, error: blastErr } = await supabase
        .from('whatsapp_blasts')
        .insert([{
            message: String(message).trim(),
            attachment: attachment || null,
            sender: sender || (state.sender ? state.sender.pushname || state.sender.number : null) || 'unknown',
            total_recipients: accepted.length,
            status: 'sending'
        }])
        .select()
        .single();
    if (blastErr) throw new Error('Failed to create blast: ' + blastErr.message);

    const rows = accepted.map(a => ({ ...a, blast_id: blast.id }));
    const { error: recErr } = await supabase.from('whatsapp_blast_recipients').insert(rows);
    if (recErr) throw new Error('Failed to create recipients: ' + recErr.message);

    blastQueue.push(blast.id);
    processQueue();
    return { blastId: blast.id, accepted: accepted.length, rejected };
}

function enqueueExistingBlast(blastId) {
    blastQueue.push(blastId);
    processQueue();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;
    while (blastQueue.length > 0) {
        const blastId = blastQueue.shift();
        try {
            await processBlast(blastId);
        } catch (e) {
            console.error(`Blast ${blastId} processing error:`, e.message);
            try {
                await supabase.from('whatsapp_blasts').update({ status: 'failed' }).eq('id', blastId);
            } catch (_) { /* ignore */ }
        }
    }
    processingQueue = false;
}

async function processBlast(blastId) {
    const { data: blast, error: blastErr } = await supabase
        .from('whatsapp_blasts')
        .select('*')
        .eq('id', blastId)
        .single();
    if (blastErr || !blast) return;
    if (cancelledBlasts.has(blastId) || blast.status === 'cancelled') return;

    const { data: rows } = await supabase
        .from('whatsapp_blast_recipients')
        .select('*')
        .eq('blast_id', blastId)
        .eq('status', 'queued')
        .order('created_at', { ascending: true });

    let media = null;
    if (blast.attachment && blast.attachment.data) {
        media = new wweb.MessageMedia(blast.attachment.mimetype, blast.attachment.data, blast.attachment.filename || 'attachment');
    }

    for (const row of rows || []) {
        if (cancelledBlasts.has(blastId)) {
            await supabase.from('whatsapp_blast_recipients').update({ status: 'skipped' }).eq('id', row.id);
            continue;
        }
        if (state.connectionState !== 'ready' || !client) {
            await supabase.from('whatsapp_blast_recipients')
                .update({ status: 'failed', error: 'WhatsApp not connected' })
                .eq('id', row.id);
            await refreshBlastCounts(blastId);
            continue;
        }
        try {
            const chatId = `${row.phone_wa}@c.us`;
            const sentMsg = media
                ? await client.sendMessage(chatId, blast.message, { media })
                : await client.sendMessage(chatId, blast.message);
            await supabase.from('whatsapp_blast_recipients')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    wa_message_id: sentMsg && sentMsg.id ? sentMsg.id._serialized : null
                })
                .eq('id', row.id);
        } catch (e) {
            await supabase.from('whatsapp_blast_recipients')
                .update({ status: 'failed', error: String(e.message || e).slice(0, 500) })
                .eq('id', row.id);
        }
        await refreshBlastCounts(blastId);
        await delay(SEND_DELAY_MS + Math.floor(Math.random() * 1000)); // jitter
    }

    const { data: finalRows } = await supabase
        .from('whatsapp_blast_recipients')
        .select('status')
        .eq('blast_id', blastId);
    const stillQueued = (finalRows || []).filter(r => r.status === 'queued').length;
    const anySent = (finalRows || []).some(r => ['sent', 'delivered', 'read'].includes(r.status));
    if (!cancelledBlasts.has(blastId)) {
        const finalStatus = cancelledBlasts.has(blastId) ? 'cancelled'
            : (stillQueued === 0 ? (anySent ? 'completed' : 'failed') : 'sending');
        await supabase.from('whatsapp_blasts').update({ status: finalStatus }).eq('id', blastId);
    }
    cancelledBlasts.delete(blastId);
}

async function cancelBlast(blastId) {
    loadSupabase();
    cancelledBlasts.add(blastId);
    await supabase.from('whatsapp_blasts').update({ status: 'cancelled' }).eq('id', blastId);
    await supabase.from('whatsapp_blast_recipients')
        .update({ status: 'skipped' })
        .eq('blast_id', blastId)
        .eq('status', 'queued');
    await refreshBlastCounts(blastId);
}

async function getBlast(blastId) {
    loadSupabase();
    const { data: blast } = await supabase.from('whatsapp_blasts').select('*').eq('id', blastId).single();
    const { data: recipients } = await supabase
        .from('whatsapp_blast_recipients')
        .select('*')
        .eq('blast_id', blastId)
        .order('created_at', { ascending: true });
    return { blast, recipients: recipients || [] };
}

async function shutdown() {
    cancelledBlasts.clear();
    if (client) {
        try { await client.destroy(); } catch (_) { /* ignore */ }
        client = null;
    }
}

module.exports = {
    normalizeMalaysiaPhone,
    getStatus,
    ensureStarted,
    reconnect,
    disconnect,
    sendBlast,
    enqueueExistingBlast,
    cancelBlast,
    getBlast,
    shutdown
};
