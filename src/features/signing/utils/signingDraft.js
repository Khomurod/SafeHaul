/**
 * Signing-room draft persistence.
 *
 * Draft storage — survives a tab refresh on flaky LTE so drivers don't lose typed values.
 * A drawn signature or initial (a PNG data URL, tens of kilobytes) is not kept:
 * localStorage writes are synchronous, and the signer redraws in a few seconds.
 * `useSigningDraftWriter` decides when a draft is written.
 */
const DRAFT_KEY_PREFIX = 'signing_draft_v1';
const draftKey = (companyId, requestId) => `${DRAFT_KEY_PREFIX}:${companyId}:${requestId}`;

const isDrawnImage = (value) => typeof value === 'string' && value.startsWith('data:image/');

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
    const kept = Object.fromEntries(Object.entries(values || {}).filter(([, value]) => !isDrawnImage(value)));
    try {
        localStorage.setItem(draftKey(companyId, requestId), JSON.stringify(kept));
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
