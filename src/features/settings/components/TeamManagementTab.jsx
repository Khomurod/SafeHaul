import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Plus } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { Button, FormField, FormSection, Input, Select } from '@/design-system/components';

export function TeamManagementTab({ currentCompanyProfile, isCompanyAdmin, onShowManageTeam }) {
    const { showSuccess, showError } = useToast();
    const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'hr_user' });
    const [addUserLoading, setAddUserLoading] = useState(false);

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setAddUserLoading(true);
        try {
            const createFn = httpsCallable(functions, 'createPortalUser');
            await createFn({
                fullName: newUser.fullName,
                email: newUser.email,
                password: newUser.password,
                companyId: currentCompanyProfile.id,
                role: newUser.role
            });

            showSuccess(`User ${newUser.fullName} created successfully!`);
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
        <div className="max-w-3xl animate-in fade-in space-y-ds-8" data-testid="team-management">
            <header className="border-b border-ds-border-subtle pb-ds-4">
                <h2 className="text-ds-heading-lg font-bold text-ds-content">Team Management</h2>
                <p className="mt-ds-1 text-ds-sm text-ds-content-muted">
                    Add new recruiters or admins to your company dashboard.
                </p>
            </header>

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
                        <Button type="submit" variant="primary" size="lg" loading={addUserLoading}>
                            {!addUserLoading && <Plus size={18} aria-hidden="true" />}
                            Create User
                        </Button>
                    </div>
                </form>
            </FormSection>

            <div className="text-center">
                <button
                    type="button"
                    onClick={onShowManageTeam}
                    className="rounded-ds-sm text-ds-sm font-semibold text-ds-content-link hover:underline focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                    View All Team Members &amp; Goals
                </button>
            </div>
        </div>
    );
}
