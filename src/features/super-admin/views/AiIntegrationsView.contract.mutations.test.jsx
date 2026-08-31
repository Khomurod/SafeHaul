/**
 * Mutations: enable/disable, save/delete, the typed-back deletion, the Groq migration, and re-authentication.
 *
 * Part of the AiIntegrationsView contract suite, split from the original
 * single file by subject. The fixtures, callable stubs, spies and the
 * security-proof context live in `AiIntegrationsView.contract.support.jsx`;
 * the properties pinned across the suite are listed there and in the view.
 * Each `vi.mock` below has to stay in this file, because vitest hoists it
 * per file and cannot register one from a helper.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import { AiIntegrationsView } from './AiIntegrationsView';
import {
    callables,
    showSuccess,
    showError,
    reauthenticateWithCredential,
    PROVIDERS,
    REAL_SECRET,
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

describe('mutations', () => {
    it('opens an empty field when replacing a credential', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);

        const input = await screen.findByLabelText(/New api key/i);
        // Preloading the current value would put a secret on screen with no
        // reveal, no timer and no audit record.
        expect(input.value).toBe('');
        expect(input.type).toBe('password');
    });

    it('saves a replacement credential', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);

        const input = await screen.findByLabelText(/New api key/i);
        fireEvent.change(input, { target: { value: 'new-value' } });
        fireEvent.click(screen.getByRole('button', { name: /Replace credential/i }));

        await waitFor(() => expect(callables.saveAiCredential).toHaveBeenCalledWith({
            providerId: 'groq', field: 'apiKey', value: 'new-value',
        }));
    });

    it('refuses to submit an empty credential', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);
        const input = await screen.findByLabelText(/New api key/i);

        // The field is marked required, so the browser's own constraint
        // validation blocks an empty submission before the handler runs. That is
        // the mechanism; what matters is that nothing is saved and the dialog
        // stays open. The handler keeps its own guard as defence for any caller
        // that submits the form programmatically.
        expect(input.hasAttribute('required')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: /Replace credential/i }));

        await waitFor(() => expect(screen.getByLabelText(/New api key/i)).toBeTruthy());
        expect(callables.saveAiCredential).not.toHaveBeenCalled();
    });

    it('reports an empty value if the form is submitted programmatically', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);
        const input = await screen.findByLabelText(/New api key/i);

        // Bypasses constraint validation the way a scripted submit would, which
        // is the path the handler's own guard exists for.
        fireEvent.submit(input.form);

        await waitFor(() => expect(screen.getByText(/Enter a value/)).toBeTruthy());
        expect(callables.saveAiCredential).not.toHaveBeenCalled();
    });

    it('requires the provider name typed back before deleting', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Groq API key' }));

        const dialog = await screen.findByRole('dialog');
        // Nothing typed yet: the confirm control says what is still needed.
        expect(within(dialog).getByRole('button', { name: 'Type the provider name to continue' })).toBeTruthy();

        // A near-miss is still refused.
        fireEvent.change(within(dialog).getByLabelText(/Type "Groq" to confirm/), { target: { value: 'groq' } });
        expect(within(dialog).getByRole('button', { name: 'Type the provider name to continue' })).toBeTruthy();
        expect(callables.deleteAiCredential).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByLabelText(/Type "Groq" to confirm/), { target: { value: 'Groq' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete credential' }));

        await waitFor(() => expect(callables.deleteAiCredential).toHaveBeenCalledWith({
            providerId: 'groq', field: 'apiKey', confirmation: 'Groq',
        }));
    });

    it('names each delete control after the credential it removes', async () => {
        await renderView();

        const names = screen.getAllByRole('button', { name: /^Delete / })
            .map((button) => button.getAttribute('aria-label'));
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('Delete Groq API key');
        expect(names).toContain('Delete Cloudflare Workers AI API token');
    });

    it('enables and disables a provider', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);

        await waitFor(() => expect(callables.setAiProviderEnabled).toHaveBeenCalledWith({
            providerId: 'groq', enabled: false,
        }));
    });

    it('runs a connection test and reports the result', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(callables.testAiProvider).toHaveBeenCalledWith({ providerId: 'groq' }));
        await waitFor(() => expect(showSuccess)
            .toHaveBeenCalledWith('Connected. 2 capabilities verified in 120ms.'));
    });

    it('shows which capabilities passed, not just an overall verdict', async () => {
        // The state that used to read as healthy: text fine, every structured
        // request rejected. One verdict cannot express that, and it is the
        // difference between "the key works" and "the product works".
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(screen.getByText('Basic text')).toBeTruthy());
        expect(screen.getByText('Structured JSON')).toBeTruthy();
        // A capability the provider does not offer is not a failure and must
        // not be rendered as one.
        expect(screen.queryByText('Single-image vision')).toBeNull();
    });

    it('reports a failed connection test without exposing the credential', async () => {
        callables.testAiProvider = vi.fn().mockResolvedValue({
            data: { success: false, message: 'The AI service rejected SafeHaul credentials.' },
        });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(showError).toHaveBeenCalledWith('The AI service rejected SafeHaul credentials.'));
        expect(showError.mock.calls.flat().join(' ')).not.toContain(REAL_SECRET);
    });

    it('does not offer a test for an unconfigured provider', async () => {
        await renderView();
        const buttons = screen.getAllByRole('button', { name: /Test connection/i });
        // Cerebras is unconfigured in the fixture, so at least one is disabled.
        expect(buttons.some((button) => button.disabled)).toBe(true);
    });

    it('saves a non-secret setting through the config callable', async () => {
        await renderView();

        fireEvent.change(screen.getByLabelText(/Account ID/i), { target: { value: 'b'.repeat(32) } });
        fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));

        await waitFor(() => expect(callables.updateAiProviderConfig).toHaveBeenCalledWith({
            providerId: 'cloudflare',
            settings: { accountId: 'b'.repeat(32) },
        }));
    });
});

describe('Groq migration', () => {
    it('offers the migration only while the legacy binding is in use', async () => {
        await renderView();
        expect(screen.queryByRole('button', { name: /Migrate legacy key/i })).toBeNull();

        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (
                        row.id === 'groq' ? { ...row, credentialSource: 'legacy-env' } : row
                    )),
                    telemetry: [],
                },
            }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(
            screen.getAllByRole('button', { name: /Migrate legacy key/i }).length,
        ).toBeGreaterThan(0));
    });

    it('says the provider is still on the legacy binding', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: [{ ...PROVIDERS[0], credentialSource: 'legacy-env' }],
                    telemetry: [],
                },
            }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(
            screen.getByText(/Using the legacy deploy binding, not the managed credential\./),
        ).toBeTruthy());
    });

    it('never renders a token returned by the migration', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: { providers: [{ ...PROVIDERS[0], credentialSource: 'legacy-env' }], telemetry: [] },
            }),
        });
        const { container } = render(<AiIntegrationsView />);
        await waitFor(() => expect(screen.getAllByText('Groq').length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: /Migrate legacy key/i }));

        await waitFor(() => expect(callables.migrateGroqCredential).toHaveBeenCalled());
        expect(container.innerHTML).not.toContain(REAL_SECRET);
    });
});

describe('re-authentication', () => {
    const staleOnce = (callableName) => {
        let called = false;
        return vi.fn(async (payload) => {
            if (!called) {
                called = true;
                const error = new Error('failed: REAUTH_REQUIRED');
                error.code = 'functions/failed-precondition';
                throw error;
            }
            return { data: { [callableName]: true, providerId: payload.providerId, field: payload.field, value: REAL_SECRET } };
        });
    };

    it('prompts for the password and retries the reveal once', async () => {
        stubCallables({ revealAiCredential: staleOnce('reveal') });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();

        fireEvent.click(revealButton('Groq'));

        const password = await screen.findByLabelText(/password/i);
        fireEvent.change(password, { target: { value: 'correct-horse' } });
        // Scoped to the dialog. A page-wide match picks up any button whose
        // label happens to contain "verify", which is a property of the rest of
        // the page rather than of the re-authentication flow being asserted.
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        expect(callables.revealAiCredential).toHaveBeenCalledTimes(2);
    });

    it('reveals nothing when the prompt is dismissed', async () => {
        stubCallables({ revealAiCredential: staleOnce('reveal') });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await screen.findByLabelText(/password/i);

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        // A dismissed prompt means nothing happened, so nothing is announced.
        expect(showSuccess).not.toHaveBeenCalled();
    });

    it('does not report success for a mutation whose prompt was dismissed', async () => {
        stubCallables({ setAiProviderEnabled: staleOnce('enabled') });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(showSuccess).not.toHaveBeenCalled();
    });
});

