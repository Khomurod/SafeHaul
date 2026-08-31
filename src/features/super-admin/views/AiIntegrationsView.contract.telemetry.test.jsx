/**
 * Telemetry: the panel, the Providers and Logs tabs, and article transactions in the log.
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
    PROVIDERS,
    REAL_SECRET,
    stubCallables,
    renderView,
    resetHarness,
} from './AiIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('telemetry panel', () => {
    it('shows an empty state when nothing has run', async () => {
        await renderView();
        expect(screen.getByText('No AI requests have been recorded yet.')).toBeTruthy();
    });

    it('sends an operator to the Logs tab rather than showing a second, shallower list', async () => {
        // The flat list this replaces could not answer the question it invited:
        // it showed that a request failed and never which providers were tried
        // or why. Keeping it alongside the Logs tab would be two competing
        // answers to the same question.
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS,
                    telemetry: [{
                        id: 't1', taskType: 'cdl_extraction', providerId: 'groq',
                        model: 'model-a', outcome: 'success', latencyMs: 812,
                        fallbackCount: 0, timestamp: '2026-08-02T12:00:00Z',
                    }],
                },
            }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(screen.getByText('1 recent transaction recorded.')).toBeTruthy());
        expect(screen.getByRole('button', { name: /open logs/i })).toBeTruthy();
    });
});

describe('Providers and Logs tabs', () => {
    /** The transaction the Logs tab renders in these tests. */
    const TRANSACTION = {
        id: 't1',
        transactionId: '6f2a-1111',
        taskType: 'cdl_extraction',
        providerId: 'groq',
        model: 'qwen/qwen3.6-27b',
        outcome: 'success',
        latencyMs: 2992,
        fallbackCount: 2,
        requiredCapabilities: ['vision', 'structured_json'],
        inputSummary: '1 image (image/jpeg), 6 structured fields requested',
        timestamp: '2026-08-17T09:14:00Z',
        attempts: [
            {
                providerId: 'gemini', model: 'gemini-3.6-flash', attemptNumber: 1,
                status: 'attempted', success: false, category: 'quota_exceeded',
                httpStatus: 429, latencyMs: 812, nextProviderId: 'mistral',
            },
            {
                providerId: 'mistral', model: 'mistral-large-latest', attemptNumber: 2,
                status: 'attempted', success: false, category: 'model_unavailable',
                httpStatus: 404, latencyMs: 240, nextProviderId: 'groq',
            },
            {
                providerId: 'groq', model: 'qwen/qwen3.6-27b', attemptNumber: 3,
                status: 'attempted', success: true, latencyMs: 1940, schemaValid: true,
            },
        ],
    };

    function stubWithLogs(entries = [TRANSACTION]) {
        stubCallables({
            listAiTelemetry: vi.fn().mockResolvedValue({
                data: { entries, truncated: false, windowSize: entries.length },
            }),
        });
    }

    /**
     * Opens the Logs tab and waits for the table to actually hold the rows.
     *
     * Waiting on the text "CDL extraction" alone is not enough: the feature
     * filter renders it as an <option> immediately, so the wait resolves before
     * the debounced fetch lands. Scoping to the table is what makes the
     * assertion about the data rather than about the filter control.
     */
    async function openLogs() {
        stubWithLogs();
        await renderView();
        fireEvent.click(screen.getByRole('tab', { name: /logs/i }));
        const table = await screen.findByRole('table', { name: /AI transactions/i });
        await waitFor(() => expect(within(table).getByText('CDL extraction')).toBeTruthy());
        return table;
    }

    it('exposes both sections as a keyboard-operable tablist', async () => {
        stubWithLogs();
        await renderView();

        const tablist = screen.getByRole('tablist', { name: /AI Integrations sections/i });
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Providers', 'Logs']);

        // Roving focus: only the selected tab is in the tab order.
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(tabs[0].getAttribute('tabindex')).toBe('0');
        expect(tabs[1].getAttribute('tabindex')).toBe('-1');

        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        await waitFor(() => expect(tabs[1].getAttribute('aria-selected')).toBe('true'));
    });

    it('lists one row per transaction, showing the fallback count without opening it', async () => {
        const table = await openLogs();

        expect(within(table).getByText('Success')).toBeTruthy();
        // A success that needed three providers is a different event from one
        // that needed none, and an operator watching for trouble wants that
        // visible in the list.
        expect(within(table).getByText('after 2 fallbacks')).toBeTruthy();
    });

    it('expands a transaction into the provider timeline that explains it', async () => {
        const table = await openLogs();

        fireEvent.click(within(table).getByText('CDL extraction'));

        const dialog = await screen.findByRole('dialog');
        // The timeline the platform could not previously produce at all.
        expect(within(dialog).getByText(/1\. gemini/)).toBeTruthy();
        expect(within(dialog).getByText('Quota exhausted')).toBeTruthy();
        expect(within(dialog).getByText(/2\. mistral/)).toBeTruthy();
        expect(within(dialog).getByText('Model not found')).toBeTruthy();
        expect(within(dialog).getByText(/3\. groq/)).toBeTruthy();
        expect(within(dialog).getByText('Success via groq')).toBeTruthy();
        expect(within(dialog).getByText(/Fell back to mistral/)).toBeTruthy();
    });

    it('shows the request as a shape description, never as content', async () => {
        const table = await openLogs();
        fireEvent.click(within(table).getByText('CDL extraction'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('1 image (image/jpeg), 6 structured fields requested')).toBeTruthy();
    });

    it('sends the chosen filters to the server', async () => {
        stubWithLogs();
        await renderView();
        fireEvent.click(screen.getByRole('tab', { name: /logs/i }));
        await waitFor(() => expect(callables.listAiTelemetry).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Errors' }));

        await waitFor(() => {
            const lastCall = callables.listAiTelemetry.mock.calls.at(-1)[0];
            expect(lastCall).toMatchObject({ outcome: 'failure' });
        });
    });

    it('distinguishes an empty log from a filtered one', async () => {
        stubWithLogs([]);
        await renderView();
        fireEvent.click(screen.getByRole('tab', { name: /logs/i }));

        await waitFor(() => expect(
            screen.getByText('No AI requests have been recorded yet.'),
        ).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'CDL' }));

        await waitFor(() => expect(
            screen.getByText('No transactions match these filters.'),
        ).toBeTruthy());
    });

    it('says when it is showing a window rather than everything that matched', async () => {
        stubCallables({
            listAiTelemetry: vi.fn().mockResolvedValue({
                data: { entries: [TRANSACTION], truncated: true, windowSize: 250 },
            }),
        });
        await renderView();
        fireEvent.click(screen.getByRole('tab', { name: /logs/i }));

        // Presenting a partial list as complete is worse than admitting the
        // window, because the operator draws a conclusion from what is absent.
        await waitFor(() => expect(
            screen.getByText(/most recent matching transactions only/i),
        ).toBeTruthy());
    });

    it('never renders a prompt, an image or a credential in a log', async () => {
        const table = await openLogs();
        fireEvent.click(within(table).getByText('CDL extraction'));
        await screen.findByRole('dialog');

        const markup = document.body.innerHTML;
        expect(markup).not.toContain(REAL_SECRET);
        expect(markup).not.toMatch(/data:image/);
        expect(markup).not.toMatch(/base64/);
    });
});

