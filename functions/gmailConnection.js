/**
 * "Send from Gmail": connecting a company's Gmail, and disconnecting it.
 *
 * 1. `startGmailConnection` stores a one-time state for the signed-in company
 *    admin and answers the address of Google's consent page.
 * 2. Google returns the admin to `/oauth/google/callback` with a one-time code.
 *    That page calls `completeGmailConnection`, which takes the state (it works
 *    once, for the same admin, within ten minutes), exchanges the code, and
 *    stores the account in the server-only `email_config` document with the
 *    refresh token sealed (`enc:v1:`, `sealPassword`, the helper the SMTP
 *    password uses). The token never leaves the server.
 * 3. `disconnectGmail` deletes the token, and revokes it at Google when no
 *    other company uses that Google account.
 *
 * `oauth_states/{sha256(state)}` and `gmail_grants/{sub}` have no Firestore
 * rule, so every client is refused. `gmail_grants` lists the companies that
 * hold a token for one Google account: revoking at Google ends every grant the
 * account gave SafeHaul, so it happens only when that list becomes empty.
 *
 * The connection belongs to the company, not to the admin who made it. Logs
 * carry ids and outcome codes only: never an email address or a token.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAdminStrict } = require('./shared/companyAccess');
const { millisOf } = require('./shared/millisOf');
const { plainPassword, sealPassword } = require('./shared/smtpSettings');
const oauth = require('./shared/gmail/oauthClient');

const STATE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 600;

const MESSAGES = Object.freeze({
    NOT_SET_UP: 'Sending from Gmail is not set up yet.',
    SWITCHED_OFF: 'Sending from Gmail is not switched on for this company.',
    WRONG_SITE: 'Open SafeHaul at app.safehaul.io to connect Gmail.',
    EXPIRED: 'This Gmail connection expired. Start again from Settings → Email.',
    WRONG_USER: 'Sign in as the person who started connecting Gmail, then try again.',
    NO_SEND_PERMISSION: "Google did not allow SafeHaul to send email. Try again and allow 'Send email on your behalf'.",
    ADMIN_BLOCKED: 'Your Google Workspace administrator has blocked SafeHaul. Ask them to allow it.',
    UNVERIFIED: "Google has not verified this account's email address, so SafeHaul cannot send from it.",
    UNREACHABLE: 'Google could not be reached. Try again in a moment.',
    FAILED: 'Gmail could not be connected. Start again from Settings → Email.',
    TOO_MANY: 'Too many attempts. Wait a few minutes, then try again.',
});

/** Every field a connection writes on `email_config`; a disconnect deletes them all. */
const GMAIL_FIELDS = Object.freeze([
    'gmailEmail', 'gmailSub', 'gmailRefreshToken', 'gmailScopes',
    'gmailConnectedAt', 'gmailConnectedBy', 'gmailStatus', 'gmailStatusReason', 'gmailStatusAt',
]);

const fieldValue = () => admin.firestore.FieldValue;
const emailConfigRef = (companyId) => db.collection('companies').doc(companyId)
    .collection('system_settings').doc('email_config');
const grantRef = (sub) => db.collection('gmail_grants').doc(sub);
const stateRef = (stateId) => db.collection('oauth_states').doc(stateId);

function signedInUid(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login required.');
    return uid;
}

function companyIdOf(data) {
    const companyId = data?.companyId;
    if (typeof companyId !== 'string' || !companyId || companyId.includes('/')) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    return companyId;
}

async function limitRate(key) {
    if (!(await checkRateLimit(key, RATE_LIMIT, RATE_WINDOW_SECONDS, 'closed'))) {
        throw new HttpsError('resource-exhausted', MESSAGES.TOO_MANY);
    }
}

/** A failure from the OAuth helper as the plain message the screen shows; its code goes to the log. */
function refusal(error, label, companyId) {
    const code = typeof error?.code === 'string' ? error.code : 'error';
    console.warn(`[${label}] Gmail was not connected for company ${companyId}: ${code}`);
    switch (code) {
        case 'gmail-not-configured': return new HttpsError('failed-precondition', MESSAGES.NOT_SET_UP);
        case 'invalid_grant': return new HttpsError('failed-precondition', MESSAGES.EXPIRED);
        case 'send-scope-missing': return new HttpsError('permission-denied', MESSAGES.NO_SEND_PERMISSION);
        case 'admin_policy_enforced': return new HttpsError('permission-denied', MESSAGES.ADMIN_BLOCKED);
        case 'email-unverified': return new HttpsError('failed-precondition', MESSAGES.UNVERIFIED);
        case 'google-unreachable': return new HttpsError('unavailable', MESSAGES.UNREACHABLE);
        default: return new HttpsError('internal', MESSAGES.FAILED);
    }
}

