import React, { useId, useRef, useState } from 'react';
import { Button, Card, FieldMessage, FormField, Input } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Add / Replace dialog for one AI provider credential.
 *
 * Follows the environment vault's dialog conventions for the same reasons:
 *
 *  1. **Nothing is preloaded.** The field opens empty. Loading the current value
 *     into an editable input would put a credential on screen with no reveal, no
 *     timer and no audit record — the workflow this console exists to replace.
 *  2. **Success says what it did and nothing more.** No value in a toast.
 *  3. **It says which credential it is.** A provider can have more than one
 *     field, so the dialog names both the provider and the field.
 *
 * Unlike the vault's dialog there is no deployment warning, because AI
 * credentials are read from Secret Manager at runtime: a saved credential is
 * live within the platform's short cache window, with no redeploy.
 */
export function AiCredentialModal({ provider, field, mode, onSubmit, onCancel }) {
    const titleId = useId();
    const descriptionId = useId();
    const inputRef = useRef(null);
    const [value, setValue] = useState('');
    const [validationError, setValidationError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    const [saving, setSaving] = useState(false);

    const verb = mode === 'add' ? 'Add' : 'Replace';

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (saving) return;

        const trimmed = value.trim();
        if (trimmed === '') {
            setValidationError('Enter a value.');
            return;
        }
        setValidationError(null);
        setSubmitError(null);
        setSaving(true);
        try {
            await onSubmit(trimmed);
        } catch (error) {
            setSubmitError(error?.message || 'The credential could not be saved.');
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
                            {verb} {provider.displayName} {field.label.toLowerCase()}
                        </h2>
                        <p id={descriptionId} className="mt-1 text-ds-sm text-ds-content-secondary">
                            {field.description}
                        </p>
                    </div>

                    <Card padding="sm">
                        <h3 className="text-ds-sm font-semibold text-ds-content">Where this is stored</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Google Secret Manager, under a name SafeHaul derives from the provider
                            registry. It is never written to the database, and it takes effect without a
                            deployment.
                        </p>
                        {provider.docsUrl && (
                            <p className="mt-2 text-ds-sm">
                                <a
                                    href={provider.docsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-ds-content underline"
                                >
                                    {provider.displayName} documentation
                                </a>
                            </p>
                        )}
                    </Card>

                    <FormField
                        label={`New ${field.label.toLowerCase()}`}
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

                    {submitError && <FieldMessage tone="error">{submitError}</FieldMessage>}

                    <div className="flex flex-wrap justify-end gap-ds-2">
                        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="primary" loading={saving}>
                            {verb} credential
                        </Button>
                    </div>
                </Stack>
            </form>
        </Modal>
    );
}

export default AiCredentialModal;
