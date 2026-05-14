const nodemailer = require('nodemailer');

// Cache transporter across invocations when possible
let cachedTransporter = null;

function getTransporter() {
    if (cachedTransporter) return cachedTransporter;

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        throw new Error('Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables.');
    }

    cachedTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });

    return cachedTransporter;
}

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { subject, body, recipients, fromName } = req.body || {};

        if (!subject || !body) {
            return res.status(400).json({ error: 'Subject and body are required' });
        }

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient is required' });
        }

        if (recipients.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 recipients per request' });
        }

        const transporter = getTransporter();
        const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
        const fromHeader = fromName ? `"${fromName}" <${smtpFrom}>` : smtpFrom;

        let sentCount = 0;
        const failedRecipients = [];

        // Send emails in sequence to avoid rate limits
        for (const recipient of recipients) {
            const email = recipient.email;
            if (!email || !email.includes('@')) {
                failedRecipients.push({ ...recipient, error: 'Invalid email' });
                continue;
            }

            try {
                await transporter.sendMail({
                    from: fromHeader,
                    to: `"${recipient.name || ''}" <${email}>`,
                    subject,
                    html: body,
                });
                sentCount++;
            } catch (err) {
                console.error(`Failed to send to ${email}:`, err.message);
                failedRecipients.push({ ...recipient, error: err.message });
            }
        }

        return res.status(200).json({
            success: true,
            sentCount,
            totalRecipients: recipients.length,
            failedRecipients
        });

    } catch (err) {
        console.error('Send email error:', err);
        return res.status(500).json({ error: err.message });
    }
};
