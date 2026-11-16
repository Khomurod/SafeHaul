import React, { useMemo } from 'react';
import { Badge, Button, DataTable } from '@/design-system/components';
import { CheckCircle, Icon, Power } from '@design-system/icons';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { settingsTableMinWidth, useSettingsTableWidth } from '../useSettingsTableWidth';

/** What each permission is called on this screen, and its tone: the full SSN warns. */
const PERMISSIONS = Object.freeze({
    'applications:read': { name: 'Applications', tone: 'info' },
    'documents:read': { name: 'Uploaded files', tone: 'info' },
    'ssn:read': { name: 'Full SSN', tone: 'warning' },
});

const keyIdOf = (key) => key.keyId;

/**
 * A moment as "Oct 5, 2026, 12:00 PM", its time kept on one line ("12:00 PM"
 * never splits), or `null` when there is none.
 */
function when(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return (
        <>
            {date.toLocaleDateString('en-US', { dateStyle: 'medium' })}
            {', '}
            <span className="whitespace-nowrap">{date.toLocaleTimeString('en-US', { timeStyle: 'short' })}</span>
        </>
    );
}

/** The narrowest box the table fits: the key's header (174 with its padding) + 176 + 144 + 120 + the card's border. */
const FITS_FROM = 616;

/**
 * The fixed columns by the width of the box the table is in: from 740px, and
 * wherever the table scrolls, the dates have their full columns ("Turned off"
 * and its date on one line each) and Turn off its power glyph, as C2 draws it;
 * between, they take a step less each and Turn off is its word alone, so the
 * key keeps the room for its header and the table still fits (a 614px box
 * beside the settings menu at 1280px).
 */
function fixedWidths(width) {
    return width >= FITS_FROM && width < 740
        ? { created: 'lg', status: 'md', actions: 'sm', glyph: false }
        : { created: 'xl', status: 'lg', actions: 'md', glyph: true };
}

/**
 * A company's API keys, turned-on ones first, in four columns at every width
 * from 768px: the key with what it may read, when it was made and last used,
 * where it stands, and turning it off (the last column, as on every list).
 * The key's column takes what the other three leave; the prefix the server
 * sends (already ending in "…") is shown whole.
 *
 * On a phone each key is a card, looked at one at a time: its name with its
 * status in the corner, the prefix and what it may read, every date on its own
 * line under one left edge, and Turn off across the card.
 */
export function ApiKeysTable({ keys, loading, error, onRevoke }) {
    const [tableBox, tableWidth] = useSettingsTableWidth();
    const widths = fixedWidths(tableWidth);
    const minWidth = settingsTableMinWidth(tableWidth, FITS_FROM);
    // Across a phone card, Turn off is a full-size target.
    const isPhone = useIsMobile();
    const columns = useMemo(() => [
        {
            key: 'name',
            header: 'Key and what it can read',
            rowHeader: true,
            render: (key) => (
                <div className="min-w-0">
                    <p className="font-semibold text-ds-content [overflow-wrap:anywhere] max-md:text-ds-heading-sm">{key.name}</p>
                    <p className="mt-ds-1 font-mono text-ds-xs font-normal text-ds-content-secondary [overflow-wrap:anywhere]">{key.prefix}</p>
                    {(key.scopes || []).length > 0 && (
                        <div className="mt-ds-2 flex flex-wrap gap-ds-2">
                            {key.scopes.map((scope) => (
                                <Badge key={scope} tone={PERMISSIONS[scope]?.tone || 'neutral'}>
                                    {PERMISSIONS[scope]?.name || scope}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            ),
        },
        {
            key: 'created',
            header: 'Created · last used',
            width: widths.created,
            mobileRole: 'line',
            render: (key) => (
                <div className="text-ds-body text-ds-content max-md:text-ds-content-secondary">
                    <p>
                        {when(key.createdAt) || '—'}
                        {key.createdByName && (
                            <>
                                <span className="md:hidden" aria-hidden="true">{' · '}</span>
                                <span className="block text-ds-xs text-ds-content-secondary max-md:inline max-md:text-ds-body">
                                    by {key.createdByName}
                                </span>
                            </>
                        )}
                    </p>
                    <p className="text-ds-xs text-ds-content-secondary max-md:text-ds-body">
                        Last used: {when(key.lastUsedAt) || 'Never'}
                    </p>
                    {/* On a card the date a key was turned off joins the other dates. */}
                    {key.revokedAt && (
                        <p className="md:hidden">Turned off: {when(key.revokedAt)}</p>
                    )}
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            // In `md` a turned-off key's date takes two lines under its badge.
            width: widths.status,
            mobileRole: 'status',
            // A key turned off keeps when under its badge.
            render: (key) => (key.revokedAt ? (
                <div className="flex flex-col items-start gap-ds-1 max-md:items-end">
                    <Badge tone="neutral">Turned off</Badge>
                    <p className="text-ds-xs text-ds-content-secondary max-md:hidden">{when(key.revokedAt)}</p>
                </div>
            ) : <Badge tone="success" icon={CheckCircle}>On</Badge>),
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            // `md`: Turn off with its glyph on one line; `sm` for the word alone.
            width: widths.actions,
            mobileRole: 'actions',
            render: (key) => (key.revokedAt ? null : (
                <Button
                    variant="secondary"
                    tone="danger"
                    size={isPhone ? 'md' : 'sm'}
                    aria-label={`Turn off ${key.name}`}
                    onClick={() => onRevoke(key)}
                >
                    {(widths.glyph || isPhone) && <Icon icon={Power} size="sm" />}
                    Turn off
                </Button>
            )),
        },
    ], [onRevoke, isPhone, widths.created, widths.status, widths.actions, widths.glyph]);

    return (
        <div ref={tableBox} className="min-w-0">
            <DataTable
                ariaLabel="API keys"
                minWidth={minWidth}
                mobilePresentation="cards"
                data={keys}
                columns={columns}
                getRowId={keyIdOf}
                isLoading={loading}
                loadingLabel="Loading API keys"
                error={error}
                empty={{
                    title: 'No API keys yet',
                    description: 'Create one when a service, such as your TMS, needs to read your applications.',
                }}
            />
        </div>
    );
}

export default ApiKeysTable;
