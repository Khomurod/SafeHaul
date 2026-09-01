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
// =====================================================================
// Shared harness for the useCompanyLeadUpload contract suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below. This module must
// not import the hook or any module the suites mock (the hook transitively
// imports the mocked firebase modules) — loading either here fires a mock
// factory that is itself awaiting this module, which deadlocks vitest
// silently (learned on `CA-3`). Each suite imports the hook itself and
// passes it to `makeMountHook`.
// =====================================================================
import { renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

export const fs = {
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    commit: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    batches: [],
    docCounter: 0,
};

export const firebaseMock = {
    db: { __db: true },
    auth: { currentUser: null },
};

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const libFirebaseMock = () => firebaseMock;
export const firebaseFirestoreMock = () => ({
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
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const COMPANY_ID = 'artificial-company-1';
export const LEADS_PATH = `companies/${COMPANY_ID}/leads`;

export const MEMBERSHIPS = [
    { data: () => ({ userId: 'artificial-user-a' }) },
    { data: () => ({ userId: 'artificial-user-b' }) },
];

export function snapshot(docs) {
    return { docs, empty: docs.length === 0 };
}

/** Default query answers: memberships resolve, dedupe lookups find nothing. */
export function primeQueries({ dedupe = () => snapshot([]) } = {}) {
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
export const makeMountHook = (useCompanyLeadUpload) => async (onUploadComplete = vi.fn(), options = {}) => {
    const hook = renderHook(() => useCompanyLeadUpload(COMPANY_ID, onUploadComplete, options));
    await waitFor(() => expect(hook.result.current.teamMembers).toHaveLength(2));
    return { ...hook, onUploadComplete };
};

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
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
}

/** The original suite's `afterEach` body, verbatim. */
export function restoreHarness() {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
}
