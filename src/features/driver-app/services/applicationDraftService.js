import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

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
    const call = httpsCallable(functions, 'resumeApplicationDraft');
    const result = await call(payload);
    return result.data;
}

/** Discards an unfinished application. Throws, because the caller must not proceed silently. */
export async function startNewApplication(payload) {
    const call = httpsCallable(functions, 'startNewApplication');
    const result = await call(payload);
    return result.data;
}
