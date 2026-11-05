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

describe('useCampaignDraft — markLaunched', () => {
    it('marks the draft launched, with its session, on the draft document itself', async () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await result.current.markLaunched('camp-1', 'session-1');

        expect(fs.setDoc).toHaveBeenCalledTimes(1);
        expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'companies/co-1/campaign_drafts/camp-1' },
            { launchedAt: '__serverTimestamp__', sessionId: 'session-1' },
            { merge: true },
        );
    });

    it('still marks the draft launched when no session id came back', async () => {
        const { result } = renderHook(() => useCampaignDraft('co-1'));

        await result.current.markLaunched('camp-1', undefined);

        expect(fs.setDoc.mock.calls[0][1]).toEqual({ launchedAt: '__serverTimestamp__', sessionId: null });
    });

    it('writes nothing without a company or a draft', async () => {
        const { result } = renderHook(() => useCampaignDraft(undefined));
        await result.current.markLaunched('camp-1', 'session-1');

        const { result: noDraft } = renderHook(() => useCampaignDraft('co-1'));
        await noDraft.current.markLaunched(undefined, 'session-1');

        expect(fs.setDoc).not.toHaveBeenCalled();
    });
});
