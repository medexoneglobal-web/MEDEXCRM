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
// Free-tier resilience (Render Free has no persistent disk — /tmp is wiped on
// every restart/sleep, which used to kill the pairing each time):
//  - the LocalAuth session folder is zipped and backed up to Supabase Storage
//    every few minutes while connected, and restored before the client starts
//  - WA_AUTO_CONNECT=true reconnects automatically after every process restart
//  - interrupted blasts resume once the connection is back
//  - WA_KEEPALIVE_URL makes the service ping itself so Render never sleeps
// ---------------------------------------------------------------------------
const AUTO_CONNECT = String(process.env.WA_AUTO_CONNECT || '').toLowerCase() === 'true';
const AUTO_CONNECT_DELAY_MS = parseInt(process.env.WA_AUTO_CONNECT_DELAY_MS || '15000', 10);
const SESSION_BACKUP_INTERVAL_MS = parseInt(process.env.WA_SESSION_BACKUP_INTERVAL_MS || '300000', 10);
const KEEPALIVE_URL = (process.env.WA_KEEPALIVE_URL || '').replace(/\/+$/, '');
const KEEPALIVE_MS = Math.max(1, parseInt(process.env.WA_KEEPALIVE_MINUTES || '10', 10)) * 60000;
const SESSION_BUCKET = 'whatsapp-sessions';
const SESSION_BACKUP_FILE = 'current.zip';

let sessionBucketChecked = false;
let backupTimer = null;
let autoConnectTimer = null;

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
        // Node < 22 has no native WebSocket, which @supabase/supabase-js needs for
        // its RealtimeClient — supply the `ws` package as transport so the backend
        // also runs on older Node versions (Render runs Node 24, unaffected).
        const realtime = {};
        try { realtime.transport = require('ws'); } catch (_) { /* Node >= 22: native WebSocket */ }
        supabase = createClient(url, key, { realtime });
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
    connectionState: 'disconnected', // disconnected | connecting | qr | authenticated | ready
    qr: null,                        // latest QR code as a data-URL
    sender: null,                    // { number, pushname } when ready
    lastError: null
};

let client = null;
// Initialization lock: guarantees a single Client instance and a single
// client.initialize() call per client. Never start a second initialize while
// one is in progress — duplicate initialize() on a live client is what
// produced "Protocol error (Runtime.callFunctionOn): Execution context was destroyed".
let isInitializing = false;

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
// Free-tier resilience: session backup/restore + blast recovery
// ---------------------------------------------------------------------------
async function ensureSessionBucket() {
    if (sessionBucketChecked) return;
    sessionBucketChecked = true;
    try {
        const { data: buckets } = await supabase.storage.listBuckets();
        if ((buckets || []).some(b => b.name === SESSION_BUCKET)) return;
        const { error } = await supabase.storage.createBucket(SESSION_BUCKET, { private: true });
        if (error && !/already exist/i.test(error.message)) {
            console.error('[WhatsApp] Storage bucket creation failed:', error.message);
        }
    } catch (e) {
        console.error('[WhatsApp] Storage bucket check failed:', e.message);
    }
}

async function backupSession() {
    try {
        if (state.connectionState !== 'ready') return;
        if (!supabase) return;
        if (!fs.existsSync(SESSION_PATH)) return;
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        // No root prefix: the zip mirrors the folder as-is (session/creds.json),
        // so extractAllTo(SESSION_PATH) restores the exact original layout.
        zip.addLocalFolder(SESSION_PATH);
        const buf = zip.toBuffer();
        if (!buf || !buf.length) return;
        await ensureSessionBucket();
        const { error } = await supabase.storage
            .from(SESSION_BUCKET)
            .upload(SESSION_BACKUP_FILE, buf, { contentType: 'application/zip', upsert: true });
        if (error) console.error('[WhatsApp] Session backup failed:', error.message);
    } catch (e) {
        console.error('[WhatsApp] Session backup error:', e.message);
    }
}

function startSessionBackupTimer() {
    if (backupTimer) return;
    backupTimer = setInterval(() => { backupSession(); }, SESSION_BACKUP_INTERVAL_MS);
    if (backupTimer.unref) backupTimer.unref();
}

async function deleteSessionBackup() {
    try {
        if (!supabase) return;
        await supabase.storage.from(SESSION_BUCKET).remove([SESSION_BACKUP_FILE]);
    } catch (_) { /* ignore */ }
}

/**
 * Restore the pairing from the Supabase backup when the local session folder
 * was wiped (free-tier restarts clear /tmp). A valid restored session lets
 * LocalAuth reconnect without showing a new QR code.
 */
