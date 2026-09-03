/**
 * The link a carrier sends, opened by the driver's browser.
 *
 * `loadPublicApplyCompany` takes every dependency as a parameter, so this drives
 * the real branch with fakes rather than mounting the whole wizard. What is pinned
 * is the order and the consequences:
 *
 *  - a prepared application beats whatever this browser had lying around, because
 *    the driver clicked the link their carrier sent;
 *  - the resume token that comes back is stored before anything else can fail —
 *    without it the driver's own autosave is refused, since a carrier-prepared
 *    draft carries no identity HMAC;
 *  - a stale or wrong link is not an error: the driver gets the ordinary blank
 *    application and can still apply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    exchangeApplicationInvite: vi.fn(),
    writeResumeToken: vi.fn(),
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
    saveApplicationDraft: vi.fn(),
    draftSyncState: vi.fn(() => null),
    sameDraftData: vi.fn(() => true),
}));

import { loadPublicApplyCompany } from './publicApplyBootstrap';

const PREPARED = {
    opened: true,
    applicantKey: 'applicant-key-1',
    resumeToken: 'resume-token-1',
    formData: { firstName: 'Dana', lastName: 'Alvarez', cdlNumber: 'TX1234567' },
    lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
    preparedBy: 'Rae Recruiter',
};

function harness(params = {}) {
    const state = { formData: { email: '' }, step: null, intakeMode: null, error: null, loading: true };
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
    storageMocks.readApplicationDraft.mockReturnValue(null);
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

    it('stores the resume token, which is what authorizes the driver to save', async () => {
        const { args } = harness({ query: 'invite=abc123' });

        await loadPublicApplyCompany(args);

        expect(serviceMocks.writeResumeToken).toHaveBeenCalledWith('blue-line', {
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

    it('falls back to the ordinary application when the link no longer opens', async () => {
        serviceMocks.exchangeApplicationInvite.mockResolvedValue(null);
        const { state, args } = harness({ query: 'invite=stale' });

        await loadPublicApplyCompany(args);

        expect(serviceMocks.writeResumeToken).not.toHaveBeenCalled();
        expect(state.error).toBeNull();
        expect(state.loading).toBe(false);
        expect(state.formData.cdlNumber).toBeUndefined();
    });

    it('does not exchange anything when no link was followed', async () => {
        const { args } = harness();

        await loadPublicApplyCompany(args);

        expect(serviceMocks.exchangeApplicationInvite).not.toHaveBeenCalled();
    });
});
