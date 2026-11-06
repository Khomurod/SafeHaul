import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firestore is mocked: `doc` surfaces its path and `serverTimestamp` a marker,
// so the exact write can be asserted. Nothing reaches Firebase.
const fs = vi.hoisted(() => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(),
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { useCampaignDraft } from './useCampaignDraft';

beforeEach(() => {
    vi.resetAllMocks();
    fs.doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    fs.setDoc.mockImplementation(async () => {});
    fs.serverTimestamp.mockImplementation(() => '__serverTimestamp__');
});

describe('useCampaignDraft — saveDraft', () => {
    it('merges the data into the draft document', async () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await expect(result.current.saveDraft('camp-1', { name: 'Spring drive' })).resolves.toBe(true);

        expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'companies/co-1/campaign_drafts/camp-1' },
            { name: 'Spring drive' },
            { merge: true },
        );
    });

    // A launch is the server's to mark (`initBulkSession`): the hook offers no way to.
    it('offers no launch mark', () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        expect(result.current).not.toHaveProperty('markLaunched');
    });

    it('writes nothing without a company or a draft', async () => {
        const { result } = renderHook(() => useCampaignDraft(undefined));
        await result.current.saveDraft('camp-1', { name: 'x' });

        const { result: noDraft } = renderHook(() => useCampaignDraft('co-1'));
        await noDraft.current.saveDraft(undefined, { name: 'x' });

        expect(fs.setDoc).not.toHaveBeenCalled();
    });

    // Autosave goes on after a failed save; the save before Launch stops on it.
    it('logs a failed save and says so (false) instead of throwing', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.setDoc.mockImplementation(async () => { throw new Error('permission-denied'); });
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await expect(result.current.saveDraft('camp-1', { name: 'x' })).resolves.toBe(false);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
