/**
 * The template wizard's lead picker reads what it shows: the 20 newest leads,
 * or the matches for a search, found on the server the way the leads list
 * finds them. It used to read every lead of the company to show 20.
 *
 * All names, addresses and ids below are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ reads: [], answer: async () => ({ docs: [] }) }));

vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => async () => ({}) }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    query: (ref, ...clauses) => ({ path: ref.path, clauses }),
    where: (field, op, value) => ({ where: [field, op, value] }),
    orderBy: (field, direction) => ({ orderBy: [field, direction] }),
    limit: (count) => ({ limit: count }),
    documentId: () => '__name__',
    getDocs: (read) => {
        fx.reads.push(read);
        return fx.answer(read);
    },
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: () => {}, commit: async () => {} }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { useTemplateSendFlow } from './useTemplateSendFlow';

const TEMPLATE = { id: 'template-1', title: 'Offer Letter', fields: [] };
const lead = (id, data) => ({ id, data: () => data });
const DANA = { firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', createdAt: { seconds: 1_800_000_000 } };

function openPicker(overrides = {}) {
    const hook = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: () => {},
        setActiveTab: () => {},
        showSuccess: () => {},
        showError: () => {},
        showWarning: () => {},
        ...overrides,
    }));
    act(() => hook.result.current.handleUseTemplate(TEMPLATE));
    return hook;
}

beforeEach(() => {
    fx.reads = [];
    fx.answer = async () => ({ docs: [] });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the template wizard's lead picker", () => {
    it('opens with the 20 newest leads, never the whole list', async () => {
        fx.answer = async () => ({ docs: [lead('lead-1', DANA)] });
        const { result } = openPicker();

        await waitFor(() => expect(fx.reads).toHaveLength(1));
        expect(fx.reads[0]).toEqual({
            path: 'companies/co-1/leads',
            clauses: [{ orderBy: ['createdAt', 'desc'] }, { limit: 20 }],
        });
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers).toEqual([{ id: 'lead-1', ...DANA }]);
    });

    it('finds a typed name on the server, as the leads list does', async () => {
        const { result } = openPicker();
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        fx.reads = [];
        fx.answer = async (read) => (read.clauses.some((clause) => clause.where?.[0] === 'firstName')
            ? { docs: [lead('lead-7', DANA)] }
            : { docs: [] });

        act(() => result.current.setSearchQuery('dana'));
        expect(result.current.driversStatus).toBe('loading');
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));

        expect(result.current.drivers.map((found) => found.id)).toEqual(['lead-7']);
        expect(fx.reads.length).toBeGreaterThan(0);
        // Bounded prefix scans on the name fields, never the whole collection.
        expect(fx.reads.every((read) => read.clauses.some((clause) => clause.limit))).toBe(true);
        expect(fx.reads.map((read) => read.clauses[0].where)).toContainEqual(['firstNameNormalized', '>=', 'dana']);
    });

    it('says when the leads could not be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fx.answer = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); };
        const { result } = openPicker();

        await waitFor(() => expect(result.current.driversStatus).toBe('failed'));
        expect(result.current.drivers).toEqual([]);
    });

    it("matches the browser tests' lead by the same rules, without a backend", async () => {
        const { result } = openPicker({ isE2EEdocMock: true });
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers.map((found) => found.id)).toEqual(['lead_e2e_1']);

        act(() => result.current.setSearchQuery('zzz-no-such-lead'));
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers).toEqual([]);
        expect(fx.reads).toEqual([]);
    });
});
