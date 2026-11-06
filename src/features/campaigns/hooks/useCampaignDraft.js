import { useCallback } from 'react';
import { db } from '@lib/firebase';

/**
 * useCampaignDraft — persists campaign draft data to Firestore.
 * Imported by CampaignEditor.jsx. A launch is marked on the draft by the server
 * (`initBulkSession`), not here.
 */
export function useCampaignDraft(companyId) {
    // Resolves `true` once saved and `false` when the save failed (logged, never
    // thrown: autosave carries on, and the save before Launch stops on it).
    const saveDraft = useCallback(async (campaignId, data) => {
        if (!companyId || !campaignId) return undefined;
        try {
            const { doc, setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'companies', companyId, 'campaign_drafts', campaignId), data, { merge: true });
            return true;
        } catch (error) {
            console.error('[CampaignDraft] Failed to save:', error);
            return false;
        }
    }, [companyId]);

    return { saveDraft, isSaving: false };
}
