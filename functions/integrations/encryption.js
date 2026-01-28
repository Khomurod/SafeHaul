const crypto = require('crypto');

// SECURITY: Encryption key MUST be set via environment variable
// Validation happens on first use to allow deployment analysis
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

// Lazy getter for encryption key with validation
let _encryptionKey = null;
function getEncryptionKey() {
    if (_encryptionKey) return _encryptionKey;

    const key = process.env.SMS_ENCRYPTION_KEY;

    if (!key) {
        throw new Error('CRITICAL SECURITY: SMS_ENCRYPTION_KEY environment variable is not set. Refusing to encrypt/decrypt with insecure defaults.');
    }

    if (key.length !== 32) {
        throw new Error(`CRITICAL SECURITY: SMS_ENCRYPTION_KEY must be exactly 32 characters for AES-256. Got ${key.length} characters.`);
    }

    _encryptionKey = key;
    return _encryptionKey;
}

function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return null;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

module.exports = { encrypt, decrypt };
