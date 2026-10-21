const { normalizePhone } = require("../../shared/normalizePhone");

/**
 * Build canonical + legacy-compatible ledger lookup keys for a phone value.
 * Canonical format is "+<digits>" as produced by shared normalizePhone().
 */
function derivePhoneLedgerKeys(rawPhone) {
    const canonical = normalizePhone(String(rawPhone || ""));
    if (!canonical) return { canonical: null, lookupKeys: [] };

    const keys = new Set([canonical]);
    const digits = canonical.replace(/\D/g, "");
    if (digits) keys.add(digits); // legacy docs stored without "+"

    // Legacy US format often stored as 10 digits.
    if (digits.length === 11 && digits.startsWith("1")) {
        keys.add(digits.slice(1));
    }

    return { canonical, lookupKeys: [...keys] };
}

module.exports = {
    derivePhoneLedgerKeys,
};
