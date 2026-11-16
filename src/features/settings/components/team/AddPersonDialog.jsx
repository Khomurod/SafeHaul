import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, UserPlus, X } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { Button, ChoiceGroup, FormField, IconButton, Input, Radio } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

const EMPTY = { fullName: '', email: '', password: '', role: 'hr_user' };

/** The two roles a person can have, as cards: the name, then what it lets them see. */
const ROLES = [
    { value: 'hr_user', label: 'Recruiter (Standard)', description: 'Sees their own leads.' },
    { value: 'company_admin', label: 'Company Admin (Full Access)', description: 'Sees everything and changes settings.' },
];

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
            showError(plainErrorMessage(error, 'The person could not be added.'));
        } finally {
            setSaving(false);
        }
    };

    const setField = (field) => (e) => setNewUser({ ...newUser, [field]: e.target.value });

    // A bottom sheet on a phone: the fields scroll between a pinned header and footer.
    return (
        <Modal
            onClose={onClose}
            labelledBy="add-person-title"
            describedBy="add-person-description"
            size="2xl"
            mobile="sheet"
            scroll="body"
        >
            <div className="flex shrink-0 items-start justify-between gap-ds-4 px-ds-4 pt-ds-5 sm:px-ds-6">
                <div className="min-w-0">
                    <h2 id="add-person-title" className="text-ds-heading-md font-bold text-ds-content">Add person</h2>
                    <p id="add-person-description" className="mt-ds-1 text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                        New people sign in with this email and password.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose} className="-mr-ds-2 -mt-ds-1">
                    <Icon icon={X} size="lg" />
                </IconButton>
            </div>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-ds-4 py-ds-5 sm:px-ds-6">
                    <Stack gap="md">
                        <FormField id="team-new-user-name" label="Full Name" required>
                            <Input autoComplete="off" value={newUser.fullName} onChange={setField('fullName')} />
                        </FormField>
                        <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                            <FormField id="team-new-user-email" label="Email" required>
                                <Input type="email" autoComplete="off" value={newUser.email} onChange={setField('email')} />
                            </FormField>
                            <FormField id="team-new-user-password" label="Password" description="At least 6 characters." required>
                                <Input
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={6}
                                    value={newUser.password}
                                    onChange={setField('password')}
                                />
                            </FormField>
                        </div>
                        <ChoiceGroup legend="Role" required appearance="card" orientation="horizontal">
                            {ROLES.map((role) => (
                                <Radio
                                    key={role.value}
                                    name="team-new-user-role"
                                    value={role.value}
                                    label={role.label}
                                    description={role.description}
                                    required
                                    requiredMark={false}
                                    checked={newUser.role === role.value}
                                    onChange={setField('role')}
                                />
                            ))}
                        </ChoiceGroup>
                    </Stack>
                </div>
                {/* The sheet's last row, so it clears the home indicator itself. */}
                <div className="flex shrink-0 justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3 max-sm:pb-[calc(var(--ds-space-3)+env(safe-area-inset-bottom,0px))] sm:px-ds-6 sm:py-ds-4 max-sm:[&>*]:flex-1">
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
