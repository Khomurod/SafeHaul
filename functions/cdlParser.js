/**
 * CDL auto-fill callable.
 *
 * The callable name `parseCdlWithGroq` is retained deliberately. It names a
 * vendor that is now only the *first* provider the shared router tries, but
 * deployed driver-application clients call it by this name and renaming it
 * would break every browser that has not reloaded. It is a compatibility
 * alias; the routing decision lives in `functions/ai/`.
 *
 * What this file owns: authentication posture, tenant admission, rate
 * limiting, payload validation and the response contract.
 * What it no longer owns: which AI vendor answers, which model is used, and
 * how that vendor's wire format looks. Those moved to the shared AI platform.
 *
 * Privacy: the submitted image is a photograph of a real driver's licence.
 * Nothing derived from its content — not the model's output, not an excerpt,
 * not a provider error body — is ever logged here.
 */

const functions = require("firebase-functions/v1");
const { db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");
const { assertCompanyAcceptingIntake } = require("./shared/companyTenant");
const { extractCdlFields, CDL_JSON_SCHEMA, normalizeFields } = require("./ai/tasks/cdlExtraction");
const { extractJsonObject } = require("./ai/validation/schema");

/**
 * Server-side ceiling on the submitted image.
 *
 * The browser already refuses anything over 8 MB before upload, so this
 * rejects nothing a well-behaved client would send; it exists because the
 * callable is reachable by unauthenticated guests and the server should not
 * depend on the client's limit. Base64 inflates by about 4/3, so 12 MB of
 * characters is roughly a 9 MB image.
 */
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;

/**
 * Maps a shared-platform failure category onto the HttpsError codes and
 * user-facing strings this callable has always returned. Preserved exactly so
 * the driver-application wizard's error handling keeps working unchanged.
 */
function toHttpsError(category) {
    switch (category) {
        case "not_configured":
        case "capability_unavailable":
            return new functions.https.HttpsError(
                "failed-precondition",
                "AI auto-fill is not configured on the server.",
            );
        case "timeout":
        case "network":
        case "deadline_exceeded":
            return new functions.https.HttpsError("unavailable", "Could not reach AI service. Please retry.");
        case "malformed_response":
        case "schema_validation_failed":
            return new functions.https.HttpsError("internal", "AI returned unreadable data. Please retry.");
        default:
            return new functions.https.HttpsError(
                "internal",
                "AI parsing failed. Please retry with a clearer photo.",
            );
    }
}

exports.parseCdlWithGroq = functions
    .runWith({ memory: "512MB", timeoutSeconds: 60, secrets: ["GROQ_API_KEY"] })
    .https.onCall(async (data, context) => {
        const { companyId, imageDataUrl, storagePath } = data || {};

        if (!companyId || typeof companyId !== "string") {
            throw new functions.https.HttpsError("invalid-argument", "companyId is required.");
        }
        if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
            throw new functions.https.HttpsError("invalid-argument", "imageDataUrl must be a data:image/* base64 URL.");
        }
        if (imageDataUrl.length > MAX_IMAGE_CHARS) {
            throw new functions.https.HttpsError("invalid-argument", "Image is too large. Please upload a smaller photo.");
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const clientIp = context.rawRequest?.ip || "unknown_guest";
        const isAllowed = await checkRateLimit(`cdl_ocr_${clientIp}`, 6, 60, "closed");
        if (!isAllowed) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                "Too many auto-fill attempts. Please wait a minute and try again."
            );
        }

        let result;
        try {
            result = await extractCdlFields({ imageDataUrl });
        } catch (error) {
            // Category and provider id only. A provider's error body can quote
            // the submitted licence back at us, so it never reaches a log.
            console.error(
                `[parseCdlWithGroq] AI task failed category=${error?.category || "internal"} provider=${error?.providerId || "none"}`,
            );
            throw toHttpsError(error?.category);
        }

        const normalized = result.fields;
        if (!normalized.firstName && !normalized.lastName && !normalized.cdlNumber) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "Could not read enough CDL data. Please upload a clearer, straight-on photo."
            );
        }

        return {
            success: true,
            fields: normalized,
            // Still the model that actually produced the answer — it is simply
            // no longer guaranteed to be a Groq one.
            sourceModel: result.model,
            provider: result.providerId,
            storagePath: storagePath || null,
            schema: CDL_JSON_SCHEMA,
        };
    });

exports.__private = {
    normalizeOutput: normalizeFields,
    extractJsonObject,
    MAX_IMAGE_CHARS,
    toHttpsError,
};
