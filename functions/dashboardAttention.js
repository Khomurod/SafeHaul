/**
 * getDashboardAttention — the dashboard's "Needs attention": how many of the
 * company's records of each kind are waiting on someone.
 *
 * The company's team or a Super Admin may ask (`assertCompanyAccessForRequest`),
 * for admins and the team alike. It takes `{ companyId }` and nothing else, and
 * every query is that company's: its own collections, or `companyId ==` on the
 * top-level `verification_requests`, which the company cannot read itself. The
 * answer is counts, but for the few names in the DQ row, which the team can
 * read on the applications anyway.
 *
 * Each row is a `count()` (billed as one read per 1,000 index entries, at least
 * one), on an index that exists, so nothing waits for a new one:
 * - `sealFailed`: signing requests `status == 'error_sealing'`;
 * - `awaitingSignature`: `status in ['sent', 'opened']` made more than seven days
 *   ago, newest first: the `signing_requests` status + createdAt (descending)
 *   composite. A send that failed is counted too: it is still unsigned;
 * - `pevWaiting`: one count per live status (`sent`, `opened`, `reminder_sent`,
 *   `requestLifecycle.js`) and `pevNoResponse` (`no_response`): equality on
 *   `companyId` and `status`, which Firestore merges from single-field indexes;
 * - `pendingChanges`: applications and leads with `hasPendingCompanyChanges`;
 * - `draftsExpiring`: unfinished applications last saved 25 days ago or more.
 *   A draft expires 30 days after it is saved (every save writes `expiresAt`
 *   beside `updatedAt`), and `expiresAt` itself is not indexed (its TTL override
 *   in `firestore.indexes.json`), so these are the drafts removed within five
 *   days, as the Unfinished page reads them; one past its date and not yet
 *   deleted by Firestore is counted;
 * - `dqExpiring`: hired drivers whose `dqExpiresNext` (the earliest expiry date
 *   among the record's DQ documents, `'YYYY-MM-DD'`, server-maintained) is in
 *   30 days or past. One read: the 50 latest such dates of any application
 *   (single-field, descending), the hired ones kept here; `more` says all 50
 *   were read, so there may be others. At most five `{ id, name, date }`,
 *   earliest first.
 *
 * Each row settles on its own: one that fails is `{ status: 'failed' }`, logged
 * by its name and error code only, and the rest still answer. Rows of a feature
 * the company turned off (E-Docs, PEV) are left out, and read nothing.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { RETENTION_DAYS } = require('./shared/applicationDraft');
const { isHiredStatus } = require('./shared/applicationStatus');
const { LIVE_STATUSES } = require('./employmentVerification/requestLifecycle');

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far each row looks, in days. */
const WINDOWS = Object.freeze({ awaitingDays: 7, draftDays: 5, dqDays: 30 });

/** Unsigned statuses: `sent`, and the older `opened` the dossier still reads. */
const AWAITING_STATUSES = Object.freeze(['sent', 'opened']);

/** How many of the latest DQ dates one call reads, and how many drivers it names. */
const DQ_CANDIDATES = 50;
const DQ_NAMED = 5;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function companyIdOf(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 100 || value.includes('/')) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    return value;
}

const isoDay = (millis) => new Date(millis).toISOString().slice(0, 10);
const countOf = async (query) => (await query.count().get()).data().count;
const sum = (counts) => counts.reduce((total, count) => total + count, 0);

/** A row's answer, or `failed` with a log that names the row and the error code, never its message. */
async function settle(id, read) {
    try {
        return { status: 'ok', ...(await read()) };
    } catch (error) {
        console.warn(`[getDashboardAttention] ${id} could not be counted:`, error?.code ?? 'error');
        return { status: 'failed' };
    }
}

/** The company's `features`; unreadable, every feature counts as on. */
async function featuresOf(company) {
    try {
        const snap = await company.get();
        return (snap.exists && snap.data()?.features) || {};
    } catch (error) {
        console.warn('[getDashboardAttention] The company could not be read:', error?.code ?? 'error');
        return {};
    }
}

function driverName(data) {
    const name = [data.firstName, data.lastName]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' ');
    return name.slice(0, 80) || 'Unnamed driver';
}

async function dqExpiring(applications, now) {
    const horizon = isoDay(now + WINDOWS.dqDays * DAY_MS);
    const snap = await applications
        .where('dqExpiresNext', '<=', horizon)
        .orderBy('dqExpiresNext', 'desc')
        .select('status', 'firstName', 'lastName', 'dqExpiresNext')
        .limit(DQ_CANDIDATES)
        .get();
    const hired = snap.docs
        .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
        .filter(({ data }) => isHiredStatus(data.status) && DAY_PATTERN.test(data.dqExpiresNext))
        .sort((a, b) => a.data.dqExpiresNext.localeCompare(b.data.dqExpiresNext));
    return {
        count: hired.length,
        more: snap.size >= DQ_CANDIDATES,
        drivers: hired.slice(0, DQ_NAMED).map(({ id, data }) => ({ id, name: driverName(data), date: data.dqExpiresNext })),
    };
}

function readRows(companyId, features, now) {
    const company = db.collection('companies').doc(companyId);
    const applications = company.collection('applications');
    const rows = {};

    if (features.eDocs !== false) {
        const requests = company.collection('signing_requests');
        rows.sealFailed = settle('sealFailed', async () => ({
            count: await countOf(requests.where('status', '==', 'error_sealing')),
        }));
        rows.awaitingSignature = settle('awaitingSignature', async () => ({
            count: await countOf(requests
                .where('status', 'in', [...AWAITING_STATUSES])
                .where('createdAt', '<', new Date(now - WINDOWS.awaitingDays * DAY_MS))
                .orderBy('createdAt', 'desc')),
        }));
    }
    if (features.pev !== false) {
        const verifications = db.collection('verification_requests').where('companyId', '==', companyId);
        rows.pevWaiting = settle('pevWaiting', async () => ({
            count: sum(await Promise.all(LIVE_STATUSES.map((status) => countOf(verifications.where('status', '==', status))))),
        }));
        rows.pevNoResponse = settle('pevNoResponse', async () => ({
            count: await countOf(verifications.where('status', '==', 'no_response')),
        }));
    }
    rows.pendingChanges = settle('pendingChanges', async () => ({
        count: sum(await Promise.all(['applications', 'leads'].map((name) => countOf(
            company.collection(name).where('hasPendingCompanyChanges', '==', true),
        )))),
    }));
    rows.draftsExpiring = settle('draftsExpiring', async () => ({
        count: await countOf(company.collection('application_drafts')
            .where('updatedAt', '<=', new Date(now - (RETENTION_DAYS - WINDOWS.draftDays) * DAY_MS))),
    }));
    rows.dqExpiring = settle('dqExpiring', () => dqExpiring(applications, now));
    return rows;
}

exports.getDashboardAttention = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const companyId = companyIdOf(request.data?.companyId);
    await assertCompanyAccessForRequest(request, companyId, 'getDashboardAttention');

    const now = Date.now();
    const features = await featuresOf(db.collection('companies').doc(companyId));
    const pending = readRows(companyId, features, now);
    const ids = Object.keys(pending);
    const answers = await Promise.all(ids.map((id) => pending[id]));
    return {
        generatedAt: new Date(now).toISOString(),
        windows: WINDOWS,
        rows: Object.fromEntries(ids.map((id, index) => [id, answers[index]])),
    };
});