const companyIdsOf = (snap) => {
    const ids = snap?.exists ? snap.data()?.companyIds : null;
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
};

/**
 * In a transaction, after its reads: takes `companyId` off the account's
 * grant list. True when no company is left, and so the token may be revoked.
 */
function releaseGrant(transaction, sub, grantSnap, companyId) {
    const remaining = companyIdsOf(grantSnap).filter((id) => id !== companyId);
    if (remaining.length) {
        transaction.set(grantRef(sub), { companyIds: remaining, updatedAt: fieldValue().serverTimestamp() });
        return false;
    }
    transaction.delete(grantRef(sub));
    return true;
}

/** Best effort: the token is already gone from SafeHaul, so a failure is logged by code only. */
async function revokeSealed(sealed, label, companyId) {
    let token;
    try {
        token = plainPassword(sealed);
    } catch {
        console.warn(`[${label}] The old Gmail token for company ${companyId} could not be opened, so it was not revoked.`);
        return;
    }
    const outcome = await oauth.revokeToken(token);
    const log = outcome === 'revoked' || outcome === 'already-invalid' ? console.log : console.warn;
    log(`[${label}] Revoking the old Gmail token for company ${companyId}: ${outcome}`);
}

/**
 * Refuses unless the company's `gmailSending` switch is on, read from the
 * company the admin check read (a super admin's check may hand back none).
 */
async function requireSwitchOn(checked, companyId) {
    const companySnap = checked || await db.collection('companies').doc(companyId).get();
    const company = companySnap?.exists ? companySnap.data() || {} : {};
    if (company.features?.gmailSending !== true) {
        throw new HttpsError('failed-precondition', MESSAGES.SWITCHED_OFF);
    }
}

/**
 * The state, taken and deleted in one transaction so it works once. A state
 * started by another user is left in place: refusing them must not spend the
 * real admin's attempt.
 */
async function takeState(stateId, uid) {
    const ref = stateRef(stateId);
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) return null;
        const pending = snap.data() || {};
        if (pending.uid !== uid) return { wrongUser: true };
        transaction.delete(ref);
        return pending;
    });
}

exports.startGmailConnection = onCall({ cors: true }, async (request) => {
    const uid = signedInUid(request);
    const companyId = companyIdOf(request.data);
    await limitRate(`gmail_connect_${uid}`);

    await requireSwitchOn(await assertCompanyAdminStrict(uid, companyId), companyId);

    const redirectUri = oauth.gmailRedirectUriFor(request.rawRequest?.headers?.origin);
    if (!redirectUri) throw new HttpsError('failed-precondition', MESSAGES.WRONG_SITE);

    let clientId;
    try {
        ({ clientId } = await oauth.readGmailClient());
    } catch (error) {
        throw refusal(error, 'startGmailConnection', companyId);
    }

    const { state, stateId } = oauth.newState();
    const { codeVerifier, codeChallenge } = oauth.newPkcePair();
    await stateRef(stateId).set({
        kind: 'gmail',
        uid,
        companyId,
        codeVerifier,
        redirectUri,
        createdAt: fieldValue().serverTimestamp(),
        // A TTL policy deletes it later; `completeGmailConnection` checks the time itself.
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
    });

    console.log(`[startGmailConnection] company ${companyId}, uid ${uid}`);
    return { url: oauth.buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) };
});

