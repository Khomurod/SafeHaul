/**
 * The dossier's DQ status: the value the sidebar's DQ File marker reads
 * (`DossierSidebar` flags `dqStatus === 'incomplete'`), from the entries the DQ
 * File tab lists, kept live.
 *
 * All identifiers below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    listeners: [],
    unsubscribe: vi.fn(),
    record: { appData: { firstName: 'Ann' }, collectionName: 'applications' },
}));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    collection: (parent, name) => ({ path: `${parent.path}/${name}` }),
    orderBy: (field, direction) => ({ field, direction }),
    query: (ref, ...constraints) => ({ path: ref.path, constraints }),
    onSnapshot: (q, next, fail) => {
        fs.listeners.push({ path: q.path, constraints: q.constraints, next, fail });
        return fs.unsubscribe;
    },
}));
vi.mock('@features/applications/services/applicationPdfService', () => ({
    NoPreservedPdfError: class NoPreservedPdfError extends Error {},
    downloadPreservedApplicationPdf: vi.fn(),
}));
vi.mock('@features/applications/hooks/useApplicationDetails', () => ({
    useApplicationDetails: () => ({
        ...fs.record,
        handleStatusUpdate: vi.fn(),
        isCompanyAdmin: true,
    }),
}));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showError: vi.fn() }) }));

import { useApplicationView } from './useApplicationView';

/** One entry of each type the DQ File tab offers that the status requires. */
const ALL_REQUIRED = [
    'MVR (Annual)',
    'Medical Card',
    'Road Test Certificate',
    'PSP Report',
    'Clearinghouse Report (Full)',
    'Clearinghouse Report (Annual)',
    'Certificate of Violations (Annual)',
].map((fileType, i) => ({ id: `dq-${i}`, fileType, fileName: `file-${i}.pdf` }));

const snapshotOf = (entries) => ({
    docs: entries.map(({ id, ...data }) => ({ id, data: () => data })),
});

const mount = () => renderHook(() => useApplicationView('co-1', 'app-1'));

const deliver = (entries, listener = fs.listeners.at(-1)) => act(() => listener.next(snapshotOf(entries)));

// Cleared before each test: the previous test's hook unmounts after its own
// `afterEach` hooks have run, and that unmount unsubscribes.
beforeEach(() => {
    vi.clearAllMocks();
    fs.listeners = [];
    fs.record = { appData: { firstName: 'Ann' }, collectionName: 'applications' };
});
afterEach(() => vi.restoreAllMocks());

describe("useApplicationView's DQ status", () => {
    it('is incomplete while a required document is missing', () => {
        const { result } = mount();
        deliver([{ id: 'dq-1', fileType: 'Medical Card', fileName: 'med.pdf' }]);

        expect(result.current.dqStatus).toBe('incomplete');
    });

    it('is complete once every required document is listed', () => {
        const { result } = mount();
        deliver(ALL_REQUIRED);

        expect(result.current.dqStatus).toBe('complete');
    });

    it('does not count an entry the DQ File tab no longer lists', () => {
        const { result } = mount();
        deliver(ALL_REQUIRED.map((entry, i) => (i === 0 ? { ...entry, removedAt: { seconds: 1 } } : entry)));

        expect(result.current.dqStatus).toBe('incomplete');
    });

    it.each([
        ['as the DQ File tab syncs it', { fileType: 'MVR Consent', fileName: 'IMG_1001.jpg' }],
        ['as the server syncs it', { fileType: 'MVR Consent', type: 'mvr_consent', fileName: 'consent.pdf' }],
    ])('does not take an MVR Consent for the MVR, %s', (_how, consent) => {
        const { result } = mount();
        deliver([...ALL_REQUIRED.slice(1), { id: 'dq-consent', ...consent }]);

        expect(result.current.dqStatus).toBe('incomplete');
    });

    it('takes the MVR the server syncs, under its label', () => {
        const { result } = mount();
        deliver([...ALL_REQUIRED.slice(1), { id: 'dq-mvr', fileType: 'MVR', type: 'mvr', fileName: 'record.pdf' }]);

        expect(result.current.dqStatus).toBe('complete');
    });

    it('follows the entries as they change', () => {
        const { result } = mount();
        deliver(ALL_REQUIRED.slice(1));
        expect(result.current.dqStatus).toBe('incomplete');

        deliver(ALL_REQUIRED);
        expect(result.current.dqStatus).toBe('complete');
        expect(fs.listeners).toHaveLength(1);
    });

    it('claims nothing before the entries arrive, nor when they cannot be read', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = mount();
        expect(result.current.dqStatus).toBeNull();

        act(() => fs.listeners[0].fail(new Error('permission-denied')));
        expect(result.current.dqStatus).toBeNull();
    });

    it("waits for the record, then reads the DQ File tab's entries for its collection", () => {
        fs.record = { appData: null, collectionName: 'applications' };
        const { result, rerender } = mount();
        expect(fs.listeners).toHaveLength(0);
        expect(result.current.dqStatus).toBeNull();

        fs.record = { appData: { firstName: 'Lee' }, collectionName: 'leads' };
        rerender();

        expect(fs.listeners).toHaveLength(1);
        expect(fs.listeners[0].path).toBe('companies/co-1/leads/app-1/dq_files');
        expect(fs.listeners[0].constraints).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    });

    it('stops listening when the dossier closes', () => {
        const { unmount } = mount();
        unmount();

        expect(fs.unsubscribe).toHaveBeenCalledTimes(1);
    });
});
