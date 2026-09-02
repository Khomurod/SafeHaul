/**
 * Applications a carrier prepares on a driver's behalf: what a prepare writes,
 * what it refuses, and who may read it back.
 *
 * The properties pinned here are the ones that decide whether this feature is
 * safe to have at all:
 *
 *  - a prepared application is a DRAFT, so none of the four `applications`
 *    triggers fire and nobody is emailed that an application was received;
 *  - it takes the same deterministic applicant key a driver's own draft would, so
 *    the draft, the invite and the eventual application are one identity;
 *  - it never overwrites a driver's own unfinished application;
 *  - the carrier reads its own answers back only until the driver writes, after
 *    which it sees contact and progress like any other unfinished application;
 *  - a driver-authored draft behaves exactly as it did before this existed.
 *
 * Reuses the `applicationDrafts` harness — same Firestore double, same fixtures —
 * so the two surfaces cannot drift apart about what a draft document looks like.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, mockRunTransactionCalls, mockCheckRateLimit, mockAssertCompanyAccess,
    COMPANY, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = {
    auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter', email: 'rae@carrier.test' } },
};

const PREPARED_FORM = {
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: IDENTITY.email,
    phone: IDENTITY.phone,
    cdlNumber: 'TX1234567',
    cdlState: 'TX',
    employers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
};

function prepare(overrides = {}) {
    return require('../../companyApplications').saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: PREPARED_FORM,
            ...overrides,
        },
    });
}

function read(applicantKey = keyFor()) {
    return require('../../companyApplications').getCompanyPreparedDraft({
        ...REQUEST,
        data: { companyId: COMPANY, applicantKey },
    });
}

function storedDraft(applicantKey = keyFor()) {
    return mockStore.get(`companies/${COMPANY}/application_drafts/${applicantKey}`);
}

/**
 * A driver who opened the invite link.
 *
 * The exchange (phase 2) hands them a resume token for that exact draft, which is
 * what authorizes their saves — a carrier-prepared draft carries no identity HMAC,
 * because the carrier does not know the driver's Social Security Number. This
 * helper installs that token the way the exchange will, so the save path here is
 * the one a real invited driver takes.
 */
function inviteDriverIn(applicantKey = keyFor()) {
    const { mintResumeToken } = require('../../shared/applicationDraft');
    const minted = mintResumeToken();
    mockStore.set(`companies/${COMPANY}/application_drafts/${applicantKey}`, {
        ...storedDraft(applicantKey), resumeTokenHash: minted.hash,
    });
    return minted.token;
}

beforeEach(resetDraftState);

