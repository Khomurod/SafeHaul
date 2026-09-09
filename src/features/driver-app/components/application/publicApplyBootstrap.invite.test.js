/**
 * The link a carrier sends, opened by the driver's browser.
 *
 * `loadPublicApplyCompany` takes every dependency as a parameter, so this drives
 * the real branch with fakes rather than mounting the whole wizard. What is pinned
 * is the order and the consequences:
 *
 *  - a prepared application beats whatever this browser had lying around, because
 *    the driver clicked the link their carrier sent;
 *  - the resume token that comes back is adopted before anything else can fail —
 *    without it the driver's own autosave is refused, since a carrier-prepared
 *    draft carries no identity HMAC;
 *  - the exchange runs BEFORE the post-apply session restore, and a successful one
 *    clears that session — which is what stops a 24-hour-old confirmation screen
 *    for this carrier hiding a live invitation (found 2026-09-08);
 *  - a failed exchange touches none of that, so a driver who re-clicks their own
 *    dead link after submitting keeps their confirmation number and checklist;
 *  - a link the driver has already started returns no token and no answers, and
 *    nothing may be adopted from it.
 *
 * The reconciliation gate that stops this racing the server-draft restore lives in
 * `PublicApplyHandler`, and `publicApplyInvite.test.js` covers the outcome mapping
 * and the foreign-slot decision on their own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    exchangeApplicationInvite: vi.fn(),
    readResumeToken: vi.fn(() => null),
}));
const storageMocks = vi.hoisted(() => ({ readApplicationDraft: vi.fn(() => null) }));

vi.mock('../../services/applicationDraftService', () => serviceMocks);
vi.mock('../../services/publicProfileService', () => ({
    fetchPublicProfileBySlug: vi.fn(async () => ({ id: 'co-1', companyName: 'Blue Line Freight', appSlug: 'blue-line' })),
}));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('./applicationDraftStorage', () => ({
    readApplicationDraft: (...args) => storageMocks.readApplicationDraft(...args),
}));

import { loadPublicApplyCompany } from './publicApplyBootstrap';

const PREPARED = {
    opened: true,
    requiresIdentity: false,
    applicantKey: 'applicant-key-1',
    resumeToken: 'resume-token-1',
    formData: { firstName: 'Dana', lastName: 'Alvarez', cdlNumber: 'TX1234567' },
    lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
    preparedBy: 'Rae Recruiter',
};

/** A callable rejection, in the shape the service now lets through. */
function callableError(code) {
    return Object.assign(new Error('nope'), { code });
}

/** A finished application's session, as the previous applicant left it in this tab. */
function seedFinishedSession() {
    sessionStorage.setItem('lastConfirmationNumber', 'SH-OLD-1');
    sessionStorage.setItem('sh_post_apply_co-1', JSON.stringify({
        applicationId: 'app-old', confirmationNumber: 'SH-OLD-1', slug: 'blue-line',
        docs: {}, savedAt: Date.now(),
    }));
}

