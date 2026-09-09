/**
 * A replacement link returns the driver to the application they already started.
 *
 * ## The production failure this file is built from
 *
 * `companies/0AblDiRX0tB9p07hibs3/application_drafts/eb58fc7f58ca61c7218e`, read
 * on 2026-09-09: `origin: 'company'`, `status: 'driver_in_progress'`,
 * `lastSemanticStep: 'consent'`, `clientSeq: 10`, `inviteClaimedAt` at 16:02 —
 * and **`identityKey: null`**. The recruiter minted a replacement link at 16:41,
 * the driver opened it twice (both exchanges returned 200), and both times the
 * page rendered the fresh-application chooser.
 *
 * Two independent defects, and the suite covers both:
 *
 * 1. `requiresIdentity` had no verification path that could run. It delegated to
 *    `findResumableApplication`, which queries `identityKey ==`, and that field was
 *    null — erased by the first autosave issued after a page reload, because the
 *    HMAC needs an SSN and a draft never stores one.
 * 2. Nothing rendered `requires_identity`, which is the client half
 *    (`PublicApplyScreens`).
 *
 * Every fixture here is synthetic. `driverStartedWithoutIdentity` reproduces the
 * *shape* of that record — a taken-over prepared draft with no identity HMAC — and
 * `driverStartedWithIdentity` the shape every draft written from now on has.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, mockCheckRateLimit, COMPANY, CONTEXT, IDENTITY,
    keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };
const PATH = (key = keyFor()) => `companies/${COMPANY}/application_drafts/${key}`;
/** What the driver typed after taking the application over. Never the carrier's. */
const DRIVER_SECRET = 'DRIVER-ONLY-4471';

/** The claim a driver makes on the confirmation screen. */
const CLAIM = Object.freeze({
    lastName: IDENTITY.lastName,
    dob: IDENTITY.dob,
    ssn: IDENTITY.ssn,
    contact: IDENTITY.email,
});

function api() {
    return require('../../companyApplications');
}

function mint(applicantKey = keyFor()) {
    return api().mintApplicationInvite({ ...REQUEST, data: { companyId: COMPANY, applicantKey } });
}

function open(inviteToken, identity = undefined, applicantKey = keyFor()) {
    return api().exchangeApplicationInvite(
        { companyId: COMPANY, applicantKey, inviteToken, identity }, CONTEXT,
    );
}

async function prepare(formData = {}) {
    return api().saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Dana', lastName: IDENTITY.lastName, ...formData },
        },
    });
}

/**
 * The reported record's shape: taken over, and with no identity HMAC on file.
 *
 * The driver's save deliberately carries no SSN — which is exactly what an autosave
 * issued after a reload looks like, since the SSN lives only in the page's own
 * state. Before `identityKeyForSave` that save also ERASED any key an earlier one
 * had written; either way the stored draft ends up here.
 */
async function driverStartedWithoutIdentity() {
    await prepare();
    const { inviteToken } = await mint();
    const { resumeToken } = await open(inviteToken);
    await saveFirstPage({
        resumeToken,
        ssn: '',
        lastStep: 8,
        lastSemanticStep: 'consent',
        formData: { firstName: 'Dana', lastName: IDENTITY.lastName, cdlNumber: DRIVER_SECRET, dob: IDENTITY.dob },
    });
    return { inviteToken, resumeToken };
}

/** The same, but the driver's save carried their SSN, so the HMAC is on file. */
async function driverStartedWithIdentity() {
    await prepare();
    const { inviteToken } = await mint();
    const { resumeToken } = await open(inviteToken);
    await saveFirstPage({
        resumeToken,
        lastStep: 8,
        lastSemanticStep: 'consent',
        formData: { firstName: 'Dana', lastName: IDENTITY.lastName, cdlNumber: DRIVER_SECRET, dob: IDENTITY.dob },
    });
    return { inviteToken, resumeToken };
}

beforeEach(resetDraftState);

