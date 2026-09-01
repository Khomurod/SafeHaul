/**
 * Deletion and the recent-authentication guard around it.
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
    reauthenticateWithCredential,
    POSTS,
    stubCallables,
    renderView,
    resetHarness,
} from './BlogPostsView.contract.support';

beforeEach(() => {
    resetHarness();
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

