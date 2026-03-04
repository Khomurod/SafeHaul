import { useCallback } from 'react';
import { db } from '@lib/firebase';

/**
 * useCampaignDraft — persists campaign draft data to Firestore.
 * Imported by CampaignEditor.jsx.
 */
export function useCampaignDraft(companyId) {
    const saveDraft = useCallback(async (campaignId, data) => {
        if (!companyId || !campaignId) return;
        try {
            const { doc, setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'companies', companyId, 'campaign_drafts', campaignId), data, { merge: true });
        } catch (error) {
            console.error('[CampaignDraft] Failed to save:', error);
        }
    }, [companyId]);

    return { saveDraft, isSaving: false };
}