describe('the replacement link a recruiter creates for a driver who already started', () => {
    it('returns them to the same application, with their answers and their step', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();

        const opened = await open(inviteToken, CLAIM);

        expect(opened.opened).toBe(true);
        expect(opened.requiresIdentity).toBe(false);
        // The SAME document, not a new one.
        expect(opened.applicantKey).toBe(keyFor());
        expect(opened.formData.cdlNumber).toBe(DRIVER_SECRET);
        // Where they actually were. Withheld entirely until 2026-09-09, which would
        // have dropped a confirmed driver back onto page one of their own form.
        expect(opened.lastStep).toBe(8);
        expect(opened.lastSemanticStep).toBe('consent');
        expect(opened.resumeToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('creates no second draft', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();
        await open(inviteToken, CLAIM);

        const drafts = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(drafts).toEqual([PATH()]);
    });

    it('establishes the identity HMAC the draft had lost, so the next link verifies it', async () => {
        await driverStartedWithoutIdentity();
        expect(mockStore.get(PATH()).identityKey).toBeNull();

        const { inviteToken } = await mint();
        await open(inviteToken, CLAIM);

        expect(mockStore.get(PATH()).identityKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies the SSN against the HMAC once one is on file', async () => {
        await driverStartedWithIdentity();
        expect(mockStore.get(PATH()).identityKey).toMatch(/^[0-9a-f]{64}$/);
        const { inviteToken } = await mint();

        await expect(open(inviteToken, { ...CLAIM, ssn: '987-65-4321' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        await expect(open(inviteToken, CLAIM)).resolves.toMatchObject({ requiresIdentity: false });
    });

    it('leaves the driver resuming where they left off on a device that still holds a token', async () => {
        // The strongest path asks the applicant for nothing, and a replacement link
        // must not take it away: the token the driver's browser holds still opens
        // the draft after somebody else has opened the link.
        const { resumeToken } = await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();
        await open(inviteToken);

        const restored = await require('../../applicationDrafts').resumeApplicationDraft(
            { companyId: COMPANY, applicantKey: keyFor(), resumeToken }, CONTEXT,
        );
        expect(restored.draft.formData.cdlNumber).toBe(DRIVER_SECRET);
    });
});

describe('what the link refuses', () => {
    it('refuses the carrier, which knows the name and the contact detail but not the SSN', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();

        await expect(open(inviteToken, { ...CLAIM, ssn: '' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        // Nothing was written, so the driver's own token is not demoted by a guess.
        expect(mockStore.get(PATH()).identityKey).toBeNull();
    });

    it('refuses a wrong date of birth even with no HMAC on file', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();

        await expect(open(inviteToken, { ...CLAIM, dob: '1990-01-01' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('refuses a contact detail the draft does not hold', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();

        await expect(open(inviteToken, { ...CLAIM, contact: 'someone.else@example.test' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('never lets one applicant’s link reach another applicant’s draft', async () => {
        const other = { lastName: 'Whitfield', dob: '1975-06-02', email: 'other@example.test', phone: '(214) 555-0900' };
        await saveFirstPage({
            email: other.email, phone: other.phone, lastName: other.lastName, dob: other.dob,
            formData: { firstName: 'Marcus', lastName: other.lastName, dob: other.dob },
        });
        const otherKey = keyFor(COMPANY, other.email, other.phone);

        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();

        // Dana's link, presented with Marcus's identity: refused, and Dana's draft
        // is what the link named either way — it can never resolve to Marcus's.
        await expect(open(inviteToken, {
            lastName: other.lastName, dob: other.dob, ssn: IDENTITY.ssn, contact: other.email,
        })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockStore.get(PATH(otherKey)).formData.firstName).toBe('Marcus');
    });

    it('says honestly when the draft holds nothing to check against', async () => {
        // No last name and no date of birth, and no HMAC: essential identity
        // information never existed, so there is no safe way to hand this over.
        await prepare();
        const { inviteToken } = await mint();
        const { resumeToken } = await open(inviteToken);
        await saveFirstPage({ resumeToken, ssn: '', formData: { firstName: 'Dana' } });

        const replacement = await mint();
        await expect(open(replacement.inviteToken, CLAIM)).rejects.toMatchObject({
            code: 'permission-denied',
            message: expect.stringContaining('cannot confirm'),
        });
    });

    it('cannot resurrect a submitted or discarded application', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();
        // A submission deletes the draft, and the invite hash lives on it.
        mockStore.delete(PATH());

        await expect(open(inviteToken, CLAIM)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('cannot be opened with a correct identity once the link itself has expired', async () => {
        await driverStartedWithoutIdentity();
        const { inviteToken } = await mint();
        const stored = mockStore.get(PATH());
        mockStore.set(PATH(), { ...stored, inviteTokenExpiresAt: new Date(Date.now() - 1000) });

        await expect(open(inviteToken, CLAIM)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('audits a refused claim, without recording what was presented', async () => {
        await driverStartedWithIdentity();
        const { inviteToken } = await mint();

        await expect(open(inviteToken, { ...CLAIM, ssn: '000-00-0000' }))
            .rejects.toMatchObject({ code: 'permission-denied' });

        const audit = [...mockStore.keys()].filter((key) => key.includes('application_draft_audit'));
        expect(audit).toHaveLength(1);
        const row = mockStore.get(audit[0]);
        expect(row).toMatchObject({ action: 'invite_identity_refused', outcome: 'identity_mismatch' });
        // Value-free, like every other row in this collection: the outcome and the
        // company, never a name, a date of birth, an SSN or a contact detail.
        expect(JSON.stringify(row)).not.toContain('000-00-0000');
        expect(JSON.stringify(row)).not.toContain(IDENTITY.lastName);
        expect(JSON.stringify(row)).not.toContain(IDENTITY.email);
    });

    it('bounds guessing per draft, not only per caller', async () => {
        await driverStartedWithIdentity();
        const { inviteToken } = await mint();

        // The per-IP budget passes; the per-draft one is spent.
        mockCheckRateLimit.mockImplementation(async (key) => !String(key).startsWith('invite_identity_denied_'));
        await expect(open(inviteToken, { ...CLAIM, ssn: '000-00-0000' }))
            .rejects.toMatchObject({ code: 'resource-exhausted' });

        // And nothing is written past the budget, which is what the budget is FOR:
        // it bounds the audit writes one caller can cause, so a probe loop cannot
        // become unbounded writes. The first attempts are recorded, which is all a
        // spike needs to be visible.
        expect([...mockStore.keys()].filter((key) => key.includes('application_draft_audit')))
            .toHaveLength(0);
    });

    /**
     * The stated limitation, pinned so it cannot be quietly forgotten *or* quietly
     * widened.
     *
     * With no HMAC on file there is nothing to verify a Social Security Number
     * against, so a well-formed one is REQUIRED and not CHECKED — while the last
     * name and the date of birth, which the draft does hold, are checked. That is
     * the whole of the `answers` tier, and the first assertion below is what it
     * costs. The second is what stops it being the tier everything lands in: one
     * successful pass writes the HMAC, so the same wrong SSN is refused afterwards.
     */
    it('cannot check an SSN it has nothing to check against, and says so by healing', async () => {
        await driverStartedWithoutIdentity();
        const first = await mint();

        await expect(open(first.inviteToken, { ...CLAIM, ssn: '000-00-0000' }))
            .resolves.toMatchObject({ requiresIdentity: false });

        const second = await mint();
        await expect(open(second.inviteToken, { ...CLAIM, ssn: '111-11-1111' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });
});

describe('an application the driver started themselves', () => {
    it('can be sent a continuation link that returns them to it', async () => {
        await saveFirstPage({ lastStep: 5, lastSemanticStep: 'employment' });
        const { inviteToken, requiresIdentity } = await mint();
        expect(requiresIdentity).toBe(true);

        // The link alone opens nothing: the carrier authored none of these answers.
        await expect(open(inviteToken)).resolves.toEqual({
            opened: true, requiresIdentity: true, applicantKey: keyFor(),
        });

        const opened = await open(inviteToken, CLAIM);
        expect(opened.applicantKey).toBe(keyFor());
        expect(opened.formData.firstName).toBe('Dana');
        expect(opened.lastSemanticStep).toBe('employment');
        expect(opened.resumeToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is never described to the carrier as something it prepared', async () => {
        await saveFirstPage();
        await mint();

        const stored = mockStore.get(PATH());
        expect(stored.origin).toBeUndefined();
        expect(stored.status).toBe('in_progress');
        const list = await api().listCompanyPreparedApplications({ ...REQUEST, data: { companyId: COMPANY } });
        expect(list.applications).toHaveLength(0);
    });
});

describe('the locks a carrier took, through the identity path', () => {
    it('are not reconciled against answers the driver supplied', async () => {
        // Reconciling here would make "delete the locked row" mean "delete the
        // lock", which is the whole thing the lock prevents.
        await prepare({ employers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }] });
        mockStore.set(PATH(), {
            ...mockStore.get(PATH()),
            lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
        });
        const { inviteToken } = await mint();
        const { resumeToken } = await open(inviteToken);
        // The driver deletes the locked row and saves.
        await saveFirstPage({
            resumeToken, ssn: '',
            formData: { firstName: 'Dana', lastName: IDENTITY.lastName, dob: IDENTITY.dob, employers: [] },
        });

        const replacement = await mint();
        const opened = await open(replacement.inviteToken, CLAIM);

        expect(opened.lockedEmployers).toHaveLength(1);
        expect(mockStore.get(PATH()).lockedEmployers).toHaveLength(1);
    });
});
