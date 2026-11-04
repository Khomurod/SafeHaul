// The team an import assigns leads to, by name. The team comes from
// `useAssignableTeam`: the saved team list names each member by the server's
// rule (pinned by `functions/test/unit/onMembershipWrite.teamMembers.test.js`),
// and one it could not name shows their email (`useCompanyTeam.test.jsx`). A
// batch write refuses a field holding undefined, so every lead needs a name.
// The harness is the contract's (`useCompanyLeadUpload.contract.support.js`).
//
// All names and emails below are artificial.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());
vi.mock('./useAssignableTeam', async () => (await import('./useCompanyLeadUpload.contract.support')).assignableTeamMock());

import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import { makeMountHook, resetHarness, restoreHarness, fs, team } from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

beforeEach(resetHarness);
afterEach(restoreHarness);

describe('useCompanyLeadUpload — the names of the team it assigns to', () => {
    it('assigns leads round-robin to a member named by their email, writing a name for every lead', async () => {
        // Member a's profile gave the server no name.
        team.members = [
            { id: 'artificial-user-a', name: 'ann@example.test', email: 'ann@example.test', role: 'recruiter' },
            { id: 'artificial-user-b', name: 'Ben Carter', email: '', role: 'recruiter' },
        ];
        const { result } = await mountHook();
        expect(result.current.teamMembers).toEqual([
            { id: 'artificial-user-a', name: 'ann@example.test' },
            { id: 'artificial-user-b', name: 'Ben Carter' },
        ]);
        act(() => result.current.setAssignmentMode('round_robin'));

        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'One' }, { firstName: 'Two' }], 'file');
        });

        const leads = fs.set.mock.calls.map(([, payload]) => payload).filter((payload) => 'firstName' in payload);
        expect(leads.map((payload) => [payload.assignedTo, payload.assignedToName])).toEqual([
            ['artificial-user-a', 'ann@example.test'],
            ['artificial-user-b', 'Ben Carter'],
        ]);
        leads.forEach((payload) => expect(Object.values(payload)).not.toContain(undefined));
    });
});
