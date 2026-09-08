/**
 * The link a carrier sends, and the driver's browser opening it.
 *
 * What is pinned here is mostly refusal:
 *
 *  - a wrong token, an expired token and a draft that is not a prepared one all
 *    answer identically, so a caller learns nothing by guessing;
 *  - only the hash is stored, so the database row is not the link;
 *  - regenerating does not kill a link somebody is opening this second, and does
 *    not walk back the driver having taken the application over;
 *  - a successful open hands over a resume token, because without one the driver's
 *    own autosave would be refused — a prepared draft has no identity HMAC.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, mockCheckRateLimit, mockAssertCompanyAccess, mockAssertIntake,
    COMPANY, CONTEXT, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };
const PATH = () => `companies/${COMPANY}/application_drafts/${keyFor()}`;

function api() {
    return require('../../companyApplications');
}

async function prepare(overrides = {}) {
    return api().saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: {
                firstName: 'Dana',
                lastName: 'Alvarez',
                cdlNumber: 'TX1234567',
                // The row the lock names. A lock with no row on the application is
                // a state the editor cannot produce and `reconcileLockedEmployers`
                // now refuses, because it is exactly the invisible requirement a
                // driver gets blocked on at submission and cannot satisfy.
                employers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
            },
            lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
            ...overrides,
        },
    });
}

function mint(applicantKey = keyFor()) {
    return api().mintApplicationInvite({ ...REQUEST, data: { companyId: COMPANY, applicantKey } });
}

function exchange(inviteToken, overrides = {}) {
    return api().exchangeApplicationInvite({
        companyId: COMPANY, applicantKey: keyFor(), inviteToken, ...overrides,
    }, CONTEXT);
}

/** Firestore timestamps in the double are plain objects; expiry needs a real one. */
function setInviteExpiry(msFromNow) {
    const at = new Date(Date.now() + msFromNow);
    mockStore.set(PATH(), { ...mockStore.get(PATH()), inviteTokenExpiresAt: { toDate: () => at } });
}

beforeEach(resetDraftState);

