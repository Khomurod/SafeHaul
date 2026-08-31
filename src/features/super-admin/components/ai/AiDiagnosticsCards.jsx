/**
 * The two diagnostics cards of the AI Integrations screen: model pins
 * reconciled against each vendor's live catalogue, and credential access
 * asked of BOTH Functions generations (the two generations run as different
 * service accounts, so one answer proves nothing — the comments below carry
 * the full reasoning). Extracted verbatim from `AiIntegrationsView.jsx`; the
 * state and the handlers stay with the view, so tab switches keep their
 * results exactly as before.
 */

import React from 'react';
import {
    Badge,
    Button,
    Card,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import {
    describePinStatus,
} from './aiTelemetryPresentation';

export function AiDiagnosticsCards({
    pinDiagnosis,
    diagnosingPins,
    handleDiagnosePins,
    credentialAccess,
    checkingCredentialAccess,
    handleCheckCredentialAccess,
}) {
    return (
        <>
            {/* Model pins, reconciled against each vendor's live catalogue.
                A pin is only a string until a request is made with it, so this
                is the one check that can catch a vendor retiring a model. */}
            <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <div>
                        <h3 className="text-ds-sm font-semibold text-ds-content">Model pins</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Asks each configured vendor whether the models SafeHaul pins still exist.
                            Six pins had been naming retired models before this check existed.
                        </p>
                    </div>
                    <Button variant="secondary" size="sm" loading={diagnosingPins} onClick={handleDiagnosePins}>
                        Verify model pins
                    </Button>
                </div>

                {pinDiagnosis && (
                    <ul className="mt-ds-3 space-y-ds-2">
                        {pinDiagnosis.providers.map((entry) => {
                            const state = describePinStatus(entry);
                            return (
                                <li key={entry.providerId} className="flex flex-wrap items-center gap-ds-2 text-ds-sm">
                                    <span className="font-semibold text-ds-content">{entry.displayName}</span>
                                    <Badge tone={state.tone}>{state.label}</Badge>
                                    {entry.pins.filter((pin) => !pin.present).map((pin) => (
                                        <span key={pin.model} className="text-ds-xs text-ds-content-secondary">
                                            {pin.model} ({pin.capabilities.join(', ')})
                                        </span>
                                    ))}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>

            {/* Credential access, asked of BOTH Functions generations.
                Not one: 1st generation functions default to the App Engine
                service account and 2nd generation ones to the Compute Engine
                account, and AI credentials are read at runtime so access depends
                entirely on a manual Secret Manager grant. A grant made to one
                account fixes some AI entry points and leaves others refused,
                which from the outside reads as "AI works sometimes". CDL
                auto-fill is 1st generation; this console, the E-Doc assistant and
                the blog scheduler are 2nd. One answer proves nothing. */}
            <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <div>
                        <h3 className="text-ds-sm font-semibold text-ds-content">Credential access</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Asks each Functions generation whether it can actually read the stored
                            credentials, and names the service account being refused. The two
                            generations use different accounts, so both are checked.
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={checkingCredentialAccess}
                        onClick={handleCheckCredentialAccess}
                    >
                        Check credential access
                    </Button>
                </div>

                {credentialAccess && (
                    <Stack gap="sm" className="mt-ds-3">
                        {credentialAccess.generations.map((entry) => (
                            <div key={entry.generation} className="text-ds-sm">
                                <div className="flex flex-wrap items-center gap-ds-2">
                                    <span className="font-semibold text-ds-content">
                                        {entry.generation === 'v1' ? '1st generation' : '2nd generation'}
                                    </span>
                                    {entry.ok ? (
                                        <Badge tone={entry.report.unreadableCount > 0 ? 'danger' : 'success'}>
                                            {entry.report.unreadableCount > 0
                                                ? `${entry.report.unreadableCount} unreadable`
                                                : 'All readable'}
                                        </Badge>
                                    ) : (
                                        <Badge tone="warning">Check did not run</Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-ds-xs text-ds-content-secondary">
                                    {entry.ok ? entry.report.summary : entry.error}
                                </p>
                                {entry.ok && entry.report.runtime.serviceAccount && (
                                    <p className="mt-1 text-ds-xs text-ds-content-secondary">
                                        Running as {entry.report.runtime.serviceAccount}
                                    </p>
                                )}
                                {entry.ok && (
                                    <ul className="mt-1 space-y-ds-1">
                                        {entry.report.providers
                                            .flatMap((row) => row.secrets
                                                .filter((secret) => !secret.readable)
                                                .map((secret) => ({ ...secret, displayName: row.displayName })))
                                            .map((secret) => (
                                                <li
                                                    key={`${entry.generation}-${secret.secretId}`}
                                                    className="text-ds-xs text-ds-content-secondary"
                                                >
                                                    {secret.displayName}: {secret.secretId} — {secret.reason}
                                                </li>
                                            ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </Stack>
                )}
            </Card>

        </>
    );
}
