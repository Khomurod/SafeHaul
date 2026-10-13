// The team an import assigns leads to, by name. Profiles keep a member's name
// under different fields (`nameFromProfile` in functions/shared/userIdentity.js
// lists them), and a batch write refuses a field holding undefined, so a member
// whose profile had no `name` made every assigned import fail at that member.
// The harness is the contract's (`useCompanyLeadUpload.contract.support.js`).
//
// All names and emails below are artificial.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());

import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import { makeMountHook, resetHarness, restoreHarness, fs } from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

/** Member `artificial-user-a` gets `profile`; `artificial-user-b` keeps a plain `name`. */
function profilesWith(profile) {
    fs.getDoc.mockImplementation(async (ref) => {
        const id = ref.path.split('/').pop();
        return { exists: () => true, id, data: () => (id === 'artificial-user-a' ? profile : { name: 'Ben Carter' }) };
    });
}

beforeEach(resetHarness);
afterEach(restoreHarness);

describe('useCompanyLeadUpload — the names of the team it assigns to', () => {
    it.each([
        [{ name: 'Ann Baker' }, 'Ann Baker'],
        [{ fullName: 'Ann Baker' }, 'Ann Baker'],
        [{ displayName: 'Ann Baker' }, 'Ann Baker'],
        [{ firstName: 'Ann', lastName: 'Baker' }, 'Ann Baker'],
        [{ email: 'ann@example.test' }, 'ann@example.test'],
        [{}, 'Unknown'],
    ])('lists a member whose profile holds %o as %s', async (profile, name) => {
        profilesWith(profile);
        const { result } = await mountHook();

        expect(result.current.teamMembers).toEqual([
            { id: 'artificial-user-a', name },
            { id: 'artificial-user-b', name: 'Ben Carter' },
        ]);
    });

    it('assigns leads round-robin to a member without a `name`, writing a name for every lead', async () => {
        profilesWith({ firstName: 'Ann', lastName: 'Baker', email: 'ann@example.test' });
        const { result } = await mountHook();
        act(() => result.current.setAssignmentMode('round_robin'));

        await act(async () => {
            await result.current.uploadLeads([{ firstName: 'One' }, { firstName: 'Two' }], 'file');
        });

        const leads = fs.set.mock.calls.map(([, payload]) => payload).filter((payload) => 'firstName' in payload);
        expect(leads.map((payload) => [payload.assignedTo, payload.assignedToName])).toEqual([
            ['artificial-user-a', 'Ann Baker'],
            ['artificial-user-b', 'Ben Carter'],
        ]);
        leads.forEach((payload) => expect(Object.values(payload)).not.toContain(undefined));
    });
});
