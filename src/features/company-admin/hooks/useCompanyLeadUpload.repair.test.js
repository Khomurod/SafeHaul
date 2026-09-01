// useCompanyLeadUpload contract, part 2 of 2: the repair-scan progress rule,
// upload-failure rethrow, and the data-repair scan (rule, payload, batching,
// clean-scan return).
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `useCompanyLeadUpload.contract.support.js`; the registrations below delegate
// to it. See that file's header for the scope of this contract freeze.
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());

import { PLACEHOLDER_DOMAIN } from '@/config/placeholderDomains';
import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import {
    makeMountHook,
    resetHarness,
    restoreHarness,
    snapshot,
    fs,
    MEMBERSHIPS,
    LEADS_PATH,
} from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

beforeEach(resetHarness);

afterEach(restoreHarness);

describe('useCompanyLeadUpload — preserved contracts', () => {
    it('leaves the numeric progress count at zero for the repair scan', async () => {
        fs.getDocs.mockImplementation(async (target) => {
            const path = target?.path ?? target?.ref?.path;
            if (path === 'memberships') return snapshot(MEMBERSHIPS);
            return snapshot([]);
        });
        const { result } = await mountHook();
        await act(async () => { await result.current.runDataRepair(); });
        expect(result.current.progressCount).toEqual({ current: 0, total: 0 });
    });

    it('rethrows an upload failure and clears the uploading flag', async () => {
        fs.commit.mockImplementationOnce(() => { throw new Error('artificial batch failure'); });
        const { result } = await mountHook();

        await expect(result.current.uploadLeads([{ firstName: 'A' }], 'file'))
            .rejects.toThrow('artificial batch failure');
        await waitFor(() => expect(result.current.uploading).toBe(false));
        expect(result.current.step).toBe('upload');
    });

    it('repairs leads whose email holds a phone number', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        fs.getDocs.mockImplementation(async (target) => {
            const path = target?.path ?? target?.ref?.path;
            if (path === 'memberships') return snapshot(MEMBERSHIPS);
            if (path === LEADS_PATH) {
                return snapshot([
                    {
                        id: 'lead-broken',
                        ref: { __kind: 'doc', path: `${LEADS_PATH}/lead-broken` },
                        data: () => ({ email: '555-123-4567' }),
                    },
                    {
                        id: 'lead-ok',
                        ref: { __kind: 'doc', path: `${LEADS_PATH}/lead-ok` },
                        data: () => ({ email: 'artificial@example.test' }),
                    },
                ]);
            }
            return snapshot([]);
        });

        const { result, onUploadComplete } = await mountHook();
        await act(async () => { await result.current.runDataRepair(); });

        expect(fs.update).toHaveBeenCalledTimes(1);
        const [ref, payload] = fs.update.mock.calls[0];
        expect(ref.path).toBe(`${LEADS_PATH}/lead-broken`);
        expect(payload).toMatchObject({
            isEmailPlaceholder: true,
            phone: '(555) 123-4567',
            normalizedPhone: '5551234567',
            updatedAt: '__serverTimestamp__',
        });
        expect(payload.email).toMatch(
            new RegExp(`^no_email_\\d+_lead_@${PLACEHOLDER_DOMAIN.replace(/\./g, '\\.')}$`
                .replace('lead_', 'lead-')),
        );

        expect(result.current.stats).toEqual({ created: 0, updated: 1 });
        expect(result.current.step).toBe('success');
        expect(result.current.progress).toBe('Repaired 1 records.');

        await act(async () => { vi.advanceTimersByTime(1500); });
        expect(onUploadComplete).toHaveBeenCalledTimes(1);
    });

    it('reports a clean repair scan and returns to the upload step', async () => {
        fs.getDocs.mockImplementation(async (target) => {
            const path = target?.path ?? target?.ref?.path;
            if (path === 'memberships') return snapshot(MEMBERSHIPS);
            if (path === LEADS_PATH) {
                return snapshot([{
                    id: 'lead-ok',
                    ref: { __kind: 'doc', path: `${LEADS_PATH}/lead-ok` },
                    data: () => ({ email: 'artificial@example.test' }),
                }]);
            }
            return snapshot([]);
        });
        const alertMock = vi.fn();
        vi.stubGlobal('alert', alertMock);
        const onInfo = vi.fn();

        const { result, onUploadComplete } = await mountHook(vi.fn(), { onInfo });
        await act(async () => { await result.current.runDataRepair(); });

        const announced = onInfo.mock.calls.some(
            ([text]) => text === 'Scan complete. No misformatted records found.',
        );
        expect(announced).toBe(true);
        // The message must never be delivered by a blocking browser dialog again.
        expect(alertMock).not.toHaveBeenCalled();
        expect(result.current.uploading).toBe(false);
        expect(result.current.step).toBe('upload');
        expect(onUploadComplete).not.toHaveBeenCalled();
    });

    it('does not treat a real email or an existing placeholder as a phone number', async () => {
        fs.getDocs.mockImplementation(async (target) => {
            const path = target?.path ?? target?.ref?.path;
            if (path === 'memberships') return snapshot(MEMBERSHIPS);
            if (path === LEADS_PATH) {
                return snapshot([
                    { id: 'a', ref: { path: 'a' }, data: () => ({ email: 'x@example.test' }) },
                    { id: 'b', ref: { path: 'b' }, data: () => ({ email: 'no_email_1@placeholder.com' }) },
                    { id: 'c', ref: { path: 'c' }, data: () => ({ email: '' }) },
                    { id: 'd', ref: { path: 'd' }, data: () => ({ email: '12345' }) },
                ]);
            }
            return snapshot([]);
        });

        const { result } = await mountHook();
        await act(async () => { await result.current.runDataRepair(); });

        expect(fs.update).not.toHaveBeenCalled();
        expect(result.current.stats).toEqual({ created: 0, updated: 0 });
    });
});
