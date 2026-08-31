/**
 * Routing: the provider order, reordering, and why a provider is skipped.
 *
 * Part of the AiIntegrationsView contract suite, split from the original
 * single file by subject. The fixtures, callable stubs, spies and the
 * security-proof context live in `AiIntegrationsView.contract.support.jsx`;
 * the properties pinned across the suite are listed there and in the view.
 * Each `vi.mock` below has to stay in this file, because vitest hoists it
 * per file and cannot register one from a helper.
 */

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import {
    callables,
    showSuccess,
    showError,
    reauthenticateWithCredential,
    PROVIDERS,
    routingFor,
    stubCallables,
    renderView,
    orderedNames,
    resetHarness,
} from './AiIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('routing order', () => {
    it('lists every provider in the order the router will try them', async () => {
        await renderView();
        expect(orderedNames()).toEqual(PROVIDERS.map((row) => row.displayName));
    });

    it('says plainly whether the deployment is running the shipped default', async () => {
        await renderView();
        expect(screen.getByText(/running the built-in default order/)).toBeTruthy();
    });

    it('says so when an operator has chosen a different order', async () => {
        const reordered = [PROVIDERS[4], ...PROVIDERS.filter((row) => row.id !== 'mistral')]
            .map((row, index) => ({ ...row, rank: index + 1 }));
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: reordered,
                    routing: routingFor(reordered, { usingDefaultOrder: false }),
                    telemetry: [],
                },
            }),
        });
        await renderView();

        expect(screen.getByText(/running an operator-chosen order/)).toBeTruthy();
        expect(orderedNames()[0]).toBe('Mistral');
    });

    it('shows a row its effective position, and its default when they differ', async () => {
        const reordered = [PROVIDERS[4], ...PROVIDERS.filter((row) => row.id !== 'mistral')]
            .map((row, index) => ({ ...row, rank: index + 1 }));
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: reordered,
                    routing: routingFor(reordered, { usingDefaultOrder: false }),
                    telemetry: [],
                },
            }),
        });
        await renderView();

        // Mistral now runs first but ships fifth. Saying only one of those
        // makes the registry documentation look wrong.
        expect(screen.getByText('Default position 5')).toBeTruthy();
    });

    // The accessibility policy is binding, and a drag-only control fails it.
    // These are the tests that would catch the move controls being quietly
    // dropped as redundant.
    describe('without a pointer', () => {
        it('offers a named move control for every provider, in both directions', async () => {
            await renderView();

            for (const row of PROVIDERS) {
                expect(screen.getByRole('button', { name: `Move ${row.displayName} up` })).toBeTruthy();
                expect(screen.getByRole('button', { name: `Move ${row.displayName} down` })).toBeTruthy();
            }
        });

        it('moves a provider up the order', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

            // Mistral is fifth in the fixture; one move up puts it fourth.
            expect(orderedNames()[3]).toBe('Mistral');
        });

        it('moves a provider down the order', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Groq down' }));

            expect(orderedNames()[1]).toBe('Groq');
        });

        it('promotes a provider to first with repeated moves', async () => {
            await renderView();

            for (let i = 0; i < 4; i += 1) {
                fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
            }

            expect(orderedNames()[0]).toBe('Mistral');
        });

        it('keeps focus on the control that was pressed, so a move can be repeated', async () => {
            await renderView();
            const up = screen.getByRole('button', { name: 'Move Mistral up' });
            up.focus();

            fireEvent.click(up);

            // Same accessible name, but the button has moved with its row —
            // without this a keyboard user is returned to the top of the page
            // after every single move.
            expect(document.activeElement.getAttribute('aria-label')).toBe('Move Mistral up');
        });

        it('cannot move the first provider up or the last one down', async () => {
            await renderView();

            expect(screen.getByRole('button', { name: 'Move Groq up' }).disabled).toBe(true);
            expect(screen.getByRole('button', { name: 'Move Hugging Face down' }).disabled).toBe(true);
        });

        it('announces each move, because a changed list index is silent', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

            const announcements = screen.getAllByRole('status').map((node) => node.textContent);
            expect(announcements.some((text) => /Mistral moved to position 4 of 9/.test(text))).toBe(true);
            expect(announcements.some((text) => /Not saved yet/.test(text))).toBe(true);
        });
    });

    it('does not save until asked, so a change of mind costs nothing', async () => {
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        expect(callables.setAiProviderPriority).not.toHaveBeenCalled();
    });

    it('offers no save control until something has actually changed', async () => {
        await renderView();
        expect(screen.queryByRole('button', { name: /Save routing order/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        expect(screen.getByRole('button', { name: /Save routing order/i })).toBeTruthy();
    });

    it('sends the whole order, as ids, when saved', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledWith({
            providerIds: [
                'groq', 'gemini', 'cloudflare', 'mistral', 'github-models',
                'cerebras', 'sambanova', 'openrouter', 'huggingface',
            ],
        }));
    });

    it('reloads after saving, so the screen shows what the server stored', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(callables.listAiProviders).toHaveBeenCalledTimes(2));
        expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/Routing order saved/));
    });

    it('discards an unsaved reorder on request', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        expect(orderedNames()[3]).toBe('Mistral');

        fireEvent.click(screen.getByRole('button', { name: /Discard changes/i }));

        expect(orderedNames()).toEqual(PROVIDERS.map((row) => row.displayName));
        expect(callables.setAiProviderPriority).not.toHaveBeenCalled();
    });

    it('re-authenticates a stale session and then saves', async () => {
        const stale = { code: 'functions/failed-precondition', message: 'REAUTH_REQUIRED: re-enter your password.' };
        let calls = 0;
        callables.setAiProviderPriority = vi.fn(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(stale);
            return Promise.resolve({ data: { saved: true, order: [] } });
        });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        const password = await screen.findByLabelText(/password/i);
        fireEvent.change(password, { target: { value: 'artificial-password' } });
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledTimes(2));
    });

    it('never reports success when re-authentication is cancelled', async () => {
        callables.setAiProviderPriority = vi.fn().mockRejectedValue({
            code: 'functions/failed-precondition',
            message: 'REAUTH_REQUIRED: re-enter your password.',
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledTimes(1));
        expect(showSuccess).not.toHaveBeenCalled();
        // The draft is still on screen: a cancelled save must not look like a
        // completed one, and must not silently discard the operator's work.
        expect(orderedNames()[3]).toBe('Mistral');
    });

    it('surfaces a rejected order without pretending it saved', async () => {
        callables.setAiProviderPriority = vi.fn().mockRejectedValue({
            code: 'functions/invalid-argument',
            message: 'That order lists the same provider twice.',
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('That order lists the same provider twice.'));
        expect(showSuccess).not.toHaveBeenCalled();
    });
});

describe('why a provider is skipped', () => {
    it('separates text tasks from document-image tasks', async () => {
        await renderView();

        expect(screen.getByText('Text and structured output')).toBeTruthy();
        expect(screen.getByText('Document images')).toBeTruthy();
    });

    it('explains a capability gap rather than leaving a rank unexplained', async () => {
        await renderView();

        const vision = screen.getByText('Document images').closest('div').parentElement;
        // Groq is configured, enabled and healthy, and it still never serves a
        // CDL photograph. Without this sentence the screen shows a rank and no
        // reason, which is the gap this feature was asked to close.
        expect(within(vision).getAllByText('Does not support what this kind of task needs.').length)
            .toBeGreaterThan(0);
    });

    it('names the providers that would actually be tried, in order', async () => {
        await renderView();

        expect(screen.getByText(/Tried in this order: Groq, Google Gemini/)).toBeTruthy();
    });
});

