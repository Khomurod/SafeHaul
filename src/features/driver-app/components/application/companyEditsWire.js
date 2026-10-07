/**
 * The two keys a Company Admin's edits leave beside the answers, and the helpers
 * every save and restore passes them through.
 *
 * Its own module so the draft service, which every page loads, does not pull the
 * application's field table into the first download. The rest of the protocol is
 * `companyEditsSync.js`.
 */

export const COMPANY_REVISION_KEY = '_companyRevision';
export const COMPANY_NOTICE_KEY = '_companyNotice';
export const COMPANY_KEYS = Object.freeze([COMPANY_REVISION_KEY, COMPANY_NOTICE_KEY]);

/** The revision a copy has taken, or null for one that never took any. */
export function companyRevisionIn(formData) {
    const value = formData?.[COMPANY_REVISION_KEY];
    return Number.isInteger(value) && value >= 0 ? value : null;
}

/** The answers alone, as every payload must carry them. */
export function withoutCompanyKeys(formData) {
    const answers = { ...(formData || {}) };
    for (const key of COMPANY_KEYS) delete answers[key];
    return answers;
}

/**
 * A save as it crosses the wire: the answers alone, and beside them the revision
 * they carry.
 *
 * Said only by a browser holding its own draft's token, because that token is the
 * one thing it can fetch the edits with: a refusal it could not act on would only
 * stop its saves.
 */
export function saveOnTheWire(payload) {
    return {
        ...payload,
        formData: withoutCompanyKeys(payload?.formData),
        seenRevision: payload?.resumeToken ? (companyRevisionIn(payload.formData) ?? 0) : null,
    };
}

/** A restored draft with its revision inside the answers, where it stays with them. */
export function restoredWithRevision(data) {
    if (!data?.draft) return data;
    const revision = Number.isInteger(data.draft.companyRevision) ? data.draft.companyRevision : 0;
    return {
        ...data,
        draft: { ...data.draft, formData: { ...(data.draft.formData || {}), [COMPANY_REVISION_KEY]: revision } },
    };
}
