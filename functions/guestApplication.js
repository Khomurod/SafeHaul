/**
 * Guest application submission via callable function.
 * Uses Admin SDK writes, so Firestore client rules do not block guest intake.
 */

const functions = require('firebase-functions/v1');
const { admin, db, storage } = require('./firebaseAdmin');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const { assertRequiredUploads, buildApplicationDoc } = require('./shared/buildApplicationDoc');
const { upsertApplicationDoc } = require('./shared/upsertApplicationDoc');
const { buildApplicationDefinition } = require('./shared/applicationDefinition');
const { CURRENT_AGREEMENT_VERSION, submittableVersions } = require('./shared/legalAgreements');

/** Versions a fresh submission may claim. Never a retired `legacy-*` one. */
const KNOWN_SUBMITTABLE_VERSIONS = submittableVersions();
const { buildSubmissionSnapshot } = require('./shared/submissionSnapshot');
const { writeSubmissionSnapshot } = require('./shared/writeSubmissionSnapshot');
const {
    buildFailedStatus,
    buildRecordedStatus,
    stampSubmissionRecordStatus,
} = require('./shared/submissionRecordStatus');
const { preserveApplicationPdf } = require('./shared/preserveApplicationPdf');

/**
 * The agreement version the applicant was actually shown.
 *
 * The consent step records the version alongside every acceptance. Rebuilding
 * the definition at the server's CURRENT version instead would bind the
 * applicant's signature to whatever wording happens to be deployed at the
 * moment the submission lands — which, if the legal text were advanced while
 * their consent page sat open, is text they never read.
 *
 * Only a single version agreed across every acceptance is trusted. A mixed or
 * unrecognised set is not evidence of anything specific, so it falls back to the
 * current version rather than guessing which of them to honour.
 */
function agreementVersionFromAcceptances(acceptances) {
    if (!acceptances || typeof acceptances !== 'object') return CURRENT_AGREEMENT_VERSION;

    const reported = new Set(
        Object.values(acceptances)
            .filter((evidence) => evidence && typeof evidence === 'object')
            .map((evidence) => evidence.version)
            .filter((version) => typeof version === 'string' && version),
    );

    if (reported.size !== 1) return CURRENT_AGREEMENT_VERSION;

    const [version] = reported;
    // Never take a version id from the client on trust: an unknown one would
    // throw deep inside the registry, and a `legacy-*` one would let a caller
    // attribute a brand-new submission to retired wording.
    return KNOWN_SUBMITTABLE_VERSIONS.has(version) ? version : CURRENT_AGREEMENT_VERSION;
}

/**
 * Stamp the observed request IP onto each agreement acceptance.
 *
 * The browser reports its own user agent, which is fine — it is self-description.
 * It must NOT report its own IP: a client-supplied address is trivially forged,
 * and acceptance evidence that can be forged by the party it incriminates is not
 * evidence. The address observed by the server is substituted unconditionally,
 * overwriting anything the client sent.
 */
function stampAcceptanceOrigin(acceptances, clientIp) {
    if (!acceptances || typeof acceptances !== 'object') return acceptances;

    const stamped = {};
    for (const [agreementId, evidence] of Object.entries(acceptances)) {
        if (!evidence || typeof evidence !== 'object') continue;
        stamped[agreementId] = { ...evidence, ip: clientIp };
    }
    return stamped;
}

