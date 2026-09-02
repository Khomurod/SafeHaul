/**
 * Applicant report import: PSP report or MVR pages → suggestions to confirm.
 *
 * Public guest path, like `parseCdlWithGroq`, with one more gate: the company
 * must have switched the source on (`applicationIntegrations.{psp,mvr}.enabled`).
 * A company that has not is not affected — the callable refuses, and the apply
 * page never shows the upload in the first place.
 *
 * What this file owns: tenant admission, the integration gate, rate limiting,
 * payload validation and the response contract. Which vendor reads the pages is
 * the shared AI platform's decision (`ai/tasks/reportExtraction.js`).
 *
 * Privacy: the pages are a real person's driving and safety history. Nothing
 * derived from their content is ever logged here.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const { extractReportSuggestions, KINDS } = require('./ai/tasks/reportExtraction');

const MAX_PAGES = 5;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const IMAGE_DATA_URL_PREFIX = /^data:image\/(png|jpeg|jpg|webp);base64,/;
const FUNCTION_TIMEOUT_SECONDS = 60;

function toHttpsError(category) {
    switch (category) {
        case 'not_configured':
        case 'capability_unavailable':
        case 'credential_error':
            return new functions.https.HttpsError('failed-precondition', 'Report import is temporarily unavailable. You can continue and enter the details yourself.', { category });
        case 'timeout':
        case 'network':
        case 'deadline_exceeded':
            return new functions.https.HttpsError('unavailable', 'Could not reach the reading service. Please retry.');
        case 'malformed_response':
        case 'schema_validation_failed':
            return new functions.https.HttpsError('internal', 'The report could not be read. Please retry, or continue and enter the details yourself.');
        default:
            return new functions.https.HttpsError('internal', 'Reading the report failed. Please retry with clearer pages.');
    }
}

/** The company's switch for this source, read from its own record — never the client. */
async function integrationEnabled(companyId, kind, companyData) {
    let flags = companyData && companyData.applicationIntegrations;
    try {
        const publicSnap = await db.collection('public_profiles').doc(companyId).get();
        if (publicSnap.exists && publicSnap.data() && publicSnap.data().applicationIntegrations) {
            flags = publicSnap.data().applicationIntegrations;
        }
    } catch (err) {
        console.error('[extractApplicationReport] Public profile lookup error:', err);
    }
    return Boolean(flags && flags[kind] && flags[kind].enabled === true);
}

exports.extractApplicationReport = functions
    .runWith({ memory: '512MB', timeoutSeconds: FUNCTION_TIMEOUT_SECONDS, secrets: ['GROQ_API_KEY'] })
    .https.onCall(async (data, context) => {
        const { companyId, kind, pages } = data || {};

        if (!companyId || typeof companyId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
        }
        if (!KINDS[kind]) {
            throw new functions.https.HttpsError('invalid-argument', 'kind must be "psp" or "mvr".');
        }
        if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES) {
            throw new functions.https.HttpsError('invalid-argument', `Send between 1 and ${MAX_PAGES} page images.`);
        }
        for (const page of pages) {
            if (typeof page !== 'string' || !IMAGE_DATA_URL_PREFIX.test(page)) {
                throw new functions.https.HttpsError('invalid-argument', 'Each page must be a base64 PNG, JPEG or WebP data URL.');
            }
            if (page.length > MAX_IMAGE_CHARS) {
                throw new functions.https.HttpsError('invalid-argument', 'A page image is too large. Please upload smaller pages.');
            }
        }

        const companyData = await assertCompanyAcceptingIntake(db, companyId);
        if (!(await integrationEnabled(companyId, kind, companyData))) {
            throw new functions.https.HttpsError('failed-precondition', 'This carrier has not enabled report import.');
        }

        const clientIp = context.rawRequest?.ip || 'unknown_guest';
        const allowed = await checkRateLimit(`report_import_${clientIp}`, 6, 60, 'closed');
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many import attempts. Please wait a minute and try again.');
        }

        let result;
        try {
            result = await extractReportSuggestions({ kind, imageDataUrls: pages });
        } catch (error) {
            console.error(`[extractApplicationReport] AI task failed kind=${kind} category=${error?.category || 'internal'} provider=${error?.providerId || 'none'}`);
            throw toHttpsError(error?.category);
        }

        return {
            success: true,
            kind,
            suggestions: result.suggestions,
            provider: result.providerId,
            sourceModel: result.model,
        };
    });

exports.__private = { MAX_PAGES, MAX_IMAGE_CHARS, IMAGE_DATA_URL_PREFIX, integrationEnabled, toHttpsError };