describe('preparing an application', () => {
    it('stages a draft — never an application document', async () => {
        const result = await prepare();

        expect(result.saved).toBe(true);
        expect(result.applicantKey).toBe(keyFor());
        expect(storedDraft()).toBeTruthy();
        // The four onCreate triggers live on `applications`. Nothing here may write
        // there, or a recruiter uploading a licence emails the driver that their
        // application was received.
        const applicationWrites = [...mockStore.keys()].filter((key) => key.includes('/applications/'));
        expect(applicationWrites).toEqual([]);
    });

    it('marks its origin and who prepared it, and starts as prepared', async () => {
        await prepare();
        const stored = storedDraft();

        expect(stored.origin).toBe('company');
        expect(stored.status).toBe('prepared');
        expect(stored.preparedBy).toMatchObject({ uid: 'recruiter-1', name: 'Rae Recruiter' });
    });

    it('stores no Social Security Number, at any depth', async () => {
        await prepare({
            formData: { ...PREPARED_FORM, ssn: '123-45-6789', nested: { ssn: '123-45-6789' } },
        });

        const serialized = JSON.stringify(storedDraft());
        expect(serialized).not.toContain('123-45-6789');
        expect(storedDraft().formData.ssn).toBeUndefined();
        expect(storedDraft().formData.nested.ssn).toBeUndefined();
    });

    it('records locked employers beside the answers, keyed by their identity', async () => {
        const result = await prepare({
            lockedEmployers: [
                { companyName: 'Acme Trucking', dotNumber: 'USDOT 123456' },
                { companyName: '', dotNumber: '' },
            ],
        });

        // The unidentifiable row is dropped: a lock nothing can match would refuse
        // every submission with no way to satisfy it.
        expect(result.lockedEmployers).toEqual([
            { signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' },
        ]);
        expect(storedDraft().lockedEmployers).toHaveLength(1);
    });

    it('reads and writes in one transaction, so two recruiters cannot overwrite each other', async () => {
        await prepare();
        expect(mockRunTransactionCalls).toHaveLength(1);
        expect(mockRunTransactionCalls[0].writes).toContain(`companies/${COMPANY}/application_drafts/${keyFor()}`);
    });

    it('requires an email or phone, because they are the key', async () => {
        await expect(prepare({ email: '', phone: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('requires company access and refuses without it', async () => {
        mockAssertCompanyAccess.mockRejectedValueOnce(
            Object.assign(new Error('denied'), { code: 'permission-denied' }),
        );
        await expect(prepare()).rejects.toThrow();
        expect(storedDraft()).toBeUndefined();
    });

    it('rate-limits per company user, fail-closed', async () => {
        mockCheckRateLimit.mockResolvedValueOnce(false);
        await expect(prepare()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
            `company_prepare_${COMPANY}_recruiter-1`, expect.any(Number), expect.any(Number), 'closed',
        );
    });

    it('never overwrites a driver-authored draft', async () => {
        await saveFirstPage();
        const before = JSON.stringify(storedDraft());

        await expect(prepare()).rejects.toMatchObject({ code: 'already-exists' });
        expect(JSON.stringify(storedDraft())).toBe(before);
    });

    it('refuses once the driver has started filling it in', async () => {
        await prepare();
        await saveFirstPage({ resumeToken: inviteDriverIn() });
        expect(storedDraft().status).toBe('driver_in_progress');

        await expect(prepare({ formData: { firstName: 'Overwritten' } }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(storedDraft().formData.firstName).toBe('Dana');
    });

    it('keeps the sent status when the carrier edits after minting a link', async () => {
        await prepare();
        mockStore.set(`companies/${COMPANY}/application_drafts/${keyFor()}`, {
            ...storedDraft(), status: 'sent',
        });

        await prepare({ formData: { ...PREPARED_FORM, firstName: 'Dana Marie' } });
        expect(storedDraft().status).toBe('sent');
        expect(storedDraft().formData.firstName).toBe('Dana Marie');
    });
});

describe('the driver taking it over', () => {
    it("flips to driver_in_progress on the driver's first save, one way only", async () => {
        await prepare();
        const resumeToken = inviteDriverIn();
        await saveFirstPage({ resumeToken });

        expect(storedDraft().status).toBe('driver_in_progress');

        // A later save must not walk it back — the carrier's read of the answers
        // ended at the first one.
        await saveFirstPage({ lastStep: 3, resumeToken });
        expect(storedDraft().status).toBe('driver_in_progress');
    });

    it('is not taken over by someone who merely knows the email and phone', async () => {
        await prepare();

        // No invite token: the ordinary autosave ownership rules apply, and a
        // carrier-prepared draft has no identity HMAC to satisfy them with. The
        // save is refused in the same shape a network failure produces, so the
        // stranger learns nothing and the prepared answers stay put.
        const refused = await saveFirstPage({ formData: { firstName: 'Stranger' } });

        expect(refused.saved).toBe(false);
        expect(storedDraft().status).toBe('prepared');
        expect(storedDraft().formData.firstName).toBe('Dana');
    });

    it('leaves a driver-authored draft exactly as it was', async () => {
        await saveFirstPage();
        expect(storedDraft().status).toBe('in_progress');
        expect(storedDraft().origin).toBeUndefined();
    });
});

describe('reading a prepared application back', () => {
    it('returns the answers while the carrier is still the author', async () => {
        await prepare({ lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }] });
        const result = await read();

        expect(result.readable).toBe(true);
        expect(result.formData.cdlNumber).toBe('TX1234567');
        expect(result.lockedEmployers).toHaveLength(1);
        expect(result.status).toBe('prepared');
    });

    it('withholds the answers once the driver has written, keeping progress', async () => {
        await prepare();
        await saveFirstPage({ resumeToken: inviteDriverIn() });

        const result = await read();
        expect(result.readable).toBe(false);
        expect(result.formData).toBeNull();
        expect(result.lockedEmployers).toEqual([]);
        expect(result.status).toBe('driver_in_progress');
        expect(result.email).toBe(IDENTITY.email.toLowerCase());
    });

    it('never returns the identity hash or a token hash', async () => {
        await prepare();
        mockStore.set(`companies/${COMPANY}/application_drafts/${keyFor()}`, {
            ...storedDraft(), identityKey: 'secret-hmac', resumeTokenHash: 'secret-hash',
        });

        const serialized = JSON.stringify(await read());
        expect(serialized).not.toContain('secret-hmac');
        expect(serialized).not.toContain('secret-hash');
    });

    it('refuses to read a driver-authored draft through this door', async () => {
        await saveFirstPage();
        await expect(read()).rejects.toMatchObject({ code: 'not-found' });
    });

    it('lists only what this carrier prepared, without answers', async () => {
        await prepare();
        await require('../../companyApplications').saveCompanyPreparedApplication({
            ...REQUEST,
            data: { companyId: COMPANY, email: 'other@example.test', phone: '2145550188', formData: { firstName: 'Sam' } },
        });

        const result = await require('../../companyApplications').listCompanyPreparedApplications({
            ...REQUEST, data: { companyId: COMPANY },
        });

        expect(result.applications).toHaveLength(2);
        for (const row of result.applications) {
            expect(row.origin).toBe('company');
            expect(row).not.toHaveProperty('formData');
        }
    });
});
