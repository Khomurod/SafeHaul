import { useState, useCallback } from 'react';
import { db } from '@lib/firebase';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function useCampaignDraft(companyId) {
    const { showSuccess, showError } = useToast();
    const [isSaving, setIsSaving] = useState(false);

    const saveDraft = useCallback(async (campaignId, data) => {
        if (!companyId || !campaignId) return;

        setIsSaving(true);
        try {
            const draftRef = doc(db, 'companies', companyId, 'campaign_drafts', campaignId);

            // Clean undefined values
            const cleanData = JSON.parse(JSON.stringify(data));

            await setDoc(draftRef, {
                ...cleanData,
                updatedAt: serverTimestamp(),
                companyId
            }, { merge: true });

            // Optional: Silent save vs toaster
            // showSuccess("Draft saved");
        } catch (err) {
            console.error("Draft Save Error:", err);
            showError("Failed to save draft");
        } finally {
            setIsSaving(false);
        }
    }, [companyId]);

    const deleteDraft = useCallback(async (campaignId) => {
        if (!window.confirm("Delete this draft?")) return;
        try {
            await deleteDoc(doc(db, 'companies', companyId, 'campaign_drafts', campaignId));
            showSuccess("Draft deleted");
        } catch (err) {
            showError(err.message);
        }
    }, [companyId]);

    return {
        saveDraft,
        deleteDraft,
        isSaving
    };
}
