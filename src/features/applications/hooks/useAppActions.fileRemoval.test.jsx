/**
 * Contract for the reworked admin file-removal flow in `useAppActions`
 * (2026-07-28), the sixth and last of the blocking `window.confirm` guards.
 *
 * The guard used to live *inside* the hook, which meant the only possible
 * confirmation was the browser's blocking one. It was also unreachable: nothing
 * in the app calls `handleAdminFileDelete`, so the confirmation was dead code in a
 * live, two-layer-exported API — waiting to surprise whoever wired it up.
 *
 * This freezes:
 *  - `handleAdminFileDelete` keeps its name and `(fieldKey, storagePath)`
 *    signature and no longer prompts; it is purely the executor.
 *  - The exact Storage delete, Firestore `{ [fieldKey]: null }` update, activity
 *    log and toast wording are unchanged.
 *  - The additive `requestAdminFileDelete` / `confirmAdminFileDelete` /
 *    `cancelAdminFileDelete` API: staging deletes nothing, cancelling deletes
 *    nothing, confirming deletes exactly once, and a failure keeps the pending
 *    target so the operator can retry.
 *  - `canEdit` and missing-`storagePath` guards.
 *
 * All ids and paths below are artificial test fixtures.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ updateDoc: vi.fn(), doc: vi.fn((_db, ...p) => ({ path: p.join('/') })) }));
const st = vi.hoisted(() => ({ deleteObject: vi.fn(), ref: vi.fn((_s, path) => ({ path })) }));
const logActivity = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
    doc: (...a) => fs.doc(...a),
    updateDoc: (...a) => fs.updateDoc(...a),
    serverTimestamp: () => '__ts__',
}));
vi.mock('firebase/storage', () => ({
    ref: (...a) => st.ref(...a),
    deleteObject: (...a) => st.deleteObject(...a),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
}));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: (...a) => logActivity(...a) }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toast }));
vi.mock('@shared/utils/searchNormalization', () => ({ buildApplicationSearchFields: () => ({}) }));

import { useAppActions } from './useAppActions';

/** Exposes the hook's file-removal surface through a tiny harness. */
let api;
function Harness({ canEdit = true }) {
    api = useAppActions({
        companyId: 'co-1',
        applicationId: 'app-1',
        collectionName: 'applications',
        appData: {},
        setAppData: vi.fn(),
        setFileUrls: vi.fn(),
        setCurrentStatus: vi.fn(),
        currentStatus: 'New',
        setAssignedTo: vi.fn(),
        teamMembers: [],
        canEdit,
        onStatusUpdate: vi.fn(),
    });
    return <div data-testid="pending">{api.pendingFileRemoval ? api.pendingFileRemoval.fieldKey : 'none'}</div>;
}

beforeEach(() => {
    vi.clearAllMocks();
    fs.updateDoc.mockResolvedValue(undefined);
    st.deleteObject.mockResolvedValue(undefined);
    logActivity.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useAppActions — the hook no longer owns a dialog', () => {
    it('does not call window.confirm when executing a removal', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);
        render(<Harness />);

        await act(async () => { await api.handleAdminFileDelete('cdl-front', 'p/cdl.jpg'); });

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(st.deleteObject).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('keeps the public executor name and signature', () => {
        render(<Harness />);
        expect(typeof api.handleAdminFileDelete).toBe('function');
        expect(api.handleAdminFileDelete.length).toBe(2);
    });

    it('exposes the additive confirm-ready API', () => {
        render(<Harness />);
        expect(typeof api.requestAdminFileDelete).toBe('function');
        expect(typeof api.confirmAdminFileDelete).toBe('function');
        expect(typeof api.cancelAdminFileDelete).toBe('function');
        expect(api.pendingFileRemoval).toBeNull();
    });
});

