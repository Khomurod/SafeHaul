/**
 * Shared harness for the `applicationDrafts.*` suites.
 *
 * The properties these suites pin are mostly negatives, because this is the one
 * unauthenticated surface that can return another person's data if it is wrong:
 *
 *  - no Social Security Number is ever stored, at any depth;
 *  - a wrong guess and a non-existent application answer identically;
 *  - matching needs a keyed identity AND a contact detail the draft already holds;
 *  - one company cannot reach another's drafts;
 *  - start-over leaves exactly one consistent state, never two live drafts;
 *  - a failed save never blocks the applicant.
 *
 * ## Why the mocks are factories rather than `jest.mock` calls
 *
 * `jest.mock` is hoisted to the top of the file it appears in, so it cannot be
 * moved into a helper module and still register. Each suite therefore keeps its
 * own one-line `jest.mock(path, () => require('./applicationDrafts.support').xMock())`
 * and the *body* lives here — which is what stops six copies of this Firestore
 * double drifting apart.
 *
 * Jest gives every test file its own module registry, so each suite starts from
 * an empty `mockStore`. That is isolation the single 1476-line file did not have.
 *
 * ## The `Once` hazard does not apply here, and it was checked
 *
 * `AGENTS.md` records that `clearAllMocks` does not drain a `*Once` queue, and
 * that splitting a file changes test ordering — the timing that makes such a leak
 * surface. These tests queue no `*Once` value anywhere (verified before the
 * split), so `resetDraftState` keeps using `clearAllMocks` exactly as before.
 * **If you add a `mockResolvedValueOnce` here, switch it to `resetAllMocks` and
 * re-establish the implementations below.**
 */

/** An in-memory Firestore, keyed by full path, with the queries these callables use. */
const mockStore = new Map();
const mockDeletedPaths = [];
let mockFailWritesOn = null;
/** What each transaction read and wrote, so atomicity can be asserted directly. */
const mockRunTransactionCalls = [];
/**
 * Runs once at the start of the next transaction, for driving a race deterministically.
 *
 * The window that matters is "another caller changed this document between the read that
 * chose it and the write that updates it", and a transaction boundary is exactly where
 * that lands.
 */
let mockBeforeNextTransaction = null;
/** Draft-document writes that did NOT go through a transaction. */
const mockNonTransactionalWrites = [];

function mockServerTimestamp() {
    return { toDate: () => new Date('2026-08-18T10:00:00Z'), __ts: true };
}

function mockMakeDoc(path) {
    return {
        id: path.split('/').pop(),
        // The real snapshot's `ref` is a full document reference, so the double's
        // is too — a `ref` that only supports `delete` would let a missing `set`
        // pass as a test failure rather than a real one.
        get ref() { return mockDocRef(path); },
        get exists() { return mockStore.has(path); },
        data: () => mockStore.get(path),
    };
}

function mockCollectionRef(path) {
    const query = (filters = [], order = null, max = null) => ({
        where: (field, op, value) => query([...filters, { field, op, value }], order, max),
        orderBy: (field, direction) => query(filters, { field, direction }, max),
        limit: (count) => query(filters, order, count),
        get: async () => {
            let docs = [...mockStore.keys()]
                .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
                .map(mockMakeDoc);
            for (const filter of filters) {
                docs = docs.filter((doc) => doc.data()?.[filter.field] === filter.value);
            }
            if (order) {
                docs.sort((a, b) => String(b.data()?.[order.field]?.seq ?? 0) - String(a.data()?.[order.field]?.seq ?? 0));
            }
            if (max) docs = docs.slice(0, max);
            return { empty: docs.length === 0, docs, size: docs.length };
        },
        add: async (row) => {
            const id = `auto-${mockStore.size}`;
            mockStore.set(`${path}/${id}`, row);
            return { id };
        },
        doc: (id) => mockDocRef(`${path}/${id}`),
    });
    return query();
}

function mockDocRef(path) {
    return {
        path,
        get: async () => mockMakeDoc(path),
        set: async (patch, options) => {
            if (mockFailWritesOn && path.includes(mockFailWritesOn)) throw new Error('firestore unavailable');
            mockNonTransactionalWrites.push(path);
            const current = options?.merge ? (mockStore.get(path) || {}) : {};
            mockStore.set(path, { ...current, ...patch });
        },
        delete: async () => { mockDeletedPaths.push(path); mockStore.delete(path); },
        collection: (name) => mockCollectionRef(`${path}/${name}`),
    };
}

const mockAssertCompanyAccess = jest.fn().mockResolvedValue(undefined);
const mockCheckRateLimit = jest.fn().mockResolvedValue(true);
const mockAssertIntake = jest.fn().mockResolvedValue({ companyName: 'Acme Freight' });

/** `firebase-functions/v2/https`, with `onCall` unwrapped so a test can call the handler. */
const httpsV2Mock = () => {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return { HttpsError, onCall: (_opts, fn) => fn };
};

/** `firebase-functions/v1`, whose `HttpsError` carries a third `details` argument. */
const httpsV1Mock = () => {
    class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    }
    return {
        https: { HttpsError, onCall: (fn) => fn },
        runWith: () => ({ https: { HttpsError, onCall: (fn) => fn } }),
    };
};

