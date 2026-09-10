/**
 * The remaining guards: what a draft refuses to store, ids that arrived from a
 * browser, a missing identity HMAC key, and the company view.
 *
 * Part of the `applicationDrafts` suite. The Firestore double, the fixtures and
 * the properties this surface has to hold are in
 * `applicationDrafts.support.js`. Each `jest.mock` below has to stay in this
 * file, because Jest hoists it per file and cannot register one from a helper.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const drafts = require('../../applicationDrafts');
const draft = require('../../shared/applicationDraft');
const {
    mockStore, mockAssertCompanyAccess, IDENTITY, COMPANY, CONTEXT, keyFor, saveFirstPage,
    resetDraftState, mockServerTimestamp,
} = require('./applicationDrafts.support');

/** A draft the carrier prepared, written straight in — no callable needed to shape it. */
function seedPreparedDraft(key, status) {
    mockStore.set(`companies/${COMPANY}/application_drafts/${key}`, {
        origin: 'company',
        status,
        contactEmail: 'prepared@example.test',
        contactPhone: '2145550111',
        formData: { firstName: 'Marcus', lastName: 'Iyer', cdlNumber: 'PREPARED-ONLY-1' },
        lastSemanticStep: 'license',
        lastStep: 2,
        lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
        preparedBy: { uid: 'recruiter-1', name: 'Rae Recruiter' },
        createdAt: mockServerTimestamp(),
        updatedAt: mockServerTimestamp(),
    });
}

/** The list, indexed by applicant key, so nothing depends on the double's ordering. */
async function listByKey() {
    const result = await drafts.listApplicationDrafts({
        auth: { uid: 'recruiter-1' },
        data: { companyId: COMPANY },
    });
    return { result, byKey: new Map(result.drafts.map((row) => [row.applicantKey, row])) };
}

beforeEach(resetDraftState);

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

    /**
     * The whole basis of the unified workspace, and the reason it cannot show a
     * draft twice.
     *
     * Until 2026-09-10 a carrier-prepared draft was returned by this callable AND
     * by the narrower `listCompanyPreparedApplications`, and the product listed it
     * on two separate screens. One query over one collection means one row per
     * document — there is no union to reconcile and no key to match wrongly — so
     * the property below is structural, not a merge step to keep correct.
     */
    it('lists driver-started and carrier-prepared drafts together, once each', async () => {
        await saveFirstPage();
        seedPreparedDraft('aa11bb22cc33dd44ee55', 'sent');

        const { result, byKey } = await listByKey();

        expect(result.drafts).toHaveLength(2);
        expect(byKey.size).toBe(2);

        // The driver's own, which is what this callable always returned.
        expect(byKey.get(keyFor())).toMatchObject({
            origin: 'driver',
            status: 'in_progress',
            firstName: 'Dana',
            lastSemanticStep: 'qualifications',
        });

        // And the carrier's, with the metadata that used to need a second call.
        expect(byKey.get('aa11bb22cc33dd44ee55')).toMatchObject({
            origin: 'company',
            status: 'sent',
            firstName: 'Marcus',
            preparedBy: { name: 'Rae Recruiter' },
            lockedEmployerCount: 1,
            lastStep: 2,
        });
    });

    it('still hands over no answers, for either origin', async () => {
        // The property the widened shape must not have cost. `toCompanySummary`
        // carries contact and progress; the answers are reached only through
        // `getCompanyPreparedDraft`, where `companyMayReadAnswers` lives.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'DRIVER-ONLY-1' } });
        seedPreparedDraft('aa11bb22cc33dd44ee55', 'driver_in_progress');

        const { result } = await listByKey();

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('DRIVER-ONLY-1');
        expect(serialized).not.toContain('PREPARED-ONLY-1');
        for (const row of result.drafts) {
            expect(row).not.toHaveProperty('formData');
            expect(row).not.toHaveProperty('identityKey');
            expect(row).not.toHaveProperty('resumeTokenHash');
        }
    });

    it('marks a taken-over prepared draft as the driver filling it in', async () => {
        // The status the read rule turns on, carried into the worklist so a
        // recruiter can see the state without the screen guessing at it.
        seedPreparedDraft('aa11bb22cc33dd44ee55', 'driver_in_progress');

        const { byKey } = await listByKey();

        expect(byKey.get('aa11bb22cc33dd44ee55')).toMatchObject({
            origin: 'company',
            status: 'driver_in_progress',
        });
    });

    it('reads a draft written before origin, status and step names existed', async () => {
        // The drafts already live in production when this shipped. `origin` marks a
        // carrier-prepared draft and its ABSENCE has always meant the driver typed
        // it, so the unified worklist must read a bare legacy document as
        // driver-started and unfinished rather than guessing "company" — which
        // would offer a recruiter an Open on somebody else's application.
        mockStore.set(`companies/${COMPANY}/application_drafts/f0f0f0f0f0f0f0f0f0f0`, {
            contactEmail: 'legacy@example.test',
            formData: { firstName: 'Older', lastName: 'Draft' },
        });

        const { byKey } = await listByKey();
        const row = byKey.get('f0f0f0f0f0f0f0f0f0f0');

        expect(row).toMatchObject({
            origin: 'driver',
            status: 'in_progress',
            firstName: 'Older',
            email: 'legacy@example.test',
            lastStep: 0,
            lastSemanticStep: null,
            lockedEmployerCount: 0,
            preparedBy: null,
        });
        // And no timestamps rather than an invented one.
        expect(row.updatedAt).toBeNull();
    });

    it('drops a draft the moment it stops existing, which is what submission does', async () => {
        // `submitGuestApplication` promotes the answers and DELETES the draft, and
        // the workspace lists this collection and nothing else — so submission
        // removes a row without anything having to remember to. Modest as a proof
        // (the store is a double), but it pins the contract that matters after the
        // consolidation: there is no second source and no cached list that could
        // keep showing an application that has been filed.
        await saveFirstPage();
        seedPreparedDraft('aa11bb22cc33dd44ee55', 'sent');
        expect((await listByKey()).result.drafts).toHaveLength(2);

        mockStore.delete(`companies/${COMPANY}/application_drafts/${keyFor()}`);

        const { result, byKey } = await listByKey();
        expect(result.drafts).toHaveLength(1);
        expect(byKey.has(keyFor())).toBe(false);
        expect(byKey.has('aa11bb22cc33dd44ee55')).toBe(true);
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
