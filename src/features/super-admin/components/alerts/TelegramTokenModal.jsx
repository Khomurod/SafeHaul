import React, { useId, useRef, useState } from 'react';
import { Button, FieldMessage, FormField, Input, Link } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';

/**
 * Add / Replace dialog for the Telegram bot token.
 *
 * The AI credential dialog's conventions: the field opens empty and the value
 * is never loaded into it, and success says only what happened. The token is
 * checked with Telegram before it is stored, so a refusal arrives here as the
 * server's sentence.
 */
export function TelegramTokenModal({ mode, onSubmit, onCancel }) {
    const titleId = useId();
    const descriptionId = useId();
    const inputRef = useRef(null);
    const [value, setValue] = useState('');
    const [validationError, setValidationError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    const [saving, setSaving] = useState(false);

    const verb = mode === 'replace' ? 'Replace' : 'Add';

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (saving) return;
        const trimmed = value.trim();
        if (!trimmed) {
            setValidationError('Enter the token.');
            return;
        }
        setValidationError(null);
        setSubmitError(null);
        setSaving(true);
        try {
            await onSubmit(trimmed);
        } catch (error) {
            setSubmitError(error?.message || 'The token could not be saved.');
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
                            {verb} the Telegram bot token
                        </h2>
                        <p id={descriptionId} className="mt-1 text-ds-sm text-ds-content-secondary">
                            In Telegram, open @BotFather, send /newbot and follow its two questions. It
                            answers with the token. SafeHaul checks it with Telegram, then keeps it in Google
                            Secret Manager, never in the database.
                        </p>
                        <p className="mt-2 text-ds-sm">
                            <Link href="https://core.telegram.org/bots/tutorial#obtain-your-bot-token" external tone="quiet">
                                How to get a bot token
                            </Link>
                        </p>
                    </div>

                    <FormField
                        label="Bot token"
                        description={mode === 'replace'
                            ? 'The current token is never loaded into this field. Paste the new one in full.'
                            : 'Paste the whole token, as @BotFather sent it.'}
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
                        <Button type="submit" variant="primary" loading={saving}>{verb} token</Button>
                    </div>
                </Stack>
            </form>
        </Modal>
    );
}

export default TelegramTokenModal;
