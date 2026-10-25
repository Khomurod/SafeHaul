import React from 'react';
import { Icon, AlertCircle, ShieldCheck, Activity } from '@design-system/icons';
import { Badge, IconButton, Select } from '@/design-system/components';
import { MISSING_TOKEN, lineDisplay, sanitizePhone } from '../../utils/linePhone';

/**
 * The columns of the recruiter assignment matrix, one row per team member.
 * The member's role is a quiet line under their name, so the four columns fit
 * the settings page at 1440px.
 *
 * Presentation only — the token/select derivation, `setAssignments`/
 * `setAssignmentTokenOverrides` wiring, and `handleVerifyLine` are unchanged
 * from `NumberAssignmentManager.jsx`, where the row was originally inlined;
 * `rowState` derives them once per member for every cell that needs them.
 *
 * Defects fixed here:
 *  - the assignment `<select>` had no accessible name (now `aria-label`);
 *  - the verify button was icon-only with a `title` but no `aria-label`
 *    (now an `IconButton`);
 *  - the "Not in current team" / "Dedicated Credentials" badges used
 *    `text-[9px]`, below the 12 px floor (now `Badge`, which floors at
 *    `--ds-font-size-xs`);
 *  - the connection-status dot in the last column was colour-only, with only
 *    a `title` attribute — no visible or accessible text (now paired with a
 *    visually-hidden status string).
 */
function rowState(user, {
    inventory,
    assignments,
    assignmentTokenOverrides,
    savedAssignmentTokens,
    tokenForPhone,
    resolveLineToken,
    verifyingLine,
    lineStatuses,
}) {
    const rawPhone = assignments[user.id] || '';
    const currentPhone = sanitizePhone(rawPhone);
    const selectedToken = assignmentTokenOverrides[user.id] ?? (tokenForPhone(currentPhone) || resolveLineToken(savedAssignmentTokens[user.id]) || (currentPhone ? MISSING_TOKEN : ''));
    const isAssigned = !!currentPhone || !!assignmentTokenOverrides[user.id];

    // Match against sanitized inventory numbers
    const invItem = inventory.find(i => sanitizePhone(i.phoneNumber) === currentPhone);
    return {
        currentPhone,
        selectedToken,
        isAssigned,
        invItem,
        hasDedicated: invItem?.hasDedicatedCredentials,
        memberName: user.name || user.fullName || user.email,
        isVerifyingRow: verifyingLine === currentPhone,
        rowStatus: lineStatuses[currentPhone],
    };
}

export function assignmentColumns(rowProps) {
    const { lines, setAssignments, setAssignmentTokenOverrides, phoneForToken, handleVerifyLine } = rowProps;
    return [
        {
            key: 'member',
            header: 'Team Member',
            rowHeader: true,
            width: 'xl',
            render: (user) => (
                <>
                    <span className="block text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">
                        {rowState(user, rowProps).memberName}
                    </span>
                    <span className="block text-ds-xs font-normal text-ds-content-muted [overflow-wrap:anywhere]">{user.email}</span>
                    {user.role && (
                        <span className="block text-ds-xs font-normal uppercase tracking-wider text-ds-content-muted">
                            <span className="sr-only">Role: </span>{user.role.replace('_', ' ')}
                        </span>
                    )}
                    {user._unlinkedAssignment && (
                        <Badge tone="warning" icon={AlertCircle}>Not in current team</Badge>
                    )}
                </>
            ),
        },
        {
            key: 'number',
            header: 'Assigned Number',
            mobileLabel: 'Assigned number',
            width: 'xl',
            render: (user) => {
                const { currentPhone, selectedToken, isAssigned, invItem, hasDedicated, memberName } = rowState(user, rowProps);
                return (
                    <div className="flex flex-col items-start gap-ds-1">
                        <Select
                            aria-label={`Assigned number for ${memberName}`}
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
                            <option value="">No Direct Line</option>
                            {/* 1. Show existing inventory (label-first so it stays readable even if a
                                browser/DLP extension hides the raw digits) */}
                            {lines.map((l, idx) => (
                                <option key={l.token} value={l.token}>
                                    {lineDisplay(l.label, l.phone, idx)}
                                </option>
                            ))}
                            {/* 2. Resilience: If currently assigned number is MISSING from inventory, show it anyway */}
                            {isAssigned && !invItem && (
                                <option value={MISSING_TOKEN}>
                                    {currentPhone} (Missing from sync)
                                </option>
                            )}
                        </Select>
                        {isAssigned && hasDedicated && (
                            <Badge tone="info" icon={ShieldCheck}>Dedicated Credentials</Badge>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'connection',
            header: 'Connection',
            width: 'lg',
            render: (user) => {
                const { currentPhone, isAssigned, invItem, memberName, isVerifyingRow, rowStatus } = rowState(user, rowProps);
                if (!isAssigned) return <span className="text-ds-content-muted" aria-hidden="true">-</span>;
                return (
                    <div className="flex items-center gap-ds-2">
                        <IconButton
                            label={`Verify connection for ${memberName}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleVerifyLine(currentPhone)}
                            disabled={isVerifyingRow}
                            loading={isVerifyingRow}
                        >
                            {!isVerifyingRow && (
                                <Icon icon={Activity} size="sm" className={rowStatus ? 'text-ds-content-link' : 'text-ds-content-muted'} />
                            )}
                        </IconButton>
                        {rowStatus ? (
                            <Badge tone={rowStatus.success ? 'success' : 'danger'}>
                                {rowStatus.success ? 'Connected' : 'Failed'}
                            </Badge>
                        ) : !invItem ? (
                            <Badge tone="warning">Inventory Mismatch</Badge>
                        ) : (
                            <span className="text-ds-xs text-ds-content-muted">Untested</span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'status',
            header: 'Status',
            width: 'sm',
            render: (user) => {
                const { isAssigned, invItem, rowStatus } = rowState(user, rowProps);
                const dotClassName = !isAssigned
                    ? 'bg-ds-border'
                    : !rowStatus
                        ? (invItem ? 'bg-ds-status-info-fg' : 'bg-ds-status-warning-fg')
                        : rowStatus.success === false ? 'bg-ds-status-danger-fg' : 'bg-ds-status-success-fg';
                const dotText = !isAssigned
                    ? 'No assignment'
                    : !rowStatus
                        ? 'Untested'
                        : rowStatus.success === false ? 'Connection error' : 'Active';
                return (
                    <>
                        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-ds-full align-middle ${dotClassName}`} />
                        <span className="sr-only">{dotText}</span>
                    </>
                );
            },
        },
    ];
}
