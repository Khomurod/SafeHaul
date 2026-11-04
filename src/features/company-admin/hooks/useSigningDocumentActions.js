/**
 * The dossier's actions on a driver's signing documents: Send to driver (a
 * post-application form, through `sendPostApplicationDocument`), Remind (a
 * document sent by email or text, through `useSignerReminder`) and opening a
 * signed copy (`openSignedDocument`). One action at a time; each row keeps the
 * message of its last action (`messages[row.key]`, `{ tone, text }`) until the
 * next, so a refusal's reason stays beside the document it is about.
 */
import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { BLOCKED_TAB_MESSAGE } from '@features/applications/services/openApplicationFile';
import { openSignedDocument } from '@features/signing/utils/openSignedDocument';
import { useSignerReminder } from '@features/signing/hooks/useSignerReminder';
import { sendErrorMessage, sendResultMessage } from '../utils/recordSigningDocuments';

export function useSigningDocumentActions({ companyId, applicationId }) {
    const [busyKey, setBusyKey] = useState(null);
    const [messages, setMessages] = useState({});
    const say = (key, message) => setMessages((prev) => ({ ...prev, [key]: message }));
    const { remind: sendReminder } = useSignerReminder({ companyId });

    const sendToDriver = useCallback(async (row) => {
        if (busyKey || !applicationId) return;
        setBusyKey(row.key);
        say(row.key, null);
        try {
            const { data } = await httpsCallable(functions, 'sendPostApplicationDocument')({
                companyId,
                applicationId,
                templateId: row.templateId,
                // The domain the driver's link opens on, as every sender records it.
                appBaseUrl: window.location.origin,
            });
            say(row.key, sendResultMessage(data));
        } catch (error) {
            console.error('[useSigningDocumentActions] Send to driver failed:', { code: error?.code, templateId: row.templateId });
            say(row.key, { tone: 'danger', text: sendErrorMessage(error) });
        } finally {
            setBusyKey(null);
        }
    }, [busyKey, companyId, applicationId]);

    const remind = useCallback(async (row) => {
        if (busyKey || !row.request) return;
        setBusyKey(row.key);
        say(row.key, null);
        try {
            const message = await sendReminder(row.request);
            if (message) say(row.key, { tone: message.tone, text: message.text });
        } finally {
            setBusyKey(null);
        }
    }, [busyKey, sendReminder]);

    /** Call it from the press itself: the tab opens before the link is signed. */
    const openSigned = useCallback((row) => {
        if (busyKey) return;
        say(row.key, null);
        const opening = openSignedDocument(row.request?.signedPdfUrl);
        if (!opening) {
            say(row.key, { tone: 'warning', text: BLOCKED_TAB_MESSAGE });
            return;
        }
        setBusyKey(row.key);
        opening
            .catch((error) => say(row.key, { tone: 'danger', text: error.message }))
            .finally(() => setBusyKey(null));
    }, [busyKey]);

    return { busyKey, messages, sendToDriver, remind, openSigned };
}

export default useSigningDocumentActions;
