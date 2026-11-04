import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (_fns, name) => (...a) => mockCallable(name, ...a) }));
let mockSnapshotDocs = [];
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({})),
    onSnapshot: (_col, cb) => { cb({ docs: mockSnapshotDocs }); return () => {}; },
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showSuccess, showError }) }));

import { useApplicationChanges } from './useApplicationChanges';

const args = ['co1', 'app1', 'applications'];

describe('useApplicationChanges', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockSnapshotDocs = [];
        mockCallable.mockResolvedValue({ data: { applied: ['firstName'] } });
    });

    it('surfaces live pending changes from the snapshot', async () => {
        mockSnapshotDocs = [{ id: 'firstName', data: () => ({ fieldKey: 'firstName', fieldLabel: 'First Name', status: 'pending' }) }];
        const { result } = renderHook(() => useApplicationChanges(...args));
        await waitFor(() => expect(result.current.pendingChanges).toHaveLength(1));
        expect(result.current.pendingChanges[0]).toMatchObject({ id: 'firstName', fieldLabel: 'First Name' });
    });

    it('proposeChanges calls proposeApplicationChanges and reports success', async () => {
        const { result } = renderHook(() => useApplicationChanges(...args));
        let ok;
        await act(async () => { ok = await result.current.proposeChanges([{ fieldKey: 'firstName', proposedValue: 'X' }]); });
        expect(ok).toBe(true);
        expect(mockCallable).toHaveBeenCalledWith('proposeApplicationChanges', { companyId: 'co1', applicationId: 'app1', collectionName: 'applications', changes: [{ fieldKey: 'firstName', proposedValue: 'X' }] });
    });

    it('proposeChanges returns false when nothing applied', async () => {
        mockCallable.mockResolvedValueOnce({ data: { applied: [] } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let ok;
        await act(async () => { ok = await result.current.proposeChanges([{ fieldKey: 'x', proposedValue: 1 }]); });
        expect(ok).toBe(false);
        expect(showError).toHaveBeenCalledWith('No applicable changes were saved.');
    });

    // The server returns every field it left out (`skipped`): one on the shared
    // list was already that value, one off it is not the company's to change.
    it('names each field the server left out, and why, beside what it saved', async () => {
        mockCallable.mockResolvedValueOnce({ data: { applied: ['firstName'], skipped: ['middleName', 'sms-consent'] } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let ok;
        await act(async () => { ok = await result.current.proposeChanges([{ fieldKey: 'firstName', proposedValue: 'X' }]); });

        expect(ok).toBe(true);
        expect(showSuccess).toHaveBeenCalledWith(
            '1 change(s) marked for driver approval. Not sent for approval: Middle Name (no change); '
            + "Can we send you SMS messages? (can't be changed by the company).",
        );
    });

    it('says what was left out when nothing was saved', async () => {
        mockCallable.mockResolvedValueOnce({ data: { applied: [], skipped: ['employers', 'no-such-field', null] } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        await act(async () => { await result.current.proposeChanges([{ fieldKey: 'employers', proposedValue: [] }]); });

        expect(showError).toHaveBeenCalledWith(
            'No applicable changes were saved. Not sent for approval: Previous Employers (no change); '
            + "Another field (can't be changed by the company).",
        );
    });

    it('createReviewLink builds the URL from path and copies to clipboard', async () => {
        mockCallable.mockResolvedValueOnce({ data: { token: 't1', path: '/review-change/t1' } });
        const writeText = vi.fn().mockResolvedValue();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let url;
        await act(async () => { url = await result.current.createReviewLink(); });
        expect(url).toBe(`${window.location.origin}/review-change/t1`);
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/review-change/t1`);
        vi.unstubAllGlobals();
    });

    it('emailReviewLink has the server email it, and never holds the link', async () => {
        mockCallable.mockResolvedValueOnce({ data: { success: true, delivered: { channel: 'email', to: 'j***@example.test' }, expiresInDays: 30 } });
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let to;
        await act(async () => { to = await result.current.emailReviewLink(); });

        expect(to).toBe('j***@example.test');
        expect(mockCallable).toHaveBeenCalledWith('createChangeReview', {
            companyId: 'co1', applicationId: 'app1', collectionName: 'applications',
            deliver: 'email', appBaseUrl: window.location.origin,
        });
        expect(result.current.emailedTo).toBe('j***@example.test');
        expect(showSuccess).toHaveBeenCalledWith('Review link emailed to j***@example.test.');
        expect(writeText).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('emailReviewLink says why it was not sent, in the server’s words', async () => {
        mockCallable.mockRejectedValueOnce(Object.assign(
            new Error('This driver has no email address we can send to, so nothing was sent.'),
            { code: 'functions/failed-precondition', details: { reason: 'no-email' } },
        ));
        const { result } = renderHook(() => useApplicationChanges(...args));
        let to;
        await act(async () => { to = await result.current.emailReviewLink(); });

        expect(to).toBeNull();
        expect(result.current.emailedTo).toBeNull();
        expect(showError).toHaveBeenCalledWith('This driver has no email address we can send to, so nothing was sent.');
    });

    it('a copied link replaces the emailed one, so the screen stops saying it was emailed', async () => {
        mockCallable.mockResolvedValueOnce({ data: { success: true, delivered: { channel: 'email', to: 'j***@example.test' } } });
        mockCallable.mockResolvedValueOnce({ data: { token: 't2', path: '/review-change/t2' } });
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        await act(async () => { await result.current.emailReviewLink(); });
        expect(result.current.emailedTo).toBe('j***@example.test');

        await act(async () => { await result.current.createReviewLink(); });
        expect(result.current.emailedTo).toBeNull();
        vi.unstubAllGlobals();
    });
});
