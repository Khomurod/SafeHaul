/**
 * "Retry seal", for the Documents workspace.
 *
 * `retry(document)` asks `retrySealDocument({ companyId, requestId })` once — a
 * second press, however quick, finds the first in flight — and answers whether
 * the server accepted it. The server decides whether the document may be
 * sealed again (`functions/sealRetry.js`) and takes nothing but which document
 * it is; its refusal is shown as it worded it. The seal itself runs after the
 * call returns, so its outcome shows in the live list, not here.
 *
 * `dialogProps(document, close)` is what the details dialog takes for it: the
 * handler, which closes the dialog once the retry is accepted, and whether that
 * document's retry is on its way.
 */
import { useCallback, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

const SEALING_AGAIN ='Sealing again. The status here changes when it finishes.';

export function useSealRetry({ companyId, showSuccess, showError }) {
    const [retryingId, setRetryingId] = useState(null);
    const inFlightRef = useRef(false);

    const retry = useCallback(async (document) => {
        if (!document?.id || inFlightRef.current) return false;
        inFlightRef.current = true;
        setRetryingId(document.id);
        try {
            const functions = getFunctions();
            const retrySealDocument = httpsCallable(functions, 'retrySealDocument');
            await retrySealDocument({ companyId, requestId: document.id });
            showSuccess(SEALING_AGAIN);
            return true;
        } catch (err) {
            console.error('Retry seal error:', err);
            showError(err?.message || 'The document could not be sealed again. Try again.');
            return false;
        } finally {
            inFlightRef.current = false;
            setRetryingId(null);
        }
    }, [companyId, showSuccess, showError]);

    const dialogProps = (document, close) => ({
        onRetrySeal: async (docItem) => { if (await retry(docItem)) close(); },
        retryingSeal: Boolean(document) && retryingId === document.id,
    });

    return { retry, retryingId, dialogProps };
}