/**
 * The console has to be truthful about *why* a provider is not working, because
 * the operator's next action differs completely between the cases — and two of
 * them used to render identically.
 */

describe('article transactions in the log', () => {
    const ENTRIES = [
        {
            id: 'e1',
            transactionId: 'txn-gen',
            taskType: 'article_generation',
            outcome: 'success',
            fallbackCount: 0,
            timestamp: '2026-08-18T10:00:00Z',
            attempts: [],
        },
        {
            id: 'e2',
            transactionId: 'txn-check',
            taskType: 'article_fact_check',
            outcome: 'success',
            verdict: 'unsupported',
            fallbackCount: 0,
            timestamp: '2026-08-18T10:01:00Z',
            attempts: [],
        },
        {
            id: 'e3',
            transactionId: 'txn-cdl',
            taskType: 'cdl_extraction',
            outcome: 'success',
            fallbackCount: 0,
            timestamp: '2026-08-18T10:02:00Z',
            attempts: [],
        },
    ];

    async function openLogsWithEntries() {
        stubCallables({
            listAiTelemetry: vi.fn().mockResolvedValue({
                data: { entries: ENTRIES, truncated: false, windowSize: 3 },
            }),
        });
        await renderView();
        fireEvent.click(screen.getByRole('tab', { name: /logs/i }));
        const table = await screen.findByRole('table', { name: /AI transactions/i });
        await waitFor(() => expect(within(table).getByText('Article generation')).toBeTruthy());
        return table;
    }

    it('says a successful fact-check refused the article', async () => {
        const table = await openLogsWithEntries();

        // "Success · first provider" read as an unqualified pass for a verdict
        // that is the reason nothing published.
        expect(within(table).getByText(/claims NOT supported/i)).toBeTruthy();
    });

    it('includes the fact-check under the Articles quick filter, not just generation', async () => {
        const table = await openLogsWithEntries();

        fireEvent.click(screen.getByRole('button', { name: /^Articles$/ }));

        // The panel debounces and re-fetches, so wait for the filter to land
        // rather than asserting against the pre-filter render.
        await waitFor(() => expect(within(table).queryByText('CDL extraction')).toBeNull());
        expect(within(table).getByText('Article verification')).toBeTruthy();
        expect(within(table).getByText('Article generation')).toBeTruthy();
    });

    it('does not send the article pair to the server as a task type', async () => {
        await openLogsWithEntries();
        const call = callables.listAiTelemetry;
        call.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /^Articles$/ }));

        await waitFor(() => expect(call).toHaveBeenCalled());
        // The server takes one equality filter, and `articleTasks` is not one of
        // its filters — sending it would be silently dropped and the pair lost.
        for (const [payload] of call.mock.calls) {
            expect(payload).not.toHaveProperty('articleTasks');
            expect(payload.taskType).toBeUndefined();
        }
    });
});

