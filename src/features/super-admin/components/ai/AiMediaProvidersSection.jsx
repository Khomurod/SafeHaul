/**
 * The Research & Media subsection of the AI Integrations screen: the image
 * providers the automated blog uses, with their credential controls.
 * Extracted verbatim from `AiIntegrationsView.jsx`; the credential modal and
 * delete dialog stay with the view, which owns their state.
 */

import React from 'react';
import {
    Badge,
    Button,
    Card,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import {
} from './aiTelemetryPresentation';

export function AiMediaProvidersSection({
    mediaProviders,
    setCredentialModal,
    setDeleteTarget,
    setDeleteError,
}) {
    return (
        <>
            {/* Research & Media — a clearly separated subsection of the same view. */}
            <div>
                <h3 className="text-ds-heading-md font-bold text-ds-content">Research &amp; Media</h3>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Image sources for automatically published articles. Every stored image records its
                    provider, source, creator, licence and attribution. When none of these is configured,
                    articles use an approved SafeHaul illustration rather than an unlicensed image.
                </p>
            </div>

            <ResponsiveGrid minItemWidth="md" role="group" aria-label="Media providers">
                {mediaProviders.map((provider) => (
                    <Card key={provider.id} padding="md">
                        <Stack gap="sm">
                            <div className="flex items-start justify-between gap-ds-2">
                                <div>
                                    <h4 className="font-semibold text-ds-content">{provider.displayName}</h4>
                                    <span className="text-ds-xs text-ds-content-secondary">
                                        Priority {provider.priority}
                                    </span>
                                </div>
                                <Badge tone={provider.configured ? 'success' : 'warning'}>
                                    {provider.configured ? 'Available' : 'Not configured'}
                                </Badge>
                            </div>

                            <p className="text-ds-xs text-ds-content-secondary">
                                {provider.requiresCredential
                                    ? 'Requires an API credential.'
                                    : 'Works without a credential; a token raises the rate limit.'}
                                {' '}
                                {provider.allowsHosting
                                    ? 'Images may be hosted by SafeHaul.'
                                    : 'Images must be hotlinked, per the provider terms.'}
                            </p>

                            {provider.credentialFields.map((field) => (
                                <div key={field.name} className="flex items-center justify-between gap-ds-2">
                                    <span className="text-ds-sm text-ds-content-secondary">
                                        {field.label}: <span className="font-mono">{field.configured ? field.maskedValue : 'none'}</span>
                                    </span>
                                    <div className="flex gap-ds-1">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setCredentialModal({
                                                provider,
                                                field,
                                                mode: field.configured ? 'replace' : 'add',
                                                kind: 'media',
                                            })}
                                        >
                                            {field.configured ? 'Replace' : 'Add'}
                                        </Button>
                                        {field.configured && (
                                            <Button
                                                size="sm"
                                                variant="danger"
                                                aria-label={`Delete ${provider.displayName} ${field.label}`}
                                                onClick={() => {
                                                    setDeleteError(null);
                                                    setDeleteTarget({ provider, field, kind: 'media' });
                                                }}
                                            >
                                                Delete
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </Stack>
                    </Card>
                ))}
            </ResponsiveGrid>

        </>
    );
}
