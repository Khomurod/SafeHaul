import React from 'react';
import { AlertCircle, ShieldCheck, Activity } from 'lucide-react';
import { Badge, IconButton, Select } from '@/design-system/components';
import { MISSING_TOKEN, lineDisplay, sanitizePhone } from '../../utils/linePhone';

/**
 * One team-member row of the assignment matrix.
 *
 * Presentation only — the token/select derivation, `setAssignments`/
 * `setAssignmentTokenOverrides` wiring, and `handleVerifyLine` are unchanged
 * from `NumberAssignmentManager.jsx`, where this row was originally inlined.
 * The row stays a real `<tr>` (not the approved `DataTable`): editable
 * per-row `<select>`s and verify actions are outside `DataTable`'s proven
 * display-table contract, per the 2026-07-23 deep-audit; see
 * `NumberAssignmentManager.jsx` for the full rationale.
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
export function AssignmentRow({
    user,
    inventory,
    lines,
    assignments,
    setAssignments,
    assignmentTokenOverrides,
    setAssignmentTokenOverrides,
    savedAssignmentTokens,
    tokenForPhone,
    phoneForToken,
    resolveLineToken,
    handleVerifyLine,
    verifyingLine,
    lineStatuses,
}) {
    const rawPhone = assignments[user.id] || '';
    const currentPhone = sanitizePhone(rawPhone);
    const selectedToken = assignmentTokenOverrides[user.id] ?? (tokenForPhone(currentPhone) || resolveLineToken(savedAssignmentTokens[user.id]) || (currentPhone ? MISSING_TOKEN : ''));
    const isAssigned = !!currentPhone || !!assignmentTokenOverrides[user.id];

    // Match against sanitized inventory numbers
    const invItem = inventory.find(i => sanitizePhone(i.phoneNumber) === currentPhone);
    const hasDedicated = invItem?.hasDedicatedCredentials;
    const memberName = user.name || user.fullName || user.email;
    const isVerifyingRow = verifyingLine === currentPhone;
    const rowStatus = lineStatuses[currentPhone];

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
        <tr className="transition-colors hover:bg-ds-surface-hover">
            <th scope="row" className="border-r border-ds-border-subtle px-ds-6 py-ds-4 text-left text-ds-sm font-medium text-ds-content">
                {memberName}
                <div className="font-normal text-ds-xs text-ds-content-muted">{user.email}</div>
                {user._unlinkedAssignment && (
                    <Badge tone="warning" icon={AlertCircle}>Not in current team</Badge>
                )}
            </th>
            <td className="px-ds-6 py-ds-4 text-ds-xs uppercase tracking-wider text-ds-content-muted">
                {user.role?.replace('_', ' ')}
            </td>
            <td className="px-ds-6 py-ds-4">
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
            </td>
            <td className="px-ds-6 py-ds-4">
                {isAssigned ? (
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
                                <Activity size={14} className={rowStatus ? 'text-ds-content-link' : 'text-ds-content-muted'} />
                            )}
                        </IconButton>
                        {rowStatus ? (
                            <Badge tone={rowStatus.success ? 'success' : 'danger'}>
                                {rowStatus.success ? 'Connected' : 'Failed'}
                            </Badge>
                        ) : isAssigned && !invItem ? (
                            <Badge tone="warning">Inventory Mismatch</Badge>
                        ) : (
                            <span className="text-ds-xs text-ds-content-muted">Untested</span>
                        )}
                    </div>
                ) : (
                    <span className="text-ds-content-muted" aria-hidden="true">-</span>
                )}
            </td>
            <td className="px-ds-6 py-ds-4 text-center">
                <span aria-hidden="true" className={`mx-auto block h-2 w-2 rounded-full ${dotClassName}`} />
                <span className="sr-only">{dotText}</span>
            </td>
        </tr>
    );
}

export default AssignmentRow;
