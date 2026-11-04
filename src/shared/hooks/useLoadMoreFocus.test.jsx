import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Notice } from '@/design-system/components';
import { useLoadMoreFocus } from './useLoadMoreFocus';

/** A list's Load more control, as the screens compose it from the approved Notice and Button. */
function LoadMoreHarness({ onLoadMore = () => {}, ...list }) {
    const { buttonRef, doneRef, showDone, press } = useLoadMoreFocus(list);
    return (
        <div>
            <input aria-label="Search" />
            {list.hasMore && (
                <Notice
                    tone="info"
                    size="sm"
                    actions={(
                        <Button ref={buttonRef} variant="secondary" size="sm" loading={list.isLoadingMore} onClick={press(onLoadMore)}>
                            Load more
                        </Button>
                    )}
                >
                    {`Showing the newest ${list.loadedCount}.`}
                </Notice>
            )}
            {showDone && (
                <Notice ref={doneRef} tabIndex={-1} tone="info" size="sm">
                    {`All ${list.loadedCount} are shown.`}
                </Notice>
            )}
        </div>
    );
}

const FIRST = { resetKey: 'list-1', hasMore: true, isLoadingMore: false, loadMoreFailed: false, loadedCount: 5 };

/** Renders the first page, presses Load more and puts the list in its loading state. */
function pressLoadMore() {
    const onLoadMore = vi.fn();
    const view = render(<LoadMoreHarness {...FIRST} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    view.rerender(<LoadMoreHarness {...FIRST} isLoadingMore onLoadMore={onLoadMore} />);
    const show = (list) => view.rerender(<LoadMoreHarness {...FIRST} {...list} onLoadMore={onLoadMore} />);
    return { ...view, show };
}

describe('useLoadMoreFocus', () => {
    it('moves nothing and shows no done line before any press', () => {
        const { rerender } = render(<LoadMoreHarness {...FIRST} />);
        expect(document.activeElement).toBe(document.body);
        // A list that fits in its first read says nothing extra.
        rerender(<LoadMoreHarness {...FIRST} hasMore={false} />);
        expect(screen.queryByText(/are shown/)).not.toBeInTheDocument();
        expect(document.activeElement).toBe(document.body);
    });

    it('puts focus on the button when the page arrives and more remain', () => {
        const { show } = pressLoadMore();
        show({ loadedCount: 10 });
        expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus();
    });

    it('puts focus on the done line after the last page', () => {
        const { show } = pressLoadMore();
        show({ loadedCount: 12, hasMore: false });
        expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
        expect(screen.getByText('All 12 are shown.').closest('.ds-notice')).toHaveFocus();
    });

    it('puts focus back on the button when the page fails', () => {
        const { show } = pressLoadMore();
        show({ loadMoreFailed: true });
        expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus();
    });

    it('leaves focus where the user moved it while the page loaded', () => {
        const { show } = pressLoadMore();
        screen.getByRole('textbox', { name: 'Search' }).focus();
        show({ loadedCount: 12, hasMore: false });
        expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
        expect(screen.getByText('All 12 are shown.')).toBeInTheDocument();
    });

    it('waits while the page is still loading', () => {
        const { show } = pressLoadMore();
        show({ isLoadingMore: true, loadedCount: 5 });
        expect(document.activeElement).toBe(document.body);
    });

    it('clears the done line for another list', () => {
        const { show } = pressLoadMore();
        show({ loadedCount: 12, hasMore: false });
        expect(screen.getByText('All 12 are shown.')).toBeInTheDocument();

        show({ resetKey: 'list-2', loadedCount: 3, hasMore: false });
        expect(screen.queryByText(/are shown/)).not.toBeInTheDocument();
    });
});
