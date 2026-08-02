import React from 'react';
import { PlugZap, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '@/design-system/components';

/**
 * Row action controls and the permission summary beside them.
 *
 * ## Unavailable actions stay on screen
 *
 * A hidden control teaches an operator nothing. Every action a row *could* have
 * is rendered; the ones the source does not support are shown in their disabled
 * treatment with the reason carried in the accessible name and repeated as a
 * pointer tooltip.
 *
 * They use `aria-disabled` rather than `disabled` deliberately: a `disabled`
 * button is removed from the tab order, so its explanation would be unreachable
 * by keyboard and by screen reader — the two audiences that most need it.
 * Activation is refused here, in the handler, because the attribute alone does
 * not prevent it.
 */

const ACTIONS = [
    { id: 'edit', label: 'Edit', icon: Pencil, permission: 'editable', restriction: 'edit' },
    { id: 'replace', label: 'Replace', icon: RefreshCw, permission: 'replaceable', restriction: 'replace' },
    { id: 'add', label: 'Add', icon: Plus, permission: 'addable', restriction: 'add' },
    { id: 'delete', label: 'Delete', icon: Trash2, permission: 'deletable', restriction: 'delete' },
    { id: 'test', label: 'Test integration', icon: PlugZap, permission: 'testable', restriction: null },
];

/** Reveal is listed first because it is the one action almost every row has. */
export function EnvironmentPermissionSummary({ entry }) {
    const items = [
        { label: 'Reveal', allowed: entry.permissions.revealable },
        { label: 'Edit', allowed: entry.permissions.editable },
        { label: 'Replace', allowed: entry.permissions.replaceable },
        { label: 'Add', allowed: entry.permissions.addable },
        { label: 'Delete', allowed: entry.permissions.deletable },
    ];

    return (
        <span className="flex flex-wrap gap-ds-1">
            {items.map((item) => (
                <Badge key={item.label} tone={item.allowed ? 'success' : 'neutral'}>
                    {item.allowed ? item.label : `No ${item.label.toLowerCase()}`}
                </Badge>
            ))}
        </span>
    );
}

export function EnvironmentActions({ entry, onAction }) {
    return (
        <span className="flex justify-end gap-ds-1">
            {ACTIONS.map((action) => {
                const allowed = Boolean(entry.permissions[action.permission]);
                const reason = action.restriction
                    ? entry.restrictions?.[action.restriction]
                    : 'This entry does not support a connectivity test';

                // "Test integration" is only meaningful on the rows that own an
                // integration, so it is not rendered as a permanent dead control
                // on every configuration key.
                if (action.id === 'test' && !allowed) return null;

                const label = allowed
                    ? `${action.label} ${entry.key}`
                    : `${action.label} ${entry.key} — unavailable: ${reason}`;

                return (
                    <IconButton
                        key={action.id}
                        size="sm"
                        variant={action.id === 'delete' && allowed ? 'danger' : 'ghost'}
                        label={label}
                        title={allowed ? undefined : reason}
                        aria-disabled={allowed ? undefined : true}
                        onClick={allowed ? () => onAction(action.id, entry) : undefined}
                    >
                        <action.icon size={16} aria-hidden="true" />
                    </IconButton>
                );
            })}
        </span>
    );
}
