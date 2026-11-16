import React, { useCallback, useState } from 'react';
import { Icon, Info, KeyRound } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button, Card, Link, Notice } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { ApiKeysTable } from './ApiKeysTable';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';
import { apiKeyErrorMessage } from './apiKeysService';
import { useCompanyApiKeys } from './useCompanyApiKeys';
import { StepMarker } from '../StepMarker';

/** The three steps from a new key to a service reading with it. */
const HOW_IT_WORKS = [
    { id: 'create', text: 'Create a key and name it after the service that will use it.' },
    { id: 'copy', text: 'Copy the key. It is shown only once.' },
    {
        id: 'give',
        text: (
            <>
                Give it to that service’s developer, with the{' '}
                <Link href="/developers/api">SafeHaul API guide</Link>.
            </>
        ),
    },
];

/**
 * Settings → API Keys: a Company Admin lets another service, such as their TMS,
 * read the applications drivers submit, and turns that off again.
 *
 * Its own tab rather than a card under Facebook leads, because Facebook leads
 * shows only where a super admin switched it on and every company may make keys. The server checks
 * Company Admin for each call; this page only shows what it answers.
 */
export function ApiKeysTab({ companyId }) {
    const { showSuccess } = useToast();
    const { keys, maxActiveKeys, activeCount, loading, error, reload, create, revoke } = useCompanyApiKeys(companyId);
    const [creating, setCreating] = useState(false);
    const [revoking, setRevoking] = useState(null);
    const [revokeState, setRevokeState] = useState({ busy: false, error: null });
    const atLimit = activeCount >= maxActiveKeys;

    const askRevoke = useCallback((key) => {
        setRevokeState({ busy: false, error: null });
        setRevoking(key);
    }, []);

    const confirmRevoke = async () => {
        setRevokeState({ busy: true, error: null });
        try {
            await revoke(revoking.keyId);
            showSuccess(`“${revoking.name}” is turned off.`);
            setRevoking(null);
        } catch (failure) {
            setRevokeState({ busy: false, error: apiKeyErrorMessage(failure, 'We could not turn the key off. Try again.') });
            return;
        }
        setRevokeState({ busy: false, error: null });
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="API keys"
                description="Let another service, such as your TMS, read the applications drivers submit to you."
                actions={(
                    <Button variant="primary" onClick={() => setCreating(true)} disabled={loading || atLimit}>
                        <Icon icon={KeyRound} />
                        Create key
                    </Button>
                )}
            />

            {atLimit && (
                <Notice tone="warning" size="sm">
                    {`You have ${maxActiveKeys} keys turned on, the most a company can have. Turn one off to create another.`}
                </Notice>
            )}

            <ApiKeysTable
                keys={keys}
                loading={loading}
                onRevoke={askRevoke}
                error={error ? { message: error, onRetry: reload } : undefined}
            />

            {/* Under the keys, so the keys are the first thing on the page. */}
            <Card as="section" padding="md" aria-labelledby="api-keys-how-it-works">
                <h2 id="api-keys-how-it-works" className="flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                    <Icon icon={Info} className="text-ds-brand-primary" />
                    How it works
                </h2>
                <ol className="mt-ds-4 grid gap-ds-3 text-ds-body text-ds-content-secondary lg:grid-cols-3 lg:gap-ds-6">
                    {HOW_IT_WORKS.map((step, index) => (
                        <li key={step.id} className="flex items-start gap-ds-3 [text-wrap:pretty]">
                            <StepMarker number={index + 1} />
                            <span>{step.text}</span>
                        </li>
                    ))}
                </ol>
                <p className="mt-ds-4 border-t border-ds-border-subtle pt-ds-4 text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                    A key only reads: the applications drivers submitted to you, and, if you allow it, their
                    uploaded files and full Social Security Number. It cannot change anything. Every request made
                    with a working key is recorded, and turning a key off stops the service at once.
                </p>
            </Card>

            {creating && <CreateApiKeyDialog onCreate={create} onClose={() => setCreating(false)} />}

            <ConfirmDialog
                isOpen={Boolean(revoking)}
                title={`Turn off “${revoking?.name || ''}”?`}
                description="The service using this key stops reading your applications at once. A key that is turned off cannot be turned on again; create a new one if you need it."
                confirmLabel="Turn off"
                loading={revokeState.busy}
                error={revokeState.error}
                onConfirm={confirmRevoke}
                onCancel={() => setRevoking(null)}
            />
        </Stack>
    );
}

export default ApiKeysTab;