exports.submitGuestApplication = functions
    .runWith({ memory: '256MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        const { checkRateLimit } = require('./shared/rateLimiter');
        const clientIp = context.rawRequest?.ip || 'unknown';
        const allowed = await checkRateLimit(`guest_submit_${clientIp}`, 5, 60, 'closed');
        if (!allowed) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions. Please try again in a minute.'
            );
        }

        const { companyId, email, phone, signature, formData: rawFormData } = data || {};
        const normalizedFormData = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};

        if (!companyId || typeof companyId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'Missing or invalid companyId.');
        }

        if (data?.companyId && data.companyId !== companyId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'companyId in payload must match submission target.'
            );
        }

        if (normalizedFormData.companyId && normalizedFormData.companyId !== companyId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'companyId in payload must match submission target.'
            );
        }

        if (!email && !phone) {
            throw new functions.https.HttpsError('invalid-argument', 'At least one of email or phone is required.');
        }

        if (!signature) {
            throw new functions.https.HttpsError('invalid-argument', 'Signature is required.');
        }

        const companyData = await assertCompanyAcceptingIntake(db, companyId);
        let companyName = companyData.companyName || 'Unknown Company';
        let applicationConfig = companyData.applicationConfig || null;
        // Questions as the DRIVER saw them. The public apply page renders from
        // public_profiles, so that projection — not the company document — is the
        // faithful record of what was asked. Falls back to the company document
        // only when no public profile exists.
        let customQuestions = Array.isArray(companyData.customQuestions) ? companyData.customQuestions : [];

        try {
            const publicSnap = await db.collection('public_profiles').doc(companyId).get();
            if (publicSnap.exists) {
                const publicData = publicSnap.data() || {};
                companyName = publicData.companyName || companyName;
                applicationConfig = publicData.applicationConfig ?? applicationConfig;
                if (Array.isArray(publicData.customQuestions)) {
                    customQuestions = publicData.customQuestions;
                }
            }
        } catch (err) {
            console.error('[submitGuestApplication] Public profile lookup error:', err);
        }

        assertRequiredUploads(applicationConfig, normalizedFormData);

        const {
            applicantKeyFull,
            applicationId,
            confirmationNumber,
            applicationDoc,
            now,
        } = buildApplicationDoc({
            companyId,
            companyName,
            email,
            phone,
            signature,
            formData: normalizedFormData,
        });

        try {
            const result = await upsertApplicationDoc({
                db,
                companyId,
                applicationId,
                applicantKeyFull,
                applicationDoc,
                now,
                logLabel: 'submitGuestApplication',
            });
            // Freeze exactly what this driver saw, answered, accepted and signed.
            //
            // Built AFTER the upsert so it records the final application id (the
            // upsert can suffix it on hash collision). Company identity details
            // (address, DOT/MC) come from the company document because the public
            // profile deliberately does not expose them, while the questions and
            // config come from the public projection the driver actually rendered.
            //
            // Best-effort: a snapshot failure must not lose an application the
            // driver has already submitted. It is logged loudly, and Stage 8's
            // reconstruction job can rebuild what is recoverable.
            //
            // The attempt id makes redelivery idempotent: the browser retries
            // three times and the offline queue replays the identical payload,
            // and neither may turn one submission into two preserved records.
            const submissionAttemptId = typeof normalizedFormData.submissionAttemptId === 'string'
                ? normalizedFormData.submissionAttemptId.trim() || null
                : null;

            let submissionSnapshot = null;
            try {
                const definition = buildApplicationDefinition({
                    company: {
                        ...companyData,
                        companyName,
                        applicationConfig,
                        customQuestions,
                    },
                    // The wording they actually saw, not whatever is current now.
                    agreementVersion: agreementVersionFromAcceptances(
                        normalizedFormData.agreementAcceptances,
                    ),
                });

                const snapshot = buildSubmissionSnapshot({
                    definition,
                    formData: normalizedFormData,
                    acceptances: stampAcceptanceOrigin(
                        normalizedFormData.agreementAcceptances,
                        clientIp
                    ),
                    signature: {
                        image: signature,
                        type: normalizedFormData.signatureType || 'drawn',
                        capturedAt: new Date().toISOString(),
                    },
                    submittedAt: new Date().toISOString(),
                });

                submissionSnapshot = await writeSubmissionSnapshot({
                    db,
                    companyId,
                    applicationId: result.applicationId,
                    snapshot,
                    ownerIds: {
                        applicantId: result.applicationId,
                        driverId: result.applicationId,
                    },
                    submissionAttemptId,
                    logLabel: 'submitGuestApplication',
                });

                // Render and preserve the official PDF from the record that was
                // actually stored — which is not always the one just built.
                //
                // A redelivery (a browser retry, an offline replay) is recognised
                // by its attempt id and returns the EXISTING snapshot. Rendering
                // the freshly rebuilt in-memory one would stamp a different
                // submission and signature time, and could pick up company or
                // question changes made since, so the preserved PDF would not be
                // the application it claims to represent. Reading the frozen
                // document back is what makes them the same thing.
                let sourceSnapshot = snapshot;
                if (submissionSnapshot.deduplicated) {
                    const storedSnap = await db
                        .collection('companies').doc(companyId)
                        .collection('applications').doc(result.applicationId)
                        .collection('submission').doc(submissionSnapshot.snapshotId)
                        .get();
                    if (storedSnap.exists) sourceSnapshot = storedSnap.data();
                }

                // Separately best-effort: a storage hiccup must not cost the
                // driver their application, and the PDF can be rebuilt from the
                // snapshot later, byte-identically, because the snapshot is the
                // only input.
                let preservedPdf = null;
                try {
                    preservedPdf = await preserveApplicationPdf({
                        db,
                        storage,
                        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                        companyId,
                        applicationId: result.applicationId,
                        snapshot: sourceSnapshot,
                        snapshotId: submissionSnapshot.snapshotId,
                        sequence: submissionSnapshot.sequence,
                        signatureImage: signature,
                        ownerIds: {
                            applicantId: result.applicationId,
                            driverId: result.applicationId,
                        },
                        logLabel: 'submitGuestApplication',
                    });
                } catch (pdfError) {
                    console.error(
                        '[submitGuestApplication] Preserving the application PDF failed for '
                        + `${result.applicationId} (company ${companyId}):`,
                        pdfError
                    );
                }

                await stampSubmissionRecordStatus({
                    db,
                    companyId,
                    applicationId: result.applicationId,
                    submissionRecord: {
                        ...buildRecordedStatus({
                            result: submissionSnapshot,
                            snapshot,
                            submissionAttemptId,
                        }),
                        // Queryable, so a repair pass can find submissions whose
                        // PDF is missing without re-reading every snapshot.
                        pdfPreserved: Boolean(preservedPdf),
                    },
                    logLabel: 'submitGuestApplication',
                });
            } catch (snapshotError) {
                console.error(
                    '[submitGuestApplication] Submission snapshot failed for application '
                    + `${result.applicationId} (company ${companyId}):`,
                    snapshotError
                );
                // Leave a queryable marker. A log line cannot be enumerated, and
                // the reconstruction job needs to find exactly these.
                await stampSubmissionRecordStatus({
                    db,
                    companyId,
                    applicationId: result.applicationId,
                    submissionRecord: buildFailedStatus({
                        error: snapshotError,
                        submissionAttemptId,
                    }),
                    logLabel: 'submitGuestApplication',
                });
            }

            return {
                ...result,
                confirmationNumber: result.confirmationNumber || confirmationNumber,
                snapshotId: submissionSnapshot ? submissionSnapshot.snapshotId : null,
            };
        } catch (writeError) {
            if (writeError instanceof functions.https.HttpsError) {
                throw writeError;
            }
            console.error('[submitGuestApplication] Firestore write failed:', writeError);
            throw new functions.https.HttpsError(
                'internal',
                'Failed to save application. Please try again.'
            );
        }
    });