const companyAccessMock = () => ({
    assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccess(...args),
});

const rateLimiterMock = () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args),
});

const companyTenantMock = () => ({
    assertCompanyAcceptingIntake: (...args) => mockAssertIntake(...args),
});

const firebaseAdminMock = () => ({
    admin: {
        firestore: {
            FieldValue: { serverTimestamp: () => mockServerTimestamp(), delete: () => '__delete__' },
            Timestamp: { now: () => ({ toMillis: () => Date.now() }), fromMillis: (ms) => ({ toMillis: () => ms }) },
        },
    },
    db: {
        collection: (name) => mockCollectionRef(name),
        // `set` as well as `get`/`delete`, because the progress save now does its
        // existence check, its authorization decision and its write in one
        // transaction — a standalone read followed by a later write leaves a window
        // in which two first saves both mint a token, or a save resurrects a draft
        // Start Over had just deleted. Same merge semantics as the non-transactional
        // double below, so the two cannot disagree about what a write leaves behind.
        runTransaction: async (fn) => {
            if (mockBeforeNextTransaction) {
                const hook = mockBeforeNextTransaction;
                mockBeforeNextTransaction = null;
                hook();
            }
            const record = { reads: [], writes: [] };
            mockRunTransactionCalls.push(record);
            return fn({
            // A transaction reads documents *and* queries: the progress save asks
            // whether a presented resume token still opens any live draft, and that
            // question has to be inside the transaction that authorizes the write.
            // A double that only understood document refs would make the real code
            // look broken.
            get: async (refOrQuery) => {
                if (refOrQuery?.path) {
                    record.reads.push(refOrQuery.path);
                    return mockMakeDoc(refOrQuery.path);
                }
                record.reads.push('<query>');
                return refOrQuery.get();
            },
            set: (ref, value, options) => {
                record.writes.push(ref.path);
                // Honours `mockFailWritesOn` like the non-transactional double, so a
                // simulated Firestore failure still surfaces from either path.
                if (mockFailWritesOn && ref.path.includes(mockFailWritesOn)) {
                    throw new Error('firestore unavailable');
                }
                const previous = options?.merge ? (mockStore.get(ref.path) || {}) : {};
                mockStore.set(ref.path, { ...previous, ...value });
            },
            delete: (ref) => { mockDeletedPaths.push(ref.path); mockStore.delete(ref.path); },
            });
        },
    },
});

const IDENTITY = {
    lastName: 'Alvarez',
    dob: '1988-03-11',
    ssn: '123-45-6789',
    email: 'dana@example.test',
    phone: '(214) 555-0147',
};
const COMPANY = 'company-1';
const CONTEXT = { rawRequest: { ip: '203.0.113.9' } };

/**
 * The modules under test are required lazily, inside these helpers rather than at
 * the top of the file. This module is loaded from a hoisted `jest.mock` factory,
 * which runs *while* a suite is requiring `../../applicationDrafts` — so a
 * top-level require here would reach that module mid-construction.
 */
function keyFor(companyId = COMPANY, email = IDENTITY.email, phone = IDENTITY.phone) {
    const { generateApplicantKey } = require('../../shared/buildApplicationDoc');
    return generateApplicantKey(companyId, email, phone).applicantKey;
}

async function saveFirstPage(overrides = {}) {
    return require('../../applicationDrafts').saveApplicationProgress({
        companyId: COMPANY,
        email: IDENTITY.email,
        phone: IDENTITY.phone,
        lastName: IDENTITY.lastName,
        dob: IDENTITY.dob,
        ssn: IDENTITY.ssn,
        lastStep: 1,
        lastSemanticStep: 'qualifications',
        formData: { firstName: 'Dana', lastName: 'Alvarez', email: IDENTITY.email },
        ...overrides,
    }, CONTEXT);
}

/**
 * Installs the one-shot transaction hook. A setter rather than an exported
 * binding, because `mockBeforeNextTransaction` is a `let` that only this module
 * can reassign.
 */
function runBeforeNextTransaction(hook) {
    mockBeforeNextTransaction = hook;
}

/** The original suite's `beforeEach` body, unchanged. */
function resetDraftState() {
    jest.clearAllMocks();
    mockStore.clear();
    mockDeletedPaths.length = 0;
    mockFailWritesOn = null;
    mockRunTransactionCalls.length = 0;
    mockNonTransactionalWrites.length = 0;
    mockBeforeNextTransaction = null;
    mockCheckRateLimit.mockResolvedValue(true);
    mockAssertIntake.mockResolvedValue({ companyName: 'Acme Freight' });
    mockAssertCompanyAccess.mockResolvedValue(undefined);
}

module.exports = {
    httpsV2Mock,
    httpsV1Mock,
    companyAccessMock,
    rateLimiterMock,
    companyTenantMock,
    firebaseAdminMock,
    mockStore,
    mockDeletedPaths,
    mockRunTransactionCalls,
    mockNonTransactionalWrites,
    mockServerTimestamp,
    mockAssertCompanyAccess,
    mockCheckRateLimit,
    mockAssertIntake,
    runBeforeNextTransaction,
    resetDraftState,
    IDENTITY,
    COMPANY,
    CONTEXT,
    keyFor,
    saveFirstPage,
};
