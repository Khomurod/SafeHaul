/**
 * Reading whatever documents the carrier has, for one prepared application.
 *
 * ## Two routes, and who chooses between them
 *
 * The browser extracts text from each document — a PDF's own text layer where it
 * has one, OCR where it does not — and sends what it got. A document whose text
 * came out too thin to be worth reading is sent as page images instead, and goes
 * to the vision tasks the CDL auto-fill and the PSP/MVR import already use.
 *
 * The client makes that call for its own documents because it is the only party
 * that can: it holds the file. The model makes it again, per document, in the
 * text pass — `unreadable` in its answer names documents whose text was garbage,
 * and the client re-sends those as pages. Two independent chances to notice, which
 * is the right number for the case that matters: OCR of a phone photo that
 * produced plausible-looking nonsense.
 *
 * ## Any subset
 *
 * One document or four, in any combination. There is no required set, nothing is
 * inferred from a document that was not sent, and an empty request is the only
 * thing refused.
 *
 * ## Not the guest report import
 *
 * `extractApplicationReport` is the driver's own, gated on the company having
 * switched PSP/MVR import on for its apply page. This is a carrier's staff member
 * reading paperwork they already hold, available to every company, and
 * authenticated — so it is its own callable rather than a flag on that one.
 *
 * Privacy: every one of these documents is `restricted`. Nothing derived from
 * their content is logged here.
 */

const functions = require('firebase-functions/v1');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAccess } = require('../shared/companyAccess');
const { extractApplicationDocuments, DOCUMENT_KINDS } = require('../ai/tasks/applicationDocumentExtraction');
const { extractReportSuggestions } = require('../ai/tasks/reportExtraction');
const { extractCdlFields } = require('../ai/tasks/cdlExtraction');
const { extractMedicalCardFields } = require('../ai/tasks/medicalCardExtraction');

const MAX_PAGES_PER_DOCUMENT = 5;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const IMAGE_DATA_URL_PREFIX = /^data:image\/(png|jpeg|jpg|webp);base64,/;
const FUNCTION_TIMEOUT_SECONDS = 120;

/** Generous for staff, bounded because every call spends a vendor request. */
const EXTRACT_LIMIT = Object.freeze({ limit: 20, windowSeconds: 3600 });

function toHttpsError(category) {
    switch (category) {
        case 'not_configured':
        case 'capability_unavailable':
        case 'credential_error':
            return new functions.https.HttpsError('failed-precondition', 'Document reading is not available right now. You can still type the details in.', { category });
        case 'timeout':
        case 'network':
        case 'deadline_exceeded':
            return new functions.https.HttpsError('unavailable', 'Could not reach the reading service. Please try again.');
        case 'malformed_response':
        case 'schema_validation_failed':
            return new functions.https.HttpsError('internal', 'The documents could not be read. Please try again, or type the details in.');
        default:
            return new functions.https.HttpsError('internal', 'Reading the documents failed. Please try again.');
    }
}

/** Splits the request into the two routes, refusing anything malformed. */
function partitionDocuments(raw) {
    const documents = raw && typeof raw === 'object' ? raw : {};
    const text = {};
    const pages = {};

    for (const kind of DOCUMENT_KINDS) {
        const entry = documents[kind];
        if (!entry || typeof entry !== 'object') continue;

        if (typeof entry.text === 'string' && entry.text.trim()) {
            text[kind] = entry.text.slice(0, MAX_TEXT_CHARS);
            continue;
        }
        if (Array.isArray(entry.pages) && entry.pages.length > 0) {
            if (entry.pages.length > MAX_PAGES_PER_DOCUMENT) {
                throw new functions.https.HttpsError('invalid-argument', `Send at most ${MAX_PAGES_PER_DOCUMENT} pages per document.`);
            }
            for (const page of entry.pages) {
                if (typeof page !== 'string' || !IMAGE_DATA_URL_PREFIX.test(page)) {
                    throw new functions.https.HttpsError('invalid-argument', 'Each page must be a base64 PNG, JPEG or WebP data URL.');
                }
                if (page.length > MAX_IMAGE_CHARS) {
                    throw new functions.https.HttpsError('invalid-argument', 'A page image is too large. Please send smaller pages.');
                }
            }
            pages[kind] = entry.pages;
        }
    }

    return { text, pages };
}

