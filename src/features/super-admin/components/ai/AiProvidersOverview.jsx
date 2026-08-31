/**
 * The introduction of the AI Integrations providers tab: how credentials are
 * handled, and the provider summary counts. Extracted verbatim from
 * `AiIntegrationsView.jsx`.
 */

import React from 'react';
import { Card, MetricCard } from '@/design-system/components';
import { ResponsiveGrid } from '@/design-system/layouts';

export function AiProvidersOverview({ summary }) {
    return (
        <>
            <Card padding="sm">
                <h3 className="text-ds-sm font-semibold text-ds-content">How credentials are handled</h3>
                <ul className="mt-1 list-disc pl-ds-4 text-ds-sm text-ds-content-secondary">
                    <li>Values are masked by default and revealed one at a time.</li>
                    <li>Revealing or changing one needs a recent sign-in and is audited without the value.</li>
                    <li>A revealed value clears after 30 seconds, when the tab is hidden, or on leaving.</li>
                    <li>Credentials live in Google Secret Manager and take effect without a deployment.</li>
                </ul>
            </Card>

            <ResponsiveGrid minItemWidth="sm" role="group" aria-label="AI provider summary">
                <MetricCard label="Supported providers" value={String(summary.total)} />
                <MetricCard label="Configured" value={String(summary.configured)} tone="info" />
                <MetricCard label="Active in routing" value={String(summary.enabled)} tone="success" />
                <MetricCard
                    label="In cooldown"
                    value={String(summary.cooldown)}
                    tone={summary.cooldown > 0 ? 'warning' : 'neutral'}
                />
                <MetricCard
                    label="Retired by vendor"
                    value={String(summary.retired)}
                    tone={summary.retired > 0 ? 'neutral' : 'neutral'}
                />
            </ResponsiveGrid>
        </>
    );
}
