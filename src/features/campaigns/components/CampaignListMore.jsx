import React from 'react';
import { Button, Notice } from '@/design-system/components';

const format = (n) => n.toLocaleString('en-US');
const ofTotal = (total) => (total === null || total === undefined ? '' : ` of ${format(total)}`);

/** What the line under each tab's cards says while the list is incomplete, and after the last page. */
const LIST_COPY = {
    drafts: {
        shown: (n, total) => `Showing the newest ${format(n)}${ofTotal(total)} drafts.`,
        action: 'Load more drafts',
        failed: 'More drafts could not be loaded.',
        done: (n) => `All ${format(n)} drafts are shown.`,
    },
    history: {
        shown: (n, total) => `Showing ${format(n)}${ofTotal(total)} campaigns, newest first. Live campaigns are always listed.`,
        action: 'Load older campaigns',
        failed: 'Older campaigns could not be loaded.',
        done: (n) => `All ${format(n)} campaigns are shown.`,
    },
};

/**
 * Where a Campaigns tab's loaded cards end (`tab`: 'drafts' | 'history'):
 * "Showing … of N" with a Load button while more remain, the failure of the
 * last load beside it, and "All N … are shown." once the user has loaded the
 * last page. `list` is one list from `useCampaignLists`; `focus` is that
 * list's `useLoadMoreFocus`, owned by the dashboard so it outlives a tab switch.
 */
export function CampaignListMore({ tab, list, focus }) {
    const { buttonRef, doneRef, showDone, press } = focus;
    if (!list.hasMore && !showDone) return null;
    const copy = LIST_COPY[tab];
    return (
        <div className="mt-ds-4 flex flex-col gap-ds-2">
            {list.hasMore && (
                <Notice
                    tone="info"
                    size="sm"
                    actions={(
                        <Button ref={buttonRef} variant="secondary" size="sm" loading={list.isLoadingMore} onClick={press(list.loadMore)}>
                            {copy.action}
                        </Button>
                    )}
                >
                    {copy.shown(list.items.length, list.total)}
                </Notice>
            )}
            {list.hasMore && list.loadMoreFailed && (
                <p role="alert" className="text-ds-sm text-ds-status-danger-fg">{copy.failed}</p>
            )}
            {showDone && (
                <Notice ref={doneRef} tabIndex={-1} tone="info" size="sm">
                    {copy.done(list.items.length)}
                </Notice>
            )}
        </div>
    );
}

export default CampaignListMore;