describe('minting a link', () => {
    it('returns the raw token once and stores only its hash', async () => {
        await prepare();
        const result = await mint();

        expect(result.inviteToken).toMatch(/^[0-9a-f]{64}$/);
        const stored = mockStore.get(PATH());
        expect(stored.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(stored)).not.toContain(result.inviteToken);
    });

    it('marks the application sent, and dates the link independently of the draft', async () => {
        await prepare();
        await mint();

        const stored = mockStore.get(PATH());
        expect(stored.status).toBe('sent');
        expect(stored.inviteTokenExpiresAt).toBeInstanceOf(Date);
        // Shorter than the draft's own 30-day retention, always.
        expect(stored.inviteTokenExpiresAt.getTime()).toBeLessThan(stored.expiresAt.getTime());
    });

    it('keeps the previous link alive through one regeneration', async () => {
        await prepare();
        const first = await mint();
        const second = await mint();

        expect(second.inviteToken).not.toBe(first.inviteToken);
        setInviteExpiry(60000);
        await expect(exchange(first.inviteToken)).resolves.toMatchObject({ opened: true });
        await expect(exchange(second.inviteToken)).resolves.toMatchObject({ opened: true });
    });

    it('does not walk back the driver having taken it over', async () => {
        await prepare();
        mockStore.set(PATH(), { ...mockStore.get(PATH()), status: 'driver_in_progress' });

        await mint();
        expect(mockStore.get(PATH()).status).toBe('driver_in_progress');
    });

    it('requires company access, and refuses for a draft the driver authored', async () => {
        await prepare();
        mockAssertCompanyAccess.mockRejectedValueOnce(
            Object.assign(new Error('denied'), { code: 'permission-denied' }),
        );
        await expect(mint()).rejects.toThrow();

        resetDraftState();
        await saveFirstPage();
        await expect(mint()).rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('opening a link', () => {
    it('hands back the prepared answers, the locked employers and a resume token', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);

        const result = await exchange(inviteToken);

        expect(result.opened).toBe(true);
        expect(result.applicantKey).toBe(keyFor());
        expect(result.formData.cdlNumber).toBe('TX1234567');
        expect(result.lockedEmployers).toHaveLength(1);
        expect(result.resumeToken).toMatch(/^[0-9a-f]{64}$/);
        expect(result.preparedBy).toBe('Rae Recruiter');
    });

    it('lets the driver save immediately afterwards, which is the point of the token', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);
        const { resumeToken } = await exchange(inviteToken);

        const saved = await saveFirstPage({ resumeToken, formData: { firstName: 'Dana', lastStep: 2 } });

        expect(saved.saved).toBe(true);
        expect(mockStore.get(PATH()).status).toBe('driver_in_progress');
    });

    it('records that the link was opened when the driver first saves through it, once', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);

        const { resumeToken } = await exchange(inviteToken);

        // Opening alone is deliberately NOT the fact (moved 2026-09-08). The
        // carrier holds this link too, and stamping the claim on the exchange let
        // it arm locked-employer enforcement for a driver who had never been shown
        // the rows — the exact refusal the field exists to prevent.
        expect(mockStore.get(PATH()).inviteClaimedAt).toBeUndefined();

        await saveFirstPage({ resumeToken });
        const firstClaim = mockStore.get(PATH()).inviteClaimedAt;
        expect(firstClaim).toBeTruthy();

        // Kept, not restamped: submission reads it to know the driver saw the
        // carrier's employers, and saving again is not a new fact.
        await saveFirstPage({ resumeToken, lastStep: 2 });
        expect(mockStore.get(PATH()).inviteClaimedAt).toBe(firstClaim);
    });

    it('heals a lock the carrier orphaned before the driver can be blocked by it', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);
        // A draft written before `prepare.js` reconciled: the lock is there and the
        // row it names is not. Enforcement reads the DRAFT at submission, so left
        // alone this refuses the driver's application for an employer nobody ever
        // showed them, and the carrier cannot fix it — it may not write to the
        // draft once the driver has started.
        const before = mockStore.get(PATH());
        mockStore.set(PATH(), { ...before, formData: { ...before.formData, employers: [] } });

        const opened = await exchange(inviteToken);

        // Healed in the same transaction that hands the application over, which is
        // the last moment the rows are provably the carrier's — reconciling any
        // later would make "delete the row" mean "delete the lock", which is the
        // whole thing the lock prevents.
        expect(opened.lockedEmployers).toEqual([]);
        expect(mockStore.get(PATH()).lockedEmployers).toEqual([]);
    });

    it('leaves a lock alone when its row is still on the application', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);

        const opened = await exchange(inviteToken);

        expect(opened.lockedEmployers).toHaveLength(1);
        expect(mockStore.get(PATH()).lockedEmployers).toHaveLength(1);
    });

    it('finds the draft even when the link carries no key', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);

        await expect(exchange(inviteToken, { applicantKey: null })).resolves.toMatchObject({ opened: true });
    });

    it.each([
        ['a token that names nothing', 'f'.repeat(64)],
        ['an empty-ish token', 'x'],
    ])('refuses %s with the same answer', async (_label, badToken) => {
        await prepare();
        await mint();
        setInviteExpiry(60000);

        await expect(exchange(badToken)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('refuses an expired link, indistinguishably from a wrong one', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(-60000);

        const expired = await exchange(inviteToken).catch((error) => error);
        const wrong = await exchange('f'.repeat(64)).catch((error) => error);

        expect(expired.code).toBe('not-found');
        expect(expired.message).toBe(wrong.message);
    });

    it('refuses a link for a draft that has since been discarded', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);
        mockStore.delete(PATH());

        await expect(exchange(inviteToken)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('rate-limits the exchange fail-closed, per caller', async () => {
        await prepare();
        const { inviteToken } = await mint();
        mockCheckRateLimit.mockResolvedValueOnce(false);

        await expect(exchange(inviteToken)).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
            `invite_exchange_${CONTEXT.rawRequest.ip}`, expect.any(Number), expect.any(Number), 'closed',
        );
    });

    it('refuses when the carrier is no longer accepting applications', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);
        mockAssertIntake.mockRejectedValueOnce(
            Object.assign(new Error('closed'), { code: 'permission-denied' }),
        );

        await expect(exchange(inviteToken)).rejects.toThrow();
    });

    it('never returns a token hash or the identity HMAC', async () => {
        await prepare();
        const { inviteToken } = await mint();
        setInviteExpiry(60000);
        mockStore.set(PATH(), { ...mockStore.get(PATH()), identityKey: 'secret-hmac' });

        const serialized = JSON.stringify(await exchange(inviteToken));
        expect(serialized).not.toContain('secret-hmac');
        expect(serialized).not.toContain(mockStore.get(PATH()).inviteTokenHash);
    });
});
