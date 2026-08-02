/**
 * Signing-room draft persistence — extracted verbatim from SigningRoom.jsx.
 *
 * Draft storage — survives a tab refresh on flaky LTE so drivers don't lose typed values.
 * Signatures (PNG dataURLs, ~10-50 KB each) are included; multi-signature docs fit comfortably
 * under the typical 5 MB localStorage quota.
 */
const DRAFT_KEY_PREFIX = 'signing_draft_v1';
const draftKey = (companyId, requestId) => `${DRAFT_KEY_PREFIX}:${companyId}:${requestId}`;

export function readDraft(companyId, requestId) {
    try {
        const raw = localStorage.getItem(draftKey(companyId, requestId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDraft(companyId, requestId, values) {
    try {
        localStorage.setItem(draftKey(companyId, requestId), JSON.stringify(values));
    } catch {
        // Quota exceeded or storage disabled — silently skip, in-memory state still works.
    }
}

export function clearDraft(companyId, requestId) {
    try {
        localStorage.removeItem(draftKey(companyId, requestId));
    } catch {
        /* ignore */
    }
}
