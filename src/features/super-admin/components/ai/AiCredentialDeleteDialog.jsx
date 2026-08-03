import React, { useState } from 'react';
import { FormField, Input } from '@/design-system/components';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';

/**
 * Typed-confirmation delete for one AI provider credential.
 *
 * Built on the shared `ConfirmDialog`, so focus trapping, focus restoration,
 * Escape handling and the double-activation guard are the ones the rest of the
 * application already uses.
 *
 * The operator must type the provider's display name. The server re-checks that
 * string, so the guard is not merely a UI affordance — a scripted call without
 * it is refused too.
 */
export function AiCredentialDeleteDialog({ provider, field, onConfirm, onCancel, loading, error }) {
    const [typed, setTyped] = useState('');
    const matches = typed.trim() === provider.displayName;

    return (
        <ConfirmDialog
            title={`Delete the ${provider.displayName} ${field.label.toLowerCase()}?`}
            description={
                `This destroys every stored version of the credential. ${provider.displayName} is `
                + 'marked unconfigured and the router stops selecting it. The audit history is kept, '
                + 'without the value.'
            }
            tone="danger"
            confirmLabel={matches ? 'Delete credential' : 'Type the provider name to continue'}
            cancelLabel="Keep credential"
            loading={loading}
            error={error}
            onConfirm={matches ? () => onConfirm(typed.trim()) : () => {}}
            onCancel={onCancel}
        >
            <FormField
                label={`Type "${provider.displayName}" to confirm`}
                description="The server checks this too, so it cannot be skipped."
                required
            >
                <Input
                    value={typed}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setTyped(event.target.value)}
                />
            </FormField>
        </ConfirmDialog>
    );
}

export default AiCredentialDeleteDialog;
