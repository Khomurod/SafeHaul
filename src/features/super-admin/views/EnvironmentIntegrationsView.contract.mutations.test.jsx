/**
 * Mutations and re-authentication: updates, deletes, adds, and the stale-session retry path.
 *
 * Part of the EnvironmentIntegrationsView contract suite, split from the
 * original single file by subject. The fixtures, callable stubs, spies and
 * the security-proof context live in
 * `EnvironmentIntegrationsView.contract.support.jsx`. Each `vi.mock` below
 * has to stay in this file, because vitest hoists it per file and cannot
 * register one from a helper.
 */

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvironmentIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvironmentIntegrationsView.contract.support')).feedbackMock());

import {
    callables,
    showSuccess,
    reauthenticateWithCredential,
    SECRET_PLAINTEXT,
    renderLoaded,
    resetHarness,
} from './EnvironmentIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('mutations', () => {
    it('opens an empty editor and updates only the selected key', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));

        const dialog = await screen.findByRole('dialog');
        const input = within(dialog).getByLabelText(/New value/);
        // Never preloaded — that is the whole point.
        expect(input).toHaveValue('');
        expect(within(dialog).getByText('functions/example.js')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace value' }));

        await waitFor(() => {
            expect(callables.updateEnvironmentValue).toHaveBeenCalledWith({
                entryId: 'company:co-alpha:sms_provider:clientSecret',
                value: 'a-new-artificial-secret',
            });
        });
        expect(callables.addEnvironmentValue).not.toHaveBeenCalled();
        expect(callables.deleteEnvironmentValue).not.toHaveBeenCalled();
    });

    it('never echoes the new value into a toast', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace value' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
        expect(showSuccess.mock.calls.flat().join(' ')).not.toContain('a-new-artificial-secret');
    });

    it('requires the exact key typed back before deleting', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Delete clientSecret' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Type the key name to continue' })).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/Type clientSecret to confirm/), { target: { value: 'clientsecret' } });
        expect(within(dialog).getByRole('button', { name: 'Type the key name to continue' })).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/Type clientSecret to confirm/), { target: { value: 'clientSecret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete clientSecret' }));

        await waitFor(() => {
            expect(callables.deleteEnvironmentValue).toHaveBeenCalledWith({
                entryId: 'company:co-alpha:sms_provider:clientSecret',
                confirmation: 'clientSecret',
            });
        });
    });
});

describe('re-authentication', () => {
    const staleError = Object.assign(new Error('REAUTH_REQUIRED: re-enter your password to continue.'), {
        code: 'functions/failed-precondition',
    });

    it('asks for the password on a stale session and retries the reveal', async () => {
        const reveal = vi.fn()
            .mockRejectedValueOnce(staleError)
            .mockResolvedValueOnce({
                data: {
                    entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                    availability: 'server-runtime',
                    readFrom: 'process-env',
                    value: SECRET_PLAINTEXT,
                    unavailableReason: null,
                },
            });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Confirm it is you')).toBeInTheDocument();
        // No value is on screen while the session is stale.
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);

        fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'artificial-password' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

        expect(await screen.findByText(SECRET_PLAINTEXT)).toBeInTheDocument();
        expect(reveal).toHaveBeenCalledTimes(2);
    });

    it('keeps the value hidden when re-authentication is cancelled', async () => {
        const reveal = vi.fn().mockRejectedValue(staleError);
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    /**
     * Regression: an earlier version resolved the guarded operation as soon as it
     * opened the prompt, so the edit dialog closed and a success toast fired for
     * a write that had not happened — and would never happen if the operator
     * backed out.
     */
    it('reports nothing and writes nothing when a mutation is cancelled at the prompt', async () => {
        const update = vi.fn().mockRejectedValue(staleError);
        await renderLoaded({ update });

        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const editDialog = await screen.findByRole('dialog');
        fireEvent.change(within(editDialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(editDialog).getByRole('button', { name: 'Replace value' }));

        const reauthDialog = await screen.findByText('Confirm it is you');
        fireEvent.click(within(reauthDialog.closest('[role="dialog"]')).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByText('Confirm it is you')).not.toBeInTheDocument());

        // Nothing claimed, nothing written, and the operator's input survives.
        expect(showSuccess).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Replace value' })).toBeInTheDocument();
        expect(screen.getByLabelText(/New value/)).toHaveValue('a-new-artificial-secret');
    });

    it('completes the mutation once, after a successful re-authentication', async () => {
        const update = vi.fn()
            .mockRejectedValueOnce(staleError)
            .mockResolvedValueOnce({ data: { verified: true } });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderLoaded({ update });

        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const editDialog = await screen.findByRole('dialog');
        fireEvent.change(within(editDialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(editDialog).getByRole('button', { name: 'Replace value' }));

        const reauthHeading = await screen.findByText('Confirm it is you');
        const reauthDialog = reauthHeading.closest('[role="dialog"]');
        fireEvent.change(within(reauthDialog).getByLabelText(/Password/), { target: { value: 'artificial-password' } });
        fireEvent.click(within(reauthDialog).getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
        expect(update).toHaveBeenCalledTimes(2);
    });
});