/** The vision task for one document kind, or null where there is none. */
function visionReaderFor(kind) {
    switch (kind) {
        case 'cdl':
            return async (imageDataUrls) => {
                const result = await extractCdlFields({ imageDataUrl: imageDataUrls[0] });
                const fields = result.fields || {};
                return {
                    driver: {
                        firstName: fields.firstName || '',
                        lastName: fields.lastName || '',
                        dateOfBirth: fields.dateOfBirth || '',
                        fullAddress: fields.fullAddress || '',
                    },
                    license: { cdlNumber: fields.cdlNumber || '', cdlExpiration: fields.expirationDate || '' },
                };
            };
        case 'medical':
            return async (imageDataUrls) => ({ license: (await extractMedicalCardFields({ imageDataUrls })).license });
        case 'psp':
            return async (imageDataUrls) => {
                const { suggestions } = await extractReportSuggestions({ kind: 'psp', imageDataUrls });
                return {
                    carriers: suggestions.carriers,
                    violations: suggestions.violations.map((row) => ({ ...row, source: 'psp' })),
                };
            };
        case 'mvr':
            return async (imageDataUrls) => {
                const { suggestions } = await extractReportSuggestions({ kind: 'mvr', imageDataUrls });
                return {
                    license: suggestions.license,
                    violations: suggestions.violations.map((row) => ({ ...row, source: 'mvr' })),
                };
            };
        default:
            return null;
    }
}

/** Merges a vision result into the combined answer without overwriting what is there. */
function mergeExtraction(base, addition) {
    return {
        driver: { ...(addition.driver || {}), ...stripEmpty(base.driver) },
        license: { ...(addition.license || {}), ...stripEmpty(base.license) },
        carriers: [...(base.carriers || []), ...(addition.carriers || [])],
        violations: [...(base.violations || []), ...(addition.violations || [])],
        unreadable: base.unreadable || [],
    };
}

/** Only the values the text pass actually found — a blank must not win over a read one. */
function stripEmpty(value) {
    return Object.fromEntries(
        Object.entries(value || {}).filter(([, entry]) => (Array.isArray(entry) ? entry.length > 0 : Boolean(entry))),
    );
}

const EMPTY_EXTRACTION = Object.freeze({
    driver: {}, license: {}, carriers: [], violations: [], unreadable: [],
});

exports.extractCompanyApplicationDocuments = functions
    .runWith({ memory: '512MB', timeoutSeconds: FUNCTION_TIMEOUT_SECONDS, secrets: ['GROQ_API_KEY'] })
    .https.onCall(async (data, context) => {
        const companyId = typeof data?.companyId === 'string' ? data.companyId.trim() : '';
        if (!companyId) throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
        if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Login required.');

        await assertCompanyAccess(context.auth.uid, companyId);

        const { text, pages } = partitionDocuments(data?.documents);
        if (Object.keys(text).length === 0 && Object.keys(pages).length === 0) {
            throw new functions.https.HttpsError('invalid-argument', 'Attach at least one document to read.');
        }

        const allowed = await checkRateLimit(
            `application_doc_extract_${companyId}_${context.auth.uid}`,
            EXTRACT_LIMIT.limit, EXTRACT_LIMIT.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'That is a lot of reading in one hour. Please try again later.');
        }

        const methods = {};
        let extracted = { ...EMPTY_EXTRACTION };
        let failure = null;

        if (Object.keys(text).length > 0) {
            try {
                const result = await extractApplicationDocuments({ documents: text });
                extracted = result.extracted;
                for (const kind of Object.keys(text)) {
                    methods[kind] = extracted.unreadable.includes(kind) ? 'unreadable' : 'text';
                }
            } catch (error) {
                console.error(`[extractCompanyApplicationDocuments] text pass failed category=${error?.category || 'internal'}`);
                failure = error;
                for (const kind of Object.keys(text)) methods[kind] = 'failed';
            }
        }

        // In parallel, and settled rather than raced: one unreadable medical card
        // must not cost the carrier the PSP report that read perfectly.
        const visionKinds = Object.keys(pages);
        const visionResults = await Promise.allSettled(
            visionKinds.map((kind) => visionReaderFor(kind)(pages[kind])),
        );
        visionResults.forEach((result, index) => {
            const kind = visionKinds[index];
            if (result.status === 'fulfilled') {
                extracted = mergeExtraction(extracted, result.value);
                methods[kind] = 'vision';
            } else {
                console.error(`[extractCompanyApplicationDocuments] vision pass failed kind=${kind} category=${result.reason?.category || 'internal'}`);
                methods[kind] = 'failed';
                failure = failure || result.reason;
            }
        });

        // Only when nothing at all could be read. A partial answer is worth
        // returning: the recruiter confirms every field anyway, and the ones that
        // did read save them the typing.
        if (Object.values(methods).every((method) => method === 'failed')) {
            throw toHttpsError(failure?.category);
        }

        return { success: true, extracted, methods };
    });

exports.__private = {
    EXTRACT_LIMIT,
    IMAGE_DATA_URL_PREFIX,
    MAX_IMAGE_CHARS,
    MAX_PAGES_PER_DOCUMENT,
    MAX_TEXT_CHARS,
    mergeExtraction,
    partitionDocuments,
    stripEmpty,
    toHttpsError,
};
