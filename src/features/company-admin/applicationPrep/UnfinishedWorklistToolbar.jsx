import React from 'react';
import { ListToolbar } from '@/design-system/patterns';
import { WORKLIST_FILTERS } from './unfinishedWorklist';

/**
 * The worklist's one row of controls: the filters, each with what it would
 * show, and the search. The page's heading carries the number of rows shown.
 *
 * Outside `DataTable` by the design system's rule: the table must not learn a
 * feature's filters. The counts are the whole list's, before the search, so a
 * filter says what pressing it shows. Until the list is in (`ready`) there is
 * nothing to count, so no number shows rather than a zero; and when the list
 * stops at its 200 most recent (`truncated`), every count is "at least". The
 * page holds the state; this only shows it.
 *
 * @param {{ counts: Record<string, number>, ready: boolean, truncated: boolean, query: string,
 *   onQuery: (query: string) => void, filter: string, onFilter: (id: string) => void }} props
 */
export function UnfinishedWorklistToolbar({ counts, ready, truncated, query, onQuery, filter, onFilter }) {
    return (
        <ListToolbar
            segments={{
                ariaLabel: 'Show',
                items: WORKLIST_FILTERS.map(({ id, label }) => ({
                    id,
                    label,
                    count: ready ? `${counts[id]}${truncated ? '+' : ''}` : undefined,
                })),
                value: filter,
                onChange: onFilter,
            }}
            search={{
                label: 'Search by name, phone or email',
                placeholder: 'Search name, phone, email…',
                value: query,
                onChange: onQuery,
            }}
        />
    );
}

export default UnfinishedWorklistToolbar;
