import React from 'react';
import { Avatar, Badge } from '@/design-system/components';
import { AlertTriangle } from '@design-system/icons';
import { initialsOf } from '@shared/utils/initials';
import { BreakableText } from '../BreakableText';
import { teamMemberName } from './teamMemberStatus';

/** A member's initials on the brand tint, or an empty ring when they have neither name nor email. */
export function MemberAvatar({ member }) {
    const initials = initialsOf(member.name || member.email || '');
    return initials
        ? <Avatar size="sm" tone="brand">{initials}</Avatar>
        : <Avatar size="sm" tone="placeholder" />;
}

/** The member's name and email: the name breaks only at spaces, the email after its "@". */
export function MemberIdentity({ member, currentUserId }) {
    const name = teamMemberName(member);
    // The email is not repeated under itself when it stands in for the name.
    const emailLine = member.name ? (member.email || 'No email on file') : (member.email ? null : 'No email on file');
    return (
        // The name and the email are one block of two lines, as a row of 68px holds them.
        <span className="flex min-w-0 flex-col items-start break-words">
            <span className="max-w-full font-semibold text-ds-content">
                <BreakableText text={name} />{member.id === currentUserId && ' (you)'}
            </span>
            {emailLine && (
                <span className="max-w-full text-ds-body font-normal text-ds-content-secondary">
                    {member.email && emailLine === member.email
                        ? <BreakableText text={emailLine} email />
                        : emailLine}
                </span>
            )}
            {member.duplicateMembershipCount > 0 && (
                <span className="mt-ds-1 flex"><Badge tone="warning" icon={AlertTriangle}>Duplicate membership</Badge></span>
            )}
        </span>
    );
}
