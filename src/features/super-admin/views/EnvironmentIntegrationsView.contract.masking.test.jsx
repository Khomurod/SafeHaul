/**
 * Masking and reveal: no plaintext in the initial DOM, one reveal per request, the 30-second clear, and concurrent reveals.
 *
 * Part of the EnvironmentIntegrationsView contract suite, split from the
 * original single file by subject. The fixtures, callable stubs, spies and
 * the security-proof context live in
 * `EnvironmentIntegrationsView.contract.support.jsx`. Each `vi.mock` below
 * has to stay in this file, because vitest hoists it per file and cannot
 * register one from a helper.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvironmentIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvironmentIntegrationsView.contract.support')).feedbackMock());

import {
    callables,
    ENTRIES,
    SECRET_PLAINTEXT,
    rowFor,
    renderLoaded,
    resetHarness,
} from './EnvironmentIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('masking', () => {
    it('renders every value as ******** with no plaintext anywhere in the DOM', async () => {
        await renderLoaded();

        const masked = screen.getAllByText('********');
        expect(masked.length).toBe(ENTRIES.length);
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
        expect(document.body.innerHTML).not.toContain(SECRET_PLAINTEXT);
    });

    it('never asks the list callable for a value', async () => {
        await renderLoaded();
        expect(callables.listEnvironmentAndIntegrations).toHaveBeenCalledWith({});
        const payload = JSON.stringify(callables.listEnvironmentAndIntegrations.mock.results[0].value);
        expect(payload).not.toContain(SECRET_PLAINTEXT);
    });

    it('puts nothing in browser storage', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        expect(localStorage.length).toBe(0);
        expect(sessionStorage.length).toBe(0);
        expect(JSON.stringify(localStorage)).not.toContain(SECRET_PLAINTEXT);
        expect(JSON.stringify(sessionStorage)).not.toContain(SECRET_PLAINTEXT);
    });

    it('never writes a revealed value into an attribute', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        for (const element of document.querySelectorAll('*')) {
            for (const attribute of element.attributes) {
                expect(attribute.value).not.toContain(SECRET_PLAINTEXT);
            }
        }
    });
});

describe('reveal', () => {
    it('requests exactly one key and shows it in that row only', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        await waitFor(() => {
            expect(callables.revealEnvironmentValue).toHaveBeenCalledTimes(1);
        });
        expect(callables.revealEnvironmentValue).toHaveBeenCalledWith({
            entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
        });

        // The call having been MADE is not the call having RESOLVED. Asserting
        // the render here without waiting for the value to land passes on a
        // fast machine and fails on a loaded CI runner, which is exactly what
        // it did. Every other positive assertion in this file already awaits.
        await screen.findByText(SECRET_PLAINTEXT);

        const revealedRow = rowFor('ARTIFICIAL_MASTER_KEY');
        expect(within(revealedRow).getByText(SECRET_PLAINTEXT)).toBeInTheDocument();
        expect(within(rowFor('VITE_FIREBASE_PROJECT_ID')).getByText('********')).toBeInTheDocument();
        expect(screen.getAllByText(SECRET_PLAINTEXT)).toHaveLength(1);
    });

    it('labels the control with the key it acts on, in both states', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        const hide = screen.getByRole('button', { name: 'Hide ARTIFICIAL_MASTER_KEY' });
        expect(hide).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('says the value hides automatically', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);
        expect(screen.getByText(/Hides automatically in 30s/)).toBeInTheDocument();
    });

    it('clears the value after 30 seconds', async () => {
        // `shouldAdvanceTime` keeps Testing Library's own async helpers working
        // while still allowing the 30-second window to be jumped deliberately.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('clears the value when the eye is pressed again', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        fireEvent.click(screen.getByRole('button', { name: 'Hide ARTIFICIAL_MASTER_KEY' }));
        await waitFor(() => expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument());
        // Hiding must not spend another reveal request.
        expect(callables.revealEnvironmentValue).toHaveBeenCalledTimes(1);
    });

    it('clears the value when the tab is hidden', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        fireEvent(document, new Event('visibilitychange'));

        await waitFor(() => expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument());
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('clears the value when the view unmounts', async () => {
        const { unmount } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        unmount();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('evicts the previous value when a second row is revealed', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: {
                entryId,
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: entryId.endsWith('ARTIFICIAL_MASTER_KEY') ? SECRET_PLAINTEXT : 'second-artificial-value',
                unavailableReason: null,
            },
        }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        fireEvent.click(screen.getByRole('button', { name: 'Reveal clientSecret' }));
        await screen.findByText('second-artificial-value');

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
    });

    it('reports a GitHub Actions secret honestly instead of hiding the row', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: {
                entryId,
                availability: 'not-retrievable',
                readFrom: 'none',
                value: null,
                unavailableReason: 'The source does not permit reading the saved value.',
            },
        }));
        await renderLoaded({ reveal });

        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' }));

        expect(await screen.findByText('The source does not permit reading the saved value.')).toBeInTheDocument();
    });

    it('resolves a build-time browser value from the running bundle', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: { entryId, availability: 'browser-visible', readFrom: 'client-bundle', value: null, unavailableReason: null },
        }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal VITE_FIREBASE_PROJECT_ID' }));

        // `src/tests/setup.js` stubs this to the placeholder project id.
        expect(await screen.findByText('vitest-placeholder')).toBeInTheDocument();
    });

    it('disables the eye for an entry with nothing stored', async () => {
        await renderLoaded();
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_OPTIONAL_URL' })).toBeDisabled();
    });
});


describe('concurrent reveals', () => {
    /**
     * Regression: only the pending row's control is disabled, so a second reveal
     * can start while the first is still in flight. If the first landed last it
     * used to overwrite the second and restart the countdown — a secret the page
     * had already evicted reappearing, attached to the wrong row.
     */
    it('discards a reveal response that a later reveal has superseded', async () => {
        let resolveFirst;
        const reveal = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockImplementationOnce(async () => ({
                data: {
                    entryId: 'company:co-alpha:sms_provider:clientSecret',
                    availability: 'firestore-encrypted',
                    readFrom: 'firestore',
                    value: 'second-artificial-value',
                    unavailableReason: null,
                },
            }));

        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reveal clientSecret' }));
        await screen.findByText('second-artificial-value');

        // The first request lands late; its value must never reach the screen.
        resolveFirst({
            data: {
                entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: SECRET_PLAINTEXT,
                unavailableReason: null,
            },
        });
        await waitFor(() => expect(reveal).toHaveBeenCalledTimes(2));

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
        expect(screen.getByText('second-artificial-value')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('discards a reveal response that arrived after an explicit hide', async () => {
        let resolveFirst;
        const reveal = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve; }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        // Hiding the tab evicts everything, including anything still in flight.
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        fireEvent(document, new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

        resolveFirst({
            data: {
                entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: SECRET_PLAINTEXT,
                unavailableReason: null,
            },
        });
        await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));

        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });
});
