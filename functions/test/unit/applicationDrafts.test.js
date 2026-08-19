/**
 * Autosave, resume and start-over for an in-progress driver application.
 *
 * The properties worth pinning are mostly negatives, because this is the one
 * unauthenticated surface that can return another person's data if it is wrong:
 *
 *  - no Social Security Number is ever stored, at any depth;
 *  - a wrong guess and a non-existent application answer identically;
 *  - matching needs a keyed identity AND a contact detail the draft already holds;
 *  - one company cannot reach another's drafts;
 *  - start-over leaves exactly one consistent state, never two live drafts;
 *  - a failed save never blocks the applicant.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v1', () => {
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
});

/** An in-memory Firestore, keyed by full path, with the queries these callables use. */
const mockStore = new Map();
const mockDeletedPaths = [];
let mockFailWritesOn = null;

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
            const current = options?.merge ? (mockStore.get(path) || {}) : {};
            mockStore.set(path, { ...current, ...patch });
        },
        delete: async () => { mockDeletedPaths.push(path); mockStore.delete(path); },
        collection: (name) => mockCollectionRef(`${path}/${name}`),
    };
}

jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: {
            FieldValue: { serverTimestamp: () => mockServerTimestamp(), delete: () => '__delete__' },
            Timestamp: { now: () => ({ toMillis: () => Date.now() }), fromMillis: (ms) => ({ toMillis: () => ms }) },
        },
    },
    db: {
        collection: (name) => mockCollectionRef(name),
        runTransaction: async (fn) => fn({
            get: async (ref) => mockMakeDoc(ref.path),
            delete: (ref) => { mockDeletedPaths.push(ref.path); mockStore.delete(ref.path); },
        }),
    },
}));

const mockCheckRateLimit = jest.fn().mockResolvedValue(true);
jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args),
}));

const mockAssertIntake = jest.fn().mockResolvedValue({ companyName: 'Acme Freight' });
jest.mock('../../shared/companyTenant', () => ({
    assertCompanyAcceptingIntake: (...args) => mockAssertIntake(...args),
}));

const drafts = require('../../applicationDrafts');
const draft = require('../../shared/applicationDraft');
const { generateApplicantKey } = require('../../shared/buildApplicationDoc');

const IDENTITY = {
    lastName: 'Alvarez',
    dob: '1988-03-11',
    ssn: '123-45-6789',
    email: 'dana@example.test',
    phone: '(214) 555-0147',
};
const COMPANY = 'company-1';
const CONTEXT = { rawRequest: { ip: '203.0.113.9' } };

function keyFor(companyId = COMPANY, email = IDENTITY.email, phone = IDENTITY.phone) {
    return generateApplicantKey(companyId, email, phone).applicantKey;
}

