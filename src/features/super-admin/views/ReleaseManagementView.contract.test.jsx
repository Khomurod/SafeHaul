/**
 * Contract and security proof for the Super Admin Release Management screen.
 *
 * The properties pinned here are the ones the feature exists to provide, and
 * every one of them is a real regression risk:
 *
 *  - there is NO field for typing a version. The screen cannot ask a human to
 *    name a commit, because a typed version could name something nobody tested;
 *  - the request that promotes carries no version the server acts on, and no
 *    credential of any kind;
 *  - the Release button is disabled unless the server says the release is
 *    eligible, so a screen that has not read a green state cannot start one;
 *  - an unfinished release explains itself in plain language instead of just
 *    being unavailable;
 *  - pressing Release never claims the release finished — the screen reports
 *    progress read back from the server;
 *  - a failed release says Production was not changed, and stays recoverable.
 *
 * All SHAs, versions and email addresses below are artificial fixtures.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = {};
const httpsCallable = vi.fn((_functions, name) => {
    if (!callables[name]) throw new Error(`Unexpected callable: ${name}`);
    return callables[name];
});

const showSuccess = vi.fn();
const showError = vi.fn();
const showInfo = vi.fn();

const reauthenticateWithCredential = vi.fn();

vi.mock('firebase/functions', () => ({ httpsCallable: (...args) => httpsCallable(...args) }));
vi.mock('@lib/firebase', () => ({
    functions: { __functions: true },
    auth: { currentUser: { email: 'ops@example.test', getIdToken: vi.fn().mockResolvedValue('token') } },
    db: {},
}));
vi.mock('firebase/auth', () => ({
    EmailAuthProvider: { credential: vi.fn(() => ({ __credential: true })) },
    reauthenticateWithCredential: (...args) => reauthenticateWithCredential(...args),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));

import { ReleaseManagementView } from './ReleaseManagementView';

// --- fixtures --------------------------------------------------------------

const SHA_TESTED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_LIVE = 'b1c2d3e4f5061728394a5b6c7d8e9f0123456789';
const SHA_OLDER = 'c1d2e3f4051627384950a1b2c3d4e5f601234567';

const eligibleStatus = () => ({
    configured: true,
    testing: {
        sha: SHA_TESTED,
        appVersionId: 'ver-app-101',
        createdAt: '2026-08-07T11:00:49Z',
        state: 'success',
        checksPassed: true,
        backendReleased: true,
        eligible: true,
        blockers: [],
    },
    production: {
        sha: SHA_LIVE,
        appVersionId: 'ver-app-900',
        createdAt: '2026-08-06T09:05:00Z',
        state: 'success',
    },
    previousProduction: {
        sha: SHA_OLDER,
        appVersionId: 'ver-app-899',
        createdAt: '2026-08-05T09:05:00Z',
        state: 'success',
    },
    activePromotion: null,
    latestPromotion: null,
    generatedAt: Date.now(),
});

const blockedStatus = () => ({
    ...eligibleStatus(),
    testing: {
        ...eligibleStatus().testing,
        backendReleased: false,
        eligible: false,
        blockers: [
            'The shared backend rollout for this release (Cloud Functions, Firestore rules, Storage rules and indexes) has not been confirmed successful yet.',
            'Still running: Deploy Cloud Functions.',
        ],
    },
});

let getReleaseStatus;
let promoteTestingToProduction;
let rollbackProductionRelease;

beforeEach(() => {
    getReleaseStatus = vi.fn().mockResolvedValue({ data: eligibleStatus() });
    promoteTestingToProduction = vi.fn().mockResolvedValue({ data: { status: 'dispatched', requestId: 'req-1', sha: SHA_TESTED } });
    rollbackProductionRelease = vi.fn().mockResolvedValue({ data: { status: 'dispatched', requestId: 'req-2', sha: SHA_OLDER } });

    callables.getReleaseStatus = getReleaseStatus;
    callables.promoteTestingToProduction = promoteTestingToProduction;
    callables.rollbackProductionRelease = rollbackProductionRelease;
});

afterEach(() => {
    vi.clearAllMocks();
});

const releaseButton = () => screen.getByRole('button', { name: /Release Testing version to Production/i });

// ---------------------------------------------------------------------------

describe('no version is ever typed', () => {
    it('renders no text input at all', async () => {
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
        expect(screen.queryByLabelText(/sha/i)).toBeNull();
        expect(screen.queryByPlaceholderText(/commit/i)).toBeNull();
    });

    it('shows the short version the system resolved, for both channels', async () => {
        render(<ReleaseManagementView />);

        expect(await screen.findByText(SHA_TESTED.slice(0, 7))).toBeTruthy();
        expect(screen.getByText(SHA_LIVE.slice(0, 7))).toBeTruthy();
    });
});

describe('eligibility gates the button', () => {
    it('enables Release when the server reports the release eligible', async () => {
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        expect(releaseButton()).not.toBeDisabled();
    });

    it('disables Release, and says why, while the backend rollout is unconfirmed', async () => {
        getReleaseStatus.mockResolvedValue({ data: blockedStatus() });
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        expect(releaseButton()).toBeDisabled();
        expect(screen.getByText(/shared backend rollout/i)).toBeTruthy();
        expect(screen.getByText(/Still running: Deploy Cloud Functions\./i)).toBeTruthy();
    });

    it('disables Release when Production already serves the tested version', async () => {
        const status = eligibleStatus();
        status.production = { ...status.production, sha: SHA_TESTED };
        getReleaseStatus.mockResolvedValue({ data: status });

        render(<ReleaseManagementView />);
        await screen.findByText(/already serving/i);

        expect(releaseButton()).toBeDisabled();
    });

    it('disables Release when the deployment credential is not configured', async () => {
        getReleaseStatus.mockResolvedValue({
            data: {
                configured: false,
                message: 'The release credential has not been configured for this environment.',
                testing: null, production: null, previousProduction: null,
                activePromotion: null, latestPromotion: null,
            },
        });

        render(<ReleaseManagementView />);
        await screen.findByText(/not connected to the deployment pipeline/i);

        expect(releaseButton()).toBeDisabled();
    });
});

describe('confirmation and dispatch', () => {
    it('confirms with the real versions before releasing anything', async () => {
        const user = userEvent.setup();
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(releaseButton());

        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain(SHA_TESTED.slice(0, 7));
        expect(dialog.textContent).toContain(SHA_LIVE.slice(0, 7));
        expect(dialog.textContent).toMatch(/Production application for all end users|updates the SafeHaul Production/i);

        // Nothing has been dispatched by merely opening the dialog.
        expect(promoteTestingToProduction).not.toHaveBeenCalled();
    });

    it('cancelling releases nothing', async () => {
        const user = userEvent.setup();
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /^Cancel$/i }));

        expect(promoteTestingToProduction).not.toHaveBeenCalled();
    });

    it('sends no credential and no version the server would act on', async () => {
        const user = userEvent.setup();
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /Release to Production/i }));

        await waitFor(() => expect(promoteTestingToProduction).toHaveBeenCalledTimes(1));

        const payload = promoteTestingToProduction.mock.calls[0][0];
        // `expectedSha` is a staleness check, not an instruction: the server
        // compares it against what it resolved and refuses on a mismatch.
        expect(Object.keys(payload).sort()).toEqual(['expectedSha', 'reason']);
        expect(payload.expectedSha).toBe(SHA_TESTED);

        const serialised = JSON.stringify(payload);
        expect(serialised).not.toMatch(/token|secret|key|PRIVATE/i);
    });

    it('reports that the release started, never that it finished', async () => {
        const user = userEvent.setup();
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /Release to Production/i }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
        const message = showSuccess.mock.calls[0][0];
        expect(message).toMatch(/started/i);
        expect(message).not.toMatch(/\bdeployed\b|\breleased to production\b/i);
    });

    it('keeps the dialog open and shows the reason when the server refuses', async () => {
        const user = userEvent.setup();
        promoteTestingToProduction.mockRejectedValue(
            Object.assign(new Error('failed-precondition: The tested release changed while you were confirming.'), {
                code: 'functions/failed-precondition',
            }),
        );

        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /Release to Production/i }));

        expect(await screen.findByText(/tested release changed/i)).toBeTruthy();
        expect(screen.getByRole('dialog')).toBeTruthy();
    });
});

describe('a stale session', () => {
    // Regression guard. Releasing requires a sign-in within the last fifteen
    // minutes, which a long-open admin session does not have. The first real
    // release was refused as `stale-authentication`, and because this screen
    // offered no prompt the only recovery was to sign out and back in.
    const staleError = () => Object.assign(
        new Error('failed-precondition: REAUTH_REQUIRED: re-enter your password to continue.'),
        { code: 'functions/failed-precondition' },
    );

    it('asks for the password and retries, instead of dead-ending', async () => {
        const user = userEvent.setup();
        promoteTestingToProduction
            .mockRejectedValueOnce(staleError())
            .mockResolvedValue({ data: { status: 'dispatched', requestId: 'req-1', sha: SHA_TESTED } });
        reauthenticateWithCredential.mockResolvedValue({});

        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));
        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /Release to Production/i }));

        const password = await screen.findByLabelText(/password/i);
        await user.type(password, 'artificial-password');
        await user.click(screen.getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(promoteTestingToProduction).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
    });

    it('reports nothing when the operator dismisses the password prompt', async () => {
        const user = userEvent.setup();
        promoteTestingToProduction.mockRejectedValue(staleError());

        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));
        await user.click(releaseButton());
        await screen.findByRole('dialog');
        await user.click(screen.getByRole('button', { name: /Release to Production/i }));

        await screen.findByLabelText(/password/i);
        await user.click(screen.getAllByRole('button', { name: /^Cancel$/i })[0]);

        // Nothing ran, so nothing may be announced — neither success nor failure.
        await waitFor(() => expect(promoteTestingToProduction).toHaveBeenCalledTimes(1));
        expect(showSuccess).not.toHaveBeenCalled();
        expect(screen.queryByText(/re-enter your password/i)).toBeNull();
    });
});

describe('progress and outcome', () => {
    it('shows a running release instead of an outcome', async () => {
        getReleaseStatus.mockResolvedValue({
            data: {
                ...eligibleStatus(),
                activePromotion: { runId: '55', status: 'in_progress' },
                latestPromotion: { requestId: 'req-1', sha: SHA_TESTED, status: 'in_progress' },
            },
        });

        render(<ReleaseManagementView />);

        expect(await screen.findByText(/Releasing to Production/i)).toBeTruthy();
        expect(releaseButton()).toBeDisabled();
    });

    it('keeps following a running release after a poll fails', async () => {
        // A transient failure must not freeze the screen on "Releasing…". This is
        // a regression guard: the polling effect originally keyed off the status
        // object, which a failed read leaves unchanged — so no further poll was
        // ever scheduled and progress tracking stopped silently.
        const running = {
            ...eligibleStatus(),
            activePromotion: { runId: '55', status: 'in_progress' },
            latestPromotion: { requestId: 'req-1', sha: SHA_TESTED, status: 'in_progress' },
        };
        const finished = {
            ...eligibleStatus(),
            production: { ...eligibleStatus().production, sha: SHA_TESTED },
            activePromotion: null,
            latestPromotion: {
                requestId: 'req-1', sha: SHA_TESTED, status: 'completed', conclusion: 'success',
            },
        };

        getReleaseStatus
            .mockResolvedValueOnce({ data: running })
            .mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'functions/unavailable' }))
            .mockResolvedValue({ data: finished });

        render(<ReleaseManagementView />);
        expect(await screen.findByText(/Releasing to Production/i)).toBeTruthy();

        // Poll 2 fails, poll 3 succeeds — reachable only if a failed read still
        // schedules the next one.
        expect(await screen.findByText(/Last release succeeded/i, {}, { timeout: 20000 })).toBeTruthy();
        expect(getReleaseStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
    }, 25000);

    it('says Production was not changed after a failed release', async () => {
        getReleaseStatus.mockResolvedValue({
            data: {
                ...eligibleStatus(),
                activePromotion: null,
                latestPromotion: {
                    requestId: 'req-1', sha: SHA_TESTED, status: 'completed', conclusion: 'failure',
                },
            },
        });

        render(<ReleaseManagementView />);

        expect(await screen.findByText(/did not finish/i)).toBeTruthy();
        expect(screen.getByText(/Production was not changed/i)).toBeTruthy();
        // Still recoverable: the release can be attempted again.
        expect(releaseButton()).not.toBeDisabled();
    });
});

describe('rollback', () => {
    it('names the previous release and warns that shared data is not rolled back', async () => {
        const user = userEvent.setup();
        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        await user.click(screen.getByRole('button', { name: /Roll back to previous release/i }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain(SHA_OLDER.slice(0, 7));
        expect(dialog.textContent).toMatch(/not.*rolled\s*back/i);
        expect(dialog.textContent).toMatch(/Cloud Functions/i);
    });

    it('is not offered when there is no previous release on record', async () => {
        const status = eligibleStatus();
        status.previousProduction = null;
        getReleaseStatus.mockResolvedValue({ data: status });

        render(<ReleaseManagementView />);
        await screen.findByText(SHA_TESTED.slice(0, 7));

        expect(screen.queryByRole('button', { name: /Roll back/i })).toBeNull();
    });
});
