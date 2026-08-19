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

jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return { HttpsError, onCall: (_opts, fn) => fn };
});

const mockAssertCompanyAccess = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccess(...args),
}));

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
/** What each transaction read and wrote, so atomicity can be asserted directly. */
const mockRunTransactionCalls = [];
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

jest.mock('../../firebaseAdmin', () => ({
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
            const record = { reads: [], writes: [] };
            mockRunTransactionCalls.push(record);
            return fn({
            get: async (ref) => { record.reads.push(ref.path); return mockMakeDoc(ref.path); },
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
    mockRunTransactionCalls.length = 0;
    mockNonTransactionalWrites.length = 0;
    mockCheckRateLimit.mockResolvedValue(true);
    mockAssertIntake.mockResolvedValue({ companyName: 'Acme Freight' });
    mockAssertCompanyAccess.mockResolvedValue(undefined);
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
        const first = await saveFirstPage();
        // Same person, new email — a different deterministic key. The browser
        // presents the token it was given, which is what proves it owned the
        // earlier draft and may therefore retire it.
        await saveFirstPage({ email: 'dana.alvarez@example.test', resumeToken: first.resumeToken });

        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        // The one that survives is the one just saved.
        expect(paths[0]).toContain(keyFor(COMPANY, 'dana.alvarez@example.test'));
    });

    it('will not retire another draft for someone who only knows the identity', async () => {
        // Superseding deletes documents. Running it on the identity alone handed
        // anyone who knew a name, a date of birth and an SSN a way to destroy that
        // person's unfinished application: save under an email of their choosing and
        // the victim's real draft was superseded.
        await saveFirstPage();

        await saveFirstPage({ email: 'attacker@example.test' });

        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        // The victim's draft is still there.
        expect(paths.some((key) => key.includes(keyFor()))).toBe(true);
        expect(mockDeletedPaths).toHaveLength(0);
    });

    it('will not retire a draft using a token minted for the attacker\'s own', async () => {
        // The subtle version of the same attack, and the one the first attempt at
        // this gate still allowed. The three identity facts let a stranger create a
        // draft of their own, which inherits the victim's identity key; the token
        // minted for it then looked like proof of ownership over that identity, and
        // the next save deleted the victim's application.
        //
        // Only a token for the draft actually being deleted counts.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });

        const attacker = await saveFirstPage({
            email: 'attacker@example.test',
            phone: '(214) 555-0199',
        });
        expect(attacker.resumeToken).toBeTruthy();

        // Second save, now presenting the token the attacker legitimately owns.
        await saveFirstPage({
            email: 'attacker@example.test',
            phone: '(214) 555-0199',
            resumeToken: attacker.resumeToken,
        });

        const victim = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(victim).toBeDefined();
        expect(victim.formData.cdlNumber).toBe('REAL');
        expect(mockDeletedPaths).toHaveLength(0);
    });

    it('ignores a resume token that belongs to a different person', async () => {
        const victim = await saveFirstPage();
        const other = await saveFirstPage({
            email: 'someone.else@example.test',
            phone: '(972) 555-0100',
            lastName: 'Nguyen',
            dob: '1990-07-04',
            ssn: '987-65-4321',
        });

        // A real token, but for a draft with a different identity, so it proves
        // nothing about the identity whose siblings would be retired.
        await saveFirstPage({ email: 'dana.new@example.test', resumeToken: other.resumeToken });

        expect(mockStore.has(`companies/${COMPANY}/application_drafts/${keyFor()}`)).toBe(true);
        expect(victim.resumeToken).toBeTruthy();
    });
});

describe('changing a draft that already exists', () => {
    it('refuses a caller who knows only the contact details', async () => {
        // The whole point: those three values derive the document id, and until now
        // nothing else was checked, so knowing them was enough to overwrite.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Attacker', cdlNumber: 'FAKE' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(attempt.resumeToken).toBeNull();
        // The same shape a network failure returns, so the refusal does not confirm
        // to a stranger that this person has an application here.
        expect(attempt.applicantKey).toBeNull();
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.formData.cdlNumber).toBe('REAL');

        // A refusal spends two budgets: one per caller, one per *targeted draft*, so
        // spreading attempts across addresses does not spread the budget with them.
        // This caller supplied no identity facts at all, and the target budget is
        // charged anyway — which is the point: it is keyed on the document being
        // attacked, not on identity facts the caller chooses.
        const refusalKeys = mockCheckRateLimit.mock.calls
            .map(([key]) => key)
            .filter((key) => key.startsWith('draft_write_denied'));
        expect(refusalKeys.sort()).toEqual([
            `draft_write_denied_${CONTEXT.rawRequest.ip}`,
            `draft_write_denied_target_${keyFor()}`,
        ].sort());

        // Audited under its own action — a refused write is a different operational
        // signal from a resume lookup, and must not inflate the lookup count. Still
        // value-free: no name, no contact detail, no identity hash.
        const audit = [...mockStore.entries()]
            .filter(([key]) => key.includes('application_draft_audit'))
            .map(([, value]) => value);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('draft_write_refused');
        expect(audit[0].outcome).toBe('unauthorized_write');
        const auditText = JSON.stringify(audit[0]);
        expect(auditText).not.toContain(IDENTITY.email);
        expect(auditText).not.toContain('123456789');
        expect(auditText).not.toContain(IDENTITY.lastName);
    });

    it('charges the same target budget however the caller varies its identity', async () => {
        // Why the budget is keyed on the target and not on the identity the caller
        // claims: the caller supplies those facts, so varying or omitting the SSN
        // would produce a fresh key on every request while every one of them still
        // attacks the same document. Three differently-shaped refusals, one shared
        // target budget.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });
        mockCheckRateLimit.mockClear();

        const shapes = [
            {},
            { lastName: 'Nguyen', dob: '1990-07-04', ssn: '987-65-4321' },
            { lastName: 'Other', dob: '1975-01-02', ssn: '555-00-1111' },
        ];
        for (const shape of shapes) {
            const attempt = await drafts.saveApplicationProgress({
                companyId: COMPANY,
                email: IDENTITY.email,
                phone: IDENTITY.phone,
                ...shape,
                formData: { firstName: 'Attacker' },
            }, CONTEXT);
            expect(attempt.saved).toBe(false);
        }

        const targetKeys = mockCheckRateLimit.mock.calls
            .map(([key]) => key)
            .filter((key) => key.startsWith('draft_write_denied_target_'));
        expect(targetKeys).toEqual(Array(3).fill(`draft_write_denied_target_${keyFor()}`));

        // Its own key, never the match budget the real applicant needs to find
        // their own draft.
        const allKeys = mockCheckRateLimit.mock.calls.map(([key]) => key);
        expect(allKeys.some((key) => key.startsWith('draft_match_id_'))).toBe(false);
        // A hash, so the limiter holds no name, contact detail or SSN of either party.
        const keyText = allKeys.join(' ');
        expect(keyText).not.toContain('987654321');
        expect(keyText).not.toContain('123456789');
        expect(keyText).not.toContain('Nguyen');
        expect(keyText).not.toContain(IDENTITY.lastName);
        expect(keyText).not.toContain(IDENTITY.email);

        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('REAL');
    });

    it('checks and writes in one transaction, so nothing slips through the gap', async () => {
        // A standalone read followed by a later write leaves a window. Two ways
        // through it both defeat the ownership rule: two first saves can each see no
        // document and each mint a token, and a save that read "exists, authorized"
        // can land *after* Start Over deleted the draft, resurrecting an application
        // the applicant had just discarded.
        //
        // Asserted on the transaction rather than on a contrived interleaving, which
        // this double cannot produce: the read that decides authorization and the
        // write it authorizes must be the same transaction's.
        mockRunTransactionCalls.length = 0;

        await saveFirstPage();

        expect(mockRunTransactionCalls).toHaveLength(1);
        const [{ reads, writes }] = mockRunTransactionCalls;
        const draftPath = `companies/${COMPANY}/application_drafts/${keyFor()}`;
        expect(reads).toContain(draftPath);
        expect(writes).toContain(draftPath);
        // And nothing else was written to that document outside a transaction.
        expect(mockNonTransactionalWrites.filter((path) => path === draftPath)).toEqual([]);
    });

    it('records nothing more once the refusal budget is spent', async () => {
        // The reply is deliberately identical either way — saying "you exceeded the
        // refusal budget" would confirm that the earlier attempts were refusals.
        // What the budget bounds is the audit writes one caller can cause.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });
        const auditBefore = [...mockStore.keys()].filter((key) => key.includes('application_draft_audit')).length;
        mockCheckRateLimit.mockImplementation(async (key) => !String(key).startsWith('draft_write_denied'));

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Attacker' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(attempt.resumeToken).toBeNull();
        expect([...mockStore.keys()].filter((key) => key.includes('application_draft_audit')).length)
            .toBe(auditBefore);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('REAL');
    });

    it('accepts the browser that holds the draft\'s resume token', async () => {
        const first = await saveFirstPage({ formData: { firstName: 'Dana' } });

        const update = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            lastStep: 3,
            formData: { firstName: 'Dana', cdlNumber: 'TX99' },
        }, CONTEXT);

        expect(update.saved).toBe(true);
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.formData.cdlNumber).toBe('TX99');
    });

    it('accepts a browser that lost its token but clears the identity bar', async () => {
        // Same bar `findResumableApplication` requires to *read* the draft. A caller
        // who clears it can already retrieve the whole thing by design, so writing
        // is not a new exposure — and it is what keeps a cleared browser's autosave
        // working.
        await saveFirstPage({ formData: { firstName: 'Dana' } });

        const update = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            formData: { firstName: 'Dana', cdlNumber: 'TX77' },
        }, CONTEXT);

        expect(update.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('TX77');
    });

    it('accepts a second device once it clears the identity bar', async () => {
        // Named for what it proves. Cross-device resume is a supported flow: a
        // phone that never held this draft's token, on a different address, is
        // authorized by the full identity plus contact details that match the
        // stored draft — the same bar that already lets it *read* the draft.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            formData: { firstName: 'Dana', cdlNumber: 'CHANGED' },
        }, { rawRequest: { ip: '198.51.100.7' } });

        expect(attempt.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('CHANGED');
    });

    it('refuses a stale token from a draft that was discarded', async () => {
        const first = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: first.resumeToken,
        }, CONTEXT);
        // Recreate a draft at the same key, as a genuinely new application would.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'FRESH' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Ghost', cdlNumber: 'STALE' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('FRESH');
    });

    it('stays idempotent for a retried save with the same token', async () => {
        const first = await saveFirstPage();
        const payload = {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            clientSeq: 4,
            formData: { firstName: 'Dana' },
        };

        const a = await drafts.saveApplicationProgress(payload, CONTEXT);
        const b = await drafts.saveApplicationProgress(payload, CONTEXT);

        expect(a.saved).toBe(true);
        expect(b.saved).toBe(true);
        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        // A token is minted once and never handed out again.
        expect(a.resumeToken).toBeNull();
        expect(b.resumeToken).toBeNull();
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

/**
 * The recruiter half. Without it a draft is only ever useful to an applicant who
 * comes back on their own, and a carrier watching people drop off at the licence
 * page still has nobody to call.
 */
describe('the browser write counter', () => {
    it('stores the sequence a save carried and hands it back on resume', async () => {
        const saved = await saveFirstPage({ clientSeq: 7 });
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.clientSeq).toBe(7);

        const resumed = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        // The browser compares this with the sequence it believes is synced. It is
        // the whole reason a stale server draft can no longer overwrite newer local
        // work, and it needs no clock on either side.
        expect(resumed.draft.clientSeq).toBe(7);
    });

    it('records null rather than a neighbour\'s number when a save omits it', async () => {
        // A cached older browser saves without the field. Claiming the previous
        // device's sequence would be a lie about whose copy this is, so the client
        // is told there is none and falls back to comparing progress.
        await saveFirstPage({ clientSeq: 7 });
        await saveFirstPage({ lastStep: 2 });

        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.clientSeq).toBeNull();
    });

    it('bounds and rejects a counter that is not a plain integer', async () => {
        for (const value of ['9', 1.5, -3, NaN, {}, 10 ** 9]) {
            await saveFirstPage({ clientSeq: value });
            const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
            expect(stored.clientSeq === null || Number.isInteger(stored.clientSeq)).toBe(true);
            expect(stored.clientSeq === null || stored.clientSeq <= 100000).toBe(true);
        }
    });

    it('still stores no SSN when a sequence is supplied', async () => {
        await saveFirstPage({ clientSeq: 3, formData: { firstName: 'Dana', ssn: '123-45-6789' } });

        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(JSON.stringify(stored)).not.toContain('123-45-6789');
        expect(stored.formData).not.toHaveProperty('ssn');
    });
});