async function restoreSession() {
    try {
        if (fs.existsSync(SESSION_PATH) && fs.readdirSync(SESSION_PATH).length > 0) return false;
        loadSupabase();
        const { data, error } = await supabase.storage.from(SESSION_BUCKET).download(SESSION_BACKUP_FILE);
        if (error || !data) return false;
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer());
        if (!raw.length) return false;
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(raw);
        fs.mkdirSync(SESSION_PATH, { recursive: true });
        zip.extractAllTo(SESSION_PATH, true);
        console.log('[WhatsApp] Session restored from Supabase backup');
        return true;
    } catch (e) {
        console.error('[WhatsApp] Session restore failed:', e.message);
        return false;
    }
}

/** Re-enqueue blasts that were interrupted by a crash/restart. */
async function recoverInterruptedBlasts() {
    try {
        loadSupabase();
        const { data: blasts } = await supabase.from('whatsapp_blasts').select('id').eq('status', 'sending');
        for (const b of blasts || []) {
            const { count } = await supabase.from('whatsapp_blast_recipients')
                .select('id', { count: 'exact', head: true })
                .eq('blast_id', b.id)
                .eq('status', 'queued');
            if (count > 0) {
                console.log(`[WhatsApp] Resuming interrupted blast ${b.id} (${count} queued)`);
                enqueueExistingBlast(b.id);
            }
        }
    } catch (e) {
        console.error('[WhatsApp] Blast recovery error:', e.message);
    }
}

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------
function wireEvents() {
    client.on('qr', async (qr) => {
        console.log('[WhatsApp] QR received');
        try {
            state.qr = await qrCodeLib.toDataURL(qr, { margin: 1, width: 280 });
        } catch (e) {
            console.error('[WhatsApp] QR generation error:', e.message);
        }
        // Only ever update the stored QR — never build a new Client here.
        state.connectionState = 'qr';
    });

    client.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated');
        state.connectionState = 'authenticated';
        state.qr = null; // scan complete — a stale QR must never be shown again
    });

    client.on('ready', () => {
        console.log('[WhatsApp] Ready');
        state.connectionState = 'ready';
        state.qr = null;
        const info = client.info || {};
        state.sender = {
            number: info.wid ? info.wid.user : '',
            pushname: info.pushname || ''
        };
        state.lastError = null;
        console.log(`[WhatsApp] Connected as ${state.sender.pushname || state.sender.number}`);
        // Free-tier resilience: persist the pairing, keep persisting it, and
        // resume any blast that a crash/restart interrupted.
        backupSession();
        startSessionBackupTimer();
        recoverInterruptedBlasts();
    });

    client.on('auth_failure', (msg) => {
        console.error('[WhatsApp] Authentication failure:', msg);
        state.lastError = `Authentication failed: ${msg}`;
        teardownClient(true); // stored session was rejected — clear it
    });

    client.on('disconnected', (reason) => {
        console.log('[WhatsApp] Disconnected:', reason);
        state.lastError = `Disconnected: ${reason}`;
        // Keep the session files: on restart LocalAuth silently restores a valid
        // session without a new QR. (Only an explicit Disconnect clears them.)
        teardownClient(false);
    });

    client.on('change_state', (s) => {
        console.log('[WhatsApp] State changed:', s);
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
    isInitializing = false;
    resetState();
    if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
    if (oldClient) {
        try { oldClient.destroy(); } catch (_) { /* ignore */ }
    }
    if (clearSession) {
        try { fs.rmSync(SESSION_PATH, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        // The stored session is being discarded on purpose (explicit Disconnect
        // / Reconnect, or auth failure) — the remote backup must not resurrect it.
        deleteSessionBackup();
    }
}

/**
 * Idempotent start. Safe to call on every "Connect" press:
 *  - does nothing while a client already exists (any state)
 *  - does nothing while an initialization is already running
 *  - otherwise creates the single Client instance and initializes it once
 */
async function ensureStarted() {
    loadDeps();
    if (client || isInitializing) return;
    isInitializing = true;
    state.connectionState = 'connecting';
    state.lastError = null;
    // If a restart/sleep wiped the session folder, restore the pairing from the
    // Supabase backup first — a valid session then reconnects with no new QR.
    await restoreSession();
    client = new wweb.Client({
        authStrategy: new wweb.LocalAuth({ dataPath: SESSION_PATH }),
        puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });
    wireEvents();
    let initWatchdog = null;
    try {
        const initPromise = client.initialize();
        // Swallow a late rejection once the watchdog has already won the race.
        initPromise.catch(() => { });
        const watchdog = new Promise((_, reject) => {
            initWatchdog = setTimeout(() => reject(new Error('Initialization timed out after 120s')), 120000);
        });
        await Promise.race([initPromise, watchdog]);
    } catch (e) {
        const msg = String(e.message || e);
        // WhatsApp Web reloads its page the instant the QR is scanned. Any
        // puppeteer evaluate() in flight during that reload rejects with
        // "Execution context was destroyed". The client underneath is still
        // healthy and will emit 'authenticated' then 'ready' — tearing the
        // browser down here was the old bug that spawned duplicate clients.
        if (/execution context was destroyed/i.test(msg)) {
            console.log('[WhatsApp] Page reload during initialization (QR scan in progress) — keeping the client alive.');
            return;
        }
        console.error('[WhatsApp] Initialize failed:', msg);
        state.lastError = `Initialize failed: ${msg}`;
        teardownClient(false);
        throw e;
    } finally {
        if (initWatchdog) clearTimeout(initWatchdog);
        isInitializing = false;
    }
}

/**
 * Explicit user reset ("Reconnect" button). This is the ONLY path allowed to
 * destroy a live client — and it still never interrupts an in-flight
 * initialization, because killing the browser mid-auth is what cascaded into
 * the duplicate-client protocol errors.
 */
async function reconnect() {
    loadDeps();
    if (isInitializing) return;
    if (client) teardownClient(true); // clear session so the next start shows a fresh QR
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
        let sendErr = null;
        let sentMsg = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const chatId = `${row.phone_wa}@c.us`;
                sentMsg = media
                    ? await client.sendMessage(chatId, blast.message, { media })
                    : await client.sendMessage(chatId, blast.message);
                sendErr = null;
                break;
            } catch (e) {
                sendErr = e;
                const msg = String(e.message || e);
                // WhatsApp Web reloads its page periodically (authenticated ->
                // ready again). While the store re-warms, sendMessage can fail
                // with "Data passed to getter must include an id property" or
                // evaluation/protocol errors. Those are transient — wait for
                // the store to warm and retry instead of failing the recipient.
                const retryable = /id property|memoize|Evaluation failed|Execution context|Protocol error|not (connected|ready)|LOGGED_OUT|logged out/i.test(msg);
                if (!retryable || attempt === 3) break;
                console.log(`[WhatsApp] Send to ${row.phone_wa} failed (attempt ${attempt}/3): ${msg.slice(0, 140)} — retrying in 30s`);
                await delay(30000);
            }
        }
        if (sendErr) {
            await supabase.from('whatsapp_blast_recipients')
                .update({ status: 'failed', error: String(sendErr.message || sendErr).slice(0, 500) })
                .eq('id', row.id);
        } else {
            await supabase.from('whatsapp_blast_recipients')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    wa_message_id: sentMsg && sentMsg.id ? sentMsg.id._serialized : null
                })
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
    if (autoConnectTimer) { clearTimeout(autoConnectTimer); autoConnectTimer = null; }
    if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
    if (client) {
        try { await client.destroy(); } catch (_) { /* ignore */ }
        client = null;
    }
    isInitializing = false;
}

// ---------------------------------------------------------------------------
// Boot behaviour: auto-connect (with session restore) + optional keep-alive
// ---------------------------------------------------------------------------
if (AUTO_CONNECT) {
    autoConnectTimer = setTimeout(() => {
        console.log('[WhatsApp] Auto-connecting (restoring session if needed)...');
        ensureStarted().catch(e => console.error('[WhatsApp] Auto-connect failed:', e.message));
    }, AUTO_CONNECT_DELAY_MS);
    if (autoConnectTimer.unref) autoConnectTimer.unref();
}

if (KEEPALIVE_URL) {
    // Render Free sleeps after ~15 min without inbound traffic. A light
    // self-ping resets that timer so the service (and its WhatsApp session)
    // stays alive. (An external monitor like UptimeRobot works too.)
    const https = require('https');
    const ping = () => {
        try {
            https.get(`${KEEPALIVE_URL}/api/whatsapp/status`, (res) => { res.resume(); }).on('error', () => { });
        } catch (_) { /* ignore */ }
    };
    setInterval(ping, KEEPALIVE_MS);
    console.log(`[WhatsApp] Keep-alive ping every ${KEEPALIVE_MS / 60000} min -> ${KEEPALIVE_URL}`);
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
