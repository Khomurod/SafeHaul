/**
 * What happens to a prepared application when the driver corrects their own
 * email or phone.
 *
 * The draft's id is `sha256(company:email:phone)`, so those two fields are not
 * contact details — they are the address. A driver who fixes a typo on page one
 * is therefore writing to a DIFFERENT document than the one the carrier prepared,
 * and before this was fixed that document was an ordinary `in_progress` draft
 * with no `origin`, no `inviteClaimedAt` and no `lockedEmployers`.
 *
 * That is not a lost record, it is a lost rule. `submitGuestApplication` reads the
 * locks from the key it computes off the *submitted* contact details, so the
 * employers the carrier locked from a PSP report could be renamed or deleted by
 * anyone who corrected a typo — the one thing the lock exists to prevent, undone
 * without touching a locked field.
 *
 * Found in review on 2026-09-03. These tests pin both halves: the carrier's facts
 * travel with the applicant, and nothing about a driver-authored draft changes.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, COMPANY, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = {
    auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter', email: 'rae@carrier.test' } },
};

/** The email the driver corrects to — a different address, so a different key. */
const CORRECTED_EMAIL = 'dana.alvarez@example.test';

const LOCKED = [{ companyName: 'Acme Trucking', dotNumber: '123456' }];

function path(applicantKey) {
    return `companies/${COMPANY}/application_drafts/${applicantKey}`;
}

function stored(applicantKey) {
    return mockStore.get(path(applicantKey));
}

function prepare(overrides = {}) {
    return require('../../companyApplications').saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Dana', lastName: 'Alvarez', employers: LOCKED },
            lockedEmployers: LOCKED,
            ...overrides,
        },
    });
}

/**
 * A driver who followed the carrier's link, as the exchange leaves them.
 *
 * `exchangeApplicationInvite` mints them a resume token for that exact draft and
 * stamps `inviteClaimedAt` — the fact submission reads to decide whether the
 * locks apply at all. Installed directly here so the save path under test is the
 * one a real invited driver takes.
 */
function inviteDriverIn(applicantKey = keyFor()) {
    const { mintResumeToken } = require('../../shared/applicationDraft');
    const minted = mintResumeToken();
    mockStore.set(path(applicantKey), {
        ...stored(applicantKey),
        resumeTokenHash: minted.hash,
        inviteTokenHash: 'invite-hash-abc',
        priorInviteTokenHashes: ['invite-hash-old'],
        inviteClaimedAt: 'claimed-at',
    });
    return minted.token;
}

/** The driver's save, with the email they corrected it to. */
function saveCorrected(overrides = {}) {
    return saveFirstPage({
        email: CORRECTED_EMAIL,
        formData: { firstName: 'Dana', lastName: 'Alvarez', email: CORRECTED_EMAIL, employers: LOCKED },
        ...overrides,
    });
}

const movedKey = () => keyFor(COMPANY, CORRECTED_EMAIL, IDENTITY.phone);

beforeEach(resetDraftState);

describe('a prepared application whose driver corrects their contact details', () => {
    it('carries the locked employers to the new key', async () => {
        await prepare();
        const resumeToken = inviteDriverIn();

        await saveCorrected({ resumeToken, resumeApplicantKey: keyFor() });

        const moved = stored(movedKey());
        expect(moved).toBeTruthy();
        expect(moved.lockedEmployers).toHaveLength(1);
        expect(moved.lockedEmployers[0]).toMatchObject({ companyName: 'Acme Trucking', dotNumber: '123456' });
    });

    it('carries the origin, who prepared it, and the claim the locks depend on', async () => {
        await prepare();
        const resumeToken = inviteDriverIn();

        await saveCorrected({ resumeToken, resumeApplicantKey: keyFor() });

        const moved = stored(movedKey());
        expect(moved.origin).toBe('company');
        expect(moved.preparedBy).toMatchObject({ uid: 'recruiter-1' });
        // Without this, `lockedEmployersForSubmission` returns nothing and the
        // locks are not enforced on the submitted application.
        expect(moved.inviteClaimedAt).toBe('claimed-at');
        // The driver is writing it, so it is theirs from here — the carrier reads
        // contact and progress only, exactly as it would have at the old key.
        expect(moved.status).toBe('driver_in_progress');
    });

    it('leaves the invite token behind rather than letting two drafts answer one link', async () => {
        await prepare();
        const resumeToken = inviteDriverIn();

        await saveCorrected({ resumeToken, resumeApplicantKey: keyFor() });

        const moved = stored(movedKey());
        expect(moved.inviteTokenHash).toBeUndefined();
        expect(moved.priorInviteTokenHashes).toBeUndefined();
        // The driver's own resume token is what opens the moved draft, and it is
        // what proved this save belonged to it in the first place.
        expect(moved.resumeTokenHash).toBeTruthy();
    });

    it('finds the prepared draft without the browser naming its key', async () => {
        await prepare();
        const resumeToken = inviteDriverIn();

        // No `resumeApplicantKey`: the hint is a convenience, and the fall-through
        // scan has to reach the same answer or the locks depend on a hint a client
        // supplies.
        await saveCorrected({ resumeToken });

        const moved = stored(movedKey());
        expect(moved.origin).toBe('company');
        expect(moved.lockedEmployers).toHaveLength(1);
    });

    it('still refuses a save whose token opens nothing at all', async () => {
        await prepare();
        inviteDriverIn();

        const result = await saveCorrected({ resumeToken: 'not-a-real-token', resumeApplicantKey: keyFor() });

        expect(result.saved).toBe(false);
        expect(stored(movedKey())).toBeUndefined();
    });
});

describe('a driver-authored draft whose driver corrects their contact details', () => {
    it('gains no origin and no locks — it never had a carrier', async () => {
        const first = await saveFirstPage();
        expect(first.saved).toBe(true);

        await saveCorrected({ resumeToken: first.resumeToken, resumeApplicantKey: keyFor() });

        const moved = stored(movedKey());
        expect(moved).toBeTruthy();
        expect(moved.origin).toBeUndefined();
        expect(moved.lockedEmployers).toBeUndefined();
        expect(moved.status).toBe('in_progress');
    });
});
