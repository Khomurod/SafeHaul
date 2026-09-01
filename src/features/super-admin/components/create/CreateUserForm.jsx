/**
 * The standalone-user form of the Create New view. Extracted verbatim from
 * `CreateView.jsx`, whose header records the frozen contract this form is
 * part of; the view keeps the state, the submit handler and the company
 * dropdown's data.
 */

import React from 'react';
import {
    UserPlus, User,
} from 'lucide-react';
import {
    Button, Card, FormField, Input, Select,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

export function CreateUserForm({
    userForm,
    setUserForm,
    companies,
    loading,
    onSubmit,
}) {
    return (
                        <form onSubmit={onSubmit}>
                            <Stack gap="lg">
                                <Card padding="none" className="overflow-hidden">
                                    <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-4">
                                        <h3 className="flex items-center gap-ds-3 text-ds-heading-sm font-semibold text-ds-content">
                                            <User className="text-ds-status-accent-fg" size={20} aria-hidden="true" />
                                            Create Standalone User
                                        </h3>
                                    </div>
                                    <div className="p-ds-5">
                                        <Stack gap="lg">
                                            <ResponsiveGrid minItemWidth="240px">
                                                <FormField id="newUserName" label="Full Name" required>
                                                    <Input
                                                        name="newUserName"
                                                        value={userForm.fullName}
                                                        onChange={e => setUserForm({ ...userForm, fullName: e.target.value })}
                                                        autoComplete="off"
                                                    />
                                                </FormField>
                                                <FormField id="newUserEmail" label="Email Address" required>
                                                    <Input
                                                        name="newUserEmail"
                                                        type="email"
                                                        value={userForm.email}
                                                        onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                                                        autoComplete="off"
                                                    />
                                                </FormField>
                                                <FormField id="newUserCompany" label="Assign to Company" required>
                                                    <Select
                                                        name="newUserCompany"
                                                        value={userForm.companyId}
                                                        onChange={e => setUserForm({ ...userForm, companyId: e.target.value })}
                                                    >
                                                        <option value="">-- Select Company --</option>
                                                        {companies.map(c => (
                                                            <option key={c.id} value={c.id}>{c.name}</option>
                                                        ))}
                                                    </Select>
                                                </FormField>
                                                <FormField id="newUserRole" label="Role">
                                                    <Select
                                                        name="newUserRole"
                                                        value={userForm.role}
                                                        onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                                                    >
                                                        <option value="hr_user">HR User</option>
                                                        <option value="company_admin">Company Admin</option>
                                                        <option value="super_admin">Super Admin (Careful!)</option>
                                                    </Select>
                                                </FormField>
                                            </ResponsiveGrid>

                                            <FormField
                                                id="newUserPass"
                                                label="Password"
                                                description="At least 6 characters."
                                                required
                                            >
                                                <Input
                                                    name="newUserPass"
                                                    type="password"
                                                    autoComplete="new-password"
                                                    minLength={6}
                                                    value={userForm.password}
                                                    onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                                                />
                                            </FormField>
                                        </Stack>
                                    </div>
                                </Card>

                                <div className="flex justify-end">
                                    <Button type="submit" variant="primary" disabled={loading} loading={loading}>
                                        {!loading && <UserPlus size={20} aria-hidden="true" />} Create User
                                    </Button>
                                </div>
                            </Stack>
                        </form>
    );
}
