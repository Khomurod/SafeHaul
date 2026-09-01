/**
 * The company-creation form of the Create New view: company details, the
 * plan choice, and the optional initial portal user created in the same
 * submit. Extracted verbatim from `CreateView.jsx`, whose header records the
 * frozen contract (form keys, payload shapes, wording) this form is part of;
 * the view keeps the state, the submit handlers and the outcome region.
 */

import React from 'react';
import {
    UserPlus, Save, Shield, Crown, Truck, Briefcase,
} from 'lucide-react';
import {
    Button, Card, Checkbox, ChoiceGroup, FormField, Input, Radio, Select,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

const PLANS = [
    { value: 'free', label: 'Free Plan', description: 'Standard features', icon: Shield },
    { value: 'paid', label: 'Pro Plan', description: 'All premium features', icon: Crown },
];

export function CreateCompanyForm({
    companyForm,
    setCompanyForm,
    withAdmin,
    setWithAdmin,
    companyAdminData,
    setCompanyAdminData,
    loading,
    onSubmit,
}) {
    return (
                        <form onSubmit={onSubmit}>
                            <Stack gap="lg">
                                <Card padding="none" className="overflow-hidden">
                                    <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-4">
                                        <h3 className="flex items-center gap-ds-3 text-ds-heading-sm font-semibold text-ds-content">
                                            <Briefcase className="text-ds-content-link" size={20} aria-hidden="true" />
                                            Company Details
                                        </h3>
                                    </div>
                                    <div className="p-ds-5">
                                        <Stack gap="lg">
                                            <ChoiceGroup legend="Plan" orientation="horizontal">
                                                {PLANS.map((plan) => (
                                                    <Radio
                                                        key={plan.value}
                                                        name="planType"
                                                        value={plan.value}
                                                        label={plan.label}
                                                        description={plan.description}
                                                        checked={companyForm.planType === plan.value}
                                                        onChange={() => setCompanyForm({ ...companyForm, planType: plan.value })}
                                                    />
                                                ))}
                                            </ChoiceGroup>

                                            <FormField id="companyName" label="Company Name" required>
                                                <Input
                                                    name="companyName"
                                                    value={companyForm.companyName}
                                                    onChange={e => setCompanyForm({ ...companyForm, companyName: e.target.value })}
                                                    autoComplete="off"
                                                />
                                            </FormField>

                                            {/* Slug & DOT */}
                                            <Card padding="md" className="bg-ds-surface-subtle">
                                                <h4 className="mb-ds-3 flex items-center gap-ds-2 text-ds-sm font-bold text-ds-content-link">
                                                    <Truck size={16} aria-hidden="true" /> Carrier Information
                                                </h4>
                                                <ResponsiveGrid minItemWidth="200px">
                                                    <FormField id="appSlug" label="URL Slug" required>
                                                        <Input
                                                            name="appSlug"
                                                            value={companyForm.appSlug}
                                                            onChange={e => setCompanyForm({ ...companyForm, appSlug: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                    <FormField id="mcNumber" label="MC Number">
                                                        <Input
                                                            name="mcNumber"
                                                            value={companyForm.mcNumber}
                                                            onChange={e => setCompanyForm({ ...companyForm, mcNumber: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                    <FormField id="dotNumber" label="DOT Number">
                                                        <Input
                                                            name="dotNumber"
                                                            value={companyForm.dotNumber}
                                                            onChange={e => setCompanyForm({ ...companyForm, dotNumber: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                </ResponsiveGrid>
                                            </Card>

                                            <ResponsiveGrid minItemWidth="240px">
                                                <FormField id="email" label="Contact Email" required>
                                                    <Input
                                                        name="email"
                                                        type="email"
                                                        value={companyForm.email}
                                                        onChange={e => setCompanyForm({ ...companyForm, email: e.target.value })}
                                                        autoComplete="off"
                                                    />
                                                </FormField>
                                                <FormField id="phone" label="Phone">
                                                    <Input
                                                        name="phone"
                                                        type="tel"
                                                        value={companyForm.phone}
                                                        onChange={e => setCompanyForm({ ...companyForm, phone: e.target.value })}
                                                        autoComplete="off"
                                                    />
                                                </FormField>
                                            </ResponsiveGrid>

                                            <div className="border-t border-ds-border-subtle pt-ds-4">
                                                <Stack gap="md">
                                                    <FormField id="address" label="Street Address">
                                                        <Input
                                                            name="address"
                                                            value={companyForm.address}
                                                            onChange={e => setCompanyForm({ ...companyForm, address: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                    <ResponsiveGrid minItemWidth="180px">
                                                        <FormField id="city" label="City">
                                                            <Input
                                                                name="city"
                                                                value={companyForm.city}
                                                                onChange={e => setCompanyForm({ ...companyForm, city: e.target.value })}
                                                                autoComplete="off"
                                                            />
                                                        </FormField>
                                                        <FormField id="state" label="State">
                                                            <Input
                                                                name="state"
                                                                value={companyForm.state}
                                                                onChange={e => setCompanyForm({ ...companyForm, state: e.target.value })}
                                                                autoComplete="off"
                                                            />
                                                        </FormField>
                                                        <FormField id="zip" label="Zip">
                                                            <Input
                                                                name="zip"
                                                                value={companyForm.zip}
                                                                onChange={e => setCompanyForm({ ...companyForm, zip: e.target.value })}
                                                                autoComplete="off"
                                                            />
                                                        </FormField>
                                                    </ResponsiveGrid>
                                                </Stack>
                                            </div>
                                        </Stack>
                                    </div>
                                </Card>

                                <Card padding="none" className="overflow-hidden">
                                    <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-4">
                                        <h3 className="flex items-center gap-ds-3 text-ds-heading-sm font-semibold text-ds-content">
                                            <UserPlus className="text-ds-status-accent-fg" size={20} aria-hidden="true" />
                                            Initial User Setup
                                        </h3>
                                    </div>
                                    <div className="p-ds-5">
                                        <Stack gap="lg">
                                            <Checkbox
                                                id="withAdmin"
                                                label="Create a portal user for this company now"
                                                checked={withAdmin}
                                                onChange={(e) => setWithAdmin(e.target.checked)}
                                            />

                                            {withAdmin && (
                                                <ResponsiveGrid minItemWidth="240px">
                                                    <FormField id="adminName" label="Full Name" required={withAdmin}>
                                                        <Input
                                                            name="adminName"
                                                            value={companyAdminData.name}
                                                            onChange={e => setCompanyAdminData({ ...companyAdminData, name: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                    <FormField id="adminEmail" label="Login Email" required={withAdmin}>
                                                        <Input
                                                            name="adminEmail"
                                                            type="email"
                                                            value={companyAdminData.email}
                                                            onChange={e => setCompanyAdminData({ ...companyAdminData, email: e.target.value })}
                                                            autoComplete="off"
                                                        />
                                                    </FormField>
                                                    <FormField id="adminRole" label="Role">
                                                        <Select
                                                            name="adminRole"
                                                            value={companyAdminData.role}
                                                            onChange={e => setCompanyAdminData({ ...companyAdminData, role: e.target.value })}
                                                        >
                                                            <option value="company_admin">Company Admin</option>
                                                            <option value="hr_user">HR User</option>
                                                        </Select>
                                                    </FormField>
                                                    <FormField
                                                        id="adminPass"
                                                        label="Password"
                                                        description="At least 6 characters."
                                                        required={withAdmin}
                                                    >
                                                        <Input
                                                            name="adminPass"
                                                            type="password"
                                                            autoComplete="new-password"
                                                            minLength={6}
                                                            value={companyAdminData.password}
                                                            onChange={e => setCompanyAdminData({ ...companyAdminData, password: e.target.value })}
                                                        />
                                                    </FormField>
                                                </ResponsiveGrid>
                                            )}
                                        </Stack>
                                    </div>
                                </Card>

                                <div className="flex justify-end">
                                    <Button type="submit" variant="primary" disabled={loading} loading={loading}>
                                        {!loading && <Save size={20} aria-hidden="true" />} Create Company
                                    </Button>
                                </div>
                            </Stack>
                        </form>
    );
}
