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

    // After a launch: the draft is kept as the record and points at its session.
    const markLaunched = useCallback(async (campaignId, sessionId) => {
        if (!companyId || !campaignId) return;
        const { serverTimestamp } = await import('firebase/firestore');
        await saveDraft(campaignId, { launchedAt: serverTimestamp(), sessionId: sessionId || null });
    }, [companyId, saveDraft]);

    return { saveDraft, markLaunched, isSaving: false };
}
