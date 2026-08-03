import React from 'react';
import { Badge } from '@/design-system/components';
import { describeProviderState } from './aiProviderPresentation';

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
            {provider.credentialSource === 'legacy-env' && (
                // Worth surfacing: this provider is still served by the
                // pre-migration deploy binding rather than the managed
                // credential, so a rollback would still work and the migration
                // has not been run.
                <span className="text-ds-xs text-ds-content-secondary">
                    Using the legacy deploy binding, not the managed credential.
                </span>
            )}
        </div>
    );
}

export default AiProviderStatus;
