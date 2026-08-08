/**
 * Operator-controlled provider order.
 *
 * The registry's `priority` field is the *default* order SafeHaul ships with.
 * A Super Admin can override it — "try Mistral first, then Gemini" — and that
 * override lives in one Firestore document, `ai_routing_config/order`.
 *
 * Two properties make this safe to put in front of every AI call in the
 * platform:
 *
 *  1. **It degrades, it never disables.** A missing document, an empty list, a
 *     malformed field, an unreadable collection — every one of them yields the
 *     built-in registry order. `orderProviders` cannot return an empty list
 *     from a non-empty registry, and `readProviderOrder` cannot throw. AI
 *     stopping platform-wide because a configuration document was deleted is
 *     the failure this module exists to make impossible.
 *  2. **It only reorders.** Ordering happens *before* eligibility, so
 *     capability gating, `enabled`, retirement, cooldown and model resolution
 *     are unchanged and still apply afterwards. Promoting a provider to first
 *     place cannot make it serve a task it cannot do.
 *
 * One document rather than a field per provider, so a reorder is a single
 * atomic write: there is no interval during which the stored order is half of
 * the old one and half of the new.
 */

const { admin, db } = require('../../firebaseAdmin');

/** Server-only collection. `src/firestore.rules` denies every client. */
const COLLECTION = 'ai_routing_config';

/** The single document. There is exactly one global order. */
const ORDER_DOC = 'order';

/**
 * Ceiling on how many ids are read out of the stored document. It is far above
 * the registry's nine, so it never truncates a legitimate order; it exists so a
 * corrupt or hostile document cannot hand the router an unbounded array.
 */
const MAX_STORED_IDS = 50;

/**
 * Reduces whatever is in the document to a list of plausible provider ids.
 * Ids are *not* checked against the registry here — `orderProviders` ignores
 * anything it cannot resolve, which is the one place that decision belongs.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function sanitizeOrder(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim();
        if (!trimmed) continue;
        out.push(trimmed);
        if (out.length >= MAX_STORED_IDS) break;
    }
    return out;
}

/**
 * Applies a stored order to the registry rows.
 *
 * Pure and synchronous, so the fail-safe behaviour above can be asserted
 * without a Firestore double.
 *
 *  - providers named in `storedOrder` come first, in that order;
 *  - every provider the list does not name follows, in registry order;
 *  - ids that are not in the registry are ignored;
 *  - a repeated id keeps its first occurrence;
 *  - a missing, empty or malformed list yields the registry order unchanged.
 *
 * @param {object[]} registryProviders registry rows, already in `priority` order
 * @param {unknown} storedOrder the stored `providerIds`, or anything at all
 * @returns {object[]} every registry row, exactly once
 */
function orderProviders(registryProviders, storedOrder) {
    const providers = Array.isArray(registryProviders)
        ? registryProviders.filter((provider) => provider && typeof provider.id === 'string')
        : [];
    if (providers.length === 0) return [];

    const ids = sanitizeOrder(storedOrder);
    if (ids.length === 0) return providers.slice();

    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const ranked = [];
    const placed = new Set();

    for (const id of ids) {
        const provider = byId.get(id);
        // An unknown id is dropped rather than treated as a gap: the registry
        // is the authority on which providers exist, and a stale document
        // naming a removed provider must not shrink the order.
        if (!provider || placed.has(id)) continue;
        placed.add(id);
        ranked.push(provider);
    }

    // Anything the operator did not rank keeps its registry position, so a
    // partial list is a valid list and a newly added provider appears without
    // anyone having to re-save the order.
    for (const provider of providers) {
        if (!placed.has(provider.id)) ranked.push(provider);
    }

    return ranked;
}

function orderRef() {
    return db.collection(COLLECTION).doc(ORDER_DOC);
}

/**
 * Reads the stored order. Never throws and never rejects: an unavailable
 * document is reported as "no override", which the caller turns into the
 * registry order.
 *
 * @returns {Promise<string[]>}
 */
async function readProviderOrder() {
    try {
        const snapshot = await orderRef().get();
        if (!snapshot || !snapshot.exists) return [];
        return sanitizeOrder((snapshot.data() || {}).providerIds);
    } catch (error) {
        // Deliberately a warning, not an error: routing continues on the
        // registry order, so this is degraded configuration rather than a
        // failed request.
        console.warn('[ai/router] Routing order unavailable; using the registry default.', {
            message: error?.message || 'unknown',
        });
        return [];
    }
}

/**
 * Replaces the stored order. Callers must have authorized and must have
 * validated every id against the registry first — this writes what it is given.
 *
 * @param {string[]} providerIds
 * @param {string|null} updatedBy actor uid, for the document's own record
 */
async function writeProviderOrder(providerIds, updatedBy = null) {
    const ids = sanitizeOrder(providerIds);
    await orderRef().set({
        providerIds: ids,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: typeof updatedBy === 'string' ? updatedBy : null,
    }, { merge: true });
    return ids;
}

module.exports = {
    COLLECTION,
    ORDER_DOC,
    MAX_STORED_IDS,
    orderProviders,
    readProviderOrder,
    sanitizeOrder,
    writeProviderOrder,
};
