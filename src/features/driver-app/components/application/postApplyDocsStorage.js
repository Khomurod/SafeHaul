/**
 * Session persistence for the post-application Required Documents checklist.
 *
 * Opening a signing request navigates away from /apply/:slug, unmounting
 * PublicApplyHandler and destroying its React state. These helpers persist the
 * submission identity (applicationId + confirmationNumber) and per-template
 * document progress in sessionStorage so the checklist survives the round trip
 * to the signing room (same-tab navigation) and page reloads within the tab.
 *
 * Access TOKENS are intentionally NEVER stored here — only request ids and
 * statuses. Re-opening a document always goes back through the callable, which
 * re-verifies the confirmation number before re-issuing a token.
 */

const SESSION_PREFIX = 'sh_post_apply_';
const SIGNED_PREFIX = 'sh_post_apply_signed_';
const RETURN_PREFIX = 'sh_post_apply_return_';

/** Sessions older than this are ignored on restore. */
export const POST_APPLY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const DOC_STATUS = Object.freeze({
    NOT_STARTED: 'not_started',
    OPENING: 'opening',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    ERROR: 'error',
});

const safeGet = (key) => {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeSet = (key, value) => {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        /* storage unavailable (privacy mode) — checklist still works in-memory */
    }
};

const safeRemove = (key) => {
    try {
        sessionStorage.removeItem(key);
    } catch {
        /* ignore */
    }
};

/**
 * @param {string} companyId
 * @param {{applicationId: string, confirmationNumber: string, slug: string, docs: object}} session
 */
export function savePostApplySession(companyId, session) {
    if (!companyId || !session?.applicationId) return;
    safeSet(`${SESSION_PREFIX}${companyId}`, JSON.stringify({
        ...session,
        savedAt: Date.now(),
    }));
}

export function readPostApplySession(companyId) {
    if (!companyId) return null;
    const raw = safeGet(`${SESSION_PREFIX}${companyId}`);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.applicationId) return null;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > POST_APPLY_SESSION_TTL_MS) {
            clearPostApplySession(companyId);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function clearPostApplySession(companyId) {
    if (!companyId) return;
    safeRemove(`${SESSION_PREFIX}${companyId}`);
}

/** Called by the signing room after a successful post-application submit. */
export function markRequestSigned(companyId, requestId) {
    if (!companyId || !requestId) return;
    safeSet(`${SIGNED_PREFIX}${companyId}_${requestId}`, '1');
}

export function isRequestSigned(companyId, requestId) {
    if (!companyId || !requestId) return false;
    return safeGet(`${SIGNED_PREFIX}${companyId}_${requestId}`) === '1';
}

/**
 * The apply page records where the signer should come back to BEFORE
 * navigating to /sign/... . The signing room only offers a "return to
 * documents" button when a path was stored for its exact request.
 */
export function setSigningReturnPath(companyId, requestId, path) {
    if (!companyId || !requestId || !path) return;
    safeSet(`${RETURN_PREFIX}${companyId}_${requestId}`, path);
}

export function readSigningReturnPath(companyId, requestId) {
    if (!companyId || !requestId) return null;
    return safeGet(`${RETURN_PREFIX}${companyId}_${requestId}`) || null;
}
