import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firestore is mocked: `doc` surfaces its path and `Timestamp.now` a marker,
// so the exact write can be asserted. Nothing reaches Firebase.
const fs = vi.hoisted(() => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    Timestamp: { now: vi.fn() },
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { useCampaignDraft } from './useCampaignDraft';

beforeEach(() => {
    vi.resetAllMocks();
    fs.doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    fs.setDoc.mockImplementation(async () => {});
    fs.Timestamp.now.mockImplementation(() => '__now__');
});

describe('useCampaignDraft — saveDraft', () => {
    it('merges the data into the draft document, and leaves its times alone', async () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await expect(result.current.saveDraft('camp-1', { name: 'Spring drive' })).resolves.toBe(true);

        expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'companies/co-1/campaign_drafts/camp-1' },
            { name: 'Spring drive' },
            { merge: true },
        );
        expect(fs.Timestamp.now).not.toHaveBeenCalled();
    });

    // A new campaign has no draft until its first save, which creates it with
    // the times the Drafts list orders by.
    it('creates the draft with its created and updated times when asked to', async () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await expect(result.current.saveDraft('camp-1', { name: 'Spring drive' }, { create: true })).resolves.toBe(true);

        expect(fs.setDoc).toHaveBeenCalledTimes(1);
        expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'companies/co-1/campaign_drafts/camp-1' },
            { name: 'Spring drive', createdAt: '__now__', updatedAt: '__now__' },
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
