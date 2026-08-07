/**
 * historicalReconstructionSurvey.js
 * =================================
 * How much historical reconstruction work is actually left — counted from the
 * records, every time it is asked.
 *
 * WHY A SURVEY AND NOT A NUMBER
 * -----------------------------
 * The temporary "Migrate the remaining …" operator action needs to know how many
 * applications still need a preserved record. The number cannot be written into
 * the code or the UI: a hard-coded total is a claim about production that starts
 * rotting the moment anyone submits an application, and an operator reading a
 * stale figure cannot tell it is stale. So the count is derived here, server-side,
 * from the same two conditions the migration itself applies:
 *
 *   1. the application has no `submission/v1`, and
 *   2. there is evidence it was actually submitted — a certification or a
 *      signature.
 *
 * This is deliberately a SECOND, independent implementation of that scope rule
 * rather than a call into the migration. It is what verifies the migration
 * afterwards, and a verifier that shares its subject's code cannot contradict it.
 *
 * It also reports preserved records whose official PDF is missing, because
 * "finished" means every eligible application has a record AND its document.
 *
 * SAFETY
 * ------
 * Read-only. It opens no transaction, writes no field and touches no PDF.
 *
 * PRIVACY
 * -------
 * Returns company ids, company names and counts. It reads two application fields
 * to decide whether a submission happened and reduces them immediately to a
 * boolean; no applicant answer, signature, date or identifier is returned,
 * logged, or retained. Application ids appear only in `unreadableApplicationIds`,
 * where an operator needs them to act, and only for documents that could not be
 * read at all.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { db, storage } = require('./firebaseAdmin');
const { hasSubmissionEvidence } = require('./shared/reconstructSubmission');
const { originalPdfPath } = require('./shared/preserveApplicationPdf');

/** Documents per `getAll` batch. Firestore's own limit is higher; this is polite. */
const READ_BATCH = 200;

/**
 * Ceiling on applications surveyed per company, so one pathological tenant
 * cannot run the call past its timeout. Reported rather than hidden.
 */
const MAX_APPLICATIONS_PER_COMPANY = 2000;

/** Only a super admin may see platform-wide record counts. */
function assertSuperAdmin(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only Super Admins can survey historical records.');
    }
}

/** Chunk an array into runs of at most `size`. */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Survey one company.
 *
 * @returns {Promise<object>} counts for this company, plus the ids of any
 *   application whose document could not be read.
 */
async function surveyCompany({ companyId, companyName, includePdfCheck }) {
    const applications = db
        .collection('companies').doc(companyId)
        .collection('applications');

    // Ids only. `select()` with no field paths fetches no application data.
    const idSnap = await applications.select().limit(MAX_APPLICATIONS_PER_COMPANY + 1).get();
    const truncated = idSnap.size > MAX_APPLICATIONS_PER_COMPANY;
    const appRefs = idSnap.docs.slice(0, MAX_APPLICATIONS_PER_COMPANY).map((doc) => doc.ref);

    const row = {
        companyId,
        companyName,
        applications: appRefs.length,
        preserved: 0,
        reconstructed: 0,
        liveSubmissions: 0,
        remaining: 0,
        neverSubmitted: 0,
        unreadable: 0,
        missingPdfs: 0,
        unreadableApplicationIds: [],
        truncated,
    };

    if (appRefs.length === 0) return row;

    // Which applications already hold the original record.
    const preservedRefs = [];
    const candidateRefs = [];
    for (const batch of chunk(appRefs, READ_BATCH)) {
        const snaps = await db.getAll(
            ...batch.map((ref) => ref.collection('submission').doc('v1')),
            { fieldMask: ['provenance.source'] },
        );
        snaps.forEach((snap, index) => {
            if (!snap.exists) { candidateRefs.push(batch[index]); return; }
            row.preserved += 1;
            preservedRefs.push(batch[index]);
            if (snap.data()?.provenance?.source === 'reconstructed') row.reconstructed += 1;
            else row.liveSubmissions += 1;
        });
    }

    // Of those without a record, which were actually submitted. Only the two
    // fields the scope rule needs are fetched, and only a boolean survives.
    for (const batch of chunk(candidateRefs, READ_BATCH)) {
        const snaps = await db.getAll(...batch, {
            fieldMask: ['final-certification', 'signature'],
        });
        for (const snap of snaps) {
            if (!snap.exists) {
                // A document that vanished between the id listing and this read.
                // Not a submission and not an error worth failing the survey for.
                row.neverSubmitted += 1;
                continue;
            }
            let data;
            try {
                data = snap.data();
            } catch {
                data = null;
            }
            if (!data || typeof data !== 'object') {
                row.unreadable += 1;
                row.unreadableApplicationIds.push(snap.id);
                continue;
            }
            if (hasSubmissionEvidence(data)) row.remaining += 1;
            else row.neverSubmitted += 1;
        }
    }

    // A record with no document is unfinished business too. Skipped when the
    // caller only wants counts, because this is one storage round trip each.
    if (includePdfCheck) {
        const bucket = storage.bucket();
        for (const batch of chunk(preservedRefs, 25)) {
            const results = await Promise.all(batch.map(async (ref) => {
                const path = originalPdfPath({
                    companyId, applicationId: ref.id, snapshotId: 'v1',
                });
                try {
                    const [exists] = await bucket.file(path).exists();
                    return exists;
                } catch {
                    // Treat an unreadable object as missing: it is the answer that
                    // keeps the operator action visible rather than hiding work.
                    return false;
                }
            }));
            row.missingPdfs += results.filter((exists) => !exists).length;
        }
    }

    return row;
}

