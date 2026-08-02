import React, { useState } from 'react';
import { fn } from 'storybook/test';
import {
    AlertTriangle,
    CheckCircle2,
    Eye,
    EyeOff,
    Pencil,
    Plus,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    UploadCloud,
} from 'lucide-react';
import { Badge, Card, DataTable, IconButton, MetricCard } from '@design-system/components';
import { PageContainer, PageHeader, ResponsiveGrid, Stack } from '@design-system/layouts';

/**
 * The managed-value inventory pattern: a table of configuration entries whose
 * values are hidden by default and revealed one at a time, deliberately.
 *
 * Everything here is a local, deterministic fixture using neutral vocabulary —
 * *entry*, *managed value*, *source*, *owner*. The catalog must not know what
 * any particular product's keys are called, and no real key name or value
 * appears on this page.
 */

const MASK = '********';

/** Deterministic fixture rows. No randomness, no timestamps, no generated data. */
const ENTRIES = [
    {
        id: 'entry-1',
        name: 'SERVICE_TOKEN',
        label: 'Service token',
        owner: 'Runtime store',
        source: 'Managed store',
        scope: 'Global',
        status: 'configured',
        deployment: false,
        can: { reveal: true, edit: true, replace: true, add: false, remove: true },
        why: {},
    },
    {
        id: 'entry-2',
        name: 'PRIMARY_MASTER_KEY',
        label: 'Primary master key',
        owner: 'Platform',
        source: 'Managed store',
        scope: 'Global',
        status: 'configured',
        deployment: true,
        can: { reveal: true, edit: false, replace: false, add: false, remove: false },
        why: {
            edit: 'Protected infrastructure value',
            replace: 'Protected infrastructure value',
            add: 'Source does not support adding entries here',
            remove: 'Cannot be deleted while referenced',
        },
    },
    {
        id: 'entry-3',
        name: 'OPTIONAL_ENDPOINT',
        label: 'Optional endpoint',
        owner: 'Runtime store',
        source: 'Managed store',
        scope: 'Global',
        status: 'missing',
        deployment: false,
        can: { reveal: false, edit: false, replace: false, add: true, remove: false },
        why: {
            edit: 'Nothing is stored yet',
            replace: 'Nothing is stored yet',
            remove: 'Nothing stored to delete',
        },
    },
    {
        id: 'entry-4',
        name: 'EXTERNAL_PIPELINE_SECRET',
        label: 'External pipeline secret',
        owner: 'External pipeline',
        source: 'External store',
        scope: 'Global',
        status: 'unknown',
        deployment: true,
        can: { reveal: true, edit: false, replace: false, add: false, remove: false },
        why: {
            edit: 'Source does not support editing',
            replace: 'Source does not support editing',
            add: 'Source does not support adding entries here',
            remove: 'Source does not support deletion',
        },
    },
    {
        id: 'entry-5',
        name: 'REGION_NAME',
        label: 'Region name',
        owner: 'Owner workspace',
        source: 'Owner record',
        scope: 'Owner',
        status: 'configured',
        deployment: false,
        can: { reveal: true, edit: true, replace: true, add: false, remove: false },
        why: { remove: 'Cannot be deleted while referenced' },
    },
];

/** The one value the catalog ever "reveals" — an obvious non-secret. */
const SAMPLE_VALUE = 'sample-value-not-a-secret';

const STATUS = {
    configured: { tone: 'success', label: 'Configured', icon: CheckCircle2 },
    missing: { tone: 'danger', label: 'Missing', icon: AlertTriangle },
    unknown: { tone: 'neutral', label: 'Not retrievable', icon: ShieldCheck },
};

const muted = { color: 'var(--ds-color-content-muted)', fontSize: 'var(--ds-font-size-sm)' };
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 'var(--ds-font-size-sm)' };

/**
 * The value cell.
 *
 * Three states, and they are the whole point of the pattern: masked, revealed
 * with a visible auto-hide notice, and revealed-but-unavailable because the
 * source cannot return what it stores.
 */
