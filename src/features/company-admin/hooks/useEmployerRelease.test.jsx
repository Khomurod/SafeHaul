// The release is read for one application, record, signature and employer.
// The dossier can hand an open preview fresher data, and no render may then
// offer the answer read for the old inputs: Print would put it on paper.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), releaseStatementFor: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (...parts) => parts.slice(1).join('/'), getDoc: (...args) => mocks.getDoc(...args) }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@shared/legal/employerReleaseAgreement', () => ({ releaseStatementFor: (...args) => mocks.releaseStatementFor(...args) }));

import { useEmployerRelease } from './useEmployerRelease';

const applicantWith = (snapshotId, id = 'app-1') => ({ id, signature: 'SIG', submissionRecord: { snapshotId } });

beforeEach(() => {
    mocks.getDoc.mockReset();
    mocks.releaseStatementFor.mockReset();
});

describe('useEmployerRelease', () => {
    it('offers no answer read for other inputs, from the first render with the new ones', async () => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('SIG'));
        const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ agreements: [] }) });
        mocks.releaseStatementFor.mockReturnValueOnce({ statement: 'for v1', signatureSha256: sha });

        const seen = [];
        const { rerender } = renderHook(({ applicant }) => {
            const result = useEmployerRelease({ companyId: 'co-1', applicant, employerName: 'Acme Freight' });
            seen.push({ snapshotId: applicant.submissionRecord.snapshotId, ...result });
            return result;
        }, { initialProps: { applicant: applicantWith('v1') } });
        await waitFor(() => expect(seen.at(-1).release).toMatchObject({ statement: 'for v1' }));

        mocks.getDoc.mockReturnValueOnce(new Promise(() => {}));
        rerender({ applicant: applicantWith('v2') });

        const forNew = seen.filter((entry) => entry.snapshotId === 'v2');
        expect(forNew.length).toBeGreaterThan(0);
        expect(forNew.every((entry) => entry.release === null && entry.loading === true)).toBe(true);
        expect(mocks.getDoc).toHaveBeenLastCalledWith('companies/co-1/applications/app-1/submission/v2');
    });

    it('reads nothing without the document id', () => {
        const { result } = renderHook(() => useEmployerRelease({ companyId: 'co-1', applicant: applicantWith('v1', null), employerName: 'Acme Freight' }));
        expect(result.current).toEqual({ release: null, loading: false });
        expect(mocks.getDoc).not.toHaveBeenCalled();
    });
});