exports.completeGmailConnection = onCall(
    // The secret seals the new token, and opens a replaced one to revoke it.
    { cors: true, secrets: ['SMS_ENCRYPTION_KEY'] },
    async (request) => {
        const uid = signedInUid(request);
        const { state, code } = request.data || {};
        const usable = (value, max) => typeof value === 'string' && value !== '' && value.length <= max;
        if (!usable(state, 256) || !usable(code, 2048)) throw new HttpsError('invalid-argument', MESSAGES.EXPIRED);
        await limitRate(`gmail_complete_${uid}`);

        const pending = await takeState(oauth.stateIdFor(state), uid);
        if (pending?.wrongUser) throw new HttpsError('permission-denied', MESSAGES.WRONG_USER);
        if (!pending || pending.kind !== 'gmail' || !(millisOf(pending.expiresAt) > Date.now())) {
            throw new HttpsError('failed-precondition', MESSAGES.EXPIRED);
        }
        const { companyId } = pending;
        // Again: the admin's role, the company or its switch may have changed since the start.
        await requireSwitchOn(await assertCompanyAdminStrict(uid, companyId), companyId);

        let granted;
        try {
            const { clientId } = await oauth.readGmailClient();
            const tokens = await oauth.exchangeCode({
                code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri,
            });
            // Granular consent lets the admin untick sending.
            if (!tokens.scopes.includes(oauth.GMAIL_SEND_SCOPE)) throw new oauth.GmailOAuthError('send-scope-missing');
            if (!tokens.refreshToken) throw new oauth.GmailOAuthError('refresh-token-missing');
            granted = { ...oauth.decodeIdToken(tokens.idToken, { clientId }), tokens };
        } catch (error) {
            throw refusal(error, 'completeGmailConnection', companyId);
        }
        const { sub, email, tokens } = granted;
        const sealed = sealPassword(tokens.refreshToken);

        const { replacedSealed, accountChanged } = await db.runTransaction(async (transaction) => {
            const configRef = emailConfigRef(companyId);
            const configSnap = await transaction.get(configRef);
            const stored = configSnap.exists ? configSnap.data() || {} : {};
            const previousSub = typeof stored.gmailSub === 'string' && oauth.SUB_PATTERN.test(stored.gmailSub)
                && stored.gmailSub !== sub ? stored.gmailSub : null;
            const newGrant = await transaction.get(grantRef(sub));
            const oldGrant = previousSub ? await transaction.get(grantRef(previousSub)) : null;

            const now = fieldValue().serverTimestamp();
            transaction.set(configRef, {
                provider: 'gmail',
                gmailEmail: email,
                gmailSub: sub,
                gmailRefreshToken: sealed,
                gmailScopes: [...tokens.scopes].sort(),
                gmailConnectedAt: now,
                gmailConnectedBy: uid,
                gmailStatus: 'active',
                gmailStatusReason: null,
                gmailStatusAt: now,
                gmailDisconnectedAt: fieldValue().delete(),
                gmailDisconnectedBy: fieldValue().delete(),
            }, { merge: true });
            const holders = companyIdsOf(newGrant);
            transaction.set(grantRef(sub), {
                companyIds: holders.includes(companyId) ? holders : [...holders, companyId],
                updatedAt: now,
            });
            // The same account again: its old token is not revoked, since that would end the new one too.
            const lastHolder = previousSub ? releaseGrant(transaction, previousSub, oldGrant, companyId) : false;
            return {
                replacedSealed: lastHolder && typeof stored.gmailRefreshToken === 'string' ? stored.gmailRefreshToken : null,
                accountChanged: Boolean(previousSub),
            };
        });
        if (replacedSealed) await revokeSealed(replacedSealed, 'completeGmailConnection', companyId);

        console.log(`[completeGmailConnection] Gmail connected for company ${companyId} by ${uid}; account changed: ${accountChanged}`);
        return { email };
    },
);

exports.disconnectGmail = onCall(
    // The secret opens the stored token to revoke it.
    { cors: true, secrets: ['SMS_ENCRYPTION_KEY'] },
    async (request) => {
        const uid = signedInUid(request);
        const companyId = companyIdOf(request.data);
        await limitRate(`gmail_disconnect_${uid}`);
        await assertCompanyAdminStrict(uid, companyId);

        const { revokeSealedToken, wasConnected } = await db.runTransaction(async (transaction) => {
            const configRef = emailConfigRef(companyId);
            const configSnap = await transaction.get(configRef);
            const stored = configSnap.exists ? configSnap.data() || {} : {};
            const connected = stored.provider === 'gmail' || GMAIL_FIELDS.some((field) => stored[field] !== undefined);
            if (!connected) return { revokeSealedToken: null, wasConnected: false };
            const sub = typeof stored.gmailSub === 'string' && oauth.SUB_PATTERN.test(stored.gmailSub) ? stored.gmailSub : null;
            if (!sub && stored.gmailRefreshToken) {
                // Without the account id, revoking could end another company's grant too.
                console.warn(`[disconnectGmail] Company ${companyId} held a Gmail token without an account id; it was deleted, not revoked.`);
            }
            const grant = sub ? await transaction.get(grantRef(sub)) : null;

            transaction.update(configRef, {
                ...Object.fromEntries(GMAIL_FIELDS.map((field) => [field, fieldValue().delete()])),
                provider: fieldValue().delete(),
                gmailDisconnectedAt: fieldValue().serverTimestamp(),
                gmailDisconnectedBy: uid,
            });
            const lastHolder = sub ? releaseGrant(transaction, sub, grant, companyId) : false;
            return {
                revokeSealedToken: lastHolder && typeof stored.gmailRefreshToken === 'string' ? stored.gmailRefreshToken : null,
                wasConnected: true,
            };
        });
        if (revokeSealedToken) await revokeSealed(revokeSealedToken, 'disconnectGmail', companyId);

        if (wasConnected) console.log(`[disconnectGmail] Gmail disconnected for company ${companyId} by ${uid}`);
        return { disconnected: true };
    },
);

exports.GMAIL_FIELDS = GMAIL_FIELDS;
exports.MESSAGES = MESSAGES;
