/**
 * Envelope loading for the public signing room.
 *
 * One responsibility: fetch the signing request through the public callable
 * (or the E2E mock), normalize its fields, and initialize field values —
 * seeding locked/default values and merging any persisted local draft.
 * Presentation, navigation, and submission stay in SigningRoom.
 */
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isFieldLocked } from '@features/signing/utils/prefillEngine';
import { normalizeSignerField } from '@features/signing/utils/signerFieldStyle';
import { readDraft } from '@features/signing/utils/signingDraft';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

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

export function useSigningEnvelope({ companyId, requestId, accessToken }) {
    const [request, setRequest] = useState(null);
    const [fieldValues, setFieldValues] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        async function load() {
            if (!accessToken) {
                setError("Invalid Link: No access token provided.");
                setLoading(false);
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
                    accessToken
                });

                const data = result.data;

                // PROD-FIX: Normalize pageNumber to a number to prevent type-mismatch rendering bugs.
                // Firestore sometimes stores numbers as strings, causing strict === to fail
                // in the per-page field filter and making fields invisible.
                if (data.fields) {
                    data.fields = data.fields.filter(f => f != null).map(normalizeSignerField);
                }

                setRequest(data);

                if (data.fields) {
                    setFieldValues(initializeFieldValues(data.fields, companyId, requestId));
                }
            } catch (err) {
                console.error("Load Error:", err);
                setError("Document not found or link expired.");
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [companyId, requestId, accessToken]);

    return { request, fieldValues, setFieldValues, loading, error };
}
