/**
 * When a link dies, and what a regeneration does to the one it replaced.
 *
 * ## The defect this file exists for
 *
 * Found 2026-09-08. Validity was modelled per DOCUMENT while matching was
 * modelled per GENERATION: `inviteNamesDraft` accepted the current hash or any
 * prior hash, `inviteStillValid` read one document-level `inviteTokenExpiresAt`,
 * and the mint rewrote that field unconditionally. Composing the two
 * independently meant an expired token could ride on a newer token's expiry —
 * so "Create a new link" did not retire the old link, it **revived** it, for a
 * further fourteen days, even when it had been dead for a week.
 *
 * `companyApplications.invite.test.js` could not see it: it calls
 * `setInviteExpiry` *after* both mints, which forces a live expiry and makes the
 * reset invisible. The sequence that matters is expire → regenerate → present
 * the old token, and it is the first case below.
 *
 * ## Two things worth knowing before editing this file
 *
 * The test double stores exactly what was written, so a stored expiry is a plain
 * `Date` here while a real deployment reads back a Firestore `Timestamp` with
 * `toDate()`. `expiryMillis` reads both on purpose. A scan that read only the
 * Timestamp shape would measure every freshly minted link as invalid, and this
 * whole file would pass for the wrong reason — which is why `stampExpiry` below
 * writes the Timestamp shape explicitly wherever the point is the expiry itself.
 *
 * The clock is moved with `Date.now`, not with real waiting, and only around the
 * exchange — the Firestore double timestamps its own writes from the same clock.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, mockCheckRateLimit, mockAssertIntake,
    COMPANY, CONTEXT, IDENTITY, keyFor, resetDraftState,
} = require('./applicationDrafts.support');

/** The grace a replaced link keeps, and the window a fresh one gets. */
const GRACE_MS = 10 * 60 * 1000;
const INVITE_MS = 14 * 24 * 60 * 60 * 1000;

const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };
const PATH = () => `companies/${COMPANY}/application_drafts/${keyFor()}`;

function api() {
    return require('../../companyApplications');
}

function invitePrivate() {
    return require('../../companyApplications/invite').__private;
}

async function prepare() {
    return api().saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Dana', lastName: 'Alvarez', cdlNumber: 'TX1234567' },
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

/**
 * Move the CURRENT link's expiry, in the shape a real read returns.
 *
 * Only the current generation's expiry lives on the document; a prior
 * generation carries its own, which is the whole point of the change.
 */
function stampExpiry(msFromNow) {
    const at = new Date(Date.now() + msFromNow);
    mockStore.set(PATH(), { ...mockStore.get(PATH()), inviteTokenExpiresAt: { toDate: () => at } });
}

/** Run one thing with the clock moved forward. */
async function afterMoving(ms, run) {
    const real = Date.now;
    const base = real();
    Date.now = () => base + ms;
    try {
        return await run();
    } finally {
        Date.now = real;
    }
}

beforeEach(() => {
    // `resetDraftState` uses `clearAllMocks`, which does NOT drain a `*Once`
    // queue (AGENTS.md rule 6) — and this file queues two. `mockReset` drains it,
    // at the cost of the implementation, which `resetDraftState` then puts back:
    // the order of these three lines is load-bearing, not stylistic.
    mockCheckRateLimit.mockReset();
    mockAssertIntake.mockReset();
    resetDraftState();
});

describe('a regeneration retires the link it replaced', () => {
    it('does not revive one that had already expired', async () => {
        await prepare();
        const first = await mint();
        stampExpiry(-60000);
        await expect(exchange(first.inviteToken)).rejects.toMatchObject({ code: 'not-found' });

        // "Create a new link", a minute after the old one died.
        const second = await mint();
        stampExpiry(INVITE_MS);

        // The dead link stays dead. Before the fix it opened again, with a fresh
        // resume token, for another fourteen days.
        await expect(exchange(first.inviteToken)).rejects.toMatchObject({ code: 'not-found' });
        await expect(exchange(second.inviteToken)).resolves.toMatchObject({ opened: true });
    });

    it('does not carry a dead link forward at all', async () => {
        await prepare();
        const first = await mint();
        stampExpiry(-60000);
        await mint();

        const carried = mockStore.get(PATH()).priorInvites || [];
        const hashOfFirst = invitePrivate().hashInvite(first.inviteToken);
        expect(carried.map((entry) => entry.hash)).not.toContain(hashOfFirst);
    });

    it('keeps a live one working for a bounded grace, then stops', async () => {
        await prepare();
        const first = await mint();
        const second = await mint();

        // Inside the grace, so an open tab is not cut off mid-page.
        await expect(exchange(first.inviteToken)).resolves.toMatchObject({ opened: true });
        await expect(exchange(second.inviteToken)).resolves.toMatchObject({ opened: true });

        await afterMoving(GRACE_MS + 60000, async () => {
            await expect(exchange(first.inviteToken)).rejects.toMatchObject({ code: 'not-found' });
            // The current link is untouched by the grace expiring.
            await expect(exchange(second.inviteToken)).resolves.toMatchObject({ opened: true });
        });
    });

    it('never extends a replaced link beyond its own expiry', async () => {
        await prepare();
        const first = await mint();
        // Two minutes left — less than the grace, so the grace must not lengthen it.
        stampExpiry(2 * 60 * 1000);
        await mint();

        await afterMoving(5 * 60 * 1000, async () => {
            await expect(exchange(first.inviteToken)).rejects.toMatchObject({ code: 'not-found' });
        });
    });

    it('retires the generation before last, so at most two links are ever live', async () => {
        await prepare();
        const first = await mint();
        const second = await mint();
        const third = await mint();

        await expect(exchange(first.inviteToken)).rejects.toMatchObject({ code: 'not-found' });
        await expect(exchange(second.inviteToken)).resolves.toMatchObject({ opened: true });
        await expect(exchange(third.inviteToken)).resolves.toMatchObject({ opened: true });
    });

    it('treats a legacy prior hash, which never had an expiry of its own, as dead', async () => {
        await prepare();
        const legacy = await mint();
        await mint();

        // What older deployments wrote: bare strings, validated against whatever
        // the document-level expiry happened to say.
        mockStore.set(PATH(), {
            ...mockStore.get(PATH()),
            priorInvites: [],
            priorInviteTokenHashes: [invitePrivate().hashInvite(legacy.inviteToken)],
        });
        stampExpiry(INVITE_MS);

        await expect(exchange(legacy.inviteToken)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('states the grace and the window it belongs to', () => {
        expect(invitePrivate().INVITE_GRACE_MS).toBe(GRACE_MS);
        expect(invitePrivate().MAX_PRIOR_INVITE_HASHES).toBe(1);
    });
});

describe('minting is guarded like every other prepared-application callable', () => {
    it('is rate-limited fail-closed, per company and caller', async () => {
        await prepare();
        mockCheckRateLimit.mockResolvedValueOnce(false);

        await expect(mint()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
            `company_invite_${COMPANY}_${REQUEST.auth.uid}`,
            expect.any(Number), expect.any(Number), 'closed',
        );
    });

    it('refuses when the carrier has stopped accepting applications', async () => {
        await prepare();
        mockAssertIntake.mockRejectedValueOnce(
            Object.assign(new Error('closed'), { code: 'failed-precondition' }),
        );

        await expect(mint()).rejects.toThrow();
    });
});
