import React from 'react';
import { Badge, Button, Card, DataTable, IconButton, MetricCard } from '@design-system/components';
import { PageContainer, ResponsiveGrid, Stack } from '@design-system/layouts';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';

/**
 * The provider-integration row pattern: a prioritised list of interchangeable
 * external services, each showing whether it is usable, what it can do, and what
 * an operator may do to it.
 *
 * Everything here is a neutral, deterministic fixture. The catalog must not know
 * which vendors any particular product integrates with, so the services are
 * "Service alpha", "Service beta" and so on, the capability names are generic,
 * and the single revealed value is the literal string
 * `sample-value-not-a-secret`.
 */

const MASK = '********';

const CAPABILITY_SETS = {
    full: ['Text', 'Structured output', 'Images'],
    textOnly: ['Text', 'Structured output'],
};

/**
 * The states a provider row must be able to express. Each one exists because an
 * operator's next action differs: configure it, enable it, wait for it, or
 * accept that it is gone.
 */
const ROWS = [
    {
        id: 'alpha',
        name: 'Service alpha',
        priority: 1,
        capabilities: CAPABILITY_SETS.full,
        status: { tone: 'success', label: 'Healthy', detail: 'Last request succeeded.' },
        credential: { configured: true, label: 'Access key' },
        lastTest: { tone: 'success', label: 'Passed', when: 'Today 09:14' },
        actions: { replace: true, test: true, toggle: 'Disable', remove: true },
    },
    {
        id: 'beta',
        name: 'Service beta',
        priority: 2,
        capabilities: CAPABILITY_SETS.textOnly,
        status: { tone: 'warning', label: 'Not configured', detail: 'Needs Access key.' },
        credential: { configured: false, label: 'Access key' },
        lastTest: null,
        actions: { replace: false, test: false, toggle: null, remove: false },
    },
    {
        id: 'gamma',
        name: 'Service gamma',
        priority: 3,
        capabilities: CAPABILITY_SETS.textOnly,
        status: { tone: 'neutral', label: 'Disabled', detail: 'Configured but excluded from routing.' },
        credential: { configured: true, label: 'Access key' },
        lastTest: { tone: 'success', label: 'Passed', when: 'Yesterday 16:02' },
        actions: { replace: true, test: true, toggle: 'Enable', remove: true },
    },
    {
        id: 'delta',
        name: 'Service delta',
        priority: 4,
        capabilities: CAPABILITY_SETS.full,
        status: { tone: 'warning', label: 'Quota cooldown', detail: 'Skipped until 10:45.' },
        credential: { configured: true, label: 'Access key' },
        lastTest: { tone: 'danger', label: 'Failed', when: 'Today 10:15' },
        actions: { replace: true, test: true, toggle: 'Disable', remove: true },
    },
    {
        id: 'epsilon',
        name: 'Service epsilon',
        priority: 5,
        capabilities: CAPABILITY_SETS.textOnly,
        status: {
            tone: 'neutral',
            label: 'Retired by vendor',
            detail: 'Withdrawn by the operator of this service. It cannot be configured.',
        },
        credential: { configured: false, label: 'Access key' },
        lastTest: null,
        // A retired entry keeps its place in the order so the list stays legible,
        // but every action would be a lie, so none is offered.
        actions: { replace: false, test: false, toggle: null, remove: false },
    },
];

const REVEALED_SAMPLE = 'sample-value-not-a-secret';

