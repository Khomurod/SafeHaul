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
    resetDraftState,
} = require('./applicationDrafts.support');

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
