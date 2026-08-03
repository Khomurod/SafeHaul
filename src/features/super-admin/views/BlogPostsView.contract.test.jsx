/**
 * Contract proof for the Super Admin Blog Posts screen.
 *
 * The screen is deliberately minimal — titles and a Delete action — so the
 * properties worth pinning are mostly about what it does *not* do, and about
 * deletion being properly guarded:
 *
 *  - it lists titles and stays a list, not a content-management screen;
 *  - deletion asks for confirmation and names the article;
 *  - deletion requires recent authentication, and a dismissed prompt reports
 *    nothing;
 *  - focus is restored somewhere meaningful after the row disappears;
 *  - a removed article is labelled and offers no further actions;
 *  - loading, empty and error states are all reachable.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { BlogPostsView } from './BlogPostsView';

const POSTS = [
    {
        id: '2026-08-02_industry-news',
        title: 'FMCSA Updates Hours-of-Service Documentation Requirements',
        slug: 'fmcsa-updates-hours-of-service-documentation',
        publicationDate: '2026-08-02',
        status: 'published',
    },
    {
        id: '2026-08-02_recruitment',
        title: 'Cutting Driver Turnover in the First Ninety Days',
        slug: 'cutting-driver-turnover-first-ninety-days',
        publicationDate: '2026-08-02',
        status: 'published',
    },
    {
        id: '2026-08-01_safehaul-education',
        title: 'Electronic Signatures for Driver Qualification Paperwork',
        slug: 'electronic-signatures-driver-qualification',
        publicationDate: '2026-08-01',
        status: 'deleted',
    },
];

function stubCallables(overrides = {}) {
    callables.listBlogPosts = vi.fn().mockResolvedValue({
        data: { posts: POSTS, generatedAt: '2026-08-02T18:00:00Z' },
    });
    callables.deleteBlogPost = vi.fn().mockResolvedValue({ data: { deleted: true } });
    callables.runBlogPublicationNow = vi.fn().mockResolvedValue({
        data: { dueCount: 3, attempted: 0, published: 0, results: [] },
    });
    Object.assign(callables, overrides);
}

async function renderView() {
    const utils = render(<BlogPostsView />);
    await waitFor(() => expect(screen.getByText(POSTS[0].title)).toBeTruthy());
    return utils;
}

beforeEach(() => {
    vi.clearAllMocks();
    stubCallables();
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

        await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
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

describe('deletion', () => {
    it('asks for confirmation and names the article', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Delete this article\?/)).toBeTruthy();
        expect(within(dialog).getByText(new RegExp(POSTS[0].title))).toBeTruthy();
    });

    it('does nothing when the confirmation is dismissed', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep article' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(callables.deleteBlogPost).not.toHaveBeenCalled();
    });

    it('deletes the confirmed article by id', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        await waitFor(() => expect(callables.deleteBlogPost).toHaveBeenCalledWith({
            postId: '2026-08-02_industry-news',
        }));
    });

    it('reloads the list after a deletion so the public state is reflected', async () => {
        await renderView();
        expect(callables.listBlogPosts).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        await waitFor(() => expect(callables.listBlogPosts).toHaveBeenCalledTimes(2));
    });

    it('moves focus to the heading, because the row that opened the dialog is gone', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        await waitFor(() => expect(callables.deleteBlogPost).toHaveBeenCalled());
        await waitFor(() => expect(
            document.activeElement,
        ).toBe(screen.getByRole('heading', { level: 2, name: 'Blog Posts' })));
    });

    it('reports a server refusal inside the dialog rather than closing it', async () => {
        stubCallables({
            deleteBlogPost: vi.fn().mockRejectedValue({
                code: 'functions/not-found',
                message: 'That article no longer exists.',
            }),
        });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        await waitFor(() => expect(
            screen.getByText(/no longer exists/i),
        ).toBeTruthy());
        expect(screen.queryByRole('dialog')).not.toBeNull();
    });
});

describe('recent authentication', () => {
    const staleOnce = () => {
        let called = false;
        return vi.fn(async () => {
            if (!called) {
                called = true;
                const error = new Error('failed: REAUTH_REQUIRED');
                error.code = 'functions/failed-precondition';
                throw error;
            }
            return { data: { deleted: true } };
        });
    };

    it('prompts for the password and retries the deletion once', async () => {
        stubCallables({ deleteBlogPost: staleOnce() });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        const password = await screen.findByLabelText(/password/i);
        fireEvent.change(password, { target: { value: 'correct-horse' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(callables.deleteBlogPost).toHaveBeenCalledTimes(2));
    });

    it('deletes nothing and reports nothing when the prompt is dismissed', async () => {
        stubCallables({ deleteBlogPost: staleOnce() });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));

        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(callables.deleteBlogPost).toHaveBeenCalledTimes(1);
        // A dismissed prompt means the action never completed.
        expect(showSuccess).not.toHaveBeenCalled();
    });
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
