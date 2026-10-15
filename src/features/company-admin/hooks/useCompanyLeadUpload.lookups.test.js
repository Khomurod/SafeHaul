// A file's leads are looked up in batches: every email and phone the file gives,
// 30 to a query and the queries side by side, instead of one or two queries
// per row, one row after another. Each row is matched as before — by its email,
// else its phone — and a row also matches a lead an earlier row of the same file
// created or gave its email or phone, so one person is one lead. The harness is
// the contract's (`useCompanyLeadUpload.contract.support.js`).
//
// All names, emails and phone numbers below are artificial.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());

import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import {
    makeMountHook,
    resetHarness,
    restoreHarness,
    primeQueries,
    snapshot,
    fs,
    COMPANY_ID,
    LEADS_PATH,
    MEMBERSHIPS,
} from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

beforeEach(resetHarness);
afterEach(restoreHarness);

/** A lead the company already has, as an `in` query returns it. */
const lead = (id, data) => ({ id, data: () => data, ref: { __kind: 'doc', path: `${LEADS_PATH}/${id}` } });

/** The leads that answer one lookup: those whose `field` is among its values. */
const answering = (leads) => (target) => {
    const [constraint] = target.constraints || [];
    if (!constraint || constraint.op !== 'in') return snapshot([]);
    return snapshot(leads.filter((one) => constraint.value.includes(one.data()[constraint.field])));
};

const leadQueries = () => fs.getDocs.mock.calls
    .map(([target]) => target)
    .filter((target) => target?.ref?.path === LEADS_PATH);

describe('useCompanyLeadUpload — looking up the file', () => {
    it('looks up every email and phone in queries of 30, side by side', async () => {
        let inFlight = 0;
        let mostAtOnce = 0;
        primeQueries({
            dedupe: async () => {
                inFlight += 1;
                mostAtOnce = Math.max(mostAtOnce, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return snapshot([]);
            },
        });
        const { result } = await mountHook();
        const rows = Array.from({ length: 100 }, (_, i) => ({
            firstName: `Artificial${i}`,
            email: `driver${i}@example.test`,
            normalizedPhone: `555${String(1000000 + i)}`,
        }));

        await act(async () => { await result.current.uploadLeads(rows, 'file'); });

        const lookups = leadQueries();
        expect(lookups).toHaveLength(8);
        expect(lookups.map(({ constraints: [c] }) => [c.field, c.op, c.value.length])).toEqual([
            ['email', 'in', 30], ['email', 'in', 30], ['email', 'in', 30], ['email', 'in', 10],
            ['normalizedPhone', 'in', 30], ['normalizedPhone', 'in', 30], ['normalizedPhone', 'in', 30],
            ['normalizedPhone', 'in', 10],
        ]);
        expect(mostAtOnce).toBe(8);
        expect(result.current.stats).toEqual({ created: 100, updated: 0 });
    });

    it('matches a value two leads share to the one an equality query returned first, the lowest id', async () => {
        primeQueries({
            dedupe: answering([
                lead('lead-b', { email: 'ann@example.com' }),
                lead('lead-a', { email: 'ann@example.com' }),
            ]),
        });
        const { result } = await mountHook();

        await act(async () => { await result.current.uploadLeads([{ firstName: 'Ann', email: 'ann@example.com' }], 'file'); });

        expect(fs.update.mock.calls.map(([ref]) => ref.path)).toEqual([`${LEADS_PATH}/lead-a`]);
    });

    it('still matches by email first, then by phone', async () => {
        primeQueries({
            dedupe: answering([
                lead('by-phone', { normalizedPhone: '5551234567' }),
                lead('by-email', { email: 'ann@example.com' }),
            ]),
        });
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([
                { firstName: 'Ann', email: 'ann@example.com', normalizedPhone: '5551234567' },
                { firstName: 'Bo', email: 'bo@example.com', normalizedPhone: '5551234567' },
            ], 'file');
        });

        expect(fs.update.mock.calls.map(([ref]) => ref.path)).toEqual([
            `${LEADS_PATH}/by-email`,
            `${LEADS_PATH}/by-phone`,
        ]);
    });
});

describe('useCompanyLeadUpload — one person in one file', () => {
    it('gives two rows for the same person one lead, wherever the batch ends', async () => {
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([
                { firstName: 'Ann', email: 'ann@example.com' },
                { firstName: 'Ann', lastName: 'Baker', email: 'ann@example.com' },
            ], 'file');
        });

        const created = fs.set.mock.calls.filter(([, payload]) => 'createdAt' in payload);
        expect(created).toHaveLength(1);
        expect(fs.update.mock.calls.map(([ref]) => ref.path)).toEqual([created[0][0].path]);
        expect(fs.update.mock.calls[0][1]).toMatchObject({ lastName: 'Baker' });
        expect(result.current.stats).toEqual({ created: 1, updated: 1 });
    });

    it('never creates and updates one lead in the same batch: the create is committed first', async () => {
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([
                { firstName: 'Ann', email: 'ann@example.com' },
                { firstName: 'Ann', lastName: 'Baker', email: 'ann@example.com' },
            ], 'file');
        });

        const leadWrites = (batch) => batch.ops
            .filter(([, ref]) => !ref.path.includes('/activity_logs/'))
            .map(([kind, ref]) => `${kind} ${ref.path}`);
        const written = fs.batches.map(leadWrites).filter((writes) => writes.length > 0);
        expect(written).toHaveLength(2);
        expect(written[0]).toEqual([expect.stringMatching(/^set /)]);
        expect(written[1]).toEqual([expect.stringMatching(/^update /)]);
        expect(fs.commit).toHaveBeenCalledTimes(2);
    });

    it('matches a later row by the email an earlier row gave a lead', async () => {
        primeQueries({ dedupe: answering([lead('existing-1', { normalizedPhone: '5551234567' })]) });
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([
                { firstName: 'Ann', email: 'ann@example.com', normalizedPhone: '5551234567' },
                { firstName: 'Ann', email: 'ann@example.com', normalizedPhone: '5559876543' },
            ], 'file');
        });

        expect(fs.update.mock.calls.map(([ref]) => ref.path)).toEqual([
            `${LEADS_PATH}/existing-1`,
            `${LEADS_PATH}/existing-1`,
        ]);
        expect(result.current.stats).toEqual({ created: 0, updated: 2 });
    });
});

describe('useCompanyLeadUpload — the team', () => {
    it("reads the team's profiles side by side", async () => {
        const releases = [];
        fs.getDocs.mockImplementation(async () => snapshot(MEMBERSHIPS));
        fs.getDoc.mockImplementation((ref) => new Promise((resolve) => {
            const id = ref.path.split('/').pop();
            releases.push(() => resolve({ exists: () => true, id, data: () => ({ name: `Name ${id}` }) }));
        }));

        const { result } = renderHook(() => useCompanyLeadUpload(COMPANY_ID, vi.fn(), {}));
        await waitFor(() => expect(fs.getDoc).toHaveBeenCalledTimes(2));

        releases.forEach((release) => release());
        await waitFor(() => expect(result.current.teamMembers.map((member) => member.id))
            .toEqual(['artificial-user-a', 'artificial-user-b']));
    });
});
