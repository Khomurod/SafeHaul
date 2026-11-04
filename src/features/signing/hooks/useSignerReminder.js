/**
 * "Remind", for the Documents workspace and the dossier.
 *
 * `remind(document)` asks `remindSigner({ companyId, requestId })` once — a
 * second press, however quick, finds the first in flight and gets `null` — and
 * answers what to tell the person (`{ tone, text }`, `signerReminder.js`). The
 * server decides the channels and refuses with its reason (another reminder
 * within ten minutes, no channel, a signed or voided document); the new expiry
 * shows in the live lists.
 *
 * `dialogProps(document, close)` is what the details dialog takes for it: the
 * handler, which toasts the answer and closes the dialog once a reminder went
 * (the dialog shows the document as it was opened), and whether that
 * document's reminder is on its way.
 */
import { useCallback, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { reminderErrorMessage, reminderResultMessage } from '../utils/signerReminder';

export function useSignerReminder({ companyId, showSuccess, showError } = {}) {
    const [remindingId, setRemindingId] = useState(null);
    const inFlightRef = useRef(false);

    const remind = useCallback(async (document) => {
        if (!document?.id || inFlightRef.current) return null;
        inFlightRef.current = true;
        setRemindingId(document.id);
        try {
            const { data } = await httpsCallable(functions, 'remindSigner')({ companyId, requestId: document.id });
            return reminderResultMessage(data);
        } catch (error) {
            // Ids only, never the signer's contact details.
            console.error('[useSignerReminder] Remind failed:', { code: error?.code, requestId: document.id });
            return { tone: 'danger', text: reminderErrorMessage(error) };
        } finally {
            inFlightRef.current = false;
            setRemindingId(null);
        }
    }, [companyId]);

    const dialogProps = (document, close) => ({
        onRemind: async (docItem) => {
            const message = await remind(docItem);
            if (!message) return;
            if (message.tone === 'danger') {
                showError?.(message.text);
                return;
            }
            showSuccess?.(message.text);
            close();
        },
        reminding: Boolean(document) && remindingId === document.id,
    });

    return { remind, remindingId, dialogProps };
}

export default useSignerReminder;