function ValueCell({ entry, state, seconds = 30, onToggle }) {
    const revealed = state === 'revealed' || state === 'unavailable';
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ds-space-2)', minWidth: 0 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                {!revealed && <span style={mono} aria-label={`${entry.name} value hidden`}>{MASK}</span>}

                {state === 'revealed' && (
                    <>
                        <span style={{ ...mono, display: 'block', wordBreak: 'break-all' }}>{SAMPLE_VALUE}</span>
                        <span style={{ ...muted, display: 'block' }} role="status">
                            Hides automatically in {seconds}s
                        </span>
                    </>
                )}

                {state === 'unavailable' && (
                    <span style={{ ...muted, display: 'flex', gap: 'var(--ds-space-1)' }} role="status">
                        <ShieldAlert size={14} aria-hidden="true" />
                        The source does not permit reading the saved value.
                    </span>
                )}
            </div>

            <IconButton
                size="sm"
                variant="ghost"
                label={`${revealed ? 'Hide' : 'Reveal'} ${entry.name}`}
                aria-pressed={revealed}
                disabled={!entry.can.reveal}
                onClick={onToggle}
            >
                {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </IconButton>
        </div>
    );
}

const ACTIONS = [
    { id: 'edit', label: 'Edit', icon: Pencil },
    { id: 'replace', label: 'Replace', icon: RefreshCw },
    { id: 'add', label: 'Add', icon: Plus },
    { id: 'remove', label: 'Delete', icon: Trash2 },
];

/**
 * Action controls.
 *
 * Unavailable actions stay on screen and stay **focusable** — `aria-disabled`
 * rather than `disabled` — because the reason lives in the accessible name, and
 * a truly disabled control is skipped by keyboard and screen reader, taking its
 * explanation with it. The caller refuses the activation; the attribute alone
 * does not.
 */
function ActionCell({ entry }) {
    return (
        <span style={{ display: 'flex', gap: 'var(--ds-space-1)', justifyContent: 'flex-end' }}>
            {ACTIONS.map((action) => {
                const allowed = entry.can[action.id];
                const reason = entry.why[action.id] || 'Not available for this entry';
                return (
                    <IconButton
                        key={action.id}
                        size="sm"
                        variant={action.id === 'remove' && allowed ? 'danger' : 'ghost'}
                        label={allowed
                            ? `${action.label} ${entry.name}`
                            : `${action.label} ${entry.name} — unavailable: ${reason}`}
                        title={allowed ? undefined : reason}
                        aria-disabled={allowed ? undefined : true}
                        onClick={allowed ? fn() : undefined}
                    >
                        <action.icon size={16} aria-hidden="true" />
                    </IconButton>
                );
            })}
        </span>
    );
}

function inventoryColumns({ revealedId, revealState, onToggle }) {
    return [
        {
            key: 'name',
            header: 'Entry',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (row) => (
                <div style={{ minWidth: 0 }}>
                    <strong style={{ ...mono, wordBreak: 'break-all' }}>{row.name}</strong>
                    <div style={muted}>{row.label}</div>
                </div>
            ),
        },
        { key: 'owner', header: 'Owner', width: 'md', truncate: true, render: (row) => row.owner },
        { key: 'scope', header: 'Scope', width: 'sm', priority: 'tertiary', render: (row) => row.scope },
        { key: 'source', header: 'Source', width: 'md', priority: 'tertiary', render: (row) => row.source },
        {
            key: 'status',
            header: 'Status',
            width: 'sm',
            render: (row) => (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--ds-space-1)' }}>
                    <Badge tone={STATUS[row.status].tone} icon={STATUS[row.status].icon}>
                        {STATUS[row.status].label}
                    </Badge>
                    {row.deployment && <Badge tone="warning" icon={UploadCloud}>Needs deployment</Badge>}
                </span>
            ),
        },
        {
            key: 'value',
            header: 'Value',
            width: 'lg',
            render: (row) => (
                <ValueCell
                    entry={row}
                    state={revealedId === row.id ? revealState : 'masked'}
                    onToggle={() => onToggle(row)}
                />
            ),
        },
        {
            key: 'actions',
            header: '',
            headerLabel: 'Actions',
            align: 'end',
            width: 'actions',
            priority: 'actions',
            stopPropagation: true,
            render: (row) => <ActionCell entry={row} />,
        },
    ];
}

