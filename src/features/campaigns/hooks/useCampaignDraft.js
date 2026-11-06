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
    // `create`: the draft is not stored yet, so this save creates it, with the
    // times the Drafts list orders by. Client time, not `serverTimestamp()`: the
    // server's own value would come back in a second snapshot after the save,
    // and the editor would put the saved fields back over anything typed since.
    const saveDraft = useCallback(async (campaignId, data, { create = false } = {}) => {
        if (!companyId || !campaignId) return undefined;
        try {
            const { doc, setDoc, Timestamp } = await import('firebase/firestore');
            const now = create ? Timestamp.now() : null;
            const stored = create ? { ...data, createdAt: now, updatedAt: now } : data;
            await setDoc(doc(db, 'companies', companyId, 'campaign_drafts', campaignId), stored, { merge: true });
            return true;
        } catch (error) {
            console.error('[CampaignDraft] Failed to save:', error);
            return false;
        }
    }, [companyId]);

    return { saveDraft, isSaving: false };
}
