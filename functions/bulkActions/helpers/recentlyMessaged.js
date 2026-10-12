// functions/bulkActions/helpers/recentlyMessaged.js
//
// Who a campaign's "Exclude Previously Messaged" window leaves out, decided one
// way for the count, the preview list and the launch, for CRM leads and
// uploaded lists alike. Each of them used to carry its own copy of the rule,
// and the copies disagreed on what a bad window meant and on which of a lead's
// two stamps counted.

const { admin } = require("../../firebaseAdmin");
const { derivePhoneLedgerKeys } = require("./phoneLedger");

const DEFAULT_DAYS = 7;
// Ledger documents read per getAll, and getAll calls in flight at once. Ten per
// call, one call at a time, was about 1,500 round trips for 5,000 numbers.
const LOOKUP_CHUNK = 100;
const LOOKUP_PARALLEL = 10;

/**
 * The window, read one way: nothing or 'off' is no window, 'forever' is every
 * past message, a number is that many days back, and anything else is 7 days.
 * @returns {{ active: boolean, since: object|null }} `since` is null for 'forever'.
 */
function excludeWindow(excludeRecentDays) {
    if (!excludeRecentDays || excludeRecentDays === "off") return { active: false, since: null };
    if (excludeRecentDays === "forever") return { active: true, since: null };
    const parsed = parseInt(excludeRecentDays, 10);
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAYS;
    const date = new Date();
    date.setDate(date.getDate() - days);
    return { active: true, since: admin.firestore.Timestamp.fromDate(date) };
}

/** Whether a stamp falls inside the window; for 'forever', any stamp does. */
function withinWindow(stamp, window) {
    if (!window.active || !stamp) return false;
    return window.since === null || stamp >= window.since;
}

/**
 * Whether a CRM lead's own stamps put a message inside the window: the bulk
 * system's lastBulkMessageAt, or lastContactedAt, which single texts and the old
 * reactivation batches set. Either one counts.
 */
function leadMessagedWithin(data, window) {
    return withinWindow(data?.lastBulkMessageAt, window) || withinWindow(data?.lastContactedAt, window);
}

/** The email ledger's document id: the lowercased address, base64url without padding. */
function emailLedgerKey(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized.includes("@")) return null;
    return Buffer.from(normalized, "utf8").toString("base64")
        .replace(/=+$/, "")
        .replace(/\//g, "_")
        .replace(/\+/g, "-");
}

function addTo(map, id, key) {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(key);
}

/**
 * Reads the ledger documents named in `byId` and adds the keys of those inside
 * the window. A read that fails is logged and keeps what was found before it:
 * it must not drop another ledger's matches, so each ledger fails on its own.
 */
async function readLedger({ db, collection, name, byId, window, messaged }) {
    const ids = [...byId.keys()];
    const chunks = [];
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) chunks.push(ids.slice(i, i + LOOKUP_CHUNK));
    try {
        for (let i = 0; i < chunks.length; i += LOOKUP_PARALLEL) {
            const wave = chunks.slice(i, i + LOOKUP_PARALLEL);
            const results = await Promise.all(wave.map((chunk) => db.getAll(...chunk.map((id) => collection.doc(id)))));
            results.flat().forEach((snap) => {
                if (!snap.exists || !withinWindow(snap.data()?.lastSentAt, window)) return;
                byId.get(snap.id)?.forEach((key) => messaged.add(key));
            });
        }
    } catch (err) {
        console.error(`[recentlyMessaged] ${name} read failed (proceeding with what was found):`, err);
    }
}

/**
 * The keys of the recipients messaged inside the window by the company's ledgers:
 * the SMS ledger for every campaign, under a number's canonical and legacy keys,
 * and the email ledger for an email campaign. A ledger that cannot be read
 * leaves out only its own matches.
 * @param {{ db: object, companyId: string, window: object, method?: string,
 *           recipients: Array<{ key: string, phone?: string, email?: string }> }} args
 * @returns {Promise<Set<string>>}
 */
async function recipientsMessagedWithin({ db, companyId, window, method, recipients }) {
    const messaged = new Set();
    if (!window.active || !recipients?.length) return messaged;
    const company = db.collection("companies").doc(companyId);

    const byPhoneKey = new Map();
    recipients.forEach(({ key, phone }) => {
        derivePhoneLedgerKeys(phone || "").lookupKeys.forEach((id) => addTo(byPhoneKey, id, key));
    });
    await readLedger({ db, collection: company.collection("sms_sent_phones"), name: "sms_sent_phones", byId: byPhoneKey, window, messaged });

    if (method === "email") {
        const byEmailKey = new Map();
        recipients.forEach(({ key, email }) => {
            const id = emailLedgerKey(email);
            if (id) addTo(byEmailKey, id, key);
        });
        await readLedger({ db, collection: company.collection("email_sent_addresses"), name: "email_sent_addresses", byId: byEmailKey, window, messaged });
    }
    return messaged;
}

module.exports = {
    excludeWindow,
    withinWindow,
    leadMessagedWithin,
    emailLedgerKey,
    recipientsMessagedWithin,
    LOOKUP_CHUNK,
};