describe('useAppActions — removal contract', () => {
    it('deletes from Storage, nulls the Firestore field, logs and reports success', async () => {
        render(<Harness />);
        await act(async () => { await api.handleAdminFileDelete('cdl-front', 'companies/co-1/applications/app-1/cdl-front-a.jpg'); });

        expect(st.ref).toHaveBeenCalledWith({}, 'companies/co-1/applications/app-1/cdl-front-a.jpg');
        expect(fs.doc).toHaveBeenCalledWith({}, 'companies', 'co-1', 'applications', 'app-1');
        expect(fs.updateDoc.mock.calls[0][1]).toEqual({ 'cdl-front': null });
        expect(logActivity).toHaveBeenCalledWith('co-1', 'applications', 'app-1', 'File Deleted', 'Deleted cdl-front');
        expect(toast.showSuccess).toHaveBeenCalledWith('File removed');
    });

    it('removes only the selected field', async () => {
        render(<Harness />);
        await act(async () => { await api.handleAdminFileDelete('mvr-upload', 'p/mvr.pdf'); });
        expect(Object.keys(fs.updateDoc.mock.calls[0][1])).toEqual(['mvr-upload']);
    });

    it('tolerates a missing Storage object and still clears the reference', async () => {
        st.deleteObject.mockRejectedValueOnce({ code: 'storage/object-not-found' });
        render(<Harness />);
        await act(async () => { await api.handleAdminFileDelete('twic-card-upload', 'p/twic.jpg'); });

        expect(fs.updateDoc).toHaveBeenCalledTimes(1);
        expect(toast.showSuccess).toHaveBeenCalledWith('File removed');
    });

    it('reports a failure with the frozen wording', async () => {
        fs.updateDoc.mockRejectedValue(new Error('offline'));
        render(<Harness />);
        let result;
        await act(async () => { result = await api.handleAdminFileDelete('cdl-back', 'p/back.jpg'); });

        expect(toast.showError).toHaveBeenCalledWith('File deletion failed.');
        expect(result).toBe(false);
    });

    it.each([
        ['a missing storagePath', { path: '' }],
        ['no edit permission', { canEdit: false, path: 'p/x.jpg' }],
    ])('does nothing with %s', async (_name, { canEdit = true, path }) => {
        render(<Harness canEdit={canEdit} />);
        await act(async () => { await api.handleAdminFileDelete('cdl-front', path); });
        expect(st.deleteObject).not.toHaveBeenCalled();
        expect(fs.updateDoc).not.toHaveBeenCalled();
    });
});

describe('useAppActions — staged confirmation', () => {
    it('staging performs no deletion', () => {
        render(<Harness />);
        act(() => { api.requestAdminFileDelete('cdl-front', 'p/cdl.jpg'); });

        expect(screen.getByTestId('pending')).toHaveTextContent('cdl-front');
        expect(st.deleteObject).not.toHaveBeenCalled();
        expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('cancelling performs no deletion and clears the target', () => {
        render(<Harness />);
        act(() => { api.requestAdminFileDelete('cdl-front', 'p/cdl.jpg'); });
        act(() => { api.cancelAdminFileDelete(); });

        expect(screen.getByTestId('pending')).toHaveTextContent('none');
        expect(st.deleteObject).not.toHaveBeenCalled();
    });

    it('will not stage a removal without a path or permission', () => {
        render(<Harness canEdit={false} />);
        act(() => { api.requestAdminFileDelete('cdl-front', 'p/cdl.jpg'); });
        expect(screen.getByTestId('pending')).toHaveTextContent('none');
    });

    it('confirming removes the staged file exactly once and clears the target', async () => {
        render(<Harness />);
        act(() => { api.requestAdminFileDelete('medical-card-upload', 'p/med.jpg'); });
        await act(async () => { await api.confirmAdminFileDelete(); });

        expect(st.ref).toHaveBeenCalledWith({}, 'p/med.jpg');
        expect(fs.updateDoc.mock.calls[0][1]).toEqual({ 'medical-card-upload': null });
        await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('none'));
    });

    it('confirming with nothing staged does nothing', async () => {
        render(<Harness />);
        await act(async () => { await api.confirmAdminFileDelete(); });
        expect(st.deleteObject).not.toHaveBeenCalled();
    });

    it('rejects a second confirmation dispatched before the first settles', async () => {
        let release;
        fs.updateDoc.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        render(<Harness />);
        act(() => { api.requestAdminFileDelete('cdl-front', 'p/cdl.jpg'); });

        await act(async () => {
            api.confirmAdminFileDelete();
            api.confirmAdminFileDelete();
            api.confirmAdminFileDelete();
        });

        expect(st.deleteObject).toHaveBeenCalledTimes(1);
        await act(async () => { release(); });
    });

    it('keeps the staged target after a failure so the removal can be retried', async () => {
        fs.updateDoc.mockRejectedValue(new Error('offline'));
        render(<Harness />);
        act(() => { api.requestAdminFileDelete('cdl-front', 'p/cdl.jpg'); });
        await act(async () => { await api.confirmAdminFileDelete(); });

        expect(toast.showError).toHaveBeenCalledWith('File deletion failed.');
        expect(screen.getByTestId('pending')).toHaveTextContent('cdl-front');

        // Retry succeeds and clears it.
        fs.updateDoc.mockResolvedValue(undefined);
        await act(async () => { await api.confirmAdminFileDelete(); });
        await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('none'));
    });
});
