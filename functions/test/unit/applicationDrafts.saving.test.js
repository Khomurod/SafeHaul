/**
 * Autosave: what a first save writes, and what it refuses to write.
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

const {
    mockStore, mockDeletedPaths, mockCheckRateLimit, mockAssertIntake, COMPANY, keyFor,
    saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

beforeEach(resetDraftState);

/**
 * The identity HMAC survives a save that cannot compute one.
 *
 * ## The defect, measured in production on 2026-09-09
 *
 * `identityKey` was written as `identityKey || null` on **every** save. The HMAC
 * needs a Social Security Number, and a draft deliberately never stores one — so
 * the SSN lives only in the page's own state, and the first autosave issued after
 * a reload (or after a restore from the server copy, which has none either)
 * recomputed the key as null and erased it.
 *
 * `findResumableApplication` queries `identityKey ==`, so what the applicant
 * silently lost was cross-device resume — and, for a carrier-prepared
 * application, the only thing that could ever prove the driver owns it. Three of
 * six live drafts held `identityKey: null`, one of them at the consent step, its
 * `resumeApplicationDraft` restore followed 46 seconds later by the save that
 * erased it.
 */
describe('the identity a draft is matched on', () => {
    const identityOf = () => mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).identityKey;

    it('is not erased by a later save that has no Social Security Number', async () => {
        const { resumeToken } = await saveFirstPage();
        const established = identityOf();
        expect(established).toMatch(/^[0-9a-f]{64}$/);

        // Exactly what an autosave after a page reload sends.
        await saveFirstPage({ resumeToken, ssn: '', lastStep: 4 });

        expect(identityOf()).toBe(established);
    });

    it('follows a corrected contact detail even when that save has no SSN', async () => {
        // The applicant fixes a typo in their own email on a reloaded page. The
        // document id is `sha256(company:email:phone)`, so this writes a different
        // document — and leaving the identity behind on the old key would cost them
        // the match just as surely as erasing it.
        const { resumeToken } = await saveFirstPage();
        const established = identityOf();

        const moved = await saveFirstPage({
            resumeToken, ssn: '', email: 'dana.alvarez@example.test',
        });

        const movedPath = `companies/${COMPANY}/application_drafts/${moved.applicantKey}`;
        expect(mockStore.get(movedPath).identityKey).toBe(established);
        // And exactly one live draft, because the sweep reads the key that was
        // written rather than the one this request could compute.
        expect(mockDeletedPaths).toContain(`companies/${COMPANY}/application_drafts/${keyFor()}`);
    });

    it('still moves when the applicant corrects an identity field', async () => {
        const { resumeToken } = await saveFirstPage();
        const established = identityOf();

        await saveFirstPage({ resumeToken, lastName: 'Alvarez-Reed' });

        expect(identityOf()).toMatch(/^[0-9a-f]{64}$/);
        expect(identityOf()).not.toBe(established);
    });

    it('is null, not undefined, on a first save that cannot compute one', async () => {
        // A carrier-prepared draft the driver has just taken over: the field is
        // present and empty, which is what "there has never been one" looks like.
        await saveFirstPage({ ssn: '' });
        expect(identityOf()).toBeNull();
    });
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
