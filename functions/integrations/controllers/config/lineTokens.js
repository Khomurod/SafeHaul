/**
 * Shared helpers for stable SMS line identifiers.
 * Extracted verbatim from configController.js.
 *
 * Some customer browsers/DLP layers redact phone numbers in Firestore snapshots,
 * so the UI works with stable line tokens instead of raw phone values. These
 * helpers derive those tokens from inventory entries.
 */

const crypto = require('crypto');
const { isLikelyValidPhone, normalizePhoneForKeychain } = require('../../../utils/phoneUtils');

const stableLineIdForPhone = (phoneNumber) => {
    if (!phoneNumber) return '';
    try {
        const normalized = normalizePhoneForKeychain(String(phoneNumber));
        if (!isLikelyValidPhone(normalized)) return '';
        return `line_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
    } catch {
        return '';
    }
};

const lineTokenForInventoryItem = (line, idx) => {
    return line?.lineId || line?.id || stableLineIdForPhone(line?.phoneNumber) || `ln${idx}`;
};

const withStableLineIds = (inventory = []) => inventory.map((line, idx) => ({
    ...(line || {}),
    lineId: lineTokenForInventoryItem(line, idx)
}));

module.exports = { stableLineIdForPhone, lineTokenForInventoryItem, withStableLineIds };
