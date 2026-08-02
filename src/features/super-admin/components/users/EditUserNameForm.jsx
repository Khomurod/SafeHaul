import React, { useId, useState } from 'react';
import { updateUser } from '@features/auth/services/userService';
import { auth, functions } from '@lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { KeyRound, Trash2, AlertTriangle } from 'lucide-react';
import { Button, Card, FieldMessage, FormField, Input, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * User profile editor inside the Super Admin Edit User dialog.
 *
 * Migrated to the design system 2026-07-28. This file was missed by the Super
 * Admin dialog pass: `EditUserModal`'s own shell was migrated, but the two
 * bodies it renders — this form and `UserMembershipsManager` — were still fully
 * legacy.
 *
 * Presentation only. Frozen and unchanged: the
 * `updateUser(userId, { name, email }, companyId)` call and argument order, the
 * `sendPasswordResetEmail(auth, userEmail)` call, the
 * `deletePortalUser({ userId, companyId })` payload, the `onSave` callback
 * points (after a successful save and after a successful delete), the 2-second
 * save-message reset, the `!userEmail` early return on reset, and every
 * user-facing string including the `Error: ` prefix.
 *
 * Defects fixed:
 *  1. **Two blocking `window.confirm` guards** (password reset, delete user) →
 *     shared accessible dialogs, wording preserved verbatim.
 *  2. **Four blocking `alert()` calls** carried the reset and delete outcomes →
 *     announced in-page messages, wording preserved verbatim. A destructive
 *     delete previously reported success only through a modal alert.
 *  3. **The save message was colour-only** — red or green text with no role, so
 *     a screen-reader user got no confirmation that a save succeeded or failed.
 *     It is now a `FieldMessage` in a live region, and the tone is secondary to
 *     the text.
 *  4. Raw inputs with `focus:ring-blue-500`, raw buttons, `bg-orange-50` /
 *     `bg-red-50` action tints and a hand-built `Loader2` spinner replaced by
 *     `FormField`/`Input`/`Button` and the primitives' own loading state.
 */
export function EditUserNameForm({ userId, initialName, email, companyId, onSave }) {
    const [userName, setUserName] = useState(initialName || '');
    const [userEmail, setUserEmail] = useState(email || '');

    const [saveLoading, setSaveLoading] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    /** Replaces the four `alert()`s: `{ tone, message }`. */
    const [actionMessage, setActionMessage] = useState(null);
    // Replace the two blocking `window.confirm` guards.
    const [pendingAction, setPendingAction] = useState(null); // 'reset' | 'delete'

    const nameId = useId();
    const emailId = useId();

    const handleSave = async () => {
      setSaveLoading(true);
      setSaveMessage('Saving...');
      try {
        // Send both name and email to the update service
        await updateUser(userId, { name: userName, email: userEmail }, companyId);
        setSaveMessage('Profile saved!');
        if (onSave) onSave();

        setTimeout(() => setSaveMessage(''), 2000);
      } catch (error) {
        console.error("Error updating user:", error);
        setSaveMessage('Error: ' + (error.message || 'Unknown error'));
      } finally {
        setSaveLoading(false);
      }
    };

    const confirmResetPassword = async () => {
        setPendingAction(null);
        setActionMessage(null);
        // Preserved guard: reset was always a no-op without an address.
        if (!userEmail) return;
        setResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, userEmail);
            setActionMessage({ tone: 'success', message: `Password reset email sent to ${userEmail}` });
        } catch (error) {
            console.error("Reset Password Error:", error);
            setActionMessage({ tone: 'error', message: "Failed to send reset email: " + error.message });
        } finally {
            setResetLoading(false);
        }
    };

    const confirmDeleteUser = async () => {
        setPendingAction(null);
        setActionMessage(null);
        setDeleteLoading(true);
        try {
            const deleteFn = httpsCallable(functions, 'deletePortalUser');
            await deleteFn({ userId, companyId });
            setActionMessage({ tone: 'success', message: "User deleted/removed successfully." });
            if (onSave) onSave(); // Triggers refresh in parent
        } catch (error) {
            console.error("Delete User Error:", error);
            setActionMessage({ tone: 'error', message: "Failed to delete user: " + error.message });
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <Card padding="md">
            <Stack gap="lg">

                {/* Header */}
                <div>
                    <h3 className="text-ds-heading-sm font-semibold text-ds-content">User Profile</h3>
                    <p className="text-ds-sm text-ds-content-secondary">Update basic information.</p>
                </div>

                {/* Form Fields */}
                <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
                    <Stack gap="md">
                        <FormField id={nameId} label="Full Name" required>
                            <Input
                                type="text"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                autoComplete="off"
                            />
                        </FormField>
                        <FormField id={emailId} label="Email Address" required>
                            <Input
                                type="email"
                                value={userEmail}
                                onChange={(e) => setUserEmail(e.target.value)}
                                autoComplete="off"
                            />
                        </FormField>

                        {/* Save Button */}
                        <div className="flex flex-wrap items-center gap-ds-4 pt-ds-2">
                            <Button type="submit" variant="primary" disabled={saveLoading} loading={saveLoading}>
                                {saveLoading ? 'Saving...' : 'Save Changes'}
                            </Button>
                            {/* Always mounted so the live region can announce into it. */}
                            <div role="status" className="min-w-0">
                                {saveMessage && (
                                    <FieldMessage tone={saveMessage.startsWith('Error') ? 'error' : 'success'}>
                                        {saveMessage}
                                    </FieldMessage>
                                )}
                            </div>
                        </div>
                    </Stack>
                </form>

                {/* Account Actions Section */}
                <div className="border-t border-ds-border-subtle pt-ds-6">
                    <h4 className="mb-ds-4 text-ds-sm font-bold text-ds-content">Account Actions</h4>
                    <div className="flex flex-col gap-ds-3 sm:flex-row">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => { setActionMessage(null); setPendingAction('reset'); }}
                            disabled={resetLoading}
                            loading={resetLoading}
                        >
                            {!resetLoading && <KeyRound size={16} aria-hidden="true" />}
                            Send Password Reset
                        </Button>

                        <Button
                            variant="danger"
                            className="flex-1"
                            onClick={() => { setActionMessage(null); setPendingAction('delete'); }}
                            disabled={deleteLoading}
                            loading={deleteLoading}
                        >
                            {!deleteLoading && <Trash2 size={16} aria-hidden="true" />}
                            Delete User
                        </Button>
                    </div>

                    {/* Outcomes that were previously four blocking `alert()`s. */}
                    <div role="status" className="mt-ds-3">
                        {actionMessage?.tone === 'success' && (
                            <FieldMessage tone="success">{actionMessage.message}</FieldMessage>
                        )}
                    </div>
                    <div role="alert">
                        {actionMessage?.tone === 'error' && (
                            <FieldMessage tone="error">{actionMessage.message}</FieldMessage>
                        )}
                    </div>
                </div>
            </Stack>

            {pendingAction === 'reset' && (
                <ConfirmDialog
                    tone="warning"
                    title="Send a password reset email?"
                    description={`Send password reset email to ${userEmail}?`}
                    confirmLabel="Send reset email"
                    confirmVariant="primary"
                    onCancel={() => setPendingAction(null)}
                    onConfirm={confirmResetPassword}
                />
            )}

            {pendingAction === 'delete' && (
                <ConfirmDialog
                    tone="danger"
                    title="Delete this user?"
                    description="Are you sure you want to delete this user? This action cannot be undone."
                    confirmLabel="Delete user"
                    confirmVariant="danger"
                    onCancel={() => setPendingAction(null)}
                    onConfirm={confirmDeleteUser}
                />
            )}
        </Card>
    );
}

/**
 * Replaces the two blocking `window.confirm` guards. Each description keeps the
 * original confirm wording verbatim.
 */
function ConfirmDialog({ tone, title, description, confirmLabel, confirmVariant, onCancel, onConfirm }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            closeOnBackdrop={false}
            className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="p-ds-5 text-center">
                <StatusMedallion tone={tone} className="mx-auto mb-ds-3"><AlertTriangle /></StatusMedallion>
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">{title}</h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">{description}</p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
            </div>
        </Modal>
    );
}
