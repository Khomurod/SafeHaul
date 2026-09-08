import React from 'react';
import { Icon, Users as UsersIcon } from '@design-system/icons';
import { Card } from '@/design-system/components';
import { AssignmentRow } from './AssignmentRow';

/**
 * Recruiter assignment matrix.
 *
 * Presentation only — row data and callbacks pass straight through to
 * `AssignmentRow`, unchanged. This stays a real native table rather than the
 * approved `DataTable`: every cell here is an editable per-row form control
 * plus a verify action, which is outside `DataTable`'s proven display-table
 * contract (see the 2026-07-23 deep-audit referenced in
 * `NumberAssignmentManager.jsx`). It carries `ds-native-table` as of 2026-08-25,
 * so its header, divider, density and cell padding come from the same
 * `--ds-table-*` roles `DataTable` reads instead of from three hand-picked
 * paddings. Column headers carry `scope="col"`, a `<caption>` names the table
 * for assistive tech, and the table sits in a labelled, keyboard-focusable
 * scroll region.
 *
 * On a phone it is one card per team member (audit step K, 2026-09-06). This
 * matrix is worked one member at a time — nothing in it is compared across
 * rows — so under 768px `data-mobile-presentation="cards"` stacks each row
 * with every value under the label of its column (`data-label`, written here in
 * the feature's own words), instead of putting a `<select>` and its verify
 * action 400px apart in a sideways-scrolling form. Above 768px the table is a
 * table, with its first column pinned (`data-pin-first-column`) for the widths
 * where it still scrolls. The table roles are stated explicitly on every
 * element because `display: block` can drop the implicit ones — redundant
 * while it is a table, load-bearing while it is cards. Same DOM at every width,
 * so the frozen 15-case suite and the a11y suite cover both.
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

            <div
                role="region"
                aria-label="Recruiter assignments"
                tabIndex={0}
                className="overflow-x-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
            >
                <table
                    className="ds-native-table min-w-[720px]"
                    role="table"
                    data-pin-first-column
                    data-mobile-presentation="cards"
                >
                    <caption className="sr-only">Recruiter number assignments</caption>
                    <thead role="rowgroup" className="text-ds-content-muted">
                        <tr role="row">
                            <th scope="col" role="columnheader">Team Member</th>
                            <th scope="col" role="columnheader">Role</th>
                            <th scope="col" role="columnheader">Assigned Number</th>
                            <th scope="col" role="columnheader">Connection</th>
                            <th scope="col" role="columnheader" className="w-10 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody role="rowgroup">
                        {users.map(user => (
                            <AssignmentRow key={user.id} user={user} {...rowProps} />
                        ))}
                    </tbody>
                </table>
                {users.length === 0 && (
                    <p className="p-ds-8 text-center text-ds-sm text-ds-content-muted">No team members found.</p>
                )}
            </div>
        </Card>
    );
}

export default AssignmentTable;
