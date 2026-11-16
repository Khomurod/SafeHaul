/**
 * One page-load sequence for production and for the browser suites.
 *
 * E2E mode differs only in where the company comes from — the fixture profile,
 * never Firestore — and in the `e2eIntake` switch that lets a suite skip the
 * intake chooser. Everything else is the same code, so what a browser test sees
 * is what production does. That includes the protection the E2E copy once
 * lacked: a draft discarded in another tab while this page was loading does not
 * come back on screen. Each case below runs in both modes.
 *
 * The full component under the same race, in production mode, is pinned by
 * `PublicApplyHandler.discardTabs.contract.test.jsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ e2e: false, e2eIntake: null }));
const profileMocks = vi.hoisted(() => ({ fetchPublicProfileBySlug: vi.fn() }));
const serviceMocks = vi.hoisted(() => ({
    exchangeApplicationInvite: vi.fn(),
    readResumeToken: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({ readApplicationDraft: vi.fn() }));

vi.mock('../../services/applicationDraftService', () => serviceMocks);
vi.mock('../../services/publicProfileService', () => profileMocks);
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('@lib/runtime/e2eMode', () => ({
    // Read on every access, so one file can run the sequence in both modes.
    get isE2ETestMode() { return mode.e2e; },
    getE2EQueryParam: (name, fallback) => (name === 'e2eIntake' && mode.e2eIntake) || fallback,
}));
vi.mock('./applicationDraftStorage', () => ({
    readApplicationDraft: (...args) => storageMocks.readApplicationDraft(...args),
}));

import { loadPublicApplyCompany } from './publicApplyBootstrap';

const STORED_DRAFT = {
    data: { firstName: 'Ada', cdlNumber: 'STORED-1' },
    lastStep: 3,
    meta: { draftId: 'draft-a' },
};

function harness({ slug = 'blue-line', loadGeneration = 0, resetGeneration = 0, discarded = false } = {}) {
    const state = { formData: {}, step: 0, intakeMode: null, error: null, loading: true, company: null };
    return {
        state,
        args: {
            slug,
            sandbox: false,
            searchParams: new URLSearchParams(''),
            loadGeneration,
            resetGenerationRef: { current: resetGeneration },
            restoredFromDraftRef: { current: false },
            draftIdRef: { current: null },
            discardedElsewhere: () => discarded,
            restorePostApplySession: vi.fn(),
            adoptResumeToken: vi.fn(),
            setInviteOutcome: vi.fn(),
            setError: (value) => { state.error = value; },
            setLoading: (value) => { state.loading = value; },
            setCompany: (value) => { state.company = value; },
            setFormData: (updater) => {
                state.formData = typeof updater === 'function' ? updater(state.formData) : updater;
            },
            setCurrentStep: (value) => { state.step = value; },
            setIntakeMode: (value) => { state.intakeMode = value; },
        },
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    mode.e2e = false;
    mode.e2eIntake = null;
    sessionStorage.clear();
    profileMocks.fetchPublicProfileBySlug.mockResolvedValue({
        id: 'co-1', companyName: 'Blue Line Freight', appSlug: 'blue-line',
    });
    serviceMocks.readResumeToken.mockReturnValue(null);
    storageMocks.readApplicationDraft.mockReturnValue(STORED_DRAFT);
});

describe.each([
    ['production', false],
    ['E2E mode', true],
])('the page load, %s', (_label, e2e) => {
    beforeEach(() => {
        mode.e2e = e2e;
        // A suite asking for the chooser, so the restore alone decides the screen.
        mode.e2eIntake = 'choice';
    });

    it('restores a stored draft and the step it reached', async () => {
        const { state, args } = harness();

        await loadPublicApplyCompany(args);

        expect(state.formData).toMatchObject({ firstName: 'Ada', cdlNumber: 'STORED-1' });
        expect(state.step).toBe(3);
        expect(state.intakeMode).toBe('manual');
        expect(args.restoredFromDraftRef.current).toBe(true);
        expect(args.draftIdRef.current).toBe('draft-a');
        expect(state.loading).toBe(false);
    });

    it('does not restore a draft whose discard arrived while the page was loading', async () => {
        // The event was delivered and its reaction adopted the mark, so only the
        // reset counter still remembers: it moved after this load captured it.
        const { state, args } = harness({ loadGeneration: 0, resetGeneration: 1 });

        await loadPublicApplyCompany(args);

        expect(state.formData.cdlNumber).toBeUndefined();
        expect(state.step).toBe(0);
        expect(state.intakeMode).toBeNull();
        expect(args.restoredFromDraftRef.current).toBe(false);
        expect(args.draftIdRef.current).toBeNull();
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
    });

    it('does not restore a draft discarded before this tab could hear of it', async () => {
        // No event, so the counter never moved; the mark in storage is no longer
        // the one this tab loaded with.
        const { state, args } = harness({ discarded: true });

        await loadPublicApplyCompany(args);

        expect(state.formData.cdlNumber).toBeUndefined();
        expect(state.step).toBe(0);
        expect(args.restoredFromDraftRef.current).toBe(false);
        expect(args.draftIdRef.current).toBeNull();
        expect(state.loading).toBe(false);
    });

    it('records the company the application is for', async () => {
        const { args } = harness();

        await loadPublicApplyCompany(args);

        expect(sessionStorage.getItem('pending_application_company')).toBe(e2e ? 'e2e-company' : 'co-1');
    });
});

describe('where the company comes from', () => {
    it('production reads the public profile', async () => {
        const { state, args } = harness();

        await loadPublicApplyCompany(args);

        expect(profileMocks.fetchPublicProfileBySlug).toHaveBeenCalledWith('blue-line');
        expect(state.company).toMatchObject({ id: 'co-1', companyName: 'Blue Line Freight' });
    });

    it('production reports a company it cannot find, and restores nothing', async () => {
        profileMocks.fetchPublicProfileBySlug.mockResolvedValue(null);
        const { state, args } = harness();

        await loadPublicApplyCompany(args);

        expect(state.error).toBe('Company not found.');
        expect(state.formData.cdlNumber).toBeUndefined();
        expect(state.loading).toBe(false);
    });

    it('E2E mode uses the fixture profile and never reads Firestore', async () => {
        mode.e2e = true;
        const { state, args } = harness({ slug: 'e2e-company' });

        await loadPublicApplyCompany(args);

        expect(profileMocks.fetchPublicProfileBySlug).not.toHaveBeenCalled();
        expect(state.company).toMatchObject({ id: 'e2e-company', appSlug: 'e2e-company' });
    });
});

describe('the intake chooser on a first visit', () => {
    beforeEach(() => {
        storageMocks.readApplicationDraft.mockReturnValue(null);
    });

    it('production offers it', async () => {
        const { state, args } = harness();

        await loadPublicApplyCompany(args);

        expect(state.intakeMode).toBeNull();
    });

    it('E2E mode skips it by default', async () => {
        mode.e2e = true;
        const { state, args } = harness({ slug: 'e2e-company' });

        await loadPublicApplyCompany(args);

        expect(state.intakeMode).toBe('manual');
    });

    it('E2E mode offers it when the suite asks with e2eIntake=choice', async () => {
        mode.e2e = true;
        mode.e2eIntake = 'choice';
        const { state, args } = harness({ slug: 'e2e-company' });

        await loadPublicApplyCompany(args);

        expect(state.intakeMode).toBeNull();
    });
});
