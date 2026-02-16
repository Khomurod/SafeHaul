const { HttpsError } = require("firebase-functions/v2/https");
const Sentry = require("@sentry/node");

// Initialize Sentry only if DSN is present (prevents crash in dev)
if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN });
}

/**
 * Centralized Error Handler
 * @param {Error} error - The caught error
 * @param {string} context - Name of the function or operation
 * @param {object} metadata - Additional debug info
 */
const handleError = (error, context, metadata = {}) => {
    console.error(`[${context}] Error:`, error.message, metadata);

    // 1. Report to Sentry (if critical)
    if (process.env.SENTRY_DSN) {
        Sentry.withScope(scope => {
            scope.setTag("function_name", context);
            scope.setExtras(metadata);
            Sentry.captureException(error);
        });
    }

    // 2. Return safe error to client
    if (error instanceof HttpsError) {
        throw error;
    }

    // Map common system errors to HttpsError
    if (error.code === 'permission-denied') { // Firestore permission
        throw new HttpsError('permission-denied', "Access denied.");
    }

    // Default Fallback
    throw new HttpsError('internal', "An internal system error occurred. Our team has been notified.");
};

module.exports = { handleError };
