/**
 * The driver uploads that the applications a driver submitted still point at.
 *
 * Read only, and the one place the unfinished-application surface reads a
 * submitted application at all: deleting an unfinished application's files
 * (`drafts/draftFiles.js`) must keep any file the driver's submitted application
 * uses, and nothing in `drafts/` may name that collection
 * (`applicationDrafts.lifecycle.test.js` holds both: that nothing there does, and
 * that this file writes nothing).
 */

const { db } = require('../firebaseAdmin');
const { guestUploadPathsIn } = require('./guestUploads');

/** More applications than one driver files with one email or phone. */
const PER_QUERY = 10;

/** Upload paths in a submitted application, the DQ files it filed and its snapshots. */
async function pathsInApplication(companyId, doc) {
    const [dqFiles, snapshots] = await Promise.all([
        doc.ref.collection('dq_files').get(),
        doc.ref.collection('submission').get(),
    ]);
    return [doc.data(), ...dqFiles.docs.map((file) => file.data()), ...snapshots.docs.map((snap) => snap.data())]
        .flatMap((record) => guestUploadPathsIn(record, companyId));
}

/**
 * Every upload path the applications these drafts' driver submitted hold: the
 * application at each draft's key, any filed under that key after a collision
 * (`applicantKey`), and any with the same email, or the same phone as typed.
 *
 * @param {string} companyId
 * @param {Array<{key: string, data: object}>} drafts unfinished applications, as stored
 * @returns {Promise<Set<string>>}
 */
async function uploadPathsInSubmittedApplications(companyId, drafts) {
    const applications = db.collection('companies').doc(companyId).collection('applications');
    const queries = [];
    const reads = [];
    for (const { key, data } of drafts) {
        const email = String(data?.contactEmail || '').toLowerCase().trim();
        const typedPhone = typeof data?.formData?.phone === 'string' ? data.formData.phone : '';
        if (email) queries.push(applications.where('email', '==', email).limit(PER_QUERY));
        if (typedPhone) queries.push(applications.where('phone', '==', typedPhone).limit(PER_QUERY));
        queries.push(applications.where('applicantKey', '==', key).limit(PER_QUERY));
        reads.push(applications.doc(key).get());
    }
    const [snapshots, direct] = await Promise.all([
        Promise.all(queries.map((query) => query.get())),
        Promise.all(reads),
    ]);

    // Once each, by id: the queries and the direct reads overlap.
    const byId = new Map([...snapshots.flatMap((snapshot) => snapshot.docs), ...direct.filter((doc) => doc.exists)]
        .map((doc) => [doc.id, doc]));
    const paths = await Promise.all([...byId.values()].map((doc) => pathsInApplication(companyId, doc)));
    return new Set(paths.flat());
}

/** More applications than change at a company between two deletions there, usually. */
const SINCE_LIMIT = 200;

/**
 * Every upload path in the applications submitted or changed since `since`.
 *
 * For a retry, which knows the deleted drafts by key alone: a copy of one,
 * submitted in between with another email or phone, files under a key the retry
 * cannot name. Its own document holds the paths its DQ files and snapshots copy.
 *
 * @returns {Promise<{paths: Set<string>, complete: boolean}>} `complete` is false
 *   when more applications changed than were read, and the answer is not sure.
 */
async function uploadPathsInApplicationsSince(companyId, since) {
    const changed = await db.collection('companies').doc(companyId).collection('applications')
        .where('updatedAt', '>=', since).limit(SINCE_LIMIT).get();
    return {
        paths: new Set(changed.docs.flatMap((doc) => guestUploadPathsIn(doc.data(), companyId))),
        complete: changed.size < SINCE_LIMIT,
    };
}

module.exports = { SINCE_LIMIT, uploadPathsInApplicationsSince, uploadPathsInSubmittedApplications };
