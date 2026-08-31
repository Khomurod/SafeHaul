/**
 * The AI provider table's columns, extracted verbatim from
 * `AiIntegrationsView.jsx`. A builder rather than a component: the view
 * memoises the result with the same dependency list it always had, and every
 * handler and piece of state the cells use arrives through the one context
 * argument, so nothing about when the columns are rebuilt has changed.
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import {
    Badge,
    Button,
    FormField,
    Input,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { AiCredentialCell } from './AiCredentialCell';
import { AiProviderStatus } from './AiProviderStatus';
import {
    describeCategory,
    describeProbe,
    describeProbeDetail,
} from './aiTelemetryPresentation';

export function buildProviderColumns({
    busyId,
    configDrafts,
    handleMigrateGroq,
    handleSaveConfig,
    handleTest,
    handleToggleEnabled,
    revealed,
    testingId,
    testResults,
    setConfigDrafts,
    setCredentialModal,
    setDeleteTarget,
    setDeleteError,
}) {
    return [
        {
            key: 'provider',
            header: 'Provider',
            rowHeader: true,
            priority: 'primary',
            width: 'md',
            render: (provider) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-semibold text-ds-content">{provider.displayName}</span>
                    <span className="text-ds-xs text-ds-content-secondary">
                        Fallback position {provider.rank ?? provider.priority}
                    </span>
                    {typeof provider.rank === 'number' && provider.rank !== provider.priority && (
                        // The registry default is worth naming once an operator
                        // has moved away from it, so "why is this not where the
                        // documentation says" has an answer on the row itself.
                        <span className="text-ds-xs text-ds-content-secondary">
                            Default position {provider.priority}
                        </span>
                    )}
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (provider) => <AiProviderStatus provider={provider} />,
        },
        {
            key: 'capabilities',
            header: 'Capabilities',
            priority: 'tertiary',
            // `xl`, not `md`. Badges are `white-space: nowrap`, so a column
            // holding them must be at least as wide as the widest one —
            // "Structured JSON output" needs 171px, and at 144px it spilled over
            // the credentials column. `lg` clears it by 5px, which is one font
            // change away from breaking; `xl` clears it by 49px.
            width: 'xl',
            render: (provider) => (
                <div className="flex flex-wrap gap-ds-1">
                    {provider.capabilities.map((capability) => (
                        <Badge key={capability.id} tone="info">{capability.label}</Badge>
                    ))}
                </div>
            ),
        },
        {
            key: 'credentials',
            header: 'Credentials',
            width: 'lg',
            render: (provider) => (
                <Stack gap="sm">
                    {provider.credentialFields.map((field) => (
                        <AiCredentialCell
                            key={field.name}
                            providerId={provider.id}
                            providerName={provider.displayName}
                            field={field}
                            revealedSlot={revealed.revealedSlot}
                            pendingSlot={revealed.pendingSlot}
                            revealedValue={revealed.revealedValue}
                            unavailableReason={revealed.unavailableReason}
                            secondsRemaining={revealed.secondsRemaining}
                            canReveal={!provider.retired}
                            onToggle={revealed.reveal}
                        />
                    ))}
                </Stack>
            ),
        },
        {
            key: 'models',
            header: 'Model defaults',
            priority: 'tertiary',
            width: 'md',
            render: (provider) => (
                <Stack gap="sm">
                    <ul className="text-ds-xs text-ds-content-secondary">
                        {Object.entries(provider.resolvedModels).slice(0, 3).map(([capability, model]) => (
                            <li key={capability} className="break-all">{model}</li>
                        ))}
                    </ul>
                    {provider.configFields.map((field) => (
                        <FormField key={field.name} label={field.label} description={field.description}>
                            <Input
                                value={configDrafts[provider.id]?.[field.name] ?? field.value}
                                placeholder={field.placeholder}
                                autoComplete="off"
                                spellCheck={false}
                                disabled={Boolean(provider.retired)}
                                onChange={(event) => setConfigDrafts((current) => ({
                                    ...current,
                                    [provider.id]: {
                                        ...(current[provider.id] || {}),
                                        [field.name]: event.target.value,
                                    },
                                }))}
                            />
                        </FormField>
                    ))}
                    {configDrafts[provider.id] && (
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={busyId === provider.id}
                            onClick={() => handleSaveConfig(provider)}
                        >
                            Save settings
                        </Button>
                    )}
                </Stack>
            ),
        },
        {
            key: 'lastTest',
            header: 'Last test',
            priority: 'tertiary',
            width: 'sm',
            render: (provider) => {
                // In-session results first, then the stored ones. Both matter:
                // the first because a freshly-run test must render immediately,
                // the second because a reload is when an operator comes back to
                // look — and the breakdown used to exist only in memory, so the
                // row degraded to a bare "Failed" the moment the page refreshed.
                const probes = testResults[provider.id]?.length
                    ? testResults[provider.id]
                    : (provider.lastTest?.capabilities || []);
                if (!provider.lastTest && probes.length === 0) {
                    return <span className="text-ds-xs text-ds-content-secondary">Never tested</span>;
                }
                return (
                    <div className="flex flex-col gap-ds-1">
                        {provider.lastTest && (
                            <>
                                <Badge tone={provider.lastTest.success ? 'success' : 'danger'}>
                                    {provider.lastTest.success ? 'Passed' : 'Failed'}
                                </Badge>
                                {/* The category was returned and never rendered,
                                    so every unsuccessful test looked identical. */}
                                {!provider.lastTest.success && provider.lastTest.category && (
                                    <span className="text-ds-xs text-ds-content-secondary">
                                        {describeCategory(provider.lastTest.category)}
                                    </span>
                                )}
                                <span className="text-ds-xs text-ds-content-secondary">
                                    {provider.lastTest.at ? new Date(provider.lastTest.at).toLocaleString() : ''}
                                </span>
                            </>
                        )}
                        {/* Per-capability results. A provider that answers text
                            but not structured JSON says so on the row rather
                            than reporting a single misleading verdict — and each
                            line carries the vendor's own status and code, which
                            is what turns "Failed" into something actionable. */}
                        {probes.filter((probe) => probe.status !== 'skipped').map((probe) => {
                            const state = describeProbe(probe);
                            const detail = describeProbeDetail(probe);
                            return (
                                <span key={probe.id} className="flex flex-wrap items-center gap-ds-1 text-ds-xs">
                                    <Badge tone={state.tone}>{state.label}</Badge>
                                    <span className="text-ds-content-secondary">{probe.label}</span>
                                    {detail && (
                                        <span className="text-ds-content-secondary">{detail}</span>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (provider) => {
                if (provider.retired) {
                    // Retired providers keep their row so the fallback order is
                    // legible, but every action would be a lie.
                    return (
                        <span className="text-ds-xs text-ds-content-secondary">
                            No actions available.
                        </span>
                    );
                }

                const firstField = provider.credentialFields[0];
                const anyConfigured = provider.credentialFields.some((field) => field.configured);

                return (
                    <div className="flex flex-wrap justify-end gap-ds-1">
                        {provider.credentialFields.map((field) => (
                            <Button
                                key={field.name}
                                size="sm"
                                variant="secondary"
                                onClick={() => setCredentialModal({
                                    provider,
                                    field,
                                    mode: field.configured ? 'replace' : 'add',
                                    kind: 'ai',
                                })}
                            >
                                {field.configured ? 'Replace' : 'Add'} {field.label.toLowerCase()}
                            </Button>
                        ))}

                        <Button
                            size="sm"
                            variant="secondary"
                            loading={testingId === provider.id}
                            disabled={!provider.configured}
                            onClick={() => handleTest(provider)}
                        >
                            Test connection
                        </Button>

                        <Button
                            size="sm"
                            variant="secondary"
                            loading={busyId === provider.id}
                            disabled={!provider.configured}
                            onClick={() => handleToggleEnabled(provider)}
                        >
                            {provider.enabled ? 'Disable' : 'Enable'}
                        </Button>

                        {provider.id === 'groq' && provider.credentialSource === 'legacy-env' && (
                            <Button
                                size="sm"
                                variant="primary"
                                loading={busyId === 'groq'}
                                onClick={handleMigrateGroq}
                            >
                                Migrate legacy key
                            </Button>
                        )}

                        {anyConfigured && firstField && (() => {
                            const target = provider.credentialFields.find((f) => f.configured) || firstField;
                            return (
                                <Button
                                    size="sm"
                                    variant="danger"
                                    // Named for the credential it deletes. A table
                                    // of identical "Delete" buttons is unusable
                                    // with a screen reader.
                                    aria-label={`Delete ${provider.displayName} ${target.label}`}
                                    onClick={() => {
                                        setDeleteError(null);
                                        setDeleteTarget({ provider, field: target, kind: 'ai' });
                                    }}
                                >
                                    <Trash2 size={14} aria-hidden="true" /> Delete
                                </Button>
                            );
                        })()}
                    </div>
                );
            },
        },
    ];
}
