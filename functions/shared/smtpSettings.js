/**
 * A company's SMTP settings, read one way for every email the platform sends:
 * the company's own emails (`emailService.js`) and a bulk campaign
 * (`bulkActions/workers/senderSetup.js`).
 *
 * `saveEmailSettings` stores them in `system_settings/email_config`, the
 * password encrypted (`enc:v1:`, `sealPassword`). Older companies keep them on
 * the company document (`emailSettings`), and the oldest in
 * `integrations/email_settings`, with other field names and no server for a
 * Gmail account; a password stored before encryption is plain text. Either is
 * read here, so the calling function binds SMS_ENCRYPTION_KEY.
 */
const crypto = require('crypto');
const { db } = require('../firebaseAdmin');
const { decrypt, encrypt } = require('../integrations/encryption');

const ENCRYPTED = 'enc:v1:';

/** A password as it is stored: encrypted, and marked so. */
function sealPassword(plain) {
    return ENCRYPTED + encrypt(plain);
}

const isSealed = (stored) => typeof stored === 'string' && stored.startsWith(ENCRYPTED);

function plainPassword(stored) {
    if (!stored.startsWith(ENCRYPTED)) return stored;
    try {
        return decrypt(stored.slice(ENCRYPTED.length));
    } catch (err) {
        console.error('[smtpSettings] Failed to decrypt the SMTP password:', err.message);
        throw new Error('Email configuration error: could not decrypt SMTP credentials.');
    }
}

/** Stored settings in one shape, or null when they hold no password. */
function normalizeSmtpSettings(stored) {
    const password = stored?.smtpPass || stored?.password;
    if (!password) return null;
    return {
        host: String(stored.smtpHost || stored.host || '').trim(),
        port: Number(stored.smtpPort || stored.port) || 587,
        user: stored.smtpUser || stored.email || '',
        pass: plainPassword(password),
        signature: stored.signature || '',
    };
}

/** Of the stored settings, newest place first, the first that holds a password: the ones email is sent with. */
function effectiveStoredSettings(...candidates) {
    return candidates.find((candidate) => candidate?.smtpPass || candidate?.password) || null;
}

/** The first settings holding a password, newest place first, and the company's name. */
async function readSmtpSettings(companyId) {
    const companyRef = db.collection('companies').doc(companyId);
    const [companySnap, configSnap] = await Promise.all([
        companyRef.get(),
        companyRef.collection('system_settings').doc('email_config').get(),
    ]);
    if (!companySnap.exists) throw new Error(`Company not found: ${companyId}`);
    const company = companySnap.data();
    const companyName = company.companyName || 'SafeHaul';

    const stored = effectiveStoredSettings(configSnap.exists ? configSnap.data() : null, company.emailSettings);
    if (stored) return { settings: normalizeSmtpSettings(stored), companyName };

    const oldest = await companyRef.collection('integrations').doc('email_settings').get();
    return { settings: oldest.exists ? normalizeSmtpSettings(oldest.data()) : null, companyName };
}

/** Nodemailer options for the settings: TLS from the start on port 465, STARTTLS otherwise. */
function smtpTransportOptions(settings) {
    const server = settings.host
        ? { host: settings.host, port: settings.port, secure: settings.port === 465 }
        : { service: 'gmail' };
    return {
        ...server,
        auth: { user: settings.user, pass: settings.pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
    };
}

/** Changes whenever the server, the account or the password changes. */
function smtpFingerprint(settings) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([settings.host, settings.port, settings.user, settings.pass]))
        .digest('hex');
}

module.exports = {
    effectiveStoredSettings, isSealed, normalizeSmtpSettings, plainPassword, readSmtpSettings, sealPassword, smtpTransportOptions, smtpFingerprint,
};
