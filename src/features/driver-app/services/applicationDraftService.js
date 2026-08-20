import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import {
    clearApplicationDraft,
    draftSyncState,
    writeDiscardMark,
} from '../components/application/applicationDraftStorage';

/**
 * Client for the application autosave and resume callables.
 *
 * Everything here is best-effort by design. Saving progress must never be able to
 * stop an applicant moving to the next page: the local draft is written first and
 * synchronously, so a failed network call costs a server copy and nothing the
 * driver can see. That asymmetry is the whole point — the feature exists because
 * applicants were losing work, and a version of it that *blocks* them would be a
 * worse bargain than not having it.
 */

/**
 * Browser-test doubles for the four draft callables.
 *
 * The end-to-end suite runs the real SPA against no backend — the company
 * profile, the upload and the submission are all already served from fixtures in
 * `isE2ETestMode` — so a resume flow that only exists behind a callable cannot be
 * exercised in a browser at all. `?e2eResume=offer` says "a matching unfinished
 * application exists", which is the one thing a spec cannot arrange from outside.
 *
 * Two independent gates, following `isMarketingDemo`: the E2E flag is never set in
 * a production build, and `import.meta.env.PROD` refuses regardless. A fixture
 * draft appearing in the real product would be worse than not testing the flow.
 */
const E2E_APPLICANT_KEY = 'e2e-applicant-key';
const E2E_RESUME_TOKEN = 'e2e-resume-token';

/** Deliberately a different step and different answers from a fresh first page. */
const E2E_RESUME_DRAFT = Object.freeze({
    applicantKey: E2E_APPLICANT_KEY,
    // A sequence, so a restored copy can be recorded as already-synced and the
    // reconciliation branches are reachable from a browser test.
    clientSeq: 5,
    formData: {
        firstName: 'Restored',
        lastName: 'Driver',
        email: 'restored@example.com',
        phone: '5555550101',
        cdlNumber: 'E2ERESTORED9',
    },
    lastStep: 3,
    lastSemanticStep: 'violations',
});

function e2eDraftsEnabled() {
    if (import.meta.env.PROD) return false;
    return isE2ETestMode;
}

function e2eResumeMode() {
    return e2eDraftsEnabled() ? getE2EQueryParam('e2eResume', '') : '';
}

/**
 * Whether a browser test has asked the next progress save to fail.
 *
 * Settable at runtime rather than only by query parameter, because the case worth
 * proving needs a *successful* save first and a failing one after, without a
 * reload in between — a reload would discard the in-memory form state that makes
 * the local copy newer than the server's.
 */
function e2eSaveShouldFail() {
    if (!e2eDraftsEnabled()) return false;
    if (getE2EQueryParam('e2eDraftSave', '') === 'fail') return true;
    return typeof window !== 'undefined' && window.__e2eFailDraftSave === true;
}

/** Where the resume token for this device lives. One per company slug. */
const tokenKey = (slug) => `apply_resume_${slug}`;

/**
 * The resume token is a bearer credential for one unfinished application.
 *
 * `localStorage` rather than a cookie because the apply page is a public SPA with
 * no session, and rather than `sessionStorage` because surviving a closed tab is
 * the entire feature. It is not an SSN and not an application: the worst it does
 * is restore a form on the device that filled it in.
 */
export function readResumeToken(slug) {
    if (!slug) return null;
    try {
        const raw = localStorage.getItem(tokenKey(slug));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.resumeToken ? parsed : null;
    } catch {
        return null;
    }
}

export function writeResumeToken(slug, { resumeToken, applicantKey }) {
    if (!slug || !resumeToken) return;
    try {
        localStorage.setItem(tokenKey(slug), JSON.stringify({ resumeToken, applicantKey }));
    } catch {
        // A browser refusing storage costs cross-session resume on this device.
        // The identity match still works, so it is a degradation, not a failure.
    }
}

/**
 * Ends the local life of a draft whose application has been submitted.
 *
 * Three writes, and all three are needed. The local copy goes, or a reload would
 * restore the answers of an application that has already been sent. The mark tells
 * every other open tab, which is the only way they learn: the server deleted the
 * draft, and a deletion is indistinguishable from "there was never anything here".
 * The token goes last, because it is now a credential for a document that no longer
 * exists.
 *
 * The order matches Start Over's, for the same reason: clearing the draft frees the
 * space the mark needs, and a mark that fails to land leaves the other tabs able to
 * autosave a submitted application back into existence.
 *
 * Lives here rather than in the wizard because two callers need it and must not
 * drift: the direct submission, and the offline queue when a submission it was
 * holding finally reaches the server — possibly in a different tab, possibly days
 * later.
 *
 * @returns {string|null} the mark written, so a caller that must not react to its own
 *   write can adopt it. `null` when storage refused it.
 */
export function closeDraftAfterSubmission(slug) {
    if (!slug) return null;
    clearApplicationDraft(slug);
    const mark = writeDiscardMark(slug, 'submit');
    clearResumeToken(slug);
    return mark;
}

