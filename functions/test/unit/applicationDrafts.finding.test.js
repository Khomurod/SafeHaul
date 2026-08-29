/**
 * Finding a resumable application from an identity the applicant re-enters.
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
    mockStore, mockCheckRateLimit, IDENTITY, COMPANY, CONTEXT, saveFirstPage,
    runBeforeNextTransaction, resetDraftState,
} = require('./applicationDrafts.support');

beforeEach(resetDraftState);

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

    it('does not resurrect a draft discarded while the lookup was running', async () => {
        // The lookup rotates the matched draft's token, and a merge-set *creates* what it
        // cannot find. Start Over deleting the draft between the query and that write
        // would otherwise be undone — brought back as a stub holding a token and two
        // timestamps and no answers — and this call would offer it as the applicant's
        // unfinished application.
        const first = await saveFirstPage();
        const path = `companies/${COMPANY}/application_drafts/${first.applicantKey}`;
        runBeforeNextTransaction(() => { mockStore.delete(path); });

        const found = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: IDENTITY.email,
        }, CONTEXT);

        // Nothing offered, and nothing left behind. The answer is also the same one a
        // lookup that found nothing gives, so it does not disclose that a draft existed
        // a moment ago.
        expect(found).toEqual({ resumable: false });
        expect(mockStore.has(path)).toBe(false);
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
