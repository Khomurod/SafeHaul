import React from 'react';
import { Badge } from '@/design-system/components';
import { describeProviderState } from './aiProviderPresentation';
import { describeLaneHealth } from './aiTelemetryPresentation';

/**
 * The two lanes every SafeHaul AI task falls into.
 *
 * Shown separately because they fail separately: they reach different models, in
 * different request shapes, on different vendor entitlements. A single badge let a
 * successful blog article turn a provider green again while every CDL photograph
 * handed to it was being rejected — the "status looks healthy while important
 * capabilities are failing" this row was reported for.
 */
const LANES = [
    { id: 'text', label: 'Text' },
    { id: 'vision', label: 'Images' },
];

/**
 * Status treatment for one provider row.
 *
 * The state machine itself lives in `./aiProviderPresentation.js` so this file
 * exports a component only — Fast Refresh can then swap it without remounting
 * the page, which would otherwise discard a revealed credential's countdown.
 */
export function AiProviderStatus({ provider }) {
    const state = describeProviderState(provider);

    return (
        <div className="flex flex-col gap-ds-1">
            <Badge tone={state.tone}>{state.label}</Badge>
            <span className="text-ds-xs text-ds-content-secondary">{state.detail}</span>
            {provider.laneHealth && (
                <div className="flex flex-wrap items-center gap-ds-1">
                    {LANES.map((lane) => {
                        const laneState = describeLaneHealth(provider.laneHealth[lane.id]);
                        return (
                            <span key={lane.id} className="flex items-center gap-ds-1 text-ds-xs">
                                <span className="text-ds-content-secondary">{lane.label}</span>
                                <Badge tone={laneState.tone}>{laneState.label}</Badge>
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default AiProviderStatus;