function harness(params = {}) {
    const state = {
        formData: { email: '' }, step: null, intakeMode: null, error: null, loading: true, invite: null,
    };
    return {
        state,
        args: {
            slug: 'blue-line',
            sandbox: false,
            searchParams: new URLSearchParams(params.query || ''),
            loadGeneration: 0,
            resetGenerationRef: { current: 0 },
            restoredFromDraftRef: { current: false },
            draftIdRef: { current: null },
            discardedElsewhere: () => false,
            restorePostApplySession: vi.fn(),
            adoptResumeToken: vi.fn(),
            setInviteOutcome: (value) => { state.invite = value; },
            setCurrentCompanyProfile: vi.fn(),
            setError: (value) => { state.error = value; },
            setLoading: (value) => { state.loading = value; },
            setCompany: vi.fn(),
            setFormData: (updater) => {
                state.formData = typeof updater === 'function' ? updater(state.formData) : updater;
            },
            setCurrentStep: (value) => { state.step = value; },
            setIntakeMode: (value) => { state.intakeMode = value; },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    storageMocks.readApplicationDraft.mockReturnValue(null);
    serviceMocks.readResumeToken.mockReturnValue(null);
    serviceMocks.exchangeApplicationInvite.mockResolvedValue(PREPARED);
});

describe('opening an application a carrier prepared', () => {
    it('exchanges the link for the prepared answers and shows them', async () => {
        const { state, args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        expect(serviceMocks.exchangeApplicationInvite).toHaveBeenCalledWith({
            companyId: 'co-1', applicantKey: 'applicant-key-1', inviteToken: 'abc123',
        });
        expect(state.formData.cdlNumber).toBe('TX1234567');
        expect(state.formData.lockedEmployers).toHaveLength(1);
        expect(state.intakeMode).toBe('manual');
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
        expect(state.invite).toMatchObject({ status: 'opened', applicantKey: 'applicant-key-1' });
    });

    it('sets the company before it returns, which is what the wizard renders from', async () => {
        const { args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        // The invite branch returns straight out of `loadPublicApplyCompany`, so a
        // company set *after* it is a company never set at all — and the wizard
        // dereferences `company.companyName` on the very next render. Every real
        // carrier-sent link opened on nothing; the E2E branch happens to set the
        // company before calling the helper, which is why no browser test saw it.
        expect(args.setCompany).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'co-1', companyName: 'Blue Line Freight' }),
        );
        expect(args.setCurrentCompanyProfile).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'co-1' }),
        );
    });

    it('adopts the resume token through the hook, which authorizes the driver to save', async () => {
        const { args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        // Through the hook rather than `writeResumeToken`: writing the shared slot
        // directly left the ownership refs unset, and this path worked only because
        // the resume lookup happened to re-read the slot and find the token.
        expect(args.adoptResumeToken).toHaveBeenCalledWith({
            resumeToken: 'resume-token-1', applicantKey: 'applicant-key-1',
        });
        expect(args.restoredFromDraftRef.current).toBe(true);
        expect(args.draftIdRef.current).toBe('applicant-key-1');
    });

    it('works when the link carries no applicant key', async () => {
        const { args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        expect(serviceMocks.exchangeApplicationInvite).toHaveBeenCalledWith(
            expect.objectContaining({ applicantKey: null, inviteToken: 'abc123' }),
        );
    });

    it("prefers the carrier's prepared application over this browser's own leftovers", async () => {
        storageMocks.readApplicationDraft.mockReturnValue({
            data: { firstName: 'Half-finished', cdlNumber: 'OLD-1' },
            lastStep: 4,
            meta: { draftId: 'local-draft' },
        });
        const { state, args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        expect(state.formData.cdlNumber).toBe('TX1234567');
        expect(state.formData.firstName).toBe('Dana');
        expect(args.draftIdRef.current).toBe('applicant-key-1');
    });

    it('reports which applicant this browser was already holding', async () => {
        // The slot belongs to somebody else, so the reconciliation must not merge
        // this browser's local draft into the carrier's prepared application.
        serviceMocks.readResumeToken.mockReturnValue({
            resumeToken: 'someone-elses', applicantKey: 'other-applicant',
        });
        const { state, args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        expect(state.invite.foreignSlot).toBe(true);
    });

    it("leaves the local draft alone when the slot is the invited driver's own", async () => {
        serviceMocks.readResumeToken.mockReturnValue({
            resumeToken: 'their-own', applicantKey: 'applicant-key-1',
        });
        const { state, args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        expect(state.invite.foreignSlot).toBe(false);
    });

    it('adopts nothing when the driver has already taken the application over', async () => {
        // After takeover the exchange returns `requiresIdentity` and withholds both
        // the answers and the resume token, so the carrier holding this link cannot
        // read or rewrite what the driver wrote. The browser must not treat that as
        // an opened application: adopting `resumeToken: undefined` would destroy the
        // credential the driver's own tab saves with.
        serviceMocks.exchangeApplicationInvite.mockResolvedValue({
            opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1',
        });
        // The slot proves these leftovers are the invited driver's own, so they stay
        // on screen rather than being blanked by an empty `formData` — and the case
        // below is what happens when nothing proves it.
        serviceMocks.readResumeToken.mockReturnValue({
            resumeToken: 'their-own', applicantKey: 'applicant-key-1',
        });
        storageMocks.readApplicationDraft.mockReturnValue({
            data: { firstName: 'Dana', cdlNumber: 'DRIVERS-OWN' },
            lastStep: 4,
            meta: { draftId: 'local-draft' },
        });
        const { state, args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        expect(args.adoptResumeToken).not.toHaveBeenCalled();
        expect(state.invite).toMatchObject({ status: 'requires_identity', foreignSlot: false });
        expect(state.formData.cdlNumber).toBe('DRIVERS-OWN');
        expect(state.loading).toBe(false);
    });

    /**
     * Review found this on 2026-09-09, and it is the foreign-slot rule reaching one
     * step further than it did.
     *
     * `requires_identity` used to fall through to the local-draft restore
     * unconditionally, so a shared or kiosk browser loaded the PREVIOUS applicant's
     * answers into `formData` — behind the confirmation screen, where the driver
     * cannot see them. They do not stay invisible: `adoptOpenedApplication` merges
     * the real answers over `prev` and every key the target application does not
     * itself hold survives, so the next autosave writes a stranger's employer rows
     * and upload descriptors onto this driver's DOT application. The reconciliation
     * effect already withheld the same slot for the same reason; this is the other
     * reader of it.
     *
     * The cost is stated where the OPENED path states it: an unclaimed slot loses
     * its LOCAL backup of this slug. Their server copy is untouched, the link names
     * it, and confirming returns it — while the driver whose own device holds the
     * token for this application (the case above) is asked nothing at all.
     */
    it('withholds leftovers the slot cannot prove belong to the invited driver', async () => {
        serviceMocks.exchangeApplicationInvite.mockResolvedValue({
            opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1',
        });
        serviceMocks.readResumeToken.mockReturnValue({
            resumeToken: 'someone-elses', applicantKey: 'other-applicant',
        });
        storageMocks.readApplicationDraft.mockReturnValue({
            data: { firstName: 'Marcus', cdlNumber: 'SOMEONE-ELSES' },
            lastStep: 4,
            meta: { draftId: 'local-draft' },
        });
        const { state, args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        expect(state.invite).toMatchObject({ status: 'requires_identity', foreignSlot: true });
        expect(state.formData.cdlNumber).toBeUndefined();
        expect(state.formData.firstName).toBeUndefined();
        // And this tab has not taken that draft on, so a discard elsewhere is not
        // its business and a submission from here cannot close out its record.
        expect(args.restoredFromDraftRef.current).toBe(false);
        expect(args.draftIdRef.current).toBeNull();
        expect(state.loading).toBe(false);
    });

    it('withholds them when the slot is unclaimed, because a link names one applicant', async () => {
        // No token at all: nothing says these leftovers are the invited driver's,
        // and a link was followed — the same reading the opened path already takes.
        serviceMocks.exchangeApplicationInvite.mockResolvedValue({
            opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1',
        });
        storageMocks.readApplicationDraft.mockReturnValue({
            data: { cdlNumber: 'UNPROVEN' }, lastStep: 4, meta: { draftId: 'local-draft' },
        });
        const { state, args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        expect(state.formData.cdlNumber).toBeUndefined();
    });

    it('does not exchange anything when no link was followed', async () => {
        const { state, args } = harness();

        await loadPublicApplyCompany(args);

        expect(serviceMocks.exchangeApplicationInvite).not.toHaveBeenCalled();
        expect(state.invite).toEqual({ status: 'absent' });
    });
});

describe('a link that could not be opened', () => {
    it.each([
        ['a wrong or expired one', 'functions/not-found', 'unopenable'],
        ['a malformed request', 'functions/invalid-argument', 'invalid'],
        ['too many attempts', 'functions/resource-exhausted', 'throttled'],
        ['a carrier no longer accepting', 'functions/failed-precondition', 'closed'],
        ['a temporary outage', 'functions/unavailable', 'unavailable'],
        ['an offline reject', undefined, 'unavailable'],
    ])('reports %s as %s, and adopts nothing', async (_label, code, status) => {
        serviceMocks.exchangeApplicationInvite.mockRejectedValue(callableError(code));
        const { state, args } = harness({ query: 'invite=stale' });

        await loadPublicApplyCompany(args);

        expect(state.invite.status).toBe(status);
        expect(args.adoptResumeToken).not.toHaveBeenCalled();
        // The ordinary load still finishes underneath, so "start a fresh
        // application instead" is one click rather than a second load path.
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
        expect(state.formData.cdlNumber).toBeUndefined();
    });
});

describe('a finished application and a live invitation in the same tab', () => {
    it("lets the invitation retire the previous applicant's confirmation", async () => {
        seedFinishedSession();
        const { args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        // Not restored — it used to run BEFORE the exchange and set
        // `submissionStatus = 'success'`, which renders above the wizard, so the
        // invitation's answers loaded into state behind a stale success screen.
        expect(args.restorePostApplySession).not.toHaveBeenCalled();
        // And cleared, not merely skipped: left in place, a later reload of the
        // bare apply page in this tab brings that screen back over the invited
        // driver's half-typed application.
        expect(sessionStorage.getItem('sh_post_apply_co-1')).toBeNull();
        expect(sessionStorage.getItem('lastConfirmationNumber')).toBeNull();
    });

    /**
     * The second route to the reported symptom, found in review on 2026-09-09.
     *
     * A live invitation waiting on "Confirm it's you" used to fall through to the
     * post-apply restore, which sets `submissionStatus = 'success'` — and success
     * renders ABOVE the confirmation screen. So a driver who submitted an
     * application to this carrier in this tab within the last 24 hours, and then
     * opened a continuation link for a DIFFERENT unfinished one, saw the old
     * confirmation screen and no question at all: the intake chooser bug wearing a
     * different mask, and permanent, because the session is rewritten on every
     * load.
     *
     * Retired here rather than reordered on the screen: the exchange resolved a
     * LIVE draft, and a submission deletes the draft the invite hash lives on, so
     * the application this link names provably has not been submitted.
     */
    it('retires it for an invitation that is only waiting on identity', async () => {
        seedFinishedSession();
        serviceMocks.exchangeApplicationInvite.mockResolvedValue({
            opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1',
        });
        const { state, args } = harness({ query: 'invite=abc123&k=applicant-key-1' });

        await loadPublicApplyCompany(args);

        expect(state.invite).toMatchObject({ status: 'requires_identity' });
        expect(args.restorePostApplySession).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('sh_post_apply_co-1')).toBeNull();
        expect(sessionStorage.getItem('lastConfirmationNumber')).toBeNull();
    });

    it('leaves a submitted application alone when the link is dead', async () => {
        // The one thing an applicant cannot get back. A submission deletes the
        // draft and the invite hash lives on it, so a link that still opens proves
        // the application it opens was not submitted — and one that does not open
        // proves nothing at all, so it may take nothing away.
        seedFinishedSession();
        serviceMocks.exchangeApplicationInvite.mockRejectedValue(callableError('functions/not-found'));
        const { args } = harness({ query: 'invite=dead' });

        await loadPublicApplyCompany(args);

        expect(args.restorePostApplySession).toHaveBeenCalled();
        expect(sessionStorage.getItem('sh_post_apply_co-1')).not.toBeNull();
        expect(sessionStorage.getItem('lastConfirmationNumber')).toBe('SH-OLD-1');
    });
});
