import React, { useId, useState } from 'react';
import { updateUser } from '@features/auth/services/userService';
import { auth, functions } from '@lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Icon, KeyRound, Trash2 } from '@design-system/icons';
import { Button, Card, FieldMessage, FormField, Input } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * User profile editor inside the Super Admin Edit User dialog.
 *
 * Built on the design system's components and `--ds-*` tokens.
 *
 * Presentation only. Frozen and unchanged: the
 * `updateUser(userId, { name, email }, companyId)` call and argument order, the
 * `sendPasswordResetEmail(auth, userEmail)` call, the
 * `deletePortalUser({ userId, companyId })` payload, the `onSave` callback
 * points (after a successful save and after a successful delete), the 2-second
 * save-message reset, the `!userEmail` early return on reset, and every
 * user-facing string including the `Error: ` prefix.
 *
 * Rules this form keeps:
 *  1. **Password reset and user delete ask through the shared accessible
 *     dialog**, never a blocking `window.confirm`; the wording is verbatim.
 *  2. **Reset and delete outcomes are announced in-page messages**, never a
 *     blocking `alert()`; the wording is verbatim.
 *  3. **The save message is a `FieldMessage` in a live region**, so a
 *     screen-reader user hears whether a save succeeded or failed; the tone is
 *     secondary to the text.
 *  4. `FormField`/`Input`/`Button` and the primitives' own loading state — no raw
 *     inputs, raw buttons, action tints or hand-built spinner.
 *  5. **The confirmation is the approved `ConfirmDialog`**, never a local
 *     component of the same name: on "Delete this user?" initial focus lands on
 *     **Cancel** rather than on the destructive action, and `onConfirm` is
 *     guarded by a synchronous ref, so two activations dispatched inside one
 *     React render cannot both fire the callable.
 *
 *     The pattern's in-flight guards (Escape and backdrop dismissal disabled
 *     while `loading`) are deliberately not used here: both handlers close the
 *     dialog before starting, and the progress is shown on the page's own button.
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
                            {!resetLoading && <Icon icon={KeyRound} />}
                            Send Password Reset
                        </Button>

                        <Button
                            variant="danger"
                            className="flex-1"
                            onClick={() => { setActionMessage(null); setPendingAction('delete'); }}
                            disabled={deleteLoading}
                            loading={deleteLoading}
                        >
                            {!deleteLoading && <Icon icon={Trash2} />}
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
                    /*
                     * `info`, not the `warning` the local copy used: sending a
                     * reset email is advisory, and the approved tone map pairs
                     * `warning` with a danger-styled confirm button. The local
                     * dialog had overridden that pairing by hand — an amber alert
                     * medallion above a blue primary button — which is exactly the
                     * inconsistency a tone map exists to prevent.
                     */
                    tone="info"
                    title="Send a password reset email?"
                    description={`Send password reset email to ${userEmail}?`}
                    confirmLabel="Send reset email"
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
                    onCancel={() => setPendingAction(null)}
                    onConfirm={confirmDeleteUser}
                />
            )}
        </Card>
    );
}
