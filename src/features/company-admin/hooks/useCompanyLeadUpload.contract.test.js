/**
 * Contract freeze for `useCompanyLeadUpload`.
 *
 * This hook owns every Firestore write behind lead bulk import. The
 * design-system campaign must not touch any of it, so the payloads, paths,
 * guards, batching, assignment behaviour and completion callback are pinned
 * here before the presentation layer changes.
 *
 * Frozen:
 *  - team-member load from `memberships` + `users`, and select-all default,
 *  - the round-robin and specific-user guard messages,
 *  - the created / updated lead payloads, the tenant-binding `companyId`,
 *    `LEAD_DEFAULT_STATUS`, and the `Company Import (File|Sheet)` source values,
 *  - the `activity_logs` subcollection entries,
 *  - round-robin distribution order and `assignedTo` / `assignedToName`,
 *  - the 200-operation batch limit (2 ops per lead),
 *  - `stats`, the `'success'` step and the 1500 ms `onUploadComplete` callback,
 *  - the data-repair scan rule, payload and 400-operation batch limit.
 *
 * All identifiers and contact details below are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    commit: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    batches: [],
    docCounter: 0,
}));

const firebaseMock = vi.hoisted(() => ({
    db: { __db: true },
    auth: { currentUser: null },
}));

vi.mock('@lib/firebase', () => firebaseMock);
vi.mock('firebase/firestore', () => ({
    serverTimestamp: () => '__serverTimestamp__',
    collection: (_db, ...segments) => ({ __kind: 'collection', path: segments.join('/') }),
    doc: (first, ...rest) => {
        if (rest.length === 0) {
            fs.docCounter += 1;
            return { __kind: 'doc', path: `${first.path}/generated-${fs.docCounter}` };
        }
        return { __kind: 'doc', path: rest.join('/') };
    },
    query: (ref, ...constraints) => ({ __kind: 'query', ref, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (...args) => fs.getDocs(...args),
    getDoc: (...args) => fs.getDoc(...args),
    writeBatch: () => {
        const batch = {
            set: (...args) => { batch.ops.push(['set', ...args]); fs.set(...args); },
            update: (...args) => { batch.ops.push(['update', ...args]); fs.update(...args); },
            commit: async (...args) => { fs.commit(batch.ops.length, ...args); },
            ops: [],
        };
        fs.batches.push(batch);
        return batch;
    },
}));

import { LEAD_DEFAULT_STATUS } from '@shared/constants/atsStatus';
import { PLACEHOLDER_DOMAIN } from '@/config/placeholderDomains';
import { useCompanyLeadUpload } from './useCompanyLeadUpload';

const COMPANY_ID = 'artificial-company-1';
const LEADS_PATH = `companies/${COMPANY_ID}/leads`;

const MEMBERSHIPS = [
    { data: () => ({ userId: 'artificial-user-a' }) },
    { data: () => ({ userId: 'artificial-user-b' }) },
];

function snapshot(docs) {
    return { docs, empty: docs.length === 0 };
}

/** Default query answers: memberships resolve, dedupe lookups find nothing. */
function primeQueries({ dedupe = () => snapshot([]) } = {}) {
    fs.getDocs.mockImplementation(async (target) => {
        const path = target?.path ?? target?.ref?.path;
        if (path === 'memberships') return snapshot(MEMBERSHIPS);
        return dedupe(target);
    });
    fs.getDoc.mockImplementation(async (ref) => {
        const id = ref.path.split('/').pop();
        return {
            exists: () => true,
            id,
            data: () => ({ name: `Name ${id}` }),
        };
    });
}

/**
 * `options` lets a case inject the `onError` / `onInfo` sinks, which is what the
 * real consumer (`CompanyBulkUpload`) does. The hook's *messages* are the frozen
 * contract; the sink is the consumer's choice. The defaults used to be blocking
 * `alert()` calls and are now non-blocking logs.
 */
async function mountHook(onUploadComplete = vi.fn(), options = {}) {
    const hook = renderHook(() => useCompanyLeadUpload(COMPANY_ID, onUploadComplete, options));
    await waitFor(() => expect(hook.result.current.teamMembers).toHaveLength(2));
    return { ...hook, onUploadComplete };
}

beforeEach(() => {
    vi.clearAllMocks();
    fs.batches = [];
    fs.docCounter = 0;
    firebaseMock.auth.currentUser = {
        uid: 'artificial-admin-1',
        displayName: 'Artificial Admin',
        email: 'admin@example.test',
    };
    primeQueries();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

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
