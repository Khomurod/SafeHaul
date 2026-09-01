/**
 * The manual publication check and the publication run ledger.
 *
 * Part of the BlogPostsView contract suite, split from the original single
 * file by subject. The fixtures, callable stubs and spies live in
 * `BlogPostsView.contract.support.jsx`, together with the original
 * contract-proof header. Each `vi.mock` below has to stay in this file,
 * because vitest hoists it per file and cannot register one from a helper.
 */

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./BlogPostsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./BlogPostsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./BlogPostsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./BlogPostsView.contract.support')).feedbackMock());

import {
    callables,
    showSuccess,
    showError,
    showInfo,
    POSTS,
    stubCallables,
    renderView,
    resetHarness,
} from './BlogPostsView.contract.support';

beforeEach(() => {
    resetHarness();
});

describe('manual publication check', () => {
    it('runs the same idempotent pass the schedule uses', async () => {
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Run today’s publication check/i }));

        await waitFor(() => expect(callables.runBlogPublicationNow).toHaveBeenCalled());
    });

    it('reports "already filled" as information, not as a failure', async () => {
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Run today’s publication check/i }));

        await waitFor(() => expect(showInfo).toHaveBeenCalledWith(
            'Every due slot for today is already filled.',
        ));
        expect(showError).not.toHaveBeenCalled();
    });

    it('reports how many articles were published', async () => {
        stubCallables({
            runBlogPublicationNow: vi.fn().mockResolvedValue({
                data: {
                    dueCount: 3,
                    attempted: 1,
                    published: 1,
                    results: [{ slot: '2026-08-02_industry-news', theme: 'industry-news', outcome: 'published' }],
                },
            }),
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Run today’s publication check/i }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Published 1 article(s).'));
    });

    it('explains a run that published nothing', async () => {
        stubCallables({
            runBlogPublicationNow: vi.fn().mockResolvedValue({
                data: {
                    dueCount: 3,
                    attempted: 1,
                    published: 0,
                    results: [{
                        slot: '2026-08-02_industry-news',
                        theme: 'industry-news',
                        outcome: 'skipped_all_duplicates',
                    }],
                },
            }),
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: /Run today’s publication check/i }));

        await waitFor(() => expect(showInfo).toHaveBeenCalledWith(
            'Nothing new was published (skipped_all_duplicates).',
        ));
    });
});

/**
 * The publication run ledger.
 *
 * The article list above can only ever show runs that *succeeded* — it reads
 * `blog_posts` — so publication failure was rendered as absence, and a slot
 * refused for an unsupported claim looked exactly like a slot nobody attempted.
 * Meanwhile the AI transactions those refused runs made were recorded as
 * successes, because a telemetry success means "a provider answered in a valid
 * shape". Two green rows, no article.
 */
describe('publication run ledger', () => {
    /**
     * Scoped to the ledger list throughout. The article table has a "Published"
     * column header and the stage filter repeats every stage name in an
     * `<option>`, so an unscoped match would pass on the chrome rather than the
     * data — the kind of assertion that keeps passing after the feature breaks.
     */
    const ledger = () => screen.getByRole('list', { name: /Publication runs/i });

    it('names the stage that decided each run', async () => {
        await renderView();

        expect(within(ledger()).getByText('Fact-check')).toBeTruthy();
        expect(within(ledger()).getByText('Publication')).toBeTruthy();
        expect(within(ledger()).getByText('Scheduling')).toBeTruthy();
    });

    it('separates a refused run from a published one in words, not only colour', async () => {
        await renderView();

        expect(within(ledger()).getByText('Published')).toBeTruthy();
        expect(within(ledger()).getByText('Unsupported factual claim')).toBeTruthy();
    });

    it('says a held slot was held, rather than leaving it looking like a failure', async () => {
        await renderView();

        // At most one article publishes per run, so a backlog fills over
        // successive hourly runs. That is the pipeline working.
        expect(screen.getByText('Held for the next run')).toBeTruthy();
    });

    it('reports the fact-check verdict, which is not the same fact as the call succeeding', async () => {
        await renderView();

        expect(screen.getByText(/Fact-check found 1 unsupported claim/)).toBeTruthy();
    });

    it('carries the transaction ids so a run can be matched to its provider timeline', async () => {
        await renderView();

        expect(screen.getByText(/txn-gen-2/)).toBeTruthy();
        expect(screen.getByText(/txn-ver-2/)).toBeTruthy();
    });

    it('shows the pipeline detail the run recorded', async () => {
        await renderView();

        expect(screen.getByText('The rule takes effect in January 2027.')).toBeTruthy();
    });

    it('filters to one stage', async () => {
        await renderView();

        fireEvent.change(screen.getByLabelText(/Pipeline stage/i), { target: { value: 'verification' } });

        expect(within(ledger()).getByText('Unsupported factual claim')).toBeTruthy();
        expect(within(ledger()).queryByText('Published')).toBeNull();
    });

    it('hides the published runs when an operator only wants the refusals', async () => {
        await renderView();

        fireEvent.click(screen.getByLabelText(/Include published runs/i));

        expect(within(ledger()).queryByText('Published')).toBeNull();
        expect(within(ledger()).getByText('Unsupported factual claim')).toBeTruthy();
    });

    it('distinguishes an unreadable ledger from a ledger with nothing in it', async () => {
        stubCallables({
            listBlogRuns: vi.fn().mockResolvedValue({
                data: { runs: [], truncated: false, unavailable: true, retentionDays: 30 },
            }),
        });
        await renderView();

        // "No runs recorded" would be a claim; "could not be read" is the truth.
        expect(screen.getByText(/not evidence that no runs/i)).toBeTruthy();
    });

    it('reports an empty ledger plainly when it really is empty', async () => {
        stubCallables({
            listBlogRuns: vi.fn().mockResolvedValue({
                data: { runs: [], truncated: false, unavailable: false, retentionDays: 30 },
            }),
        });
        await renderView();

        expect(screen.getByText('No publication runs have been recorded yet.')).toBeTruthy();
    });

    it('keeps the article list usable when the ledger cannot be loaded', async () => {
        stubCallables({
            listBlogRuns: vi.fn().mockRejectedValue({ code: 'functions/internal' }),
        });
        await renderView();

        expect(screen.getByText(POSTS[0].title)).toBeTruthy();
        expect(screen.getByText(/publication run history could not be loaded/i)).toBeTruthy();
    });
});

