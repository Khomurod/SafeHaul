import React from 'react';
import { Icon, Users as UsersIcon } from '@design-system/icons';
import { Card, DataTable } from '@/design-system/components';
import { assignmentColumns } from './assignmentColumns';

/**
 * Recruiter assignment matrix.
 *
 * Presentation only — member data and callbacks pass straight through to the
 * column renderers (`assignmentColumns`), unchanged. It is an embedded
 * `DataTable`: the member heads each row, every other cell is a labelled
 * control or status, and the table's region and caption carry one name.
 *
 * On a phone it is one card per team member. This matrix is worked one member
 * at a time — nothing in it is compared across rows — so under 768px each row
 * stacks with every value under the label of its column (in the feature's own
 * words), instead of putting a `<select>` and its verify action 400px apart in
 * a sideways-scrolling form. Above 768px it is a table with its member column
 * pinned for the widths where it still scrolls. The table states its roles
 * explicitly, because `display: block` can drop the implicit ones. Same DOM at
 * every width, so the frozen 15-case suite and the a11y suite cover both.
 */
export function AssignmentTable({ users, ...rowProps }) {
    return (
        <Card padding="none" className="overflow-hidden">
            <div className="border-b border-ds-border-subtle p-ds-6">
                <h3 className="flex items-center gap-ds-2 font-bold text-ds-content">
                    <Icon icon={UsersIcon} size="lg" className="text-ds-status-accent-fg" /> Recruiter Assignments
                </h3>
                <p className="mt-ds-1 text-ds-xs text-ds-content-muted">Assign strict 1:1 lines for your team members.</p>
            </div>

            <DataTable
                embedded
                ariaLabel="Recruiter number assignments"
                density="compact"
                minWidth="standard"
                mobilePresentation="cards"
                data={users}
                columns={assignmentColumns(rowProps)}
                getRowId={(user) => user.id}
                empty={{ title: 'No team members found.' }}
            />
        </Card>
    );
}

export default AssignmentTable;
