import React from 'react';

import { Badge, Card } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

import { describeSkipReason } from './aiProviderPresentation';

/**
 * Which providers would actually serve each kind of AI task right now, and why
 * the rest would not.
 *
 * This answers the question the routing order on its own cannot: an operator
 * puts Cerebras first, CDL auto-fill carries on using Gemini, and nothing on
 * the page says why. The reason is that Cerebras declares no vision models, so
 * it is skipped as `incapable` for document images however it is ranked. The
 * verdicts come from the router's own `describeRouting`, so they cannot drift
 * from what routing will really do.
 */
export function AiRoutingEligibility({ lanes, providers }) {
    if (!lanes || lanes.length === 0) return null;

    const nameFor = (providerId) => providers.find((provider) => provider.id === providerId)?.displayName
        || providerId;

    return (
        <ResponsiveGrid minItemWidth="md" role="group" aria-label="Effective routing by task type">
            {lanes.map((lane) => {
                const eligible = lane.providers.filter((row) => row.eligible);

                return (
                    <Card key={lane.id} padding="md">
                        <Stack gap="sm">
                            <div>
                                <h4 className="font-semibold text-ds-content">{lane.label}</h4>
                                <p className="mt-1 text-ds-xs text-ds-content-secondary">
                                    {lane.description}
                                </p>
                            </div>

                            <p className="text-ds-sm text-ds-content-secondary">
                                {eligible.length === 0
                                    ? 'No provider can serve this kind of task right now.'
                                    : `Tried in this order: ${eligible.map((row) => nameFor(row.providerId)).join(', ')}.`}
                            </p>

                            <ul className="flex flex-col gap-ds-1">
                                {lane.providers.map((row) => (
                                    <li
                                        key={row.providerId}
                                        className="flex flex-wrap items-center gap-ds-2 text-ds-sm text-ds-content-secondary"
                                    >
                                        <Badge tone={row.eligible ? 'success' : 'neutral'}>
                                            {row.eligible ? 'In use' : 'Skipped'}
                                        </Badge>
                                        <span className="text-ds-content">{nameFor(row.providerId)}</span>
                                        <span>
                                            {row.eligible
                                                ? `Would use ${row.model}.`
                                                : describeSkipReason(row.reason)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </Stack>
                    </Card>
                );
            })}
        </ResponsiveGrid>
    );
}

export default AiRoutingEligibility;
