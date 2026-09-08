/**
 * The carrier's read of a prepared application ends when the driver starts, and
 * the link does not get it back.
 *
 * ## The defect this file exists for
 *
 * Found 2026-09-08. `shared/companyPreparedDraft.js` states the boundary: a
 * carrier may read the answers of its own prepared draft until the driver's first
 * save, and from then on sees contact and progress only. It was enforced at one of
 * the two doors that read those answers. `companyApplications/read.js` consulted
 * `companyMayReadAnswers`, which tests `status`; `companyApplications/invite.js`
 * consulted `isCompanyPrepared`, which tests `origin` — the field that records who
 * *created* the draft and deliberately never changes.
 *
 * So a carrier could mint a link, exchange it itself from anything (the exchange is
 * unauthenticated by necessity — the driver has no account), and recover exactly the
 * answers the cutoff had just withheld, plus a resume token that could rewrite them.
 * `StartApplicationPage` rendered the mint button on the very screen that tells the
 * recruiter the answers are the driver's now.
 *
 * **Gating the mint would not have closed it.** The driver's first save leaves
 * `inviteTokenHash` untouched, so the link the carrier had already copied kept
 * working. The fix is at the exchange, which is what these cases pin.
 *
 * ## What replaces it
 *
 * After takeover the link is a pointer, not a credential: `requiresIdentity`, and
 * the driver proves who they are through `findResumableApplication` — last name,
 * date of birth and SSN digits, plus a contact detail already on the record. The
 * carrier cannot pass that (a prepared draft never holds an SSN, by design) and the
 * driver can, on any device.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, COMPANY, CONTEXT, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };
const PATH = () => `companies/${COMPANY}/application_drafts/${keyFor()}`;
// What the CARRIER wrote, and what the DRIVER wrote over it. Both matter, and
// they are different values on purpose: a driver's first save replaces `formData`
// wholesale, so probing post-takeover for the carrier's value proves nothing —
// it is not in the document any more. The leak this file is about is the second
// one.
const CARRIER_SECRET = 'TX1234567';
const DRIVER_SECRET = 'DRIVER-ONLY-4471';

function api() {
    return require('../../companyApplications');
}

async function prepare() {
    return api().saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: {
                firstName: 'Dana',
                lastName: 'Alvarez',
                cdlNumber: CARRIER_SECRET,
                // The row the lock names — see the invite suite; a lock with no row
                // is a state the editor cannot produce and the reconcile refuses.
                employers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
            },
            lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
        },
    });
}

function mint() {
    return api().mintApplicationInvite({ ...REQUEST, data: { companyId: COMPANY, applicantKey: keyFor() } });
}

function exchange(inviteToken) {
    return api().exchangeApplicationInvite(
        { companyId: COMPANY, applicantKey: keyFor(), inviteToken }, CONTEXT,
    );
}

function readBack() {
    return api().getCompanyPreparedDraft({
        ...REQUEST, data: { companyId: COMPANY, applicantKey: keyFor() },
    });
}

/**
 * A prepared application the driver has taken over, and the token their browser
 * is saving with.
 *
 * The save deliberately carries no SSN, so the draft gets no `identityKey` — which
 * is the state a prepared draft is in until the driver reaches the page that asks
 * for one, and the state in which the resume token is the ONLY thing authorizing
 * their autosave. That is what makes the token-demotion case below real rather
 * than theoretical.
 */
async function driverHasStarted() {
    await prepare();
    const { inviteToken } = await mint();
    const { resumeToken } = await exchange(inviteToken);
    await saveFirstPage({
        resumeToken,
        ssn: '',
        formData: { firstName: 'Dana', lastName: 'Alvarez', cdlNumber: DRIVER_SECRET },
    });
    return { inviteToken, resumeToken };
}

beforeEach(resetDraftState);

describe('before the driver has written anything', () => {
    it('hands the carrier its own answers back, because they are its own', async () => {
        await prepare();
        const { inviteToken } = await mint();

        const opened = await exchange(inviteToken);

        expect(opened).toMatchObject({ opened: true, requiresIdentity: false });
        expect(opened.formData.cdlNumber).toBe(CARRIER_SECRET);
        expect(opened.lockedEmployers).toHaveLength(1);
        expect(opened.resumeToken).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('once the driver has taken it over', () => {
    it('the link stops handing over the answers, and stops handing over a token', async () => {
        const { inviteToken } = await driverHasStarted();
        expect(mockStore.get(PATH()).status).toBe('driver_in_progress');

        const opened = await exchange(inviteToken);

        expect(opened).toEqual({ opened: true, requiresIdentity: true, applicantKey: keyFor() });
        expect(JSON.stringify(opened)).not.toContain(DRIVER_SECRET);
        expect(opened.resumeToken).toBeUndefined();
        expect(opened.formData).toBeUndefined();
        expect(opened.lockedEmployers).toBeUndefined();
        // Not even who prepared it: the carrier is the party holding this link.
        expect(opened.preparedBy).toBeUndefined();
    });

    it('closes the ORIGINAL link, not just a freshly minted one', async () => {
        // The driver's first save leaves `inviteTokenHash` alone, so the token the
        // carrier copied before the handover kept working. Gating the mint would
        // have left this open.
        const { inviteToken } = await driverHasStarted();

        await expect(exchange(inviteToken)).resolves.toMatchObject({ requiresIdentity: true });
    });

    it('closes a link minted after the handover too', async () => {
        await driverHasStarted();

        const { inviteToken } = await mint();

        await expect(exchange(inviteToken)).resolves.toMatchObject({ requiresIdentity: true });
    });

    it('agrees with the carrier-authenticated read, which is the whole point', async () => {
        const { inviteToken } = await driverHasStarted();

        const asCarrier = await readBack();
        const asLinkHolder = await exchange(inviteToken);

        expect(asCarrier.readable).toBe(false);
        expect(JSON.stringify(asCarrier)).not.toContain(DRIVER_SECRET);
        expect(JSON.stringify(asLinkHolder)).not.toContain(DRIVER_SECRET);
    });

    it('writes nothing at all, so it cannot displace the driver or arm a refusal', async () => {
        const { inviteToken } = await driverHasStarted();
        const before = mockStore.get(PATH());

        await exchange(inviteToken);

        const after = mockStore.get(PATH());
        expect(after.resumeTokenHash).toBe(before.resumeTokenHash);
        expect(after.priorResumeTokenHashes).toEqual(before.priorResumeTokenHashes);
        expect(after.inviteClaimedAt).toBe(before.inviteClaimedAt);
    });

    it('leaves the driver still able to save', async () => {
        const { inviteToken, resumeToken } = await driverHasStarted();

        // Three opens: the old code rotated on every one, demoting the driver's
        // token to a prior hash — which grants liveness but never write
        // authorization — so their autosave stopped without a word.
        await exchange(inviteToken);
        await exchange(inviteToken);
        await exchange(inviteToken);

        const saved = await saveFirstPage({ resumeToken, ssn: '', lastStep: 3 });
        expect(saved.saved).toBe(true);
        expect(mockStore.get(PATH()).lastStep).toBe(3);
    });
});