/**
 * Platform-wide survey of outstanding historical reconstruction.
 *
 * `includePdfCheck` defaults to true. It is the slower half, and the caller can
 * turn it off when it only needs the button's count.
 */
exports.surveyHistoricalReconstruction = onCall({
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (request) => {
    assertSuperAdmin(request);

    const { includePdfCheck: requestedPdfCheck = true } = request.data || {};
    const includePdfCheck = Boolean(requestedPdfCheck);

    const companies = await db.collection('companies').select('companyName').get();

    const rows = [];
    for (const company of companies.docs) {
        const row = await surveyCompany({
            companyId: company.id,
            companyName: company.data()?.companyName || '(unnamed company)',
            includePdfCheck,
        });
        // A company with no applications is noise in an operator report.
        if (row.applications > 0) rows.push(row);
    }

    const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
    const totals = {
        companiesWithApplications: rows.length,
        applications: sum('applications'),
        preserved: sum('preserved'),
        reconstructed: sum('reconstructed'),
        liveSubmissions: sum('liveSubmissions'),
        remaining: sum('remaining'),
        neverSubmitted: sum('neverSubmitted'),
        unreadable: sum('unreadable'),
        missingPdfs: sum('missingPdfs'),
        truncatedCompanies: rows.filter((row) => row.truncated).length,
    };

    // The single question the operator UI acts on. Deliberately requires the PDF
    // half to have actually run: without it, `missingPdfs: 0` means "not checked",
    // and treating that as "complete" would retire the action while documents were
    // still missing.
    const complete = includePdfCheck
        && totals.remaining === 0
        && totals.unreadable === 0
        && totals.missingPdfs === 0
        && totals.truncatedCompanies === 0;

    logger.info(
        `[surveyHistoricalReconstruction] ${totals.companiesWithApplications} companies, `
        + `${totals.applications} applications, ${totals.preserved} preserved, `
        + `${totals.remaining} still eligible, ${totals.neverSubmitted} never submitted, `
        + `${totals.missingPdfs} missing PDFs, ${totals.unreadable} unreadable`
        + (includePdfCheck ? '' : ' (PDF check skipped)'),
    );

    return {
        success: true,
        pdfCheckPerformed: includePdfCheck,
        complete,
        totals,
        // Only the companies an operator would act on lead the list.
        companies: rows.sort((a, b) => b.remaining - a.remaining || b.applications - a.applications),
    };
});

exports.surveyCompany = surveyCompany;
exports.MAX_APPLICATIONS_PER_COMPANY = MAX_APPLICATIONS_PER_COMPANY;
