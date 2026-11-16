/**
 * The template wizard's picker reads what it shows: the 20 newest applicants
 * and leads, or the matches for a search, found on the server the way the
 * Applications and leads lists find them. Each row says which it is. It used
 * to read every lead of the company to show 20, and no applicant at all.
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
const row = (id, data) => ({ id, data: () => data });
const DANA = { firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', createdAt: { seconds: 1_800_000_000 } };
const JANE = { firstName: 'Jane', lastName: 'Driver', email: 'jane@example.test', createdAt: { seconds: 1_800_000_100 } };
const NEWEST = (path) => ({ path, clauses: [{ orderBy: ['createdAt', 'desc'] }, { limit: 20 }] });

/** Answers each collection with its own rows. */
const byCollection = ({ applications = [], leads = [] }) => async (read) => (
    { docs: read.path.endsWith('/applications') ? applications : leads }
);

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

describe("the template wizard's picker", () => {
    it('opens with the 20 newest applicants and leads, newest first, each saying which it is', async () => {
        fx.answer = byCollection({ applications: [row('app-1', JANE)], leads: [row('lead-1', DANA)] });
        const { result } = openPicker();

        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(fx.reads).toEqual(expect.arrayContaining([
            NEWEST('companies/co-1/applications'),
            NEWEST('companies/co-1/leads'),
        ]));
        expect(fx.reads).toHaveLength(2);
        expect(result.current.drivers).toEqual([
            { id: 'app-1', ...JANE, collectionName: 'applications' },
            { id: 'lead-1', ...DANA, collectionName: 'leads' },
        ]);
    });

    it('shows 20 at most', async () => {
        const many = (prefix, count) => Array.from({ length: count }, (_, index) => row(`${prefix}-${index}`, {
            ...DANA, createdAt: { seconds: 1_800_000_000 + index },
        }));
        fx.answer = byCollection({ applications: many('app', 20), leads: many('lead', 20) });
        const { result } = openPicker();

        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers).toHaveLength(20);
    });

    it('finds a typed name among applicants and leads on the server, as their lists do', async () => {
        const { result } = openPicker();
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        fx.reads = [];
        const named = (read) => read.clauses.some((clause) => clause.where?.[0] === 'firstNameNormalized');
        fx.answer = async (read) => {
            if (!named(read)) return { docs: [] };
            return { docs: read.path.endsWith('/applications') ? [row('app-7', DANA)] : [row('lead-7', DANA)] };
        };

        act(() => result.current.setSearchQuery('dana'));
        expect(result.current.driversStatus).toBe('loading');
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));

        expect(result.current.drivers.map((found) => [found.collectionName, found.id]).sort()).toEqual([
            ['applications', 'app-7'],
            ['leads', 'lead-7'],
        ]);
        // Bounded prefix scans on the name fields, never the whole collection.
        expect(fx.reads.every((read) => read.clauses.some((clause) => clause.limit))).toBe(true);
        expect(fx.reads.map((read) => read.path)).toEqual(expect.arrayContaining([
            'companies/co-1/applications',
            'companies/co-1/leads',
        ]));
        expect(fx.reads.map((read) => read.clauses[0].where)).toContainEqual(['firstNameNormalized', '>=', 'dana']);
    });

    it('keeps the newest for a one-letter name, and searches nothing', async () => {
        const { result } = openPicker();
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        fx.reads = [];
        fx.answer = byCollection({ leads: [row('lead-1', DANA)] });

        act(() => result.current.setSearchQuery('d'));
        await waitFor(() => expect(result.current.drivers.map((found) => found.id)).toEqual(['lead-1']));
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));

        expect(fx.reads).toEqual(expect.arrayContaining([
            NEWEST('companies/co-1/applications'),
            NEWEST('companies/co-1/leads'),
        ]));
        expect(fx.reads).toHaveLength(2);
    });

    it('says when they could not be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fx.answer = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); };
        const { result } = openPicker();

        await waitFor(() => expect(result.current.driversStatus).toBe('failed'));
        expect(result.current.drivers).toEqual([]);
    });

    it("matches the browser tests' lead by the same rules, without a backend", async () => {
        const { result } = openPicker({ isE2EEdocMock: true });
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers.map((found) => [found.collectionName, found.id])).toEqual([['leads', 'lead_e2e_1']]);

        act(() => result.current.setSearchQuery('zzz-no-such-lead'));
        await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
        expect(result.current.drivers).toEqual([]);
        expect(fx.reads).toEqual([]);
    });
});
