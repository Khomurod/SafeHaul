import React from 'react';
import { Badge, IconButton } from '@/design-system/components';
import { Icon, AlertTriangle, CheckCircle, Link as LinkIcon, ListChecks, Trash2 } from '@design-system/icons';
import { BreakableText } from '../BreakableText';
import { MemberAvatar, MemberIdentity } from './teamMemberParts';
import { MEMBER_STATUS, roleLabel, teamMemberName } from './teamMemberStatus';

/**
 * What is wrong with a record that is not simply healthy, as the row's detail
 * (`DataTable` `getRowDetail`): its sentence (`MEMBER_STATUS`) in the status's
 * tone, a line of its own under the member; a hyphenated word ("re-invite")
 * never splits. `null` for a healthy member.
 */
export function memberDetail(member) {
    const status = MEMBER_STATUS[member.status];
    return status ? { tone: status.tone, content: <BreakableText text={status.detail} /> } : null;
}

/**
 * The columns of the team table, one row per member as `listCompanyTeam`
 * resolves them: who they are, their role with their status and daily goals,
 * and the row actions (copy the member's personal link, open their daily
 * goals, remove them — the last never on the signed-in admin's own row). A
 * record that is not simply healthy says so with a badge beside the role; its
 * sentence is the row's detail (`memberDetail`), a line of its own under the
 * member.
 *
 * On a phone (`cards`) each member is a card: the initials in its leading slot
 * (their own column), then one text column — name, email, role and status,
 * goals, the sentence — and the actions as full-size targets. From 1440px
 * (`wide`) a role and its badge share a line, and their column is wide enough
 * for the longest pair, so every member is one 68px row.
 */
export function teamColumns({ currentUserId, deletingId, onCopyLink, onEditGoals, onRemove, cards = false, wide = false }) {
    const actionSize = cards ? 'md' : 'sm';
    return [
        ...(cards ? [{
            key: 'initials',
            header: '',
            headerLabel: 'Initials',
            mobileRole: 'lead',
            render: (member) => <MemberAvatar member={member} />,
        }] : []),
        {
            key: 'person',
            header: 'Team member',
            rowHeader: true,
            // The initials lead the cell, so a row's detail starts under the name.
            leadingAvatar: !cards,
            render: (member) => {
                if (cards) return <MemberIdentity member={member} currentUserId={currentUserId} />;
                // The initials centred on the name and email.
                return (
                    <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-ds-3">
                        <MemberAvatar member={member} />
                        <MemberIdentity member={member} currentUserId={currentUserId} />
                    </span>
                );
            },
        },
        {
            key: 'roleStatus',
            header: 'Role and status',
            width: wide ? '2xl' : 'xl',
            // From 1440px a role and its badge share a line, in a column wide
            // enough for the longest pair; below, every badge sits under its
            // role, so the rows keep one shape. A card has the room for one
            // line again.
            mobileRole: 'line',
            render: (member) => {
                const status = MEMBER_STATUS[member.status];
                return (
                    <span className="flex min-w-0 flex-col items-start gap-ds-1 md:gap-0">
                        <span className="flex flex-col items-start gap-x-ds-2 gap-y-ds-1 max-md:flex-row max-md:flex-wrap max-md:items-center min-[1440px]:flex-row min-[1440px]:flex-wrap min-[1440px]:items-center min-[1440px]:gap-x-ds-1">
                            <span className="font-semibold text-ds-content">{roleLabel(member.role)}</span>
                            {status
                                ? <Badge tone={status.tone} icon={AlertTriangle}>{status.label}</Badge>
                                : <Badge tone="success" icon={CheckCircle}>Active</Badge>}
                        </span>
                        <span className="text-ds-xs tabular-nums text-ds-content-secondary">
                            Goals: {member.callGoal} dials, {member.contactGoal} contacts
                        </span>
                    </span>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            // Three 36px icon buttons side by side and the cell's padding fit `md`.
            width: 'md',
            mobileRole: 'actions',
            render: (member) => {
                const name = teamMemberName(member);
                return (
                    // On a card the first glyph lines up with the text above it.
                    <span className="flex items-center justify-end max-md:-ml-ds-3 max-md:justify-start max-md:gap-ds-1">
                        <IconButton label={`Copy personal link for ${name}`} variant="ghost" size={actionSize} onClick={() => onCopyLink(member)}>
                            <Icon icon={LinkIcon} />
                        </IconButton>
                        <IconButton label={`Daily goals for ${name}`} variant="ghost" size={actionSize} onClick={() => onEditGoals(member)}>
                            <Icon icon={ListChecks} />
                        </IconButton>
                        {member.id !== currentUserId && (
                            <IconButton
                                label={`Remove ${name} from the team`}
                                variant="ghost"
                                size={actionSize}
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
