import React, { useEffect, useId, useRef, useState } from 'react';
import { Copy, Icon, X } from '@design-system/icons';
import { Modal } from '@design-system/patterns';
import { Button, Checkbox, FieldMessage, FormField, IconButton, Input, Notice } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { apiKeyErrorMessage } from './apiKeysService';

const MAX_NAME_LENGTH = 60;

/**
 * Making an API key, in two steps: name it and choose what it may read, then
 * copy it. The key is on screen only in the second step and is never stored by
 * this page: closing the dialog is the last anyone sees of it.
 */
export function CreateApiKeyDialog({ onCreate, onClose }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `api-key-title-${rawId}`;
    const descriptionId = `api-key-description-${rawId}`;
    const nameRef = useRef(null);
    const doneRef = useRef(null);

    const [name, setName] = useState('');
    const [documents, setDocuments] = useState(false);
    const [ssn, setSsn] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [made, setMade] = useState(null);
    const [copy, setCopy] = useState('idle');

    // The dialog stays mounted when the key appears, so its first focus is long
    // spent: move focus to Done, inside the dialog, or it falls to the page
    // behind it with the button that had it.
    useEffect(() => {
        if (made) doneRef.current?.focus();
    }, [made]);

    const submit = async (event) => {
        event.preventDefault();
        if (saving) return;
        const cleaned = name.trim();
        if (!cleaned) {
            setError('Give the key a name.');
            nameRef.current?.focus();
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const scopes = [documents && 'documents:read', ssn && 'ssn:read'].filter(Boolean);
            setMade(await onCreate({ name: cleaned, scopes }));
        } catch (failure) {
            setError(apiKeyErrorMessage(failure, 'We could not create the key. Try again.'));
        } finally {
            setSaving(false);
        }
    };

    const copyKey = async () => {
        try {
            await navigator.clipboard.writeText(made.key);
            setCopy('copied');
        } catch {
            setCopy('failed');
        }
    };

    // Once the key is shown, only the explicit Done closes the dialog: a stray
    // click outside it must not throw away a key that cannot be shown again.
    return (
        <Modal
            onClose={made ? undefined : onClose}
            closeOnBackdrop={!made}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={made ? doneRef : nameRef}
            size="md"
            scroll="body"
        >
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                        {made ? 'Copy your new key' : 'Create an API key'}
                    </h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        {made
                            ? `“${made.name}” is ready. Give it to the service that will use it.`
                            : 'The key lets one service read the applications drivers submit to you. It cannot change anything.'}
                    </p>
                </div>
                {!made && (
                    <IconButton label="Close" variant="ghost" onClick={onClose} disabled={saving}>
                        <Icon icon={X} size="xl" />
                    </IconButton>
                )}
            </div>

            {made ? (
                <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                        <Stack gap="md">
                            <Notice tone="warning" size="sm" title="This is the only time the key is shown">
                                Copy it now and keep it somewhere safe. We keep only a fingerprint of it, so
                                a lost key cannot be shown again: turn it off and create a new one.
                            </Notice>
                            <FormField label="Your API key">
                                <Input value={made.key} readOnly spellCheck={false} onFocus={(event) => event.target.select()} />
                            </FormField>
                            <div>
                                <Button variant="secondary" onClick={copyKey}>
                                    <Icon icon={Copy} />
                                    Copy key
                                </Button>
                                <div role="status" className="mt-ds-1">
                                    {copy === 'copied' && <FieldMessage tone="success">Copied.</FieldMessage>}
                                    {copy === 'failed' && (
                                        <FieldMessage tone="error">Copying was blocked. Select the key and copy it yourself.</FieldMessage>
                                    )}
                                </div>
                            </div>
                        </Stack>
                    </div>
                    <div className="flex shrink-0 justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                        <Button ref={doneRef} variant="primary" onClick={onClose}>Done</Button>
                    </div>
                </>
            ) : (
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                        <Stack gap="md">
                            <FormField
                                label="Key name"
                                required
                                description="Name it after the service that will use it, such as your TMS."
                            >
                                <Input
                                    ref={nameRef}
                                    value={name}
                                    maxLength={MAX_NAME_LENGTH}
                                    autoComplete="off"
                                    onChange={(event) => setName(event.target.value)}
                                />
                            </FormField>
                            <fieldset className="min-w-0">
                                <legend className="mb-ds-2 text-ds-sm font-semibold text-ds-content">
                                    Besides the answers, this key may read
                                </legend>
                                <Stack gap="sm">
                                    <Checkbox
                                        label="Uploaded files"
                                        description="The license, medical card and other files the driver uploaded."
                                        checked={documents}
                                        onChange={(event) => setDocuments(event.target.checked)}
                                    />
                                    <Checkbox
                                        label="The full Social Security Number"
                                        description="Without it the number reads ***-**-1234. Also needed for the application PDF and the Social Security card, which show it."
                                        checked={ssn}
                                        onChange={(event) => setSsn(event.target.checked)}
                                    />
                                </Stack>
                            </fieldset>
                            <div role="alert">
                                {error && <Notice tone="danger" size="sm">{error}</Notice>}
                            </div>
                        </Stack>
                    </div>
                    <div className="flex shrink-0 flex-col-reverse justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row">
                        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="primary" loading={saving} disabled={saving}>Create key</Button>
                    </div>
                </form>
            )}
        </Modal>
    );
}

export default CreateApiKeyDialog;
