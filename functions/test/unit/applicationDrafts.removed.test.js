/**
 * What a deleted application's own tab, and the carrier's link to it, are told.
 *
 * Part of the `applicationDrafts` suite; the doubles are in
 * `applicationDrafts.support.js`. What these pin: the holder of a token the
 * deleted draft handed out learns it was removed, from a save, a restore or the
 * link; nobody else learns anything they did not before; and a new application
 * by the same driver, at the same key, is untouched by the mark.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const drafts = require('../../applicationDrafts');
const {
    mockStore, COMPANY, CONTEXT, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const purge = () => drafts.purgeApplicationDraft({
    auth: { uid: 'admin-1' }, data: { companyId: COMPANY, applicantKey: keyFor() },
});

const saveAgain = (resumeToken) => saveFirstPage({ resumeToken, resumeApplicantKey: keyFor(), lastStep: 2 });

const resume = (resumeToken) => drafts.resumeApplicationDraft({
    companyId: COMPANY, applicantKey: keyFor(), resumeToken,
}, CONTEXT);

const STRANGERS_TOKEN = '0'.repeat(64);

beforeEach(resetDraftState);

describe('a save from the deleted application\'s own tab', () => {
    it('is told the application was removed, and nothing is written', async () => {
        const { resumeToken } = await saveFirstPage();
        await purge();

        await expect(saveAgain(resumeToken)).resolves.toEqual({
            saved: false, removed: true, applicantKey: null, resumeToken: null,
        });
        expect(mockStore.has(`companies/${COMPANY}/application_drafts/${keyFor()}`)).toBe(false);
    });

    it('is told so even after the driver started again on another device', async () => {
        const { resumeToken: oldToken } = await saveFirstPage();
        await purge();
        const fresh = await saveFirstPage();

        await expect(saveAgain(oldToken)).resolves.toMatchObject({ saved: false, removed: true });
        // The new application is the driver's, and goes on as usual.
        await expect(saveAgain(fresh.resumeToken)).resolves.toMatchObject({ saved: true });
        await expect(resume(fresh.resumeToken)).resolves.toMatchObject({ restored: true });
    });

    it('is told nothing new when the application was submitted rather than deleted', async () => {
        const { resumeToken } = await saveFirstPage();
        // What a submission does to the draft it completes.
        mockStore.delete(`companies/${COMPANY}/application_drafts/${keyFor()}`);

        await expect(saveAgain(resumeToken)).resolves.toEqual({ saved: false, applicantKey: null, resumeToken: null });
    });
});

describe('anyone else', () => {
    it('gets the answer a stranger always got', async () => {
        await saveFirstPage();
        await purge();

        await expect(saveAgain(STRANGERS_TOKEN)).resolves.toEqual({ saved: false, applicantKey: null, resumeToken: null });
        await expect(resume(STRANGERS_TOKEN)).rejects.toMatchObject({ code: 'not-found', details: undefined });
    });
});

describe('restoring the deleted application', () => {
    it('answers not-found, with the reason, to its own token', async () => {
        const { resumeToken } = await saveFirstPage();
        await purge();

        await expect(resume(resumeToken)).rejects.toMatchObject({ code: 'not-found', details: { reason: 'removed' } });
    });
});

describe('the carrier\'s link to the deleted application', () => {
    const api = () => require('../../companyApplications');
    const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };

    async function preparedWithLink() {
        await api().saveCompanyPreparedApplication({
            ...REQUEST,
            data: { companyId: COMPANY, email: IDENTITY.email, phone: IDENTITY.phone, formData: { firstName: 'Dana', lastName: 'Alvarez' } },
        });
        const { inviteToken } = await api().mintApplicationInvite({ ...REQUEST, data: { companyId: COMPANY, applicantKey: keyFor() } });
        return inviteToken;
    }

    const exchange = (inviteToken) => api().exchangeApplicationInvite({
        companyId: COMPANY, applicantKey: keyFor(), inviteToken,
    }, CONTEXT);

    it('says the application was removed', async () => {
        const inviteToken = await preparedWithLink();
        await purge();

        await expect(exchange(inviteToken)).rejects.toMatchObject({ code: 'not-found', details: { reason: 'removed' } });
    });

    it('says nothing new to a link that never opened it', async () => {
        await preparedWithLink();
        await purge();

        await expect(exchange(STRANGERS_TOKEN)).rejects.toMatchObject({ code: 'not-found', details: undefined });
    });
});
