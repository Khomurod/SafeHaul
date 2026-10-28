import { useState, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * Removes one phone line from a company's SMS wallet through `removePhoneLine`
 * and tells the person what happened. Shared by Super Admin's `LineManager` and
 * the company's own SMS settings page, so both say the same thing.
 *
 * Frozen in `LineManager.contract.test.jsx`: the `{ companyId, phoneNumber }`
 * payload and the success / cleared-assignments / failure toast wording.
 * `removingLine` is the number being removed, for a row's loading state. One
 * removal at a time: a second request while one is in flight is ignored, since
 * the server rewrites the whole inventory on each removal.
 */
export function useRemovePhoneLine(companyId) {
    const { showSuccess, showError } = useToast();
    const [removingLine, setRemovingLine] = useState(null);
    const inFlight = useRef(false);

    const removeLine = useCallback(async (phoneNumber) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setRemovingLine(phoneNumber);
        try {
            const removeLineFn = httpsCallable(functions, 'removePhoneLine');
            const result = await removeLineFn({ companyId, phoneNumber });

            if (result.data.success) {
                showSuccess(result.data.message || `Line ${phoneNumber} removed.`);
                if (result.data.clearedAssignments > 0) {
                    showSuccess(`${result.data.clearedAssignments} assignment(s) cleared.`);
                }
            }
        } catch (error) {
            console.error('Remove Line Error:', error);
            showError(error.message || 'Failed to remove line.');
        } finally {
            inFlight.current = false;
            setRemovingLine(null);
        }
    }, [companyId, showSuccess, showError]);

    return { removingLine, removeLine };
}
