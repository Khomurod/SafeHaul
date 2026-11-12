import React from 'react';
import { Button, Card } from '@/design-system/components';

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

/** The strip's inner row: a white card on the grid's edges, the words then the button; on a phone, stacked. */
const ROW = 'flex flex-wrap items-center justify-between gap-ds-4 px-ds-5 py-ds-4 max-md:flex-col max-md:items-stretch max-md:gap-ds-3 max-md:p-ds-4';
const TEXT = 'min-w-0 flex-1 text-ds-body text-ds-content-secondary [text-wrap:pretty]';

/**
 * Where a Campaigns tab's loaded cards end (`tab`: 'drafts' | 'history'):
 * "Showing … of N" with a Load button while more remain, the failure of the
 * last load under it, and "All N … are shown." once the user has loaded the
 * last page. Each is one white strip on the grid's edges, a grid gap under the
 * last row of cards. `list` is one list from `useCampaignLists`; `focus` is
 * that list's `useLoadMoreFocus`, owned by the dashboard so it outlives a tab
 * switch.
 */
export function CampaignListMore({ tab, list, focus }) {
    const { buttonRef, doneRef, showDone, press } = focus;
    if (!list.hasMore && !showDone) return null;
    const copy = LIST_COPY[tab];
    return (
        <div className="mt-ds-5 flex flex-col gap-ds-2">
            {list.hasMore && (
                <Card as="div" padding="none">
                    <div className={ROW}>
                        <div className="flex min-w-0 flex-1 flex-col gap-ds-1">
                            <p className={TEXT}>{copy.shown(list.items.length, list.total)}</p>
                            {list.loadMoreFailed && (
                                <p role="alert" className="text-ds-body text-ds-status-danger-fg">{copy.failed}</p>
                            )}
                        </div>
                        <Button ref={buttonRef} variant="secondary" loading={list.isLoadingMore} onClick={press(list.loadMore)}>
                            {copy.action}
                        </Button>
                    </div>
                </Card>
            )}
            {showDone && (
                <Card as="div" padding="none">
                    <div className={ROW}>
                        <p ref={doneRef} tabIndex={-1} className={TEXT}>{copy.done(list.items.length)}</p>
                    </div>
                </Card>
            )}
        </div>
    );
}

export default CampaignListMore;
