const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const result = {
        hasSmtpHost: !!process.env.SMTP_HOST,
        hasSmtpPort: !!process.env.SMTP_PORT,
        hasSmtpUser: !!process.env.SMTP_USER,
        hasSmtpPass: !!process.env.SMTP_PASS,
        hasSmtpFrom: !!process.env.SMTP_FROM,
        smtpHost: process.env.SMTP_HOST || '(not set)',
        smtpPort: process.env.SMTP_PORT || '(not set)',
        smtpUser: process.env.SMTP_USER || '(not set)',
        smtpFrom: process.env.SMTP_FROM || '(not set)',
        smtpPassSet: !!process.env.SMTP_PASS,
    };

    // If all config is present, try to verify connection
    if (result.hasSmtpHost && result.hasSmtpUser && result.hasSmtpPass) {
        try {
            const port = parseInt(process.env.SMTP_PORT || '587', 10);
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port,
                secure: port === 465,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
            });

            await transporter.verify();
            result.connectionOk = true;
            result.message = 'SMTP connection verified successfully!';
            transporter.close();
        } catch (err) {
            result.connectionOk = false;
            result.message = `SMTP connection failed: ${err.message}`;
            result.errorCode = err.code || 'UNKNOWN';
        }
    } else {
        result.connectionOk = false;
        result.message = 'SMTP configuration is incomplete. Set all required environment variables in Vercel Dashboard.';
    }

    return res.status(200).json(result);
};
