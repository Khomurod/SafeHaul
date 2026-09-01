// useCompanyLeadUpload contract, part 1 of 2: the return shape, team load,
// assignment guards, the frozen created/updated payloads and dedupe rules,
// round-robin distribution, batching, and the per-record progress string.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `useCompanyLeadUpload.contract.support.js`; the registrations below delegate
// to it. See that file's header for the scope of this contract freeze.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());

import { LEAD_DEFAULT_STATUS } from '@shared/constants/atsStatus';
import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import {
    makeMountHook,
    resetHarness,
    restoreHarness,
    primeQueries,
    snapshot,
    fs,
    firebaseMock,
    COMPANY_ID,
    LEADS_PATH,
} from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

beforeEach(resetHarness);

afterEach(restoreHarness);

describe('useCompanyLeadUpload — preserved contracts', () => {
    it('exposes the frozen return shape and initial state', async () => {
        const { result } = await mountHook();

        // `progressCount` is the one ADDITIVE key introduced by the lead-intake
        // design-system migration. Nothing was removed or renamed: `progress`
        // keeps its exact formatted strings and remains authoritative.
        expect(Object.keys(result.current).sort()).toEqual([
            'assignmentMode',
            'progress',
            'progressCount',
            'runDataRepair',
            'selectedUserIds',
            'setAssignmentMode',
            'setSelectedUserIds',
            'setStep',
            'stats',
            'step',
            'teamMembers',
            'uploadLeads',
            'uploading',
        ]);
        expect(result.current.uploading).toBe(false);
        expect(result.current.progress).toBe('');
        expect(result.current.stats).toEqual({ created: 0, updated: 0 });
        expect(result.current.step).toBe('upload');
        expect(result.current.assignmentMode).toBe('unassigned');
    });

    it('loads team members from memberships + users and preselects all of them', async () => {
        const { result } = await mountHook();

        expect(result.current.teamMembers).toEqual([
            { id: 'artificial-user-a', name: 'Name artificial-user-a' },
            { id: 'artificial-user-b', name: 'Name artificial-user-b' },
        ]);
        expect(result.current.selectedUserIds)
            .toEqual(['artificial-user-a', 'artificial-user-b']);
    });

    it('rejects round-robin with no recipients using the frozen message', async () => {
        const { result } = await mountHook();
        act(() => {
            result.current.setAssignmentMode('round_robin');
            result.current.setSelectedUserIds([]);
        });

        await expect(result.current.uploadLeads([{ firstName: 'A' }], 'file'))
            .rejects.toThrow('Please select at least one user for Round Robin distribution.');
    });

    it('rejects specific-user assignment without exactly one recipient', async () => {
        const { result } = await mountHook();
        act(() => result.current.setAssignmentMode('specific_user'));

        await expect(result.current.uploadLeads([{ firstName: 'A' }], 'file'))
            .rejects.toThrow('Please select exactly one user for assignment.');
    });

    it('requires a signed-in user', async () => {
        firebaseMock.auth.currentUser = null;
        const { result } = await mountHook();

        await expect(result.current.uploadLeads([{ firstName: 'A' }], 'file'))
            .rejects.toThrow('You must be logged in.');
    });

    it('writes the frozen created-lead payload and activity log', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { result, onUploadComplete } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([{
                firstName: 'Artificial',
                lastName: 'Applicant',
                email: 'artificial@example.test',
                phone: '(555) 123-4567',
                normalizedPhone: '5551234567',
                experience: '5',
                driverType: 'OTR',
                city: 'Artificial City',
                state: 'TX',
                isEmailPlaceholder: false,
            }], 'file');
        });

        const [leadRef, leadPayload] = fs.set.mock.calls[0];
        expect(leadRef.path).toMatch(new RegExp(`^${LEADS_PATH}/generated-`));
        expect(leadPayload).toEqual({
            firstName: 'Artificial',
            lastName: 'Applicant',
            email: 'artificial@example.test',
            phone: '(555) 123-4567',
            normalizedPhone: '5551234567',
            experience: '5',
            driverType: 'OTR',
            city: 'Artificial City',
            state: 'TX',
            source: 'Company Import (File)',
            isEmailPlaceholder: false,
            updatedAt: '__serverTimestamp__',
            companyId: COMPANY_ID,
            status: LEAD_DEFAULT_STATUS,
            createdAt: '__serverTimestamp__',
            assignedTo: null,
            assignedToName: null,
        });

        const [logRef, logPayload] = fs.set.mock.calls[1];
        expect(logRef.path).toContain('/activity_logs/');
        expect(logPayload).toEqual({
            type: 'system',
            performedBy: 'artificial-admin-1',
            performedByName: 'Artificial Admin',
            timestamp: '__serverTimestamp__',
            action: 'Lead Created',
            details: 'Created via Bulk Upload.',
        });

        expect(result.current.stats).toEqual({ created: 1, updated: 0 });
        expect(result.current.step).toBe('success');

        expect(onUploadComplete).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(1500); });
        expect(onUploadComplete).toHaveBeenCalledTimes(1);
    });

    it('uses the sheet source value for the gsheet method', async () => {
        const { result } = await mountHook();
        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'Artificial' }], 'gsheet');
        });
        expect(fs.set.mock.calls[0][1].source).toBe('Company Import (Sheet)');
    });

    it('defaults every optional field to an empty string', async () => {
        const { result } = await mountHook();
        await act(async () => { await result.current.uploadLeads([{}], 'file'); });

        expect(fs.set.mock.calls[0][1]).toMatchObject({
            firstName: '', lastName: '', email: '', phone: '',
            normalizedPhone: '', experience: '', driverType: '',
            city: '', state: '', isEmailPlaceholder: false,
        });
    });

    it('updates an existing lead matched by email and logs the update', async () => {
        primeQueries({
            dedupe: (target) => {
                const isEmail = target.constraints?.some((c) => c.field === 'email');
                return isEmail
                    ? snapshot([{ id: 'existing-1', ref: { __kind: 'doc', path: `${LEADS_PATH}/existing-1` } }])
                    : snapshot([]);
            },
        });
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([{
                firstName: 'Artificial',
                email: 'artificial@example.test',
            }], 'file');
        });

        expect(fs.update).toHaveBeenCalledTimes(1);
        const [ref, payload] = fs.update.mock.calls[0];
        expect(ref.path).toBe(`${LEADS_PATH}/existing-1`);
        expect(payload).not.toHaveProperty('createdAt');
        expect(payload).not.toHaveProperty('companyId');
        expect(payload).not.toHaveProperty('status');
        expect(payload.updatedAt).toBe('__serverTimestamp__');

        expect(fs.set.mock.calls[0][1]).toMatchObject({
            action: 'Lead Data Updated',
            details: 'Updated via Bulk Upload match.',
        });
        expect(result.current.stats).toEqual({ created: 0, updated: 1 });
    });

    it('skips the email dedupe lookup for placeholder emails and matches on phone', async () => {
        primeQueries({
            dedupe: (target) => {
                const fields = (target.constraints || []).map((c) => c.field);
                expect(fields).not.toContain('email');
                return fields.includes('normalizedPhone')
                    ? snapshot([{ id: 'existing-2', ref: { __kind: 'doc', path: `${LEADS_PATH}/existing-2` } }])
                    : snapshot([]);
            },
        });
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([{
                email: 'no_email_1@placeholder.test',
                isEmailPlaceholder: true,
                normalizedPhone: '5551234567',
            }], 'file');
        });

        expect(fs.update.mock.calls[0][0].path).toBe(`${LEADS_PATH}/existing-2`);
    });

    it('distributes round-robin over the selected members in order', async () => {
        const { result } = await mountHook();
        act(() => result.current.setAssignmentMode('round_robin'));

        await act(async () => {
            await result.current.uploadLeads([
                { firstName: 'One' }, { firstName: 'Two' }, { firstName: 'Three' },
            ], 'file');
        });

        const leadWrites = fs.set.mock.calls
            .filter(([, payload]) => 'firstName' in payload)
            .map(([, payload]) => [payload.assignedTo, payload.assignedToName]);

        expect(leadWrites).toEqual([
            ['artificial-user-a', 'Name artificial-user-a'],
            ['artificial-user-b', 'Name artificial-user-b'],
            ['artificial-user-a', 'Name artificial-user-a'],
        ]);
    });

    it('leaves leads unassigned in the default mode', async () => {
        const { result } = await mountHook();
        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'One' }], 'file');
        });
        expect(fs.set.mock.calls[0][1]).toMatchObject({
            assignedTo: null, assignedToName: null,
        });
    });

    it('commits a batch every 200 operations (2 per lead)', async () => {
        const { result } = await mountHook();
        const rows = Array.from({ length: 150 }, (_, i) => ({ firstName: `Artificial${i}` }));

        await act(async () => { await result.current.uploadLeads(rows, 'file'); });

        // 150 leads × 2 ops = 300 ops → one 200-op commit, then a 100-op flush.
        expect(fs.commit).toHaveBeenCalledTimes(2);
        expect(fs.commit.mock.calls[0][0]).toBe(200);
        expect(fs.commit.mock.calls[1][0]).toBe(100);
        expect(result.current.stats).toEqual({ created: 150, updated: 0 });
    });

    it('reports the per-record progress string', async () => {
        const { result } = await mountHook();
        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'A' }, { firstName: 'B' }], 'file');
        });
        expect(result.current.progress).toBe('Processing 2 / 2...');
        expect(result.current.progressCount).toEqual({ current: 2, total: 2 });
    });

});
