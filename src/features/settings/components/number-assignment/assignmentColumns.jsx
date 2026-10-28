import React from 'react';
import { ShieldCheck } from '@design-system/icons';
import { Badge, Select } from '@/design-system/components';
import { MISSING_TOKEN, lineDisplay, sanitizePhone } from '../../utils/linePhone';
import { memberLineToken, memberName } from '../sms/smsLineState';

const ROLE_LABELS = {
    company_admin: 'Company admin',
    hr_user: 'Recruiter',
    external: 'Former member',
    unassigned: 'Former member',
};

/** A membership role in the page's words. */
export function roleLabel(role) {
    return ROLE_LABELS[role] || role || '—';
}

/**
 * The columns of "Who texts from which line", one row per team member: who they
 * are, their role ("Former member" for a line owner outside the roster), and the
 * line they text from.
 *
 * The `<select>` keeps the frozen token model (`utils/linePhone.js`): option
 * values are stable line tokens, never raw phone numbers; choosing a line
 * records a token edit and the phone it stands for; a saved phone that is not
 * among the synced lines stays selectable as "(Missing from sync)". Checking a
 * line lives on the phone-lines table.
 */
export function assignmentColumns(rowProps) {
    const { lines, inventory, assignments, assignmentTokenOverrides, setAssignments, setAssignmentTokenOverrides, phoneForToken } = rowProps;
    return [
        {
            key: 'member',
            header: 'Team member',
            rowHeader: true,
            width: 'xl',
            render: (user) => (
                <span className="flex min-w-0 flex-col items-start">
                    <span className="max-w-full text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">{memberName(user)}</span>
                    {user.email && user.email !== memberName(user) && (
                        <span className="max-w-full text-ds-xs font-normal text-ds-content-muted [overflow-wrap:anywhere]">{user.email}</span>
                    )}
                </span>
            ),
        },
        {
            key: 'role',
            header: 'Role',
            width: 'lg',
            truncate: true,
            render: (user) => <span>{roleLabel(user.role)}</span>,
        },
        {
            key: 'line',
            header: 'Texts from',
            width: 'xl',
            render: (user) => {
                const currentPhone = sanitizePhone(assignments[user.id] || '');
                const selectedToken = memberLineToken(user.id, rowProps);
                const isAssigned = !!currentPhone || !!assignmentTokenOverrides[user.id];
                const invItem = inventory.find((item) => sanitizePhone(item.phoneNumber) === currentPhone);
                return (
                    <div className="flex flex-col items-start gap-ds-1">
                        <Select
                            aria-label={`Texts from, ${memberName(user)}`}
                            value={selectedToken}
                            onChange={(e) => {
                                const t = e.target.value;
                                setAssignmentTokenOverrides(prev => {
                                    const next = { ...prev };
                                    if (t === MISSING_TOKEN) delete next[user.id];
                                    else next[user.id] = t;
                                    return next;
                                });
                                const nextPhone = !t ? '' : (t === MISSING_TOKEN ? currentPhone : phoneForToken(t));
                                setAssignments(prev => ({ ...prev, [user.id]: nextPhone }));
                            }}
                            className="w-full"
                        >
                            <option value="">Default line</option>
                            {/* Label first, so a line stays readable when a browser
                                extension hides the digits. */}
                            {lines.map((l, idx) => (
                                <option key={l.token} value={l.token}>
                                    {lineDisplay(l.label, l.phone, idx)}
                                </option>
                            ))}
                            {/* A saved line missing from the synced inventory stays visible. */}
                            {isAssigned && !invItem && (
                                <option value={MISSING_TOKEN}>
                                    {currentPhone} (Missing from sync)
                                </option>
                            )}
                        </Select>
                        {isAssigned && invItem?.hasDedicatedCredentials && (
                            <Badge tone="info" icon={ShieldCheck}>Dedicated Credentials</Badge>
                        )}
                    </div>
                );
            },
        },
    ];
}