function InventoryPage({ revealedId = null, revealState = 'masked', data = ENTRIES, ...tableProps }) {
    const [openId, setOpenId] = useState(revealedId);
    const state = openId === revealedId ? revealState : 'revealed';

    return (
        <div className="sb-page">
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="Managed values"
                        description="Every configuration entry this workspace uses, with its value hidden until it is deliberately revealed."
                    />

                    <Card padding="md" aria-label="How values are handled">
                        <h2 style={{ fontSize: 'var(--ds-font-size-heading-sm)', fontWeight: 600 }}>
                            How values are handled
                        </h2>
                        <ul style={{ ...muted, marginTop: 'var(--ds-space-2)', paddingInlineStart: 'var(--ds-space-5)', listStyle: 'disc' }}>
                            <li>Values are masked until one is revealed, and a reveal returns a single entry.</li>
                            <li>A revealed value hides itself again after a short window.</li>
                            <li>Sources that cannot return a stored value say so instead of showing one.</li>
                        </ul>
                    </Card>

                    <ResponsiveGrid minItemWidth="180px" aria-label="Inventory summary">
                        <MetricCard label="Total entries" value={5} />
                        <MetricCard label="Configured" value={3} tone="success" />
                        <MetricCard label="Missing" value={1} tone="danger" />
                        <MetricCard label="Protected" value={3} tone="info" />
                        <MetricCard label="Needs deployment" value={2} tone="warning" />
                    </ResponsiveGrid>

                    <DataTable
                        ariaLabel="Managed values"
                        data={data}
                        columns={inventoryColumns({
                            revealedId: openId,
                            revealState: state,
                            onToggle: (row) => setOpenId((current) => (current === row.id ? null : row.id)),
                        })}
                        density="compact"
                        minWidth="wide"
                        getRowLabel={(row) => `${row.name}, ${STATUS[row.status].label}`}
                        {...tableProps}
                    />
                </Stack>
            </PageContainer>
        </div>
    );
}

const meta = {
    title: 'Patterns/Managed value inventory',
    parameters: {
        layout: 'fullscreen',
        docs: {
            description: {
                component: [
                    '**Status: Approved composition, visual regression Needs review.** Every part is',
                    'an approved primitive used as intended. What is not settled is automated visual',
                    'verification — the roadmap\'s screenshot-baseline item is still open, so density',
                    'and alignment here are reviewed by eye at 1440, 1024 and 412px.',
                    '',
                    '### What this pattern is for',
                    '',
                    'A table of values that must not be readable at a glance: an operator can see',
                    '*that* an entry exists, what it is for, where it is stored and what may be done',
                    'to it, without the value itself being on screen.',
                    '',
                    '### The five rules it encodes',
                    '',
                    '1. **Masked by default.** The placeholder is a fixed `********`, unrelated to the',
                    '   real value — not its length, not its shape.',
                    '2. **One at a time.** Revealing an entry hides any other. There is one revealed',
                    '   slot, so a second plaintext value has nowhere to live.',
                    '3. **The reveal announces its own expiry.** "Hides automatically in 30s" is',
                    '   visible text in a live region, not a hidden timer the user has to guess at.',
                    '4. **Unavailable actions stay visible and stay focusable.** They use',
                    '   `aria-disabled`, not `disabled`, so the *reason* — carried in the accessible',
                    '   name and repeated as a tooltip — is reachable by keyboard and screen reader.',
                    '   A hidden control teaches nobody anything.',
                    '5. **A source that cannot return a value says so.** It is not omitted from the',
                    '   table and no value is invented for it.',
                    '',
                    '### Deliberately not shown',
                    '',
                    'Nothing here is real. Fixtures are neutral placeholders and the single revealed',
                    'value is the literal string `sample-value-not-a-secret`. A catalog page is built',
                    'and published without credentials; it must never contain a real key name or',
                    'value, and this one does not.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** Every value masked — the state the page always opens in. */
export const Masked = { render: () => <InventoryPage /> };

/** One entry revealed, with its automatic-hide notice. */
export const Revealed = { render: () => <InventoryPage revealedId="entry-1" revealState="revealed" /> };

/** An entry that supports editing, replacing and deletion. */
export const Editable = { render: () => <InventoryPage data={[ENTRIES[0]]} /> };

/** A protected entry: still revealable, every write disabled and explained. */
export const ProtectedReadOnly = { render: () => <InventoryPage data={[ENTRIES[1]]} /> };

/** A referenced entry with nothing stored: reveal is off, Add is the only action. */
export const Missing = { render: () => <InventoryPage data={[ENTRIES[2]]} /> };

/** A source that cannot return what it stores, revealed. */
export const UnavailableFromSource = {
    render: () => <InventoryPage data={[ENTRIES[3]]} revealedId="entry-4" revealState="unavailable" />,
};

/** Nothing to show — the empty state, with its own explanation. */
export const Empty = {
    render: () => (
        <InventoryPage
            data={[]}
            empty={{
                title: 'No entries match these filters.',
                description: 'Clear the filters to see the full inventory.',
            }}
        />
    ),
};
