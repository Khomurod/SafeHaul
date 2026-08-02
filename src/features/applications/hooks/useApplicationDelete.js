import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * Company-admin hard delete of an application/lead via the deleteApplication
 * callable (cascade + storage cleanup happen server-side). Returns whether the
 * delete succeeded so the caller can close the dossier and refresh the list.
 */
export function useApplicationDelete() {
    const [deleting, setDeleting] = useState(false);
    const { showSuccess, showError } = useToast();

    const deleteApplication = async ({ companyId, applicationId, collectionName = 'applications' }) => {
        if (!companyId || !applicationId) {
            showError('Cannot delete: missing application reference.');
            return false;
        }
        setDeleting(true);
        try {
            const fn = httpsCallable(functions, 'deleteApplication');
            await fn({ companyId, applicationId, collectionName });
            showSuccess('Application deleted.');
            return true;
        } catch (e) {
            console.error('[useApplicationDelete] delete failed:', e);
            showError(e?.message || 'Could not delete the application.');
            return false;
        } finally {
            setDeleting(false);
        }
    };

    return { deleting, deleteApplication };
}

export default useApplicationDelete;
