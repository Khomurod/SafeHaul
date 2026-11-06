/**
 * Envelope loading for the public signing room.
 *
 * One responsibility: fetch the signing request through the public callable
 * (or the E2E mock), normalize its fields, and initialize field values —
 * seeding locked/default values and merging any persisted local draft.
 * Presentation, navigation, and submission stay in SigningRoom.
 *
 * A link that does not open keeps the server's reason (`linkProblem`, for
 * `LinkProblemScreen`) and, unless the link could not be checked at all, the
 * company's public name to say who to ask. A link this device already used to
 * sign reads as the signed document it is (`alreadySigned.js`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isFieldLocked } from '@features/signing/utils/prefillEngine';
import { isCompanySignatureField } from '@features/signing/utils/companySignature';
import { normalizeSignerField } from '@features/signing/utils/signerFieldStyle';
import { browserTimeZone, rollSignedDateFields } from '@features/signing/utils/signedDate';
import { readDraft } from '@features/signing/utils/signingDraft';
import { signedHereAt } from '@features/signing/utils/alreadySigned';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { LINK_PROBLEM, linkProblemFromError } from '@shared/components/public-link';
import { fetchPublicCompanyName } from '@shared/services/publicCompanyName';

/** Minimal data-URL PDF used by the E2E mock shell (no network fetch). */
export const E2E_MOCK_PDF_URL =
    'data:application/pdf;base64,' +
    btoa('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

function buildE2EMockEnvelope() {
    const mockFields = [
        { id: 'text1', type: 'text', pageNumber: 1, required: true, xPosition: 10, yPosition: 10, width: 20, height: 5 },
        { id: 'date1', type: 'date', pageNumber: 1, required: true, xPosition: 10, yPosition: 20, width: 20, height: 5 },
        { id: 'check1', type: 'checkbox', pageNumber: 1, required: true, xPosition: 10, yPosition: 30, width: 4, height: 3 },
        { id: 'sig1', type: 'signature', pageNumber: 1, required: true, xPosition: 10, yPosition: 40, width: 20, height: 8 },
        // Edge-anchored optional fields so e2e can verify overlays
        // hug the page corners at any viewport / zoom.
        { id: 'corner_tl', type: 'text', pageNumber: 1, required: false, xPosition: 0, yPosition: 0, width: 12, height: 4 },
        { id: 'corner_br', type: 'checkbox', pageNumber: 1, required: false, xPosition: 93, yPosition: 95, width: 6, height: 4 },
    ].map(normalizeSignerField);
    return {
        request: {
            title: 'E2E Test Document',
            recipientName: 'E2E Signer',
            status: 'sent',
            pdfUrl: E2E_MOCK_PDF_URL,
            fields: mockFields,
        },
        fieldValues: {
            text1: 'Jane Doe',
            date1: '2026-05-21',
            check1: true,
            sig1: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        },
    };
}

/**
 * Seed initial values for every field, then merge any persisted draft.
 * Locked fields always take their server-side defaultValue; draft values are
 * only restored for fields that still exist and are not locked.
 */
function initializeFieldValues(fields, companyId, requestId) {
    const initial = {};
    fields.forEach(f => {
        // The company's image: shown, never filled, so it has no value.
        if (isCompanySignatureField(f)) return;
        if (f.type === 'checkbox') {
            initial[f.id] = false;
            return;
        }

        if (f.type === 'text' || f.type === 'date') {
            if (isFieldLocked(f)) {
                initial[f.id] = String(f.defaultValue ?? '');
            } else if (f.defaultValue) {
                initial[f.id] = String(f.defaultValue);
            } else {
                initial[f.id] = '';
            }
            return;
        }

        initial[f.id] = '';
    });

    const draft = readDraft(companyId, requestId);
    if (draft) {
        fields.forEach((f) => {
            if (!f || isFieldLocked(f)) return;
            if (Object.prototype.hasOwnProperty.call(draft, f.id)) {
                initial[f.id] = draft[f.id];
            }
        });
    }

    return initial;
}

/**
 * The link was refused: whose reason to show, or the signed document this device
 * already sent with it. A submission deletes the token, so the server answers a
 * used link like a wrong or replaced one.
 */
function refusedLink(err, companyId, requestId) {
    const problem = linkProblemFromError(err, 'This document could not be opened.');
    if (err?.code !== 'functions/permission-denied') return { problem };
    const signedAt = signedHereAt(companyId, requestId);
    if (signedAt) return { signed: { status: 'signed', signedAt } };
    return {
        problem: { ...problem, detail: 'It may have been replaced by a newer link, or the document may already be signed.' },
    };
}

/** Who to ask about a link problem; a link that could not be checked asks nobody yet. */
async function senderFor(problem, companyId) {
    return problem.reason === LINK_PROBLEM.UNAVAILABLE ? null : fetchPublicCompanyName(companyId);
}

/**
 * A refused submission that ends the visit: the link no longer works (wrong or
 * replaced token, expired, the document gone or already submitted). A refusal
 * of what was filled in, or a failure to reach the server, keeps the form for
 * another try.
 */
export function isTerminalSubmitRefusal(err) {
    const code = String(err?.code ?? '');
    if (code === 'functions/permission-denied' || code === 'functions/not-found') return true;
    const { reason } = linkProblemFromError(err);
    return reason === LINK_PROBLEM.EXPIRED || reason === LINK_PROBLEM.REPLACED || reason === LINK_PROBLEM.USED;
}

export function useSigningEnvelope({ companyId, requestId, accessToken }) {
    const [request, setRequest] = useState(null);
    const [fieldValues, setFieldValues] = useState({});
    const [loading, setLoading] = useState(true);
    // `{ reason, detail? }` when the link did not open (`LinkProblemScreen`).
    const [linkProblem, setLinkProblem] = useState(null);
    // The sender, named on that screen when its public profile has a name.
    const [companyName, setCompanyName] = useState(null);
    // Bumped by Try again, which loads the envelope once more.
    const [attempt, setAttempt] = useState(0);
    // How far this device's clock sits from the server's, measured once from the
    // instant the server stamped the Date Signed fields. Everything time-related
    // in this room is derived through it, so a wrong device clock cannot put a
    // date on screen that the sealed document will contradict.
    const clockOffsetMs = useRef(0);

    useEffect(() => {
        // Another link opened in the same room (new ids or token) makes this
        // load stale: nothing it learns may replace what the new one shows.
        let current = true;
        setLinkProblem(null);
        setCompanyName(null);
        setLoading(true);

        /** The screen names who to ask, when the sender's public profile has a name. */
        async function showProblem(problem) {
            const name = await senderFor(problem, companyId);
            if (!current) return;
            setCompanyName(name);
            setLinkProblem(problem);
        }

        async function load() {
            if (!accessToken) {
                // The link was cut short: the token is what makes it a link.
                await showProblem({ reason: LINK_PROBLEM.NOT_FOUND });
                if (current) setLoading(false);
                return;
            }

            if (isE2ETestMode && getE2EQueryParam('e2eSign', '') === 'mock') {
                const mock = buildE2EMockEnvelope();
                setRequest(mock.request);
                setFieldValues(mock.fieldValues);
                setLoading(false);
                return;
            }

            try {
                const getEnvelopeFn = httpsCallable(functions, 'getPublicEnvelope');
                const result = await getEnvelopeFn({
                    companyId,
                    requestId,
                    accessToken,
                    // The server stamps Date Signed in this zone, on its own clock.
                    timeZone: browserTimeZone(),
                });
                if (!current) return;

                const data = result.data;

                // PROD-FIX: Normalize pageNumber to a number to prevent type-mismatch rendering bugs.
                // Firestore sometimes stores numbers as strings, causing strict === to fail
                // in the per-page field filter and making fields invisible.
                if (data.fields) {
                    data.fields = data.fields.filter(f => f != null).map(normalizeSignerField);
                }

                const serverNow = Date.parse(data.serverTime || '');
                clockOffsetMs.current = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;

                setRequest(data);

                if (data.fields) {
                    setFieldValues(initializeFieldValues(data.fields, companyId, requestId));
                }
            } catch (err) {
                if (!current) return;
                console.error("Load Error:", err);
                const refused = refusedLink(err, companyId, requestId);
                if (refused.signed) setRequest(refused.signed);
                else await showProblem(refused.problem);
            } finally {
                if (current) setLoading(false);
            }
        }
        load();
        return () => { current = false; };
    }, [companyId, requestId, accessToken, attempt]);

    const retry = useCallback(() => {
        setLinkProblem(null);
        setLoading(true);
        setAttempt((n) => n + 1);
    }, []);

    /**
     * The link stopped working while the signer filled the document in
     * (`isTerminalSubmitRefusal`): the room leaves the form for the link screen,
     * as if the link had been opened now.
     */
    const endWithRefusal = useCallback(async (err) => {
        const refused = refusedLink(err, companyId, requestId);
        if (refused.signed) {
            setRequest(refused.signed);
            return;
        }
        setCompanyName(await senderFor(refused.problem, companyId));
        setLinkProblem(refused.problem);
    }, [companyId, requestId]);

    /**
     * Bring the displayed Date Signed up to the server's current day, for the
     * document that was opened before midnight in the signer's zone and is submitted after
     * it. Returns the first field that moved — so the caller can stop, say so and
     * show the signer where — or null when the day has not changed, which is
     * every submission but the rare one that crosses the boundary.
     */
    const refreshSignedDate = useCallback(() => {
        if (!Array.isArray(request?.fields) || request.fields.length === 0) return null;
        const at = new Date(Date.now() + clockOffsetMs.current);
        const rolled = rollSignedDateFields(request.fields, fieldValues, at, request.timeZone || 'UTC');
        if (!rolled) return null;
        setRequest((prev) => (prev ? { ...prev, fields: rolled.fields } : prev));
        setFieldValues(rolled.fieldValues);
        return rolled.fields.find(
            (field, i) => field?.defaultValue !== request.fields[i]?.defaultValue,
        ) || null;
    }, [request, fieldValues]);

    return {
        request, fieldValues, setFieldValues, loading, linkProblem, companyName, retry, endWithRefusal,
        refreshSignedDate,
    };
}
