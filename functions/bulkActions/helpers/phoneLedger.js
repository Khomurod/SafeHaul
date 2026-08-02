const { admin } = require("../../firebaseAdmin");
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

function isCanonicalPhoneLedgerKey(phoneKey) {
    return /^\+\d{10,20}$/.test(String(phoneKey || ""));
}

function buildSmsLedgerThreshold(excludeRecentDays) {
    if (excludeRecentDays === "forever") return null;

    const days = parseInt(excludeRecentDays, 10);
    const safeDays = Number.isFinite(days) && days > 0 ? days : 7;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - safeDays);
    return admin.firestore.Timestamp.fromDate(thresholdDate);
}

function shouldIncludeLedgerDoc(lastSentAt, thresholdTs) {
    if (!lastSentAt) return false;
    if (thresholdTs === null) return true; // "forever"
    return lastSentAt >= thresholdTs;
}

/**
 * Resolve which canonical phones were already messaged by checking both
 * canonical and legacy key styles in sms_sent_phones.
 */
async function findRecentlyMessagedCanonicalPhones({
    db,
    companyId,
    canonicalPhones,
    thresholdTs
}) {
    const canonicalList = [...new Set((canonicalPhones || []).filter(Boolean))];
    if (canonicalList.length === 0) return new Set();

    const lookupKeyToCanonical = new Map();
    const lookupKeys = new Set();

    canonicalList.forEach((canonical) => {
        const { lookupKeys: keys } = derivePhoneLedgerKeys(canonical);
        keys.forEach((key) => {
            lookupKeys.add(key);
            if (!lookupKeyToCanonical.has(key)) lookupKeyToCanonical.set(key, new Set());
            lookupKeyToCanonical.get(key).add(canonical);
        });
    });

    const matchedCanonicals = new Set();
    const allLookupKeys = [...lookupKeys];

    for (let i = 0; i < allLookupKeys.length; i += 10) {
        const chunk = allLookupKeys.slice(i, i + 10);
        const docRefs = chunk.map((key) =>
            db.collection("companies").doc(companyId).collection("sms_sent_phones").doc(key)
        );

        const snapshots = await db.getAll(...docRefs);
        snapshots.forEach((snap) => {
            if (!snap.exists) return;
            const data = snap.data();
            if (!shouldIncludeLedgerDoc(data?.lastSentAt, thresholdTs)) return;

            const mappedCanonicals = lookupKeyToCanonical.get(snap.id);
            if (!mappedCanonicals) return;
            mappedCanonicals.forEach((canonical) => matchedCanonicals.add(canonical));
        });
    }

    return matchedCanonicals;
}

module.exports = {
    derivePhoneLedgerKeys,
    isCanonicalPhoneLedgerKey,
    buildSmsLedgerThreshold,
    findRecentlyMessagedCanonicalPhones,
};
