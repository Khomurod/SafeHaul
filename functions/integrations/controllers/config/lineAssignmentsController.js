/**
 * SMS recruiter line assignments. Extracted verbatim from configController.js.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { normalizePhoneForKeychain } = require('../../../utils/phoneUtils');
const { lineTokenForInventoryItem, withStableLineIds } = require('./lineTokens');

// Shared options for functions that need encryption capabilities
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

/**
 * Save line assignments by stable inventory line IDs instead of trusting
 * browser-visible phone values. Some customer browsers/DLP layers redact phone
 * numbers in Firestore snapshots and <option> values, which makes the UI unable to
 * persist a selected line. This callable re-reads the authoritative inventory with
 * Admin SDK and maps the UI token back to the real phone number server-side.
 */
exports.saveSmsLineAssignments = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, assignmentTokens = {}, defaultToken } = request.data || {};
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
    if (assignmentTokens && typeof assignmentTokens !== 'object') {
        throw new HttpsError('invalid-argument', 'assignmentTokens must be an object.');
    }

    const { assertCompanyAdminStrict } = require('../../../shared/companyAccess');
    await assertCompanyAdminStrict(request.auth.uid, companyId);

    const providerDocRef = admin.firestore()
        .collection('companies').doc(companyId)
        .collection('integrations').doc('sms_provider');

    const snap = await providerDocRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'SMS provider config was not found.');

    const data = snap.data() || {};
    const inventory = withStableLineIds(Array.isArray(data.inventory) ? data.inventory : []);
    const tokenToLine = new Map();
    const phoneToLine = new Map();
    inventory.forEach((line, idx) => {
        const stableToken = lineTokenForInventoryItem(line, idx);
        tokenToLine.set(stableToken, line);
        // Backward compatibility for already-rendered/saved selections from the
        // first token implementation. We accept lnN, but always re-persist the
        // stable lineId so future saves survive inventory reordering/removal.
        tokenToLine.set(`ln${idx}`, line);
        // Phone -> line, used to backfill tokens for legacy assignments saved as a raw
        // phone before line tokens existed.
        try {
            const normalized = line?.phoneNumber ? normalizePhoneForKeychain(String(line.phoneNumber)) : '';
            if (normalized) phoneToLine.set(normalized, line);
        } catch { /* ignore malformed inventory phone */ }
    });

    // Resolve the stable line token for a stored phone number (best-effort).
    const tokenForStoredPhone = (phone) => {
        if (!phone) return '';
        try {
            const line = phoneToLine.get(normalizePhoneForKeychain(String(phone)));
            return line ? lineTokenForInventoryItem(line, 0) : '';
        } catch {
            return '';
        }
    };

    const updates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid
    };

    const nextAssignments = { ...(data.assignments || {}) };
    const nextAssignmentLineTokens = { ...(data.assignmentLineTokens || {}) };
    for (const [uid, token] of Object.entries(assignmentTokens || {})) {
        if (!uid) continue;
        if (!token) {
            nextAssignments[uid] = '';
            nextAssignmentLineTokens[uid] = '';
            continue;
        }
        const line = tokenToLine.get(token);
        if (!line) {
            throw new HttpsError('invalid-argument', `Unknown phone line selection: ${token}`);
        }
        const phone = line?.phoneNumber || '';
        if (!phone) {
            throw new HttpsError('failed-precondition', `Selected phone line ${token} has no phone number in inventory.`);
        }
        nextAssignments[uid] = phone;
        nextAssignmentLineTokens[uid] = lineTokenForInventoryItem(line, 0);
    }

    // Backfill: any existing assignment that has a real phone but no line token yet
    // (legacy assignments saved before line tokens existed) gets its stable token
    // derived from the phone here. Without this, a browser that redacts phone numbers
    // can't connect the saved phone to a line and shows "No Direct Line" even though
    // the assignment is live and sending. Non-destructive: phones are left unchanged.
    for (const [uid, phone] of Object.entries(nextAssignments)) {
        if (!uid) continue;
        if (nextAssignmentLineTokens[uid]) continue; // already resolved
        const backfilled = tokenForStoredPhone(phone);
        if (backfilled) nextAssignmentLineTokens[uid] = backfilled;
    }

    updates.assignments = nextAssignments;
    updates.assignmentLineTokens = nextAssignmentLineTokens;

    if (Object.prototype.hasOwnProperty.call(request.data || {}, 'defaultToken')) {
        if (!defaultToken) {
            updates.defaultPhoneNumber = '';
            updates.defaultLineToken = '';
        } else {
            const line = tokenToLine.get(defaultToken);
            if (!line) {
                throw new HttpsError('invalid-argument', `Unknown default phone line selection: ${defaultToken}`);
            }
            const phone = line?.phoneNumber || '';
            if (!phone) {
                throw new HttpsError('failed-precondition', `Selected default line ${defaultToken} has no phone number in inventory.`);
            }
            updates.defaultPhoneNumber = phone;
            updates.defaultLineToken = lineTokenForInventoryItem(line, 0);
        }
    } else if (!data.defaultLineToken && data.defaultPhoneNumber) {
        // Default line not being changed, but its token is missing (legacy) -> backfill it
        // so the default dropdown can show the configured line under phone redaction.
        const backfilledDefault = tokenForStoredPhone(data.defaultPhoneNumber);
        if (backfilledDefault) updates.defaultLineToken = backfilledDefault;
    }

    updates.inventory = inventory;

    await providerDocRef.update(updates);
    return { success: true };
});
