import React from 'react';
import { Users as UsersIcon } from 'lucide-react';
import { Card } from '@/design-system/components';
import { AssignmentRow } from './AssignmentRow';

/**
 * Recruiter assignment matrix.
 *
 * Presentation only — row data and callbacks pass straight through to
 * `AssignmentRow`, unchanged. This stays a real `<table>` rather than the
 * approved `DataTable`: every cell here is an editable per-row form control
 * plus a verify action, which is outside `DataTable`'s proven display-table
 * contract (see the 2026-07-23 deep-audit referenced in
 * `NumberAssignmentManager.jsx`). What's fixed instead: column headers now
 * carry `scope="col"`, a `<caption>` names the table for assistive tech, and
 * the table sits in a labelled, keyboard-focusable horizontal-scroll region
 * (mirroring the approved `DataTable`'s own mobile-overflow pattern) instead
 * of silently overflowing the page on narrow viewports.
 */
export function AssignmentTable({ users, ...rowProps }) {
    return (
        <Card padding="none" className="overflow-hidden">
            <div className="border-b border-ds-border-subtle p-ds-6">
                <h3 className="flex items-center gap-ds-2 font-bold text-ds-content">
                    <UsersIcon className="text-ds-status-accent-fg" size={18} aria-hidden="true" /> Recruiter Assignments
                </h3>
                <p className="mt-ds-1 text-ds-xs text-ds-content-muted">Assign strict 1:1 lines for your team members.</p>
            </div>

            <div
                role="region"
                aria-label="Recruiter assignments. Scroll horizontally to view all columns."
                tabIndex={0}
                className="overflow-x-auto"
            >
                <table className="w-full min-w-[720px] border-collapse text-left">
                    <caption className="sr-only">Recruiter number assignments</caption>
                    <thead className="bg-ds-surface-subtle text-ds-xs font-bold uppercase text-ds-content-muted">
                        <tr>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Team Member</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Role</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Assigned Number</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Connection</th>
                            <th scope="col" className="w-10 border-b border-ds-border-subtle px-ds-6 py-ds-3 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border-subtle">
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
