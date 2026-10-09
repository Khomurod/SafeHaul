import React, { useCallback, useState } from 'react';
import { Icon, KeyRound } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button, Card, Link, Notice } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { ApiKeysTable } from './ApiKeysTable';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';
import { apiKeyErrorMessage } from './apiKeysService';
import { useCompanyApiKeys } from './useCompanyApiKeys';

/**
 * Settings → API Keys: a Company Admin lets another service, such as their TMS,
 * read the applications drivers submit, and turns that off again.
 *
 * Its own tab rather than a card under Integrations, because Integrations is
 * hidden with call tracking and every company may make keys. The server checks
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
                title="API Keys"
                description="Let another service, such as your TMS, read the applications drivers submit to you."
                actions={(
                    <Button variant="primary" onClick={() => setCreating(true)} disabled={loading || atLimit}>
                        <Icon icon={KeyRound} />
                        Create key
                    </Button>
                )}
            />

            <Notice tone="info" title="How it works" titleAs="h2">
                <ol className="list-decimal space-y-ds-1 ps-ds-5">
                    <li>Create a key and name it after the service that will use it.</li>
                    <li>Copy the key. It is shown only once.</li>
                    <li>
                        Give it to that service’s developer, with the{' '}
                        <Link href="/developers/api">SafeHaul API guide</Link>.
                    </li>
                </ol>
                <p className="mt-ds-2">
                    A key only reads: the applications drivers submitted to you, and, if you allow it, their
                    uploaded files and full Social Security Number. It cannot change anything. Every request is
                    recorded, and turning a key off stops the service at once.
                </p>
            </Notice>

            {atLimit && (
                <Notice tone="warning" size="sm">
                    {`You have ${maxActiveKeys} keys turned on, the most a company can have. Turn one off to create another.`}
                </Notice>
            )}

            <Card padding="none">
                <ApiKeysTable
                    keys={keys}
                    loading={loading}
                    onRevoke={askRevoke}
                    error={error ? { message: error, onRetry: reload } : undefined}
                />
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
