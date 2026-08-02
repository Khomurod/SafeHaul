import React, { useId, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, FieldMessage, FormField, Input } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';
import { reauthenticateWithPassword } from '../../services/environmentVault';

/**
 * Re-authentication prompt.
 *
 * The backend requires the caller to have authenticated within the last fifteen
 * minutes before it will reveal or change anything. A silent token refresh does
 * not satisfy that — only a real credential check moves `auth_time` — so this
 * asks for the password and then retries the action the operator was doing.
 *
 * The password is held in component state for the duration of the submit and is
 * never logged, stored or sent anywhere except Firebase Authentication.
 */
export function ReauthenticateModal({ onSuccess, onCancel }) {
    const titleId = useId();
    const descriptionId = useId();
    const inputRef = useRef(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (submitting) return;
        if (!password) {
            setError('Enter your password to continue.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await reauthenticateWithPassword(password);
            setPassword('');
            onSuccess();
        } catch {
            // Firebase distinguishes wrong-password from too-many-requests, but
            // both are answered the same way here so the prompt cannot be used to
            // probe an account.
            setError('That password was not accepted. Try again.');
            setSubmitting(false);
        }
    };

    return (
        <Modal
            onClose={submitting ? undefined : onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={inputRef}
            closeOnBackdrop={false}
            closeOnEscape={!submitting}
            className="bg-ds-surface rounded-ds-xl shadow-ds-lg w-full max-w-md overflow-hidden"
        >
            <form onSubmit={handleSubmit}>
                <Stack gap="md" className="p-ds-6">
                    <div className="flex items-start gap-ds-3">
                        <ShieldCheck size={20} aria-hidden="true" className="mt-1 shrink-0 text-ds-content-link" />
                        <div>
                            <h2 id={titleId} className="text-ds-heading-md font-bold text-ds-content">
                                Confirm it is you
                            </h2>
                            <p id={descriptionId} className="mt-1 text-ds-sm text-ds-content-secondary">
                                Reading or changing a stored credential needs a recent sign-in. Enter your
                                password to continue.
                            </p>
                        </div>
                    </div>

                    <FormField label="Password" required>
                        <Input
                            ref={inputRef}
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </FormField>

                    {error && <FieldMessage tone="error">{error}</FieldMessage>}

                    <div className="flex flex-wrap justify-end gap-ds-2">
                        <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
                        <Button type="submit" variant="primary" loading={submitting}>Continue</Button>
                    </div>
                </Stack>
            </form>
        </Modal>
    );
}
