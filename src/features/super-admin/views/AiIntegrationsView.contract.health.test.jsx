/**
 * Health: per-lane health and what a failed capability says.
 *
 * Part of the AiIntegrationsView contract suite, split from the original
 * single file by subject. The fixtures, callable stubs, spies and the
 * security-proof context live in `AiIntegrationsView.contract.support.jsx`;
 * the properties pinned across the suite are listed there and in the view.
 * Each `vi.mock` below has to stay in this file, because vitest hoists it
 * per file and cannot register one from a helper.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import {
    PROVIDERS,
    routingFor,
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

describe('per-lane health', () => {
    it('shows a broken image lane even when the text lane is working', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (row.id === 'gemini'
                        ? {
                            ...row,
                            laneHealth: { text: 'healthy', vision: 'degraded' },
                            laneFailures: { text: 0, vision: 3 },
                        }
                        : row)),
                    routing: routingFor(PROVIDERS),
                    telemetry: [],
                    generatedAt: '2026-08-02T12:00:00Z',
                },
            }),
        });

        await renderView();

        // The state a single badge could not express: articles fine, document
        // images broken. A successful article used to turn the whole row green.
        expect(screen.getAllByText('Failing').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
    });
});

describe('what a failed capability says', () => {
    it('names the vendor status and code rather than only "Failed"', async () => {
        stubCallables({
            testAiProvider: vi.fn().mockResolvedValue({
                data: {
                    success: false,
                    message: '1 of 2 capabilities failed: Single-image vision.',
                    model: 'model-a',
                    latencyMs: 300,
                    capabilities: [
                        { id: 'text', label: 'Basic text', status: 'passed', message: 'Passed.' },
                        {
                            id: 'vision_single',
                            label: 'Single-image vision',
                            status: 'failed',
                            category: 'model_unavailable',
                            httpStatus: 404,
                            vendorCode: 'model_not_found',
                            message: 'The configured AI model is not available.',
                        },
                    ],
                },
            }),
        });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        // "HTTP 404 · model_not_found" is the difference between repinning a
        // model and suspecting the vendor. Both facts were captured server-side
        // and then dropped before they reached this screen.
        await waitFor(() => expect(screen.getByText(/HTTP 404/)).toBeTruthy());
        expect(screen.getByText(/model_not_found/)).toBeTruthy();
    });

    it('reports a throttled probe as throttled, not as a broken capability', async () => {
        stubCallables({
            testAiProvider: vi.fn().mockResolvedValue({
                data: {
                    success: false,
                    message: 'Not verified: Single-image vision. The vendor throttled the check rather than refusing the capability.',
                    model: 'model-a',
                    latencyMs: 300,
                    capabilities: [
                        { id: 'text', label: 'Basic text', status: 'passed', message: 'Passed.' },
                        {
                            id: 'vision_single',
                            label: 'Single-image vision',
                            status: 'rate_limited',
                            category: 'rate_limited',
                            httpStatus: 429,
                            message: 'The vendor throttled this check, so the capability was not tested.',
                        },
                    ],
                },
            }),
        });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(screen.getByText('Throttled')).toBeTruthy());
        // It must not read as a failure: a free tier's per-minute budget is small
        // enough that the connection test can spend it on itself, and calling
        // that "this provider cannot read images" is how working vision
        // providers were reported as broken.
        expect(screen.queryByText('Failed')).toBeNull();
    });

    it('keeps the breakdown after a reload, from the stored result', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (row.id === 'groq'
                        ? {
                            ...row,
                            lastTest: {
                                at: '2026-08-18T10:00:00Z',
                                success: false,
                                category: 'provider_request_rejected',
                                capabilities: [
                                    { id: 'text', label: 'Basic text', status: 'passed', message: 'Passed.' },
                                    {
                                        id: 'vision_single',
                                        label: 'Single-image vision',
                                        status: 'failed',
                                        category: 'provider_request_rejected',
                                        httpStatus: 400,
                                        vendorCode: 'invalid_request_error',
                                        message: 'The AI service rejected the request SafeHaul sent.',
                                    },
                                ],
                            },
                        }
                        : row)),
                    routing: routingFor(PROVIDERS),
                    telemetry: [],
                    generatedAt: '2026-08-02T12:00:00Z',
                },
            }),
        });

        await renderView();

        // Without persistence this row showed a bare "Failed" after any reload —
        // which is when an operator comes back to look.
        expect(screen.getByText(/HTTP 400/)).toBeTruthy();
        expect(screen.getByText('Request rejected by vendor')).toBeTruthy();
    });
});

/**
 * One article run makes two AI transactions, and a telemetry success means "a
 * provider answered in a valid shape" — not "an article published". Both facts
 * conspired: the Articles quick filter named `article_generation` alone, so a run
 * refused by the fact-check was invisible under the filter an operator would
 * think to use, and the fact-check row itself said "Success" for a verdict that
 * correctly refused publication.
 */