async function saveFirstPage(overrides = {}) {
    return drafts.saveApplicationProgress({
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

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    mockDeletedPaths.length = 0;
    mockFailWritesOn = null;
    mockCheckRateLimit.mockResolvedValue(true);
    mockAssertIntake.mockResolvedValue({ companyName: 'Acme Freight' });
});

describe('saving progress', () => {
    it('writes a draft keyed by the existing deterministic applicant key', async () => {
        const result = await saveFirstPage();

        // The same key the submission will use, so a draft and the application it
        // becomes share one identity and nothing has to be migrated.
        expect(result.applicantKey).toBe(keyFor());
        expect(mockStore.has(`companies/${COMPANY}/application_drafts/${keyFor()}`)).toBe(true);
    });

    it('returns a resume token once, and never again', async () => {
        const first = await saveFirstPage();
        const second = await saveFirstPage({ lastStep: 2 });

        expect(typeof first.resumeToken).toBe('string');
        expect(first.resumeToken.length).toBeGreaterThan(32);
        // A later response cannot hand a token to a different browser.
        expect(second.resumeToken).toBeNull();
    });

    it('merges repeated saves into one document rather than duplicating', async () => {
        await saveFirstPage();
        await saveFirstPage({ lastStep: 3, formData: { firstName: 'Dana', cdlNumber: 'D123' } });

        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        expect(mockStore.get(paths[0]).lastStep).toBe(3);
    });

    it('never stores the Social Security Number or the signature', async () => {
        await saveFirstPage({
            formData: {
                firstName: 'Dana',
                ssn: '123-45-6789',
                signature: 'data:image/png;base64,AAAA',
                employers: [{ name: 'Acme', ssn: '123-45-6789' }],
            },
        });

        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        const serialized = JSON.stringify(stored);
        expect(serialized).not.toContain('123-45-6789');
        expect(serialized).not.toContain('123456789');
        expect(serialized).not.toContain('data:image');
        // The identity HMAC is the only thing derived from the SSN, and it is a
        // keyed hash of four values rather than the number.
        expect(stored.identityKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('refuses a save with no way to identify the applicant later', async () => {
        await expect(saveFirstPage({ email: '', phone: '' }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('refuses a payload too large to be a form', async () => {
        await expect(saveFirstPage({ formData: { blob: 'x'.repeat(600 * 1024) } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('checks the rate limit fail-closed, and the tenant, before writing', async () => {
        mockCheckRateLimit.mockResolvedValue(false);

        await expect(saveFirstPage()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
            expect.stringContaining('draft_save_'), expect.any(Number), expect.any(Number), 'closed',
        );
        expect(mockStore.size).toBe(0);
    });

    it('refuses a company that is not accepting applications', async () => {
        mockAssertIntake.mockRejectedValue(new Error('closed'));

        await expect(saveFirstPage()).rejects.toThrow();
        expect(mockStore.size).toBe(0);
    });

    it('keeps at most one live draft per person per company', async () => {
        await saveFirstPage();
        // Same person, new email — a different deterministic key.
        await saveFirstPage({ email: 'dana.alvarez@example.test' });

        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        // The one that survives is the one just saved.
        expect(paths[0]).toContain(keyFor(COMPANY, 'dana.alvarez@example.test'));
    });
});

describe('finding a resumable application', () => {
    it('offers a resume when the identity and a contact detail both match', async () => {
        await saveFirstPage();

        const found = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: '123456789',
            email: IDENTITY.email,
        }, CONTEXT);

        expect(found.resumable).toBe(true);
        expect(typeof found.resumeToken).toBe('string');
        // Enough to say "you were on the Qualifications step" and nothing more.
        expect(found.lastSemanticStep).toBe('qualifications');
        expect(JSON.stringify(found)).not.toContain('Dana');
    });

    it('refuses when the identity matches but no contact detail does', async () => {
        await saveFirstPage();

        const found = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: 'attacker@example.test',
            phone: '5550000000',
        }, CONTEXT);

        // Knowing a name, a date of birth and an SSN is not enough. This is the
        // line between a resume feature and a lookup service for anyone holding a
        // stolen identity.
        expect(found).toEqual({ resumable: false });
    });

    it('answers a wrong guess exactly as it answers a non-existent application', async () => {
        const noDraft = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: 'Nobody',
            dob: '1970-01-01',
            ssn: '999999999',
            email: 'nobody@example.test',
        }, CONTEXT);

        await saveFirstPage();
        const wrongContact = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: 'wrong@example.test',
        }, CONTEXT);

        // Byte-identical, so a probe cannot distinguish "no such person" from
        // "that person exists and you got their email wrong".
        expect(JSON.stringify(noDraft)).toBe(JSON.stringify(wrongContact));
    });

    it('matches nothing on a partial identity', async () => {
        await saveFirstPage();

        for (const partial of [
            { lastName: '', dob: IDENTITY.dob, ssn: IDENTITY.ssn },
            { lastName: IDENTITY.lastName, dob: '', ssn: IDENTITY.ssn },
            { lastName: IDENTITY.lastName, dob: IDENTITY.dob, ssn: '1234' },
        ]) {
            // eslint-disable-next-line no-await-in-loop
            const found = await drafts.findResumableApplication({
                companyId: COMPANY, email: IDENTITY.email, ...partial,
            }, CONTEXT);
            expect(found).toEqual({ resumable: false });
        }
    });

    it('never lets one company reach another company draft', async () => {
        await saveFirstPage();

        const found = await drafts.findResumableApplication({
            companyId: 'company-2',
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: IDENTITY.email,
        }, CONTEXT);

        // The identity HMAC includes the company id, so the same person at a
        // different carrier is a different identity by construction.
        expect(found).toEqual({ resumable: false });
    });

    it('limits attempts per caller and per identity, both fail-closed', async () => {
        await saveFirstPage();
        mockCheckRateLimit.mockResolvedValue(false);

        await expect(drafts.findResumableApplication({
            companyId: COMPANY, ...IDENTITY,
        }, CONTEXT)).rejects.toMatchObject({ code: 'resource-exhausted' });

        const keys = mockCheckRateLimit.mock.calls.map(([key]) => key);
        expect(keys.some((key) => key.startsWith('draft_match_'))).toBe(true);
        for (const [, , , behaviour] of mockCheckRateLimit.mock.calls) {
            expect(behaviour).toBe('closed');
        }
    });

    it('keeps the identity out of the rate-limit key', async () => {
        await saveFirstPage();
        await drafts.findResumableApplication({
            companyId: COMPANY, ...IDENTITY,
        }, CONTEXT);

        const keys = mockCheckRateLimit.mock.calls.map(([key]) => key).join(' ');
        expect(keys).not.toContain('123456789');
        expect(keys).not.toContain('Alvarez');
        expect(keys).not.toContain(IDENTITY.email);
    });

    it('records the attempt without recording what was attempted', async () => {
        await saveFirstPage();
        await drafts.findResumableApplication({
            companyId: COMPANY, ...IDENTITY,
        }, CONTEXT);

        const audit = [...mockStore.entries()].filter(([key]) => key.includes('application_draft_audit'));
        expect(audit.length).toBeGreaterThan(0);
        const serialized = JSON.stringify(audit);
        expect(serialized).toContain('resume_match_attempted');
        expect(serialized).not.toContain('Alvarez');
        expect(serialized).not.toContain('123456789');
        expect(serialized).not.toContain(IDENTITY.email);
    });

    it('lets the applicant carry on when the lookup itself breaks', async () => {
        await saveFirstPage();
        const collectionSpy = jest.spyOn(draft, 'draftsCollection').mockImplementation(() => {
            throw new Error('index missing');
        });
        try {
            const found = await drafts.findResumableApplication({
                companyId: COMPANY, ...IDENTITY,
            }, CONTEXT);

            // A broken diagnostic must not block a driver from applying.
            expect(found).toEqual({ resumable: false });
        } finally {
            collectionSpy.mockRestore();
        }
    });
});

describe('restoring a draft', () => {
    it('returns the saved answers for a valid token', async () => {
        const saved = await saveFirstPage();

        const restored = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        expect(restored.restored).toBe(true);
        expect(restored.draft.formData.firstName).toBe('Dana');
        expect(restored.draft.lastStep).toBe(1);
    });

    it('never returns an SSN, an identity hash or a token hash', async () => {
        const saved = await saveFirstPage();

        const restored = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        const serialized = JSON.stringify(restored);
        expect(serialized).not.toContain('identityKey');
        expect(serialized).not.toContain('resumeTokenHash');
        expect(serialized).not.toContain('123-45-6789');
    });

    it('refuses a wrong token and an unknown application identically', async () => {
        const saved = await saveFirstPage();

        const wrongToken = await drafts.resumeApplicationDraft({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: 'a'.repeat(64),
        }, CONTEXT).catch((error) => error);
        const unknownKey = await drafts.resumeApplicationDraft({
            companyId: COMPANY, applicantKey: 'deadbeef', resumeToken: saved.resumeToken,
        }, CONTEXT).catch((error) => error);

        expect(wrongToken.code).toBe('not-found');
        expect(unknownKey.code).toBe('not-found');
        expect(wrongToken.message).toBe(unknownKey.message);
    });

    it('compares the token in constant time', () => {
        const { token, hash } = draft.mintResumeToken();

        expect(draft.resumeTokenMatches(hash, token)).toBe(true);
        // Deterministically different: flipping to a character the token cannot
        // already end with, so this can never accidentally compare equal.
        expect(draft.resumeTokenMatches(hash, `${token.slice(0, -1)}z`)).toBe(false);
        // A length mismatch must not throw, which is what a naive
        // timingSafeEqual call does.
        expect(draft.resumeTokenMatches(hash, 'short')).toBe(false);
        expect(draft.resumeTokenMatches(undefined, token)).toBe(false);
    });
});

describe('starting over', () => {
    it('discards the draft and leaves nothing behind', async () => {
        const saved = await saveFirstPage();

        const result = await drafts.startNewApplication({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: saved.resumeToken,
        }, CONTEXT);

        expect(result.discarded).toBe(true);
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toHaveLength(0);
    });

    it('leaves exactly one consistent state, never two live drafts', async () => {
        const saved = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: saved.resumeToken,
        }, CONTEXT);

        // Beginning again writes one draft, and the old one is not among them.
        const fresh = await saveFirstPage({ email: 'dana.new@example.test' });
        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain(fresh.applicantKey);
    });

    it('refuses without a valid token, so nothing is deleted by guessing', async () => {
        await saveFirstPage();

        await expect(drafts.startNewApplication({
            companyId: COMPANY, resumeToken: 'b'.repeat(64),
        }, CONTEXT)).rejects.toMatchObject({ code: 'not-found' });
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toHaveLength(1);
    });

    it('cannot reach a submitted application', async () => {
        // The callable only ever addresses the draft subcollection, so a signed
        // application and its immutable snapshot are out of its reach entirely.
        const source = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../applicationDrafts.js'), 'utf8',
        );
        // Strip comments first: the prose above legitimately explains that
        // submitted applications are out of reach, and matching that text would
        // make this assertion a test of the documentation.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        expect(code).not.toMatch(/collection\(\s*['"]applications['"]\s*\)/);
        expect(code).not.toMatch(/['"]submission['"]/);
        // Draft storage is reached only through the shared module, whose
        // `draftsCollection` is bound to the draft subcollection; the only other
        // collection this file names is its own value-free audit trail.
        expect(code).toMatch(/require\('\.\/shared\/applicationDraft'\)/);
        expect(code).toMatch(/application_draft_audit/);
    });
});
