/**
 * Credentials: masking and reveal, the unreadable-vs-missing distinction, and the credential access check.
 *
 * Part of the AiIntegrationsView contract suite, split from the original
 * single file by subject. The fixtures, callable stubs, spies and the
 * security-proof context live in `AiIntegrationsView.contract.support.jsx`;
 * the properties pinned across the suite are listed there and in the view.
 * Each `vi.mock` below has to stay in this file, because vitest hoists it
 * per file and cannot register one from a helper.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import {
    callables,
    PROVIDERS,
    REAL_SECRET,
    routingFor,
    stubCallables,
    renderView,
    revealButton,
    resetHarness,
} from './AiIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('credential masking and reveal', () => {
    it('masks every credential and puts no plaintext in the initial DOM', async () => {
        const { container } = await renderView();

        expect(screen.getAllByText('********').length).toBeGreaterThan(0);
        expect(container.innerHTML).not.toContain(REAL_SECRET);
        expect(callables.revealAiCredential).not.toHaveBeenCalled();
    });

    it('reveals one credential for one provider on request', async () => {
        await renderView();

        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        expect(callables.revealAiCredential).toHaveBeenCalledTimes(1);
        expect(callables.revealAiCredential).toHaveBeenCalledWith({ providerId: 'groq', field: 'apiKey' });
    });

    it('announces the remaining time beside the revealed value', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        // The page carries more than one live region — the reveal countdown and
        // the routing-order announcer — so this asserts the countdown's own
        // text rather than assuming it is the only one.
        const live = screen.getAllByRole('status').map((node) => node.textContent);
        expect(live.some((text) => /Hides automatically in 30s/.test(text))).toBe(true);
    });

    it('hides the value when the same control is pressed again', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Hide Groq API key' }));

        await waitFor(() => expect(screen.queryByText(REAL_SECRET)).toBeNull());
    });

    it('evicts the first credential when a second is revealed', async () => {
        callables.revealAiCredential = vi.fn(async ({ providerId }) => ({
            data: {
                providerId,
                field: 'apiKey',
                value: providerId === 'groq' ? REAL_SECRET : 'mistral-only-value',
                unavailableReason: null,
            },
        }));
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        fireEvent.click(revealButton('Mistral'));

        await waitFor(() => expect(screen.getByText('mistral-only-value')).toBeTruthy());
        // There is only one slot, so the first value cannot still be on screen.
        expect(screen.queryByText(REAL_SECRET)).toBeNull();
    });

    it('clears the value after 30 seconds', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        await act(async () => { vi.advanceTimersByTime(30_000); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
    });

    it('clears the value when the tab is hidden', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    it('clears the value on unmount, such as a view change or sign-out', async () => {
        const { unmount, container } = await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        unmount();

        expect(container.innerHTML).not.toContain(REAL_SECRET);
    });

    it('never writes a revealed value to storage or a data attribute', async () => {
        const { container } = await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        expect(JSON.stringify(localStorage)).not.toContain(REAL_SECRET);
        expect(JSON.stringify(sessionStorage)).not.toContain(REAL_SECRET);
        for (const node of container.querySelectorAll('*')) {
            for (const attribute of node.attributes) {
                expect(attribute.value).not.toContain(REAL_SECRET);
            }
        }
    });

    it('discards a superseded reveal response instead of resurrecting it', async () => {
        // Groq resolves after Mistral. Without the generation guard, Groq's
        // late response would overwrite Mistral's and restart the countdown.
        let releaseGroq;
        callables.revealAiCredential = vi.fn(({ providerId }) => {
            if (providerId === 'groq') {
                return new Promise((resolve) => {
                    releaseGroq = () => resolve({
                        data: { providerId, field: 'apiKey', value: REAL_SECRET, unavailableReason: null },
                    });
                });
            }
            return Promise.resolve({
                data: { providerId, field: 'apiKey', value: 'mistral-only-value', unavailableReason: null },
            });
        });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        fireEvent.click(revealButton('Mistral'));
        await waitFor(() => expect(screen.getByText('mistral-only-value')).toBeTruthy());

        await act(async () => { releaseGroq(); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        expect(screen.getByText('mistral-only-value')).toBeTruthy();
    });

    it('reports an unconfigured credential rather than showing an empty value', async () => {
        callables.revealAiCredential = vi.fn().mockResolvedValue({
            data: { providerId: 'groq', field: 'apiKey', value: null, unavailableReason: 'This credential is not configured.' },
        });
        await renderView();

        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText('This credential is not configured.')).toBeTruthy());
    });

    it('does not offer a reveal for an unconfigured credential', async () => {
        await renderView();
        expect(revealButton('Cerebras').disabled).toBe(true);
    });
});


describe('an unreadable credential is not a missing one', () => {
    it('says the credential exists and cannot be read, not "Needs API key"', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (row.id === 'gemini'
                        ? {
                            ...row,
                            configured: false,
                            credentialAccess: 'unreadable',
                            unreadableCredentials: ['apiKey'],
                            missingCredentials: [],
                            health: 'credential_error',
                        }
                        : row)),
                    routing: routingFor(PROVIDERS),
                    telemetry: [],
                    generatedAt: '2026-08-02T12:00:00Z',
                },
            }),
        });

        await renderView();

        // Named in both the configuration table and the routing-order list, which
        // is the point: the page used to contradict itself about this provider.
        expect(screen.getAllByText('Credential unreadable').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/cannot read it/i).length).toBeGreaterThan(0);

        // And the wrong sentence must be gone *for this provider*, not merely
        // supplemented — it is what sent operators to re-enter a working key.
        // Cerebras is genuinely unconfigured in the fixture and must keep saying
        // so, which is exactly the distinction being asserted.
        const geminiRow = screen.getAllByRole('row')
            .find((row) => row.textContent.includes('Google Gemini'));
        expect(geminiRow.textContent).not.toContain('Needs API key');
        const cerebrasRow = screen.getAllByRole('row')
            .find((row) => row.textContent.includes('Cerebras'));
        expect(cerebrasRow.textContent).toContain('Needs API key');
    });

    it('marks a provider still working only because of the legacy binding', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (row.id === 'groq'
                        ? { ...row, credentialSource: 'legacy-env-after-read-failure' }
                        : row)),
                    routing: routingFor(PROVIDERS),
                    telemetry: [],
                    generatedAt: '2026-08-02T12:00:00Z',
                },
            }),
        });

        await renderView();

        expect(screen.getByText(/managed\s+credential could not be read/i)).toBeTruthy();
    });
});


describe('credential access check', () => {
    it('asks both Functions generations and names the account each runs as', async () => {
        stubCallables();
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Check credential access/i }));

        await waitFor(() => expect(screen.getByText(/1st generation/)).toBeTruthy());
        expect(screen.getByText(/2nd generation/)).toBeTruthy();
        // The two accounts are the diagnosis: a grant made to one leaves the
        // other refused, and nothing in the product could show that before.
        expect(screen.getByText(/proj@appspot\.gserviceaccount\.com/)).toBeTruthy();
        expect(screen.getByText(/proj-number-compute@developer\.gserviceaccount\.com/)).toBeTruthy();
    });

    it('names the refused secret and the grant to make', async () => {
        stubCallables({
            diagnoseAiCredentialAccessV1: vi.fn().mockResolvedValue({
                data: {
                    generation: 'v1',
                    runtime: { serviceAccount: 'proj@appspot.gserviceaccount.com', source: 'metadata' },
                    providers: [{
                        providerId: 'gemini',
                        displayName: 'Google Gemini',
                        retired: false,
                        legacyBinding: false,
                        secrets: [{
                            field: 'apiKey',
                            label: 'API key',
                            secretId: 'SAFEHAUL_AI_GEMINI_APIKEY',
                            exists: null,
                            readable: false,
                            reason: 'permission_denied',
                        }],
                    }],
                    unreadableCount: 1,
                    permissionDeniedCount: 1,
                    summary: '1 credential(s) refused for proj@appspot.gserviceaccount.com.'
                        + ' Grant roles/secretmanager.secretAccessor on the named secrets to that account.',
                },
            }),
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Check credential access/i }));

        await waitFor(() => expect(screen.getByText(/SAFEHAUL_AI_GEMINI_APIKEY/)).toBeTruthy());
        expect(screen.getByText(/permission_denied/)).toBeTruthy();
        expect(screen.getByText(/secretmanager\.secretAccessor/)).toBeTruthy();
    });

    it('still reports one generation when the other cannot be checked', async () => {
        stubCallables({
            diagnoseAiCredentialAccessV1: vi.fn().mockRejectedValue(
                Object.assign(new Error('nope'), { code: 'functions/internal' }),
            ),
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Check credential access/i }));

        // A diagnosis that needs both halves to succeed is useless in exactly
        // the situation it exists for.
        await waitFor(() => expect(screen.getByText('Check did not run')).toBeTruthy());
        expect(screen.getByText(/2nd generation/)).toBeTruthy();
    });

    it('never renders a credential value in the report', async () => {
        stubCallables();
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Check credential access/i }));
        await waitFor(() => expect(screen.getByText(/1st generation/)).toBeTruthy());

        expect(document.body.innerHTML).not.toContain(REAL_SECRET);
    });
});

