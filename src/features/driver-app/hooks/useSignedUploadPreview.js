import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';

/**
 * A viewable URL for a document already on the application.
 *
 * ## Why this exists
 *
 * An upload left `{name, url, storagePath}` in the form data, and that `url` is a
 * signed read URL with a **fifteen-minute** life (`GUEST_READ_TTL_MS` in
 * `functions/getSignedGuestUploadUrl.js`). It was persisted into the draft
 * verbatim and handed to the driver by the invite exchange — so a document a
 * recruiter attached on Tuesday was a broken image and a Storage error page by
 * the time the driver opened the link, and the same for a recruiter reopening
 * their own draft an hour later. Found 2026-09-08.
 *
 * The durable identifier was sitting right beside it, unused: `storagePath`.
 * Nothing anywhere re-signed from it for the driver, though the company's own
 * dossier view has done exactly this for the same reason for some time
 * (`useAppFetch.js`, "their persisted `url` is a 15-min signed URL that has
 * expired by dossier-view time"). This is that, on the side that needed it too.
 *
 * A signed URL is a short-lived capability and not a property of the document, so
 * it is minted when someone is looking and never stored. `useGuestFileUpload` no
 * longer persists one at all.
 *
 * ## What it does NOT change
 *
 * Access. `getSignedGuestUploadUrl` authorizes exactly as it did — the path shape,
 * the tenant, and a per-IP rate limit — and `storagePath` was already persisted in
 * the draft, so anyone who could read the draft could already reach the file.
 * Whoever can read the draft is the question the resume token and the invite
 * answer, and neither is touched here.
 *
 * ## Telling the three failures apart
 *
 * An expired signature, a deleted object and a refusal all rendered as the same
 * broken image and the same XML error page in a new tab, so "your link expired"
 * was indistinguishable from "your file is gone" — and the second is the only one
 * that means anything has to be uploaded again. `not-found` is the file; anything
 * else is this attempt, and can be retried.
 */

/**
 * How long a signed link is reused. It lives fifteen minutes (`GUEST_READ_TTL_MS`
 * in `functions/getSignedGuestUploadUrl.js`); ten leaves every link shown at least
 * five. Within them a revisited step, a second field showing the same file or a
 * re-render does not sign again: the callable allows twenty a minute per IP, and
 * a truck stop's Wi-Fi is one IP.
 */
export const PREVIEW_REUSE_MS = 10 * 60 * 1000;

/** `companyId|storagePath` -> the signing in flight or done; a failed one is removed. */
const signedLinks = new Map();

function signedLink(companyId, storagePath) {
    const key = `${companyId}|${storagePath}`;
    const held = signedLinks.get(key);
    if (held && Date.now() - held.at < PREVIEW_REUSE_MS) return held.link;
    const link = httpsCallable(functions, 'getSignedGuestUploadUrl')({ companyId, storagePath })
        .then(({ data }) => {
            if (!data?.url) throw new Error('No preview link was returned.');
            return data.url;
        });
    signedLinks.set(key, { link, at: Date.now() });
    link.catch(() => { if (signedLinks.get(key)?.link === link) signedLinks.delete(key); });
    return link;
}

/** For tests: forget every link. */
export function resetSignedPreviewCache() {
    signedLinks.clear();
}

export const PREVIEW_STATE = Object.freeze({
    /** Nothing attached. */
    NONE: 'none',
    LOADING: 'loading',
    READY: 'ready',
    /** The object is not in Storage. This is the one that needs a re-upload. */
    MISSING: 'missing',
    /** This attempt failed. The file is presumed fine. */
    ERROR: 'error',
});

/** What an upload descriptor says, across every shape this field has ever stored. */
function describe(value) {
    if (!value) return { storagePath: null, storedUrl: null };
    // A very old record is the URL itself.
    if (typeof value === 'string') return { storagePath: null, storedUrl: value };
    return {
        storagePath: typeof value.storagePath === 'string' ? value.storagePath : null,
        storedUrl: typeof value.url === 'string' ? value.url : null,
    };
}

export function useSignedUploadPreview(value, companyId) {
    const { storagePath, storedUrl } = describe(value);
    // The file, not the object holding it: a new copy of the same value is the same document.
    const hasValue = Boolean(value);
    const [signed, setSigned] = useState(null);
    const [state, setState] = useState(PREVIEW_STATE.NONE);
    const [attempt, setAttempt] = useState(0);
    /**
     * Which request the answer on screen belongs to.
     *
     * Bumped per request rather than compared by path, because a retry asks the
     * same question twice and the second answer must be allowed to win.
     */
    const generation = useRef(0);

    useEffect(() => {
        generation.current += 1;
        const mine = generation.current;
        setSigned(null);

        if (!hasValue) {
            setState(PREVIEW_STATE.NONE);
            return undefined;
        }
        /*
         * No path to re-sign from: a legacy record, or an E2E run, where the
         * "upload" is a `blob:` URL this browser made and the callable points at
         * an unreachable project. Either way the stored value is the only answer
         * there is, and it is a perfectly good one.
         */
        if (!storagePath || !companyId || isE2ETestMode) {
            setState(storedUrl ? PREVIEW_STATE.READY : PREVIEW_STATE.NONE);
            setSigned(storedUrl);
            return undefined;
        }

        setState(PREVIEW_STATE.LOADING);
        signedLink(companyId, storagePath)
            .then((url) => {
                if (generation.current !== mine) return;
                setSigned(url);
                setState(PREVIEW_STATE.READY);
            })
            .catch((error) => {
                if (generation.current !== mine) return;
                // The file itself, versus this attempt at looking at it. Only the
                // first means anything has to be uploaded again.
                setState(String(error?.code || '').includes('not-found')
                    ? PREVIEW_STATE.MISSING
                    : PREVIEW_STATE.ERROR);
            });
        return () => { generation.current += 1; };
    }, [hasValue, storagePath, storedUrl, companyId, attempt]);

    const retry = useCallback(() => setAttempt((previous) => previous + 1), []);

    return { url: signed, state, retry };
}

export default useSignedUploadPreview;
