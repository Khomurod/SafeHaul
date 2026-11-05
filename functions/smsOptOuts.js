/**
 * A company's SMS opt-out list, kept by its team in Settings → Text messages:
 * list it, add a number, remove one.
 *
 * `companies/{companyId}/blacklist/{E.164}` is the list every automatic text
 * checks (`isBlacklisted` in `blacklist.js`, through `shared/smsPermission.js`),
 * and campaigns check it before an email too. No Firestore rule names it, so a
 * client reaches it only through these callables.
 *
 * - List and add: any member of the company's team
 *   (`assertCompanyAccessForRequest`), because honouring a STOP must be easy.
 * - Remove: Company Admins only (`assertCompanyAdminStrict`). Only the company's
 *   entry goes; the global `blacklist` is never touched here. There is no
 *   company audit store, so who removed which number is in the function's log.
 *
 * Entries keep the shape `handleOptOut` writes (`reason`, `timestamp`), and an
 * added one says who added it (`addedBy`, `addedByName`, `source: 'team'`).
 * Logs carry ids and a number's last four digits, never the number.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest, assertCompanyAdminStrict } = require('./shared/companyAccess');
const { normalizePhone } = require('./shared/normalizePhone');

/** The most entries one list shows, newest first; the total is counted. */
const LIST_LIMIT = 300;
const MAX_REASON_LENGTH = 200;
const DEFAULT_REASON = 'Asked not to be texted';
const COMPANY_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** E.164 holds at most 15 digits after the plus. */
const MAX_E164_LENGTH = 16;
const ALREADY_EXISTS = 6;

const listOf = (companyId) => db.collection('companies').doc(companyId).collection('blacklist');

/** A number as the logs may show it: its last four digits. */
const masked = (phone) => `…${phone.slice(-4)}`;

/**
 * A read or write that failed, logged by its code alone: a Firestore message can
 * name the document, and so the number.
 */
function storeFailure(label, companyId, error, message) {
    console.error(`[${label}] failed for company ${companyId}: ${error?.code || error?.name || 'error'}`);
    return new HttpsError('internal', message);
}

function signedIn(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login required.');
    return uid;
}

function companyIdOf(request) {
    const companyId = typeof request.data?.companyId === 'string' ? request.data.companyId.trim() : '';
    if (!COMPANY_ID.test(companyId)) throw new HttpsError('invalid-argument', 'companyId is required.');
    return companyId;
}

function phoneOf(request) {
    const raw = request.data?.phone;
    const phone = typeof raw === 'string' && raw.length <= 40 ? normalizePhone(raw) : null;
    if (!phone || phone.length > MAX_E164_LENGTH) {
        throw new HttpsError('invalid-argument', 'Enter the phone number with its area code, such as (555) 123-4567.');
    }
    return phone;
}

function reasonOf(value) {
    const reason = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH) : '';
    return reason || DEFAULT_REASON;
}

function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

/**
 * How an entry came to be: `team` (added here), `reply` (a STOP reply that
 * `handleOptOut` read) or `other` (written some other way).
 */
function sourceOf(data) {
    if (data.source === 'team') return 'team';
    return data.originalMessageId ? 'reply' : 'other';
}

/** An entry as Settings shows it. */
function entryView(phone, data = {}) {
    const millis = millisOf(data.timestamp);
    return {
        phone,
        reason: typeof data.reason === 'string' ? data.reason : '',
        source: sourceOf(data),
        addedBy: typeof data.addedBy === 'string' ? data.addedBy : null,
        addedByName: typeof data.addedByName === 'string' ? data.addedByName : null,
        addedAt: millis === null ? null : new Date(millis).toISOString(),
    };
}

exports.listSmsOptOuts = onCall({ cors: true }, async (request) => {
    signedIn(request);
    const companyId = companyIdOf(request);
    await assertCompanyAccessForRequest(request, companyId, 'listSmsOptOuts');

    const list = listOf(companyId);
    const [page, counted] = await Promise.all([
        list.orderBy('timestamp', 'desc').limit(LIST_LIMIT).get(),
        list.count().get(),
    ]);
    const entries = page.docs.map((doc) => entryView(doc.id, doc.data()));
    // An entry with no date is counted but cannot be ordered, so it is not listed.
    const total = Math.max(counted.data().count, entries.length);
    return { entries, total, limit: LIST_LIMIT, hasMore: total > entries.length };
});

exports.addSmsOptOut = onCall({ cors: true }, async (request) => {
    const uid = signedIn(request);
    const companyId = companyIdOf(request);
    await assertCompanyAccessForRequest(request, companyId, 'addSmsOptOut');
    const phone = phoneOf(request);

    const entry = {
        reason: reasonOf(request.data?.reason),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        addedBy: uid,
        addedByName: request.auth.token?.name || request.auth.token?.email || null,
        source: 'team',
    };
    const ref = listOf(companyId).doc(phone);
    let kept = null;
    try {
        // `create` refuses a number already listed, so its first reason and date stay.
        await ref.create(entry).catch(async (error) => {
            if (error?.code !== ALREADY_EXISTS && !/already exists/i.test(error?.message || '')) throw error;
            kept = (await ref.get()).data() || {};
        });
    } catch (error) {
        throw storeFailure('addSmsOptOut', companyId, error, 'The number could not be added. Try again.');
    }
    if (kept) {
        console.log(`[addSmsOptOut] number ${masked(phone)} already listed for company ${companyId}`);
        return { added: false, entry: entryView(phone, kept) };
    }

    console.log(`[addSmsOptOut] number ${masked(phone)} added for company ${companyId} by ${uid}`);
    return { added: true, entry: { ...entryView(phone, entry), addedAt: new Date().toISOString() } };
});

exports.removeSmsOptOut = onCall({ cors: true }, async (request) => {
    const uid = signedIn(request);
    const companyId = companyIdOf(request);
    await assertCompanyAdminStrict(uid, companyId);
    const phone = phoneOf(request);

    const ref = listOf(companyId).doc(phone);
    try {
        if (!(await ref.get()).exists) return { phone, removed: false };
        await ref.delete();
    } catch (error) {
        throw storeFailure('removeSmsOptOut', companyId, error, 'The number could not be removed. Try again.');
    }
    console.log(`[removeSmsOptOut] number ${masked(phone)} removed for company ${companyId} by ${uid}`);
    return { phone, removed: true };
});

exports.LIST_LIMIT = LIST_LIMIT;
