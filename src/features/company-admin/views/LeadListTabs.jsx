import React from 'react';
import { useHref, useLinkClickHandler, useLocation } from 'react-router-dom';
import { TabNav } from '@/design-system/components';
import { LEAD_LIST_TABS } from './leadLists';

/**
 * One tab's link: a real address (open in a new tab, copy the link) that an
 * ordinary click follows in place. The query string goes with it, which is how
 * the browser tests sign in.
 */
function useTabLink({ scope, label, path }, search) {
    const to = { pathname: path, search };
    return { id: scope, label, href: useHref(to), onClick: useLinkClickHandler(to) };
}

/**
 * The leads lists (`LEAD_LIST_TABS`) as links, the one shown marked current: a
 * segmented tray at the start of the list's toolbar row, the scope the status
 * pills in the table card then narrow.
 */
export function LeadListTabs({ scope }) {
    const { search } = useLocation();
    const [all, mine, unassigned] = LEAD_LIST_TABS;
    const items = [useTabLink(all, search), useTabLink(mine, search), useTabLink(unassigned, search)];
    return <TabNav ariaLabel="Lead lists" variant="segmented" items={items} currentId={scope} />;
}
