// useCompanyLeadUpload: an import that creates leads already assigned tells each
// recruiter once, in their bell, how many it gave them ("15 leads assigned to
// you"), not once per lead. The importer is a company admin (the page is
// admin-only), whom the rules let create notifications. Nobody is told about
// their own action, so leads the importer gave themselves tell nobody. The
// summary holds a count only: the whole team can read every notification.
// The shared harness lives in `useCompanyLeadUpload.contract.support.js`.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());
vi.mock('./useAssignableTeam', async () => (await import('./useCompanyLeadUpload.contract.support')).assignableTeamMock());

import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import {
    makeMountHook,
    resetHarness,
    restoreHarness,
    primeQueries,
    snapshot,
    fs,
    team,
    COMPANY_ID,
    LEADS_PATH,
} from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);
const NOTIFICATIONS_PATH = `companies/${COMPANY_ID}/notifications/`;

/** The notifications the import wrote, in order. */
const notices = () => fs.set.mock.calls
    .filter(([ref]) => ref.path.startsWith(NOTIFICATIONS_PATH))
    .map(([, data]) => data);
const notice = (recipientId, count) => ({
    type: 'leads_assigned',
    title: 'Leads Assigned',
    message: `${count} ${count === 1 ? 'lead' : 'leads'} assigned to you`,
    recipientId,
    count,
    actorId: 'artificial-admin-1',
    read: false,
    createdAt: '__serverTimestamp__',
});
const rows = (count) => Array.from({ length: count }, (_, i) => ({ firstName: `Artificial${i}` }));

async function importAs(mode, data, selected) {
    const mounted = await mountHook();
    act(() => {
        mounted.result.current.setAssignmentMode(mode);
        if (selected) mounted.result.current.setSelectedUserIds(selected);
    });
    return mounted;
}

beforeEach(resetHarness);

afterEach(() => {
    fs.commit.mockReset();
    restoreHarness();
});

describe('an import that assigns the leads it creates', () => {
    it('tells each recruiter once how many leads it gave them, after the leads are saved', async () => {
        const { result } = await importAs('round_robin');

        await act(async () => { await result.current.uploadLeads(rows(5), 'file'); });

        expect(notices()).toEqual([notice('artificial-user-a', 3), notice('artificial-user-b', 2)]);
        // One batch of leads, then one of the two summaries.
        expect(fs.commit.mock.calls.map(([ops]) => ops)).toEqual([10, 2]);
    });

    it('says "1 lead" for one', async () => {
        const { result } = await importAs('specific_user', null, ['artificial-user-b']);

        await act(async () => { await result.current.uploadLeads(rows(1), 'file'); });

        expect(notices()).toEqual([notice('artificial-user-b', 1)]);
    });

    it('counts only the leads it created, not one it matched and updated', async () => {
        primeQueries({
            dedupe: (target) => (target.constraints?.some((c) => c.field === 'email')
                ? snapshot([{
                    id: 'existing-1',
                    data: () => ({ email: 'artificial@example.test' }),
                    ref: { __kind: 'doc', path: `${LEADS_PATH}/existing-1` },
                }])
                : snapshot([])),
        });
        const { result } = await importAs('specific_user', null, ['artificial-user-a']);

        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'Matched', email: 'artificial@example.test' }, ...rows(2)], 'file');
        });

        expect(notices()).toEqual([notice('artificial-user-a', 2)]);
    });

    it('tells nobody about leads the importer gave themselves', async () => {
        team.members = [team.members[0], { id: 'artificial-admin-1', name: 'Artificial Admin', email: '', role: 'company_admin' }];
        const { result } = await importAs('round_robin');

        await act(async () => { await result.current.uploadLeads(rows(3), 'file'); });

        expect(notices()).toEqual([notice('artificial-user-a', 2)]);
    });

    it('writes no notification for an unassigned import', async () => {
        const { result } = await mountHook();

        await act(async () => { await result.current.uploadLeads(rows(3), 'file'); });

        expect(notices()).toEqual([]);
        expect(fs.commit).toHaveBeenCalledTimes(1);
    });

    it('still finishes the import when the summary cannot be written', async () => {
        fs.commit.mockImplementation((ops) => {
            if (fs.batches.at(-1).ops.some(([, ref]) => ref.path.startsWith(NOTIFICATIONS_PATH))) {
                throw new Error('permission-denied');
            }
            return ops;
        });
        const { result } = await importAs('specific_user', null, ['artificial-user-a']);

        await act(async () => { await result.current.uploadLeads(rows(2), 'file'); });

        expect(result.current.stats).toEqual({ created: 2, updated: 0 });
        expect(result.current.step).toBe('success');
        expect(console.error).toHaveBeenCalled();
    });

    it('tells a recruiter about the leads already saved when a later batch fails', async () => {
        let commits = 0;
        fs.commit.mockImplementation(() => {
            commits += 1;
            if (commits === 2) throw new Error('artificial batch failure');
        });
        const { result } = await importAs('specific_user', null, ['artificial-user-a']);

        // 150 leads: the first 100 are saved in one batch, the next 50 fail.
        await act(async () => {
            await expect(result.current.uploadLeads(rows(150), 'file')).rejects.toThrow('artificial batch failure');
        });

        expect(notices()).toEqual([notice('artificial-user-a', 100)]);
    });
});
