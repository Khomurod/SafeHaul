import React from 'react';
import { Badge, IconButton } from '@/design-system/components';
import { Icon, RefreshCw, Star, RotateCcw, Trash2, AlertCircle, CheckCircle } from '@design-system/icons';
import { lineDisplay } from '../../utils/linePhone';
import { memberName } from './smsLineState';

/** Who texts from a line, in words: its members, and for the default line everyone else too. */
export function usedByText(members, isDefault) {
    const names = members.map((user) => (user._unlinkedAssignment ? `${memberName(user)} (former member)` : memberName(user)));
    if (isDefault) names.push(names.length ? 'everyone else' : 'Everyone');
    return names.join(', ');
}

/**
 * A line's state: the result of a check made on this page wins (it is kept for
 * this visit only); otherwise a provider status other than active is shown as it
 * is; otherwise the line has not been checked.
 */
function lineStatus(line, lineStatuses) {
    const checked = line.phone ? lineStatuses[line.phone] : undefined;
    if (checked) {
        return checked.success
            ? <Badge tone="success" icon={CheckCircle}>Working</Badge>
            : <Badge tone="danger" icon={AlertCircle}>Not working</Badge>;
    }
    const providerStatus = String(line.raw?.status || '').trim();
    if (providerStatus && !['active', 'available'].includes(providerStatus.toLowerCase())) {
        return <Badge tone="warning" icon={AlertCircle}>{providerStatus}</Badge>;
    }
    return <Badge tone="neutral">Not checked</Badge>;
}

/**
 * The columns of the phone-lines table, one row per line in the synced
 * inventory, its number under its name. `line` is `{ token, phone, label, raw,
 * index }`; the row actions check the line (`verifyLineConnection`), make it
 * the default or stop it being the default (saved with the page), and remove it
 * (`removePhoneLine`, by the number exactly as stored).
 */
export function phoneLineColumns({
    defaultToken, membersByToken, lineStatuses, verifyingLine, removingLine,
    onVerify, onSetDefault, onUnsetDefault, onRemove,
}) {
    const nameOf = (line) => lineDisplay(line.label, '', line.index);
    return [
        {
            key: 'line',
            header: 'Line',
            rowHeader: true,
            width: 'xl',
            render: (line) => (
                <span className="flex min-w-0 flex-col items-start">
                    <span className="flex max-w-full items-center gap-ds-2">
                        <span className="truncate font-semibold">{nameOf(line)}</span>
                        {line.token === defaultToken && <Badge tone="info">Default</Badge>}
                    </span>
                    <span className="text-ds-xs font-normal tabular-nums text-ds-content-muted">
                        {line.phone || 'Number hidden by the browser'}
                    </span>
                </span>
            ),
        },
        {
            key: 'usedBy',
            header: 'Used by',
            width: 'xl',
            truncate: true,
            render: (line) => {
                const text = usedByText(membersByToken[line.token] || [], line.token === defaultToken);
                return text ? <span>{text}</span> : <span className="text-ds-content-muted">Nobody</span>;
            },
        },
        {
            key: 'status',
            header: 'Status',
            width: 'lg',
            render: (line) => lineStatus(line, lineStatuses),
        },
        {
            key: 'actions',
            header: 'Actions',
            headerLabel: 'Actions',
            align: 'end',
            // Three icon buttons: wider than `lg` once the cell's padding is counted.
            width: 'xl',
            mobileLabel: '',
            render: (line) => {
                const name = nameOf(line);
                const isDefault = line.token === defaultToken;
                const rawPhone = line.raw?.phoneNumber;
                return (
                    <span className="flex items-center justify-end gap-ds-1">
                        <IconButton
                            label={`Check line ${name}`}
                            variant="ghost"
                            size="sm"
                            disabled={!line.phone}
                            loading={verifyingLine === line.phone && !!line.phone}
                            onClick={() => onVerify(line.phone)}
                        >
                            <Icon icon={RefreshCw} />
                        </IconButton>
                        {isDefault ? (
                            <IconButton label={`Unset ${name} as default`} variant="ghost" size="sm" onClick={() => onUnsetDefault(line)}>
                                <Icon icon={RotateCcw} />
                            </IconButton>
                        ) : (
                            <IconButton label={`Set ${name} as default`} variant="ghost" size="sm" onClick={() => onSetDefault(line)}>
                                <Icon icon={Star} />
                            </IconButton>
                        )}
                        <IconButton
                            label={`Remove line ${name}`}
                            variant="ghost"
                            size="sm"
                            disabled={!rawPhone}
                            loading={!!rawPhone && removingLine === rawPhone}
                            onClick={() => onRemove(line)}
                        >
                            <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                        </IconButton>
                    </span>
                );
            },
        },
    ];
}
