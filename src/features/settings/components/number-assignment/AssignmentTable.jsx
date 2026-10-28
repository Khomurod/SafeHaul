import React from 'react';
import { Card, DataTable } from '@/design-system/components';
import { assignmentColumns } from './assignmentColumns';

/**
 * "Who texts from which line": one row per team member, each with the line they
 * text from. Presentation only — member data and callbacks pass straight
 * through to the column renderers (`assignmentColumns`).
 *
 * `onRetry` is passed only when the team could not be loaded: the table then
 * says so instead of listing anyone.
 *
 * On a phone it is one card per member: nothing here is compared across rows,
 * so each row stacks with every value under its column's label instead of
 * scrolling sideways. The table states its roles itself, because
 * `display: block` can drop the implicit ones.
 */
export function AssignmentTable({ users, loading = false, onRetry, ...rowProps }) {
    return (
        <Card padding="none" className="overflow-hidden">
            <div className="border-b border-ds-border-subtle px-ds-4 py-ds-3">
                <h2 className="font-semibold text-ds-content">Who texts from which line</h2>
                <p className="text-ds-sm text-ds-content-muted">A member without a line of their own texts from the default line.</p>
            </div>
            <DataTable
                embedded
                ariaLabel="Who texts from which line"
                density="compact"
                minWidth="standard"
                mobilePresentation="cards"
                data={users}
                columns={assignmentColumns(rowProps)}
                getRowId={(user) => user.id}
                isLoading={loading}
                loadingLabel="Loading team"
                error={onRetry ? { title: "Couldn't load your team", message: "We couldn't load your team. Try again.", onRetry } : undefined}
                empty={{ title: 'No team members found.' }}
            />
        </Card>
    );
}

export default AssignmentTable;
