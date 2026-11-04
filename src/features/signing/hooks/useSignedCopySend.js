/**
 * Approving a signed copy, for the Documents workspace.
 *
 * `request(document)` opens the approval for that document, captured as it was
 * when it opened: the list is live, and re-reading the row on approval could
 * send a different document's copy if the order shifted. `approve()` calls
 * `sendSignedDocumentCopy({ companyId, requestId, recipientEmail })` once — a
 * second press, however quick, finds the first in flight — with the address the
 * dialog showed, which the server refuses if a correction has changed it since.
 * The server decides whether it may (`utils/signedCopy.js`). Its refusal is
 * shown as it worded it, in the dialog, which stays open; a success is said in a
 * toast and remembered here until the request's own `signedCopy` record arrives
 * (`recordFor`).
 */
import { useCallback, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signedCopyRecord } from '@features/signing/utils/signedCopy';

export function useSignedCopySend({ companyId, showSuccess }) {
    const [pending, setPending] = useState(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [sentHere, setSentHere] = useState({});
    const inFlightRef = useRef(false);

    const recordFor = useCallback((document) => signedCopyRecord(document, sentHere[document?.id]), [sentHere]);

    const request = useCallback((document) => {
        if (!document?.id) return;
        setError('');
        setPending({
            id: document.id,
            title: document.title || 'Untitled',
            email: document.recipientEmail,
            signedPdfPath: document.signedPdfUrl || document.storagePath,
        });
    }, []);

    const cancel = useCallback(() => {
        if (inFlightRef.current) return;
        setPending(null);
        setError('');
    }, []);

    const approve = useCallback(async () => {
        if (!pending || inFlightRef.current) return;
        inFlightRef.current = true;
        setSending(true);
        setError('');
        try {
            const functions = getFunctions();
            const sendSignedDocumentCopy = httpsCallable(functions, 'sendSignedDocumentCopy');
            const { data } = await sendSignedDocumentCopy({ companyId, requestId: pending.id, recipientEmail: pending.email });
            const sentTo = data?.sentTo || pending.email;
            setSentHere((previous) => ({ ...previous, [pending.id]: { state: 'sent', sentTo, sentAt: data?.sentAt || null } }));
            showSuccess(`Signed copy sent to ${sentTo}`);
            setPending(null);
        } catch (err) {
            console.error('Signed copy error:', err);
            setError(err?.message || 'The signed copy could not be sent. Try again.');
        } finally {
            inFlightRef.current = false;
            setSending(false);
        }
    }, [companyId, pending, showSuccess]);

    return { pending, sending, error, request, cancel, approve, recordFor };
}
