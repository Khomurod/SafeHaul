const crypto = require('crypto');

// Use a fixed key from env or fallback for dev/demo purposes
// In production, this MUST be a secure, random 32-byte key
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.SMS_ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 chars
const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return null;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

module.exports = { encrypt, decrypt };
