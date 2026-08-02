import React, { useState } from 'react';
import { FormField, Input } from '@/design-system/components';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';

/**
 * Typed-confirmation delete for a single configuration entry.
 *
 * The operator must type the exact key name. That is not theatre: the server
 * independently re-checks the typed string against the key it is about to
 * delete, so a mistyped or stale dialog cannot remove the wrong field.
 *
 * The dialog names every known consumer before it asks, because "what breaks if
 * this goes" is the only question worth answering here.
 */
export function EnvironmentDeleteDialog({ entry, onConfirm, onCancel, loading, error }) {
    const [typed, setTyped] = useState('');
    const matches = typed === entry.key;

    return (
        <ConfirmDialog
            title={`Delete ${entry.key}?`}
            description={`This removes ${entry.displayName} from ${entry.companyName || entry.integration}. Nothing else on the record changes.`}
            tone="danger"
            confirmLabel={matches ? `Delete ${entry.key}` : 'Type the key name to continue'}
            loading={loading}
            error={error}
            onConfirm={matches ? () => onConfirm(typed) : () => {}}
            onCancel={onCancel}
        >
            <div className="mt-ds-4 space-y-ds-3 text-start">
                <div>
                    <h3 className="text-ds-sm font-semibold text-ds-content">Known consumers</h3>
                    {entry.consumers?.length > 0 ? (
                        <ul className="mt-1 list-disc pl-ds-4 text-ds-sm text-ds-content-secondary">
                            {entry.consumers.map((consumer) => <li key={consumer}>{consumer}</li>)}
                        </ul>
                    ) : (
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            No consumer is recorded for this entry.
                        </p>
                    )}
                </div>

                <FormField
                    label={`Type ${entry.key} to confirm`}
                    description="The exact key name, including capitalisation."
                    required
                >
                    <Input
                        value={typed}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setTyped(event.target.value)}
                    />
                </FormField>
            </div>
        </ConfirmDialog>
    );
}