function CredentialCell({ row, revealedId, secondsRemaining }) {
    const isRevealed = revealedId === row.id;
    const label = `${isRevealed ? 'Hide' : 'Reveal'} ${row.name} ${row.credential.label}`;

    return (
        <div className="flex min-w-0 items-start gap-ds-2">
            <div className="min-w-0 flex-1">
                <span className="block text-ds-xs text-ds-content-secondary">{row.credential.label}</span>

                {!isRevealed && (
                    <span className="font-mono text-ds-sm text-ds-content-secondary">
                        {row.credential.configured ? MASK : 'Not configured'}
                    </span>
                )}

                {isRevealed && (
                    <>
                        <span className="block break-all font-mono text-ds-sm text-ds-content-primary">
                            {REVEALED_SAMPLE}
                        </span>
                        <span role="status" className="block text-ds-xs text-ds-content-secondary">
                            Hides automatically in {secondsRemaining}s
                        </span>
                    </>
                )}
            </div>

            <IconButton
                label={label}
                variant="ghost"
                size="sm"
                aria-pressed={isRevealed}
                disabled={!row.credential.configured}
            >
                {isRevealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </IconButton>
        </div>
    );
}

function columnsFor({ revealedId, secondsRemaining }) {
    return [
        {
            key: 'service',
            header: 'Service',
            rowHeader: true,
            priority: 'primary',
            width: 'md',
            render: (row) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-semibold text-ds-content">{row.name}</span>
                    <span className="text-ds-xs text-ds-content-secondary">Order position {row.priority}</span>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (row) => (
                <div className="flex flex-col gap-ds-1">
                    <Badge tone={row.status.tone}>{row.status.label}</Badge>
                    <span className="text-ds-xs text-ds-content-secondary">{row.status.detail}</span>
                </div>
            ),
        },
        {
            key: 'capabilities',
            header: 'Capabilities',
            priority: 'tertiary',
            width: 'md',
            render: (row) => (
                <div className="flex flex-wrap gap-ds-1">
                    {row.capabilities.map((capability) => (
                        <Badge key={capability} tone="info">{capability}</Badge>
                    ))}
                </div>
            ),
        },
        {
            key: 'credential',
            header: 'Credential',
            width: 'lg',
            render: (row) => (
                <CredentialCell row={row} revealedId={revealedId} secondsRemaining={secondsRemaining} />
            ),
        },
        {
            key: 'lastTest',
            header: 'Last check',
            priority: 'tertiary',
            width: 'sm',
            render: (row) => (row.lastTest ? (
                <div className="flex flex-col gap-ds-1">
                    <Badge tone={row.lastTest.tone}>{row.lastTest.label}</Badge>
                    <span className="text-ds-xs text-ds-content-secondary">{row.lastTest.when}</span>
                </div>
            ) : (
                <span className="text-ds-xs text-ds-content-secondary">Never checked</span>
            )),
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (row) => {
                const any = row.actions.replace || row.actions.test || row.actions.toggle || row.actions.remove;
                if (!any) {
                    return <span className="text-ds-xs text-ds-content-secondary">No actions available.</span>;
                }
                return (
                    <div className="flex flex-wrap justify-end gap-ds-1">
                        {row.actions.replace && (
                            <Button size="sm" variant="secondary">
                                {row.credential.configured ? 'Replace' : 'Add'} credential
                            </Button>
                        )}
                        {row.actions.test && <Button size="sm" variant="secondary">Check connection</Button>}
                        {row.actions.toggle && <Button size="sm" variant="secondary">{row.actions.toggle}</Button>}
                        {row.actions.remove && (
                            <Button size="sm" variant="danger" aria-label={`Delete ${row.name} ${row.credential.label}`}>
                                Delete
                            </Button>
                        )}
                    </div>
                );
            },
        },
    ];
}

function IntegrationPage({ data = ROWS, revealedId = null, secondsRemaining = 30, isLoading = false, empty }) {
    const usable = data.filter((row) => row.status.label !== 'Retired by vendor');

    return (
        <div className="min-h-screen bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <div>
                        <h2 className="text-ds-heading-lg font-bold text-ds-content">Service integrations</h2>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Interchangeable external services, listed in the order they are attempted.
                        </p>
                    </div>

                    <Card padding="sm">
                        <h3 className="text-ds-sm font-semibold text-ds-content">How credentials are handled</h3>
                        <ul className="mt-1 list-disc pl-ds-4 text-ds-sm text-ds-content-secondary">
                            <li>Values are masked by default and revealed one at a time.</li>
                            <li>A revealed value clears after 30 seconds or when the tab is hidden.</li>
                        </ul>
                    </Card>

                    <ResponsiveGrid minItemWidth="sm" role="group" aria-label="Integration summary">
                        <MetricCard label="Services" value={String(data.length)} />
                        <MetricCard
                            label="Configured"
                            value={String(usable.filter((row) => row.credential.configured).length)}
                            tone="info"
                        />
                        <MetricCard
                            label="In cooldown"
                            value={String(usable.filter((row) => row.status.label.includes('cooldown')).length)}
                            tone="warning"
                        />
                    </ResponsiveGrid>

                    <DataTable
                        ariaLabel="Service integration configuration"
                        density="compact"
                        minWidth="wide"
                        data={data}
                        columns={columnsFor({ revealedId, secondsRemaining })}
                        isLoading={isLoading}
                        loadingLabel="Loading services"
                        empty={empty || { title: 'No services are registered.' }}
                    />
                </Stack>
            </PageContainer>
        </div>
    );
}

const meta = {
    title: 'Patterns/Provider integration row',
    parameters: {
        layout: 'fullscreen',
        docs: {
            description: {
                component: [
                    '**Status: Approved composition, visual regression Needs review.** Every part is an',
                    'approved primitive used as intended. Automated visual verification is still an',
                    'open roadmap item, so density and alignment here are reviewed by eye at 1440,',
                    '1024 and 412px.',
                    '',
                    '### What this pattern is for',
                    '',
                    'A prioritised list of interchangeable external services where the operator needs',
                    'four facts per row at a glance: whether it can be used, what it is capable of,',
                    'whether its credential is present, and what happened the last time it was',
                    'checked.',
                    '',
                    '### The rules it encodes',
                    '',
                    '1. **Order is shown, not implied.** Each row states its position, because the list',
                    '   order *is* the failover order and a reader should not have to count rows.',
                    '2. **Every state carries a text label.** Healthy, not configured, disabled,',
                    '   cooldown and retired are words as well as tones, so the question "which one is',
                    '   working" is answerable without relying on colour.',
                    '3. **A state says what to do about it.** "Not configured" is followed by which',
                    '   field is missing; a cooldown says when it lifts. A bare status badge tells an',
                    '   operator nothing actionable.',
                    '4. **Capability is visible, because it gates routing.** A service that cannot',
                    '   handle a kind of work is never chosen for it, so the reader can see why a row',
                    '   was skipped.',
                    '5. **Credentials are masked and revealed one at a time**, with the expiry',
                    '   announced as visible text in a live region.',
                    '6. **Every destructive control names its target.** "Delete" repeated down a',
                    '   column is unusable with a screen reader, so the accessible name is',
                    '   "Delete <service> <field>".',
                    '7. **A retired service keeps its row and loses its actions.** Removing the row',
                    '   would break the visible ordering; offering actions that cannot succeed would',
                    '   be worse. It says why, and offers nothing.',
                    '',
                    '### Deliberately not shown',
                    '',
                    'Nothing here is real. The services are neutral placeholders, the capability names',
                    'are generic, and the single revealed value is the literal string',
                    '`sample-value-not-a-secret`. A catalog page is built and published without',
                    'credentials and must never contain a real vendor name or value.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** Every credential masked — the state the page always opens in. */
export const AllStates = { render: () => <IntegrationPage /> };

/** One credential revealed, with its expiry announced. */
export const CredentialRevealed = {
    render: () => <IntegrationPage revealedId="alpha" secondsRemaining={27} />,
};

/** A configured, healthy service with a recent passing check. */
export const Configured = { render: () => <IntegrationPage data={[ROWS[0]]} /> };

/** A service with no credential: it names the missing field and offers no check. */
export const Unconfigured = { render: () => <IntegrationPage data={[ROWS[1]]} /> };

/** Configured but deliberately excluded from routing. */
export const Disabled = { render: () => <IntegrationPage data={[ROWS[2]]} /> };

/** Temporarily skipped after exhausting its allowance, with the lift time shown. */
export const InCooldown = { render: () => <IntegrationPage data={[ROWS[3]]} /> };

/** Withdrawn by its vendor: the row stays, the actions do not. */
export const RetiredByVendor = { render: () => <IntegrationPage data={[ROWS[4]]} /> };

/** A failed connection check, reported as a category rather than a raw error. */
export const FailedCheck = { render: () => <IntegrationPage data={[ROWS[3]]} /> };

export const Loading = { render: () => <IntegrationPage data={[]} isLoading /> };

export const Empty = {
    render: () => (
        <IntegrationPage
            data={[]}
            empty={{
                title: 'No services are registered.',
                description: 'Add a credential to make one available.',
            }}
        />
    ),
};
