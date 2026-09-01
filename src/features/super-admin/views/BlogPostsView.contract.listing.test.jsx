/**
 * Listing, removed articles, and viewing a published article.
 *
 * Part of the BlogPostsView contract suite, split from the original single
 * file by subject. The fixtures, callable stubs and spies live in
 * `BlogPostsView.contract.support.jsx`, together with the original
 * contract-proof header. Each `vi.mock` below has to stay in this file,
 * because vitest hoists it per file and cannot register one from a helper.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./BlogPostsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./BlogPostsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./BlogPostsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./BlogPostsView.contract.support')).feedbackMock());

import { BlogPostsView } from './BlogPostsView';
import {
    POSTS,
    stubCallables,
    renderView,
    resetHarness,
} from './BlogPostsView.contract.support';

beforeEach(() => {
    resetHarness();
});

describe('listing', () => {
    it('shows every article title', async () => {
        await renderView();
        for (const post of POSTS) {
            expect(screen.getByText(post.title)).toBeTruthy();
        }
    });

    it('shows the publication date, which is what distinguishes similar articles', async () => {
        await renderView();
        expect(screen.getAllByText('2026-08-02').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-08-01')).toBeTruthy();
    });

    it('stays a list rather than becoming a content-management screen', async () => {
        await renderView();

        // No editor, no body, no publish/unpublish controls, no draft state.
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /publish article/i })).toBeNull();
    });

    it('starts at h2, because the Super Admin masthead owns the single h1', async () => {
        await renderView();

        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(screen.getByRole('heading', { level: 2, name: 'Blog Posts' })).toBeTruthy();
    });

    it('explains the publication cadence and what deletion does', async () => {
        await renderView();
        expect(screen.getByText(/Three articles\s+publish each day, one per theme/)).toBeTruthy();
        expect(screen.getByText(/the feed and the sitemap immediately/)).toBeTruthy();
    });

    it('shows an empty state when nothing has been published', async () => {
        stubCallables({ listBlogPosts: vi.fn().mockResolvedValue({ data: { posts: [] } }) });
        render(<BlogPostsView />);

        await waitFor(() => expect(
            screen.getByText('No articles have been published yet.'),
        ).toBeTruthy());
    });

    it('surfaces a load failure with a retry', async () => {
        stubCallables({
            listBlogPosts: vi.fn().mockRejectedValue({ code: 'functions/internal' }),
        });
        render(<BlogPostsView />);

        // Specific: the run ledger below reports its own load failure, and both
        // are correct to show. Matching loosely would pass on either.
        await waitFor(() => expect(screen.getByText('The article list could not be loaded.')).toBeTruthy());
        expect(screen.getAllByRole('button', { name: /try again/i }).length).toBeGreaterThan(0);
    });

    it('denies a non-super-admin through the callable, without a partial list', async () => {
        stubCallables({
            listBlogPosts: vi.fn().mockRejectedValue({ code: 'functions/permission-denied' }),
        });
        render(<BlogPostsView />);

        await waitFor(() => expect(
            screen.getByText('Super Admin access is required for this action.'),
        ).toBeTruthy());
        expect(screen.queryByText(POSTS[0].title)).toBeNull();
    });
});

describe('removed articles', () => {
    it('labels an article that has been removed', async () => {
        await renderView();
        expect(screen.getByText('Removed')).toBeTruthy();
    });

    it('offers no actions for an already-removed article', async () => {
        await renderView();

        // Two published posts, so exactly two Delete controls.
        expect(screen.getAllByRole('button', { name: /^Delete$/ })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: /^View$/ })).toHaveLength(2);
    });
});


describe('viewing a published article', () => {
    it('links by the slug the server returned, not an undefined one', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        try {
            await renderView();

            fireEvent.click(screen.getAllByRole('button', { name: /^View$/ })[0]);

            // `listBlogPosts` did not return `slug`, so every View opened
            // `/news/undefined`. The fixture included one, which is precisely why
            // no test caught it — a fixture richer than the server tests itself.
            expect(open).toHaveBeenCalledWith(
                `/news/${POSTS[0].slug}`,
                '_blank',
                'noopener',
            );
        } finally {
            open.mockRestore();
        }
    });

    it('does not offer a View for an article with no slug', async () => {
        stubCallables({
            listBlogPosts: vi.fn().mockResolvedValue({
                data: { posts: [{ ...POSTS[0], slug: null }] },
            }),
        });
        await renderView();

        // Better no control than one that opens a broken URL.
        expect(screen.queryByRole('button', { name: /^View$/ })).toBeNull();
    });
});
