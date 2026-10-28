import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, Plus } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { Button, FormField, FormSection, Input, Select } from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';

export function TeamManagementTab({ currentCompanyProfile, isCompanyAdmin, onShowManageTeam }) {
    const { showSuccess, showError } = useToast();
    const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'hr_user' });
    const [addUserLoading, setAddUserLoading] = useState(false);

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setAddUserLoading(true);
        try {
            const createFn = httpsCallable(functions, 'createPortalUser');
            const result = await createFn({
                fullName: newUser.fullName,
                email: newUser.email,
                password: newUser.password,
                companyId: currentCompanyProfile.id,
                role: newUser.role
            });

            // An email that already has an account is added, not created: the server
            // says so, and that its own password stays, which the admin must know.
            const existingAccount = result?.data?.status === 'success' && !result.data.userId && result.data.message;
            showSuccess(existingAccount || `User ${newUser.fullName} created successfully!`);
            setNewUser({ fullName: '', email: '', password: '', role: 'hr_user' });
        } catch (error) {
            console.error(error);
            showError("Failed to create user: " + error.message);
        } finally {
            setAddUserLoading(false);
        }
    };

    if (!isCompanyAdmin) {
        return (
            <p className="p-10 text-center text-ds-content-muted" data-testid="team-access-denied">
                Access Denied. Only Admins can manage the team.
            </p>
        );
    }

    return (
        <div className="space-y-ds-6" data-testid="team-management">
            <PageHeader title="Team" description="Add new recruiters or admins to your company dashboard." />

            <FormSection title="Add New User">
                <form onSubmit={handleCreateUser} className="space-y-ds-4">
                    <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                        <FormField id="team-new-user-name" label="Full Name" required>
                            <Input
                                autoComplete="off"
                                value={newUser.fullName}
                                onChange={e => setNewUser({ ...newUser, fullName: e.target.value })}
                            />
                        </FormField>
                        <FormField id="team-new-user-email" label="Email" required>
                            <Input
                                type="email"
                                autoComplete="off"
                                value={newUser.email}
                                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                            />
                        </FormField>
                    </div>
                    <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                        <FormField id="team-new-user-password" label="Password" required>
                            <Input
                                type="password"
                                autoComplete="new-password"
                                value={newUser.password}
                                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                            />
                        </FormField>
                        <FormField id="team-new-user-role" label="Role" required>
                            <Select
                                value={newUser.role}
                                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                            >
                                <option value="hr_user">Recruiter (Standard)</option>
                                <option value="company_admin">Company Admin (Full Access)</option>
                            </Select>
                        </FormField>
                    </div>
                    <div className="flex justify-end pt-ds-2">
                        <Button type="submit" variant="primary" loading={addUserLoading}>
                            {!addUserLoading && <Icon icon={Plus} size="lg" />}
                            Create User
                        </Button>
                    </div>
                </form>
            </FormSection>

            <div className="text-center">
                <Button variant="link" size="sm" onClick={onShowManageTeam}>
                    View All Team Members &amp; Goals
                </Button>
            </div>
        </div>
    );
}
