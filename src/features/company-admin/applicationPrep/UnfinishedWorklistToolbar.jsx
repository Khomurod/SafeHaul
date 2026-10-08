import React from 'react';
import { Icon, Search } from '@design-system/icons';
import { Chip, ChipGroup, Input } from '@/design-system/components';
import { WORKLIST_FILTERS } from './unfinishedWorklist';

/**
 * The top of the worklist: how many there are, how many are nearly done and how
 * many have gone quiet, a search, and the filters with what each would show.
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
    const count = (id) => (ready ? `${counts[id]}${truncated ? '+' : ''}` : null);
    return (
        <div>
            <div className="flex flex-col gap-ds-3 p-ds-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    {ready && (
                        <>
                            <h2 className="text-ds-heading-sm font-bold text-ds-content">
                                {`${count('all')} unfinished`}
                            </h2>
                            <p className="text-ds-sm text-ds-content-secondary">
                                {`${count('almost')} almost done · ${count('quiet')} with no activity for a week or more`}
                            </p>
                        </>
                    )}
                </div>
                <div className="relative w-full sm:max-w-sm">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-ds-3">
                        <Icon icon={Search} className="text-ds-content-muted" />
                    </span>
                    <Input
                        type="search"
                        aria-label="Search by name, phone or email"
                        placeholder="Search name, phone, email…"
                        className="pl-ds-10"
                        value={query}
                        onChange={(event) => onQuery(event.target.value)}
                    />
                </div>
            </div>
            <ChipGroup
                ariaLabel="Show"
                className="border-t border-ds-border-subtle px-ds-4 py-ds-3"
            >
                {WORKLIST_FILTERS.map(({ id, label }) => (
                    <Chip key={id} size="sm" pressed={filter === id} onClick={() => onFilter(id)}>
                        {/* The space is the name's: "All 6", not "All6". */}
                        {label}
                        {ready && <>{' '}<span className="font-bold">{count(id)}</span></>}
                    </Chip>
                ))}
            </ChipGroup>
        </div>
    );
}

export default UnfinishedWorklistToolbar;
