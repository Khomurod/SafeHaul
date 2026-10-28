import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, UserPlus, X } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { Button, FormField, IconButton, Input, Select } from '@/design-system/components';
import { Modal } from '@design-system/patterns';

const EMPTY = { fullName: '', email: '', password: '', role: 'hr_user' };

/**
 * Adds a person to the company with a sign-in of their own, through
 * `createPortalUser` (payload unchanged). An email that already has an account
 * is added to the team instead, and the server says so: that message is shown
 * as it is, because the admin must know the person's own password stays.
 */
export function AddPersonDialog({ companyId, onClose, onAdded }) {
    const { showSuccess, showError } = useToast();
    const [newUser, setNewUser] = useState(EMPTY);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const createFn = httpsCallable(functions, 'createPortalUser');
            const result = await createFn({
                fullName: newUser.fullName,
                email: newUser.email,
                password: newUser.password,
                companyId,
                role: newUser.role,
            });
            const existingAccount = result?.data?.status === 'success' && !result.data.userId && result.data.message;
            showSuccess(existingAccount || `User ${newUser.fullName} created successfully!`);
            setNewUser(EMPTY);
            onAdded?.();
            onClose();
        } catch (error) {
            console.error(error);
            showError('Failed to create user: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal onClose={onClose} labelledBy="add-person-title" size="lg">
            <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <h2 id="add-person-title" className="font-bold text-ds-content">Add person</h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>
            <form onSubmit={handleSubmit} className="space-y-ds-4 p-ds-6">
                <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                    <FormField id="team-new-user-name" label="Full Name" required>
                        <Input
                            autoComplete="off"
                            value={newUser.fullName}
                            onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                        />
                    </FormField>
                    <FormField id="team-new-user-email" label="Email" required>
                        <Input
                            type="email"
                            autoComplete="off"
                            value={newUser.email}
                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        />
                    </FormField>
                    <FormField id="team-new-user-password" label="Password" required>
                        <Input
                            type="password"
                            autoComplete="new-password"
                            value={newUser.password}
                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        />
                    </FormField>
                    <FormField id="team-new-user-role" label="Role" required>
                        <Select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                            <option value="hr_user">Recruiter (Standard)</option>
                            <option value="company_admin">Company Admin (Full Access)</option>
                        </Select>
                    </FormField>
                </div>
                <div className="flex justify-end gap-ds-3 pt-ds-2">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="primary" loading={saving}>
                        {!saving && <Icon icon={UserPlus} />}
                        Add person
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
