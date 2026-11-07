import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// The hook resolves ONE document: companies/{c}/applications/{a}/submission/v1.
// The mock records the path it was asked for so the tests can assert the reader
// addresses exactly the location writeSubmissionSnapshot writes to.
let requestedPath = [];
let mockDocResult = { exists: () => false, data: () => undefined };
let mockGetDocImpl = null;
let reads = 0;

vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => { requestedPath = segments; return { __path: segments }; },
    getDoc: () => {
        reads += 1;
        return mockGetDocImpl ? mockGetDocImpl() : Promise.resolve(mockDocResult);
    },
}));
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

import { useSubmissionRecord } from './useSubmissionRecord';
import { forgetSubmissionRecords } from '@features/applications/services/submissionRecordRead';

/**
 * A snapshot shaped exactly like buildSubmissionSnapshot's output — `frozen: true`
 * plus sections of `answers`. The presenter treats anything else as unpreserved,
 * so the fixture has to be faithful or these tests prove nothing.
 */
function preservedSnapshot(overrides = {}) {
    return {
        schemaVersion: 1,
        frozen: true,
        definitionVersion: 'def-abc',
        agreementVersion: 'v1',
        submittedAt: '2026-03-04T10:00:00.000Z',
        company: { name: 'Blue Line Freight' },
        sections: [
            {
                id: 'personal',
                title: 'Personal',
                answers: [{ fieldId: 'firstName', label: 'First Name', displayValue: 'Dana', presented: true }],
            },
        ],
        customAnswers: [],
        agreements: [],
        employmentCoverage: { isComplete: true, coveredMonths: 36, requiredMonths: 36, missingMonths: 0, gaps: [] },
        signature: null,
        provenance: { source: 'submission', notes: [] },
        ...overrides,
    };
}

describe('useSubmissionRecord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // A dossier closes between tests: each reads its own record.
        forgetSubmissionRecords();
        reads = 0;
        requestedPath = [];
        mockGetDocImpl = null;
        mockDocResult = { exists: () => false, data: () => undefined };
    });

    it('reads the original snapshot at submission/v1 under the application', async () => {
        mockDocResult = { exists: () => true, data: () => preservedSnapshot() };
        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(requestedPath).toEqual(['companies', 'co1', 'applications', 'app1', 'submission', 'v1']);
    });

    it('presents a preserved snapshot through the shared presenter', async () => {
        mockDocResult = { exists: () => true, data: () => preservedSnapshot() };
        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.record.isPreserved).toBe(true);
        expect(result.current.record.notice).toBeNull();
        expect(result.current.record.sections[0].answers[0]).toMatchObject({ label: 'First Name', value: 'Dana' });
        expect(result.current.error).toBeNull();
    });

    it('reports an honest notice for historical applications with no snapshot', async () => {
        mockDocResult = { exists: () => false, data: () => undefined };
        const { result } = renderHook(() => useSubmissionRecord('co1', 'legacy-app'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.record.isPreserved).toBe(false);
        expect(result.current.record.notice).toMatch(/no preserved submission record/i);
        // Critically: it must NOT pass live data off as the submitted original.
        expect(result.current.record.sections).toEqual([]);
    });

    it('never claims preservation when the read fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetDocImpl = () => Promise.reject(Object.assign(
            new Error('Missing or insufficient permissions.'),
            { code: 'permission-denied' },
        ));
        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe(
            'Could not load the preserved submission record. You do not have permission to do this. If you think you should, ask your company admin.',
        );
        consoleError.mockRestore();
        expect(result.current.record.isPreserved).toBe(false);
        expect(result.current.record.sections).toEqual([]);
    });

    it('stays idle until both ids are known', async () => {
        const { result } = renderHook(() => useSubmissionRecord(null, 'app1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.record).toBeNull();
        expect(requestedPath).toEqual([]);
    });

    it('surfaces the reconstructed notice instead of presenting it as an original', async () => {
        mockDocResult = {
            exists: () => true,
            data: () => preservedSnapshot({
                provenance: { source: 'reconstructed', notes: ['Agreement acceptance was not recorded.'] },
            }),
        };
        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.record.isPreserved).toBe(true);
        expect(result.current.record.isReconstructed).toBe(true);
        expect(result.current.record.notice).toMatch(/reconstructed/i);
        expect(result.current.record.reconstructionNotes).toContain('Agreement acceptance was not recorded.');
    });

    it('reads nothing on a return to the tab while the dossier is open', async () => {
        mockDocResult = { exists: () => true, data: () => preservedSnapshot() };
        const first = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(first.result.current.record?.isPreserved).toBe(true));
        first.unmount();

        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.record?.isPreserved).toBe(true));
        expect(result.current.record.sections[0].answers[0]).toMatchObject({ value: 'Dana' });
        expect(reads).toBe(1);
    });

    it('reads a record that was not there again on a return to the tab', async () => {
        const first = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(first.result.current.record?.isPreserved).toBe(false));
        first.unmount();

        mockDocResult = { exists: () => true, data: () => preservedSnapshot() };
        const { result } = renderHook(() => useSubmissionRecord('co1', 'app1'));
        await waitFor(() => expect(result.current.record?.isPreserved).toBe(true));
        expect(reads).toBe(2);
    });

    it('does not apply a stale response after the application changes', async () => {
        let resolveFirst;
        mockGetDocImpl = () => new Promise((res) => { resolveFirst = res; });

        const { result, rerender } = renderHook(({ id }) => useSubmissionRecord('co1', id), {
            initialProps: { id: 'app1' },
        });

        // Second application resolves immediately while the first is still pending.
        mockGetDocImpl = () => Promise.resolve({ exists: () => true, data: () => preservedSnapshot({ company: { name: 'Second' } }) });
        rerender({ id: 'app2' });
        await waitFor(() => expect(result.current.loading).toBe(false));

        // The first request now lands late; it must be ignored.
        resolveFirst({ exists: () => true, data: () => preservedSnapshot({ company: { name: 'First' } }) });
        await new Promise((r) => setTimeout(r, 0));

        expect(result.current.record.company.name).toBe('Second');
    });
});