describe('what a draft refuses to store', () => {
    it('drops prototype-shaped and Firestore-reserved keys at every depth', async () => {
        const hostile = JSON.parse('{"firstName":"Dana","__proto__":{"polluted":true},"constructor":"x","__name__":"y","employer1":{"__proto__":{"deep":true},"name":"Acme"}}');

        const clean = draft.sanitizeDraftData(hostile);

        expect(clean.firstName).toBe('Dana');
        expect(Object.keys(clean)).not.toContain('__proto__');
        expect(Object.keys(clean)).not.toContain('constructor');
        expect(Object.keys(clean)).not.toContain('__name__');
        expect(clean.employer1.name).toBe('Acme');
        expect(Object.keys(clean.employer1)).not.toContain('__proto__');
        // Nothing leaked onto the object's actual prototype either.
        expect({}.polluted).toBeUndefined();
        expect(clean.polluted).toBeUndefined();
    });
});

describe('ids that arrived from a browser', () => {
    it('refuses a company id that is a path rather than an id', async () => {
        // `CollectionReference.doc()` takes a *path*, so an id with slashes reads a
        // different document than the code appears to read. Nothing else lives
        // under this subcollection and a resume still needs a 256-bit token, so
        // this was not exploitable — but a client-controlled path segment should
        // not be reachable at all.
        await expect(drafts.saveApplicationProgress({
            companyId: `${COMPANY}/applications/whatever`,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: {},
        }, CONTEXT)).rejects.toMatchObject({ code: 'invalid-argument' });

        await expect(drafts.findResumableApplication({
            companyId: `${COMPANY}/applications/whatever`,
            ...IDENTITY,
        }, CONTEXT)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('refuses an applicant key that is not a plain hex id', async () => {
        await saveFirstPage();

        await expect(drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: '../../applications/abc',
            resumeToken: 'anything',
        }, CONTEXT)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('accepts the real applicant key', () => {
        expect(drafts.__private.applicantKeyOf(keyFor())).toBe(keyFor());
        expect(drafts.__private.applicantKeyOf('has/slash')).toBe('');
        expect(drafts.__private.docId(COMPANY)).toBe(COMPANY);
        expect(drafts.__private.docId('a/b')).toBe('');
        expect(drafts.__private.docId('.')).toBe('');
    });
});

describe('when the identity HMAC key is unavailable', () => {
    const realKey = process.env.SMS_ENCRYPTION_KEY;

    afterEach(() => { process.env.SMS_ENCRYPTION_KEY = realKey; });

    it('still saves the draft, without an identity key', async () => {
        delete process.env.SMS_ENCRYPTION_KEY;

        const result = await saveFirstPage();

        // Losing cross-device matching is a far smaller loss than losing the
        // draft: the same-device token path needs no identity key at all.
        expect(result.saved).toBe(true);
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.identityKey).toBeNull();
        expect(typeof result.resumeToken).toBe('string');
    });

    it('answers a match attempt with the uniform no-match', async () => {
        delete process.env.SMS_ENCRYPTION_KEY;

        const found = await drafts.findResumableApplication({ companyId: COMPANY, ...IDENTITY }, CONTEXT);

        expect(found).toEqual({ resumable: false });
    });
});

describe('the company view of unfinished applications', () => {
    it('lists enough to recognise and contact someone', async () => {
        await saveFirstPage();

        const result = await drafts.listApplicationDrafts({
            auth: { uid: 'recruiter-1' },
            data: { companyId: COMPANY },
        });

        expect(result.drafts).toHaveLength(1);
        expect(result.drafts[0]).toMatchObject({
            firstName: 'Dana',
            lastName: 'Alvarez',
            email: IDENTITY.email.toLowerCase(),
            lastSemanticStep: 'qualifications',
        });
    });

    it('does not hand a recruiter the half-finished answers', async () => {
        await saveFirstPage({
            formData: {
                firstName: 'Dana',
                lastName: 'Alvarez',
                cdlNumber: 'D9988776',
                'drug-test-positive': 'yes',
            },
        });

        const result = await drafts.listApplicationDrafts({
            auth: { uid: 'recruiter-1' },
            data: { companyId: COMPANY },
        });

        // A contact list, not a preview. The applicant has signed nothing and
        // consented to nothing, so reading their partial DOT questionnaire is a
        // decision they have not yet made.
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('D9988776');
        expect(serialized).not.toContain('drug-test-positive');
        expect(result.drafts[0]).not.toHaveProperty('formData');
    });

    it('requires company membership', async () => {
        mockAssertCompanyAccess.mockRejectedValue(
            Object.assign(new Error('nope'), { code: 'permission-denied' }),
        );

        await expect(drafts.listApplicationDrafts({
            auth: { uid: 'outsider' }, data: { companyId: COMPANY },
        })).rejects.toThrow();
    });

    it('is scoped to the company that asked', async () => {
        await saveFirstPage();

        const result = await drafts.listApplicationDrafts({
            auth: { uid: 'recruiter-2' },
            data: { companyId: 'company-2' },
        });

        expect(result.drafts).toHaveLength(0);
        expect(mockAssertCompanyAccess).toHaveBeenCalledWith(
            expect.anything(), 'company-2', expect.any(String),
        );
    });
});
