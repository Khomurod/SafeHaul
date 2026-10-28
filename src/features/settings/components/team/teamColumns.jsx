import React from 'react';
import { Badge, IconButton } from '@/design-system/components';
import { Icon, AlertTriangle, Link as LinkIcon, ListChecks, Trash2 } from '@design-system/icons';
import { MEMBER_STATUS, roleLabel, teamMemberName } from './teamMemberStatus';

/**
 * The columns of the team table, one row per member as `listCompanyTeam`
 * resolves them. A record that is not simply healthy says so in words
 * (`MEMBER_STATUS`); the daily goals sit under the role. The row actions copy
 * the member's recruiting link, open their daily goals, and remove them — the
 * last never on the signed-in admin's own row.
 */
export function teamColumns({ currentUserId, deletingId, onCopyLink, onEditGoals, onRemove }) {
    return [
        {
            key: 'person',
            header: 'Team member',
            rowHeader: true,
            width: 'xl',
            render: (member) => {
                const name = teamMemberName(member);
                // The email is not repeated under itself when it stands in for the name.
                const emailLine = member.name ? (member.email || 'No email on file') : (member.email ? null : 'No email on file');
                return (
                    <span className="flex min-w-0 flex-col items-start gap-ds-1">
                        <span className="max-w-full font-semibold text-ds-content [overflow-wrap:anywhere]">
                            {name}{member.id === currentUserId && ' (you)'}
                        </span>
                        {emailLine && (
                            <span className="max-w-full text-ds-xs font-normal text-ds-content-muted [overflow-wrap:anywhere]">{emailLine}</span>
                        )}
                        {member.duplicateMembershipCount > 0 && (
                            <Badge tone="warning" icon={AlertTriangle}>Duplicate membership</Badge>
                        )}
                        {MEMBER_STATUS[member.status] && (
                            <span className="text-ds-xs font-normal text-ds-content-muted">{MEMBER_STATUS[member.status].detail}</span>
                        )}
                    </span>
                );
            },
        },
        {
            key: 'role',
            header: 'Role',
            width: 'lg',
            render: (member) => (
                <span className="flex min-w-0 flex-col items-start">
                    <span>{roleLabel(member.role)}</span>
                    <span className="text-ds-xs tabular-nums text-ds-content-muted">
                        Goals: {member.callGoal} dials, {member.contactGoal} contacts
                    </span>
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'xl',
            render: (member) => {
                const status = MEMBER_STATUS[member.status];
                return status
                    ? <Badge tone={status.tone} icon={AlertTriangle}>{status.label}</Badge>
                    : <Badge tone="success">Active</Badge>;
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            headerLabel: 'Actions',
            align: 'end',
            // Three icon buttons: wider than `lg` once the cell's padding is counted.
            width: 'xl',
            mobileLabel: '',
            render: (member) => {
                const name = teamMemberName(member);
                return (
                    <span className="flex items-center justify-end gap-ds-1">
                        <IconButton label={`Copy recruiting link for ${name}`} variant="ghost" size="sm" onClick={() => onCopyLink(member)}>
                            <Icon icon={LinkIcon} />
                        </IconButton>
                        <IconButton label={`Daily goals for ${name}`} variant="ghost" size="sm" onClick={() => onEditGoals(member)}>
                            <Icon icon={ListChecks} />
                        </IconButton>
                        {member.id !== currentUserId && (
                            <IconButton
                                label={`Remove ${name} from the team`}
                                variant="ghost"
                                size="sm"
                                loading={deletingId === member.id}
                                onClick={() => onRemove(member)}
                            >
                                <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                            </IconButton>
                        )}
                    </span>
                );
            },
        },
    ];
}
