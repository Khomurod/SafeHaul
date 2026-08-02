/**
 * Authorisation guards for the Environment & Integrations vault.
 *
 * These are deliberately stricter than `shared/companyAccess.js`:
 *
 *  - **Exact `globalRole === 'super_admin'` only.** No company-admin path, no
 *    membership path, no owner-of-company path. The vault reads platform-wide
 *    infrastructure secrets, so tenant-scoped privilege must never reach it.
 *  - **Recent authentication.** A stale session must not be enough to read a
 *    production credential. Reveal and every mutation require the caller to have
 *    authenticated within `RECENT_AUTH_WINDOW_SECONDS`; the frontend catches the
 *    typed failure and asks the operator to re-authenticate.
 *  - **Fail-closed rate limits.** If the limiter itself errors, the request is
 *    denied rather than allowed.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { checkRateLimit } = require('../shared/rateLimiter');
const { ACTIONS, RESULTS, recordAuditEvent } = require('./audit');

/** How recently the caller must have authenticated for a privileged operation. */
const RECENT_AUTH_WINDOW_SECONDS = 15 * 60;

/**
 * Machine-readable failure the frontend keys off to offer re-authentication.
 * Kept in the message because `HttpsError` details are not always preserved
 * across SDK versions, and the string carries no information about any value.
 */
const REAUTH_REQUIRED = 'REAUTH_REQUIRED';

/** Per-operation limits. Reveal is the loosest; mutations are the tightest. */
const RATE_LIMITS = Object.freeze({
    list: { limit: 60, windowSeconds: 300 },
    reveal: { limit: 30, windowSeconds: 300 },
    mutate: { limit: 10, windowSeconds: 300 },
    test: { limit: 10, windowSeconds: 300 },
});

/**
 * Exact Super Admin assertion.
 *
 * Reads the claim from the verified ID token only. It deliberately does not fall
 * back to a Firestore lookup: a token that does not carry the claim is not a
 * Super Admin session, and silently upgrading it would defeat the point.
 *
 * @param {object} request Callable request.
 * @param {string} action Audit action, used when recording the denial.
 * @param {object} [metadata] Value-free metadata for the denial record.
 */
async function assertSuperAdmin(request, action, metadata = {}) {
    if (!request?.auth?.uid) {
        await recordAuditEvent({
            auth: null,
            action,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'unauthenticated' },
        });
        throw new HttpsError('unauthenticated', 'Sign in to continue.');
    }

    const token = request.auth.token || {};
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;

    if (globalRole !== 'super_admin') {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'not-super-admin' },
        });
        throw new HttpsError('permission-denied', 'Super Admin access is required.');
    }
}

/**
 * Requires the caller's session to be recent.
 *
 * Uses `auth_time`, which Firebase sets at sign-in and refreshes on
 * `reauthenticateWithCredential`. A plain token refresh does *not* move it, so
 * this cannot be satisfied by silently minting a new ID token.
 *
 * @param {object} request Callable request.
 * @param {string} action Audit action, used when recording the denial.
 * @param {object} [metadata] Value-free metadata for the denial record.
 */
async function assertRecentAuth(request, action, metadata = {}) {
    const authTime = Number(request?.auth?.token?.auth_time);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(authTime) || nowSeconds - authTime > RECENT_AUTH_WINDOW_SECONDS) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'stale-authentication' },
        });
        throw new HttpsError(
            'failed-precondition',
            `${REAUTH_REQUIRED}: re-enter your password to continue.`,
        );
    }
}

/**
 * Applies the per-operation, per-caller rate limit. Fails closed.
 *
 * @param {object} request Callable request.
 * @param {'list'|'reveal'|'mutate'|'test'} operation
 * @param {string} action Audit action, used when recording the denial.
 * @param {object} [metadata] Value-free metadata for the denial record.
 */
async function assertWithinRateLimit(request, operation, action, metadata = {}) {
    const config = RATE_LIMITS[operation];
    const key = `envvault_${operation}_${request.auth.uid}`;
    const allowed = await checkRateLimit(key, config.limit, config.windowSeconds, 'closed');
    if (!allowed) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'rate-limited' },
        });
        throw new HttpsError('resource-exhausted', 'Too many requests. Wait a moment and try again.');
    }
}

/**
 * Full guard for privileged operations: exact role, recent authentication, rate
 * limit — in that order, so a non-Super-Admin never learns anything about the
 * limiter's state.
 */
async function guardPrivileged(request, operation, action, metadata = {}) {
    await assertSuperAdmin(request, action, metadata);
    await assertRecentAuth(request, action, metadata);
    await assertWithinRateLimit(request, operation, action, metadata);
}

module.exports = {
    ACTIONS,
    RATE_LIMITS,
    REAUTH_REQUIRED,
    RECENT_AUTH_WINDOW_SECONDS,
    assertRecentAuth,
    assertSuperAdmin,
    assertWithinRateLimit,
    guardPrivileged,
};