/**
 * The same close, for a submission that arrives long after it was made.
 *
 * An offline submission can land minutes or days later, and in between the applicant
 * may have gone back to the apply page and started something new. `applySlug` names
 * the apply page, not *which* application was submitted from it — so closing on the
 * slug alone would clear a draft belonging to newer work and tell every open tab that
 * newer application had been submitted. Deleting work the applicant has not sent is
 * strictly worse than the duplicate-submission risk this close exists to remove, so
 * the close only happens when what is in storage now is still the same application.
 *
 * Identified by the resume token's applicant key where one existed, because that is
 * what actually names the draft; by the local write counter when no token was ever
 * issued, which is the case for an application that never reached the server at all.
 * Compared for equality only — neither value is read as an order or a time.
 *
 * When storage holds neither a token nor a draft there is nothing newer to protect,
 * and the mark is still worth writing: other tabs may hold these answers in memory.
 *
 * @param {string} slug
 * @param {{ applicantKey?: string|null, localSeq?: number|null }} [submitted] What the
 *   draft looked like when this submission was queued.
 * @returns {string|null} the mark written, or `null` when nothing was closed.
 */
export function closeDraftAfterDelayedSubmission(slug, submitted = {}) {
    if (!slug) return null;
    const { applicantKey = null, localSeq = null } = submitted;
    const stored = readResumeToken(slug);

    // A token on either side makes this decidable by key, which is the strongest
    // answer available: it names the server draft the submission was made from.
    if (stored?.applicantKey || applicantKey) {
        if (!applicantKey || stored?.applicantKey !== applicantKey) return null;
        return closeDraftAfterSubmission(slug);
    }

    // No token was ever issued for this application — it never reached the server.
    // The local write counter still distinguishes "the same draft" from "the applicant
    // has typed more since", which is all that is being asked here.
    const state = draftSyncState(slug);
    if (state && (!Number.isInteger(localSeq) || state.localSeq !== localSeq)) return null;

    return closeDraftAfterSubmission(slug);
}

export function clearResumeToken(slug) {
    if (!slug) return;
    try {
        localStorage.removeItem(tokenKey(slug));
    } catch {
        // Nothing to do: a token that cannot be removed still expires server-side.
    }
}

/**
 * Saves everything entered so far.
 *
 * Resolves to `{ saved, applicantKey, resumeToken }` or to `{ saved: false }` when
 * anything went wrong. It deliberately does not throw: every caller would have to
 * swallow it anyway, and one that forgot would block the applicant.
 */
export async function saveApplicationProgress(payload) {
    if (e2eDraftsEnabled() && e2eSaveShouldFail()) {
        // The same shape a real failure produces: the client swallows it and the
        // applicant is never blocked, so the local copy is left holding work the
        // server has not acknowledged.
        return { saved: false };
    }
    if (e2eDraftsEnabled()) {
        // Recorded so a browser test can assert what the client *actually* built,
        // rather than only what a mocked callable was handed in jsdom. The SSN is
        // a deliberate top-level field — the server needs it to derive the identity
        // HMAC and never stores it — and the assertion that matters is that it is
        // absent from `formData`, which is the part that is persisted.
        if (typeof window !== 'undefined') {
            window.__e2eDraftSaves = window.__e2eDraftSaves || [];
            window.__e2eDraftSaves.push(payload);
        }
        return { saved: true, applicantKey: E2E_APPLICANT_KEY, resumeToken: E2E_RESUME_TOKEN };
    }
    try {
        const call = httpsCallable(functions, 'saveApplicationProgress');
        const result = await call(payload);
        return result.data || { saved: false };
    } catch (error) {
        console.warn('[applicationDraftService] Progress could not be saved to the server:', error?.code || error?.message);
        return { saved: false };
    }
}

/**
 * Is there an unfinished application for this person at this company?
 *
 * Returns `{ resumable: false }` for every unsuccessful case, including an error,
 * because a returning applicant who cannot be matched should simply carry on
 * filling the form rather than be shown a diagnostic.
 */
export async function findResumableApplication(payload) {
    if (e2eDraftsEnabled()) {
        if (e2eResumeMode() !== 'offer') return { resumable: false };
        return {
            resumable: true,
            resumeToken: E2E_RESUME_TOKEN,
            startedAt: '2026-08-14T09:00:00.000Z',
            updatedAt: '2026-08-14T09:30:00.000Z',
            lastSemanticStep: E2E_RESUME_DRAFT.lastSemanticStep,
        };
    }
    try {
        const call = httpsCallable(functions, 'findResumableApplication');
        const result = await call(payload);
        return result.data || { resumable: false };
    } catch (error) {
        console.warn('[applicationDraftService] Resume lookup failed:', error?.code || error?.message);
        return { resumable: false };
    }
}

/** Exchanges a resume token for the saved answers. Throws, because the caller shows an error. */
export async function resumeApplicationDraft(payload) {
    if (e2eDraftsEnabled()) {
        // Throws exactly as the callable does for an unknown or discarded draft,
        // so the "start over, then reload" path is a real test of the client's
        // stale-token handling rather than of the double.
        if (e2eResumeMode() !== 'offer') {
            const missing = new Error('That saved application could not be found.');
            missing.code = 'functions/not-found';
            throw missing;
        }
        return { restored: true, draft: { ...E2E_RESUME_DRAFT, formData: { ...E2E_RESUME_DRAFT.formData } } };
    }
    const call = httpsCallable(functions, 'resumeApplicationDraft');
    const result = await call(payload);
    return result.data;
}

/** Discards an unfinished application. Throws, because the caller must not proceed silently. */
export async function startNewApplication(payload) {
    if (e2eDraftsEnabled()) return { discarded: true };
    const call = httpsCallable(functions, 'startNewApplication');
    const result = await call(payload);
    return result.data;
}
