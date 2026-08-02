import React, { useId, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Card, FieldMessage, FormField, Input, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Edit / Replace / Add dialog for a single configuration entry.
 *
 * Three things this deliberately does **not** do:
 *
 *  1. **Preload anything.** The field opens empty. Loading the current value
 *     into an editable input would put a secret on screen with no reveal, no
 *     timer and no audit record — exactly the workflow the vault replaces. It
 *     would also risk the double-encryption failure the SMS integration form
 *     documents.
 *  2. **Show the value in a toast.** Success says the key was updated and
 *     nothing else.
 *  3. **Claim more than it did.** A build-time entry is marked as requiring a
 *     deployment; the dialog says the live application has not changed yet.
 */
/**
 * The one field the vault stores as a boolean rather than a string. It gets a
 * two-option `Select` so an operator cannot type `"yes"` into a flag that only
 * accepts `true` / `false` — the backend would reject it, but after a round trip.
 */
const BOOLEAN_FIELD_KEYS = new Set(['isSandbox']);

export function EnvironmentValueModal({ entry, mode, onSubmit, onCancel }) {
    const isBoolean = BOOLEAN_FIELD_KEYS.has(entry.key);
    const titleId = useId();
    const descriptionId = useId();
    const inputRef = useRef(null);
    const [value, setValue] = useState(isBoolean ? 'true' : '');
    const [validationError, setValidationError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    const [saving, setSaving] = useState(false);

    const verb = mode === 'add' ? 'Add' : 'Replace';

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (saving) return;

        const trimmed = value.trim();
        if (!isBoolean && trimmed === '') {
            setValidationError('Enter a value.');
            return;
        }
        setValidationError(null);
        setSubmitError(null);
        setSaving(true);
        try {
            await onSubmit(trimmed);
        } catch (error) {
            setSubmitError(error?.message || 'The value could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            onClose={saving ? undefined : onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={inputRef}
            closeOnBackdrop={false}
            closeOnEscape={!saving}
        >
            <form onSubmit={handleSubmit}>
                <Stack gap="md" className="p-ds-6">
                    <div>
                        <h2 id={titleId} className="text-ds-heading-md font-bold text-ds-content">
                            {verb} {entry.key}
                        </h2>
                        <p id={descriptionId} className="mt-1 text-ds-sm text-ds-content-secondary">
                            {entry.displayName} — {entry.integration}
                            {entry.companyName ? ` (${entry.companyName})` : ''}
                        </p>
                    </div>

                    <Card padding="sm">
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
                    </Card>

                    {entry.requiresDeployment && (
                        <p className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                            <span>
                                This value only reaches the running application after a deployment. Saving it
                                here does not change the live app.
                            </span>
                        </p>
                    )}

                    {isBoolean ? (
                        <FormField label="New value" description="Sandbox mode targets the provider's test platform." required>
                            <Select ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)}>
                                <option value="true">true</option>
                                <option value="false">false</option>
                            </Select>
                        </FormField>
                    ) : (
                        <FormField
                            label="New value"
                            description="The current value is never loaded into this field. Enter the replacement in full."
                            error={validationError}
                            required
                        >
                            <Input
                                ref={inputRef}
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                            />
                        </FormField>
                    )}

                    {submitError && <FieldMessage tone="error">{submitError}</FieldMessage>}

                    <div className="flex flex-wrap justify-end gap-ds-2">
                        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="primary" loading={saving}>{verb} value</Button>
                    </div>
                </Stack>
            </form>
        </Modal>
    );
}
