import React, { useEffect, useId, useRef, useState } from 'react';
import { createNewCompany, loadCompanies } from '@features/companies';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import {
    UserPlus, Save, Shield, Crown, Truck, User, X, Briefcase, CheckCircle, AlertCircle,
} from 'lucide-react';
import {
    Button, Card, Checkbox, ChoiceGroup, FormField, Input, Radio, Select,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import { SUPER_ADMIN_VIEWS } from '../config/views';

/**
 * Create New — Super Admin entity creation.
 *
 * Two creation flows exist and both are covered here: **company** (optionally
 * with an initial portal user in the same submit) and **standalone user**. There
 * is no third entity type; `SUPER_ADMIN_VIEWS.CREATE` routes only to this view.
 *
 * Migrated to the design system 2026-07-28. Presentation only. Frozen and
 * unchanged: the `activeTab` values `'company'` / `'user'` with `'company'`
 * initial; every form key and initial value (including `planType: 'free'`,
 * `companyAdminData.role: 'company_admin'`, `userForm.role: 'hr_user'`);
 * `withAdmin` defaulting to `true`; the slug auto-generation rule
 * (`toLowerCase()` → non-alphanumeric runs to `-` → trim leading/trailing `-`,
 * applied only while `appSlug` is empty); the `createNewCompany({ ...companyForm,
 * isActive: true, createdAt: new Date() })` payload; the
 * `createPortalUser({ fullName, email, password, companyId, role })` payload for
 * both flows; the `result.data?.error` throw; the reset shapes; the
 * `onDataUpdate` callback ordering in each flow; the `loadCompanies()` company
 * dropdown mapping; the three role option sets; and every user-facing string.
 *
 * Defects fixed here:
 *  1. **Four blocking `alert()` calls** carried every outcome — success and
 *     failure, for both flows. They are now announced in-page regions
 *     (`role="status"` / `role="alert"`) with the wording preserved verbatim,
 *     including the `Error: ` and `Failed: ` prefixes.
 *  2. **The plan selector was two `<div onClick>` cards** — no role, no
 *     `tabIndex`, no key handling, no accessible name, and the only indication of
 *     the current choice was a blue/yellow border. It is now a native
 *     `ChoiceGroup` of `Radio`s, which the browser makes keyboard-operable and
 *     announces correctly. The `'free'` / `'paid'` values are unchanged.
 *  3. **The tab strip was colour-only** — `border-b-4` plus a blue/purple text
 *     colour, with no `role="tab"`, no `aria-selected` and no arrow-key
 *     movement. It is now a real WAI-ARIA tab interface with roving focus,
 *     matching `AnalyticsView`.
 *  4. **Three `<select>`s had no accessible name at all** — "Role" (×2) and
 *     "Assign to Company" were bare `<label>` elements with no `htmlFor`, and no
 *     `<select>` carried an `id`. `FormField` now owns the association.
 *  5. **Both password fields were `type="text"`**, so a new portal user's
 *     password was rendered in clear text on screen with no autofill hint. They
 *     are now `type="password"` with `autoComplete="new-password"`, matching the
 *     already-migrated Add-User form in Company Settings that posts to the same
 *     `createPortalUser` callable. The submitted payload is byte-for-byte
 *     identical.
 *  6. **Duplicate submission was possible.** `loading` is React state, so two
 *     activations dispatched inside one render could both pass it. A ref guard
 *     now closes that window on both forms.
 *  7. Local re-implementations of `Card` and `FormField` (with their own
 *     `focus:ring-blue-500`, `rounded-lg`, `shadow-lg` and grey palette) are
 *     replaced by the approved primitives, and the section headings are `<h3>`
 *     under the view's single `<h2>` — previously the view title and every card
 *     title were all `<h2>`.
 *
 * Deliberately unchanged: validation stays native constraint validation
 * (`required`, `minLength={6}`). It already blocks submission, announces the
 * problem and focuses the first invalid control, and there is no existing
 * application-level validation copy to preserve — inventing new validation
 * wording is a product decision, not a presentation one.
 */

const TABS = [
    { id: 'company', label: 'New Company', icon: Briefcase },
    { id: 'user', label: 'New User Only', icon: UserPlus },
];

const PLANS = [
    { value: 'free', label: 'Free Plan', description: 'Standard features', icon: Shield },
    { value: 'paid', label: 'Pro Plan', description: 'All premium features', icon: Crown },
];

const EMPTY_COMPANY_FORM = {
    companyName: '', appSlug: '', mcNumber: '', dotNumber: '',
    email: '', phone: '', address: '', city: '', state: '', zip: '',
    planType: 'free'
};
const EMPTY_ADMIN_DATA = { name: '', email: '', password: '', role: 'company_admin' };
const EMPTY_USER_FORM = { fullName: '', email: '', password: '', companyId: '', role: 'hr_user' };

// --- MAIN COMPONENT ---
export function CreateView({ onDataUpdate, setActiveView }) {
    const [activeTab, setActiveTab] = useState('company'); // 'company' or 'user'
    const [loading, setLoading] = useState(false);
    const [companies, setCompanies] = useState([]);
    /** `{ tone: 'success' | 'error', message: string }` — replaces four `alert()`s. */
    const [outcome, setOutcome] = useState(null);

    // --- STATE: CREATE COMPANY ---
    const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY_FORM);
    const [withAdmin, setWithAdmin] = useState(true);
    const [companyAdminData, setCompanyAdminData] = useState(EMPTY_ADMIN_DATA);

    // --- STATE: CREATE USER ---
    const [userForm, setUserForm] = useState(EMPTY_USER_FORM);

    const tabsId = useId();
    const tabRefs = useRef({});
    /**
     * Ref, not state: `loading` only takes effect on the next render, so two
     * activations dispatched before React re-renders would both get past it.
     */
    const submittingRef = useRef(false);

    // Load companies for the "New User" dropdown
    useEffect(() => {
        loadCompanies().then(snap => {
            const list = snap.docs.map(d => ({ id: d.id, name: d.data().companyName }));
            setCompanies(list);
        }).catch(console.error);
    }, []);

    // Auto-generate slug
    useEffect(() => {
        if (companyForm.companyName && !companyForm.appSlug) {
            const slug = companyForm.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            setCompanyForm(prev => ({ ...prev, appSlug: slug }));
        }
    }, [companyForm.companyName]);

    // Roving focus: a tablist must respond to Arrow/Home/End, not just clicks.
    const onTabKeyDown = (event) => {
        const index = TABS.findIndex((t) => t.id === activeTab);
        let next = null;
        if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
        if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
        if (event.key === 'Home') next = TABS[0];
        if (event.key === 'End') next = TABS[TABS.length - 1];
        if (!next) return;
        event.preventDefault();
        setActiveTab(next.id);
        tabRefs.current[next.id]?.focus();
    };

    // --- HANDLERS ---

    const handleCompanySubmit = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        submittingRef.current = true;
        setLoading(true);
        setOutcome(null);
        try {
            // 1. Create Company Doc
            const newCompanyRef = await createNewCompany({
                ...companyForm,
                isActive: true,
                createdAt: new Date()
            });

            // 2. Create Admin User (If selected)
            if (withAdmin) {
                const createFn = httpsCallable(functions, 'createPortalUser');
                await createFn({
                    fullName: companyAdminData.name,
                    email: companyAdminData.email,
                    password: companyAdminData.password,
                    companyId: newCompanyRef.id,
                    role: companyAdminData.role
                });
            }

            setOutcome({ tone: 'success', message: 'Company (and Admin) created successfully!' });
            if (onDataUpdate) onDataUpdate();
            setCompanyForm(EMPTY_COMPANY_FORM);
            setCompanyAdminData(EMPTY_ADMIN_DATA);

        } catch (error) {
            console.error("Creation Error:", error);
            setOutcome({ tone: 'error', message: `Error: ${error.message}` });
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const handleUserSubmit = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        submittingRef.current = true;
        setLoading(true);
        setOutcome(null);
        try {
            const createFn = httpsCallable(functions, 'createPortalUser');
            const result = await createFn({
                fullName: userForm.fullName,
                email: userForm.email,
                password: userForm.password,
                companyId: userForm.companyId,
                role: userForm.role
            });

            if (result.data?.error) throw new Error(result.data.error);

            setOutcome({ tone: 'success', message: 'User created successfully!' });
            setUserForm(EMPTY_USER_FORM);
            if (onDataUpdate) onDataUpdate();

        } catch (error) {
            console.error("User Creation Error:", error);
            setOutcome({ tone: 'error', message: `Failed: ${error.message}` });
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const selectTab = (id) => {
        setActiveTab(id);
        // The outcome belongs to the flow that produced it.
        setOutcome(null);
    };

    return (
        <div className="mx-auto max-w-4xl pb-ds-10">
            <Stack gap="lg">
                <header className="flex flex-wrap items-start justify-between gap-ds-4">
                    <div>
                        <h2 className="text-ds-heading-lg font-bold text-ds-content">Create New Entity</h2>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Add new companies or team members to the system.
                        </p>
                    </div>
                    {setActiveView && (
                        <Button
                            variant="ghost"
                            onClick={() => setActiveView(SUPER_ADMIN_VIEWS.COMPANIES)}
                        >
                            <X size={20} aria-hidden="true" /> Close
                        </Button>
                    )}
                </header>

                <div
                    role="tablist"
                    aria-label="Entity type"
                    onKeyDown={onTabKeyDown}
                    className="flex gap-ds-4 overflow-x-auto border-b border-ds-border-subtle"
                >
                    {TABS.map((tab) => {
                        const selected = activeTab === tab.id;
                        const TabIcon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                id={`${tabsId}-tab-${tab.id}`}
                                aria-selected={selected}
                                aria-controls={`${tabsId}-panel-${tab.id}`}
                                tabIndex={selected ? 0 : -1}
                                ref={(node) => { tabRefs.current[tab.id] = node; }}
                                onClick={() => selectTab(tab.id)}
                                className={`flex items-center gap-ds-2 whitespace-nowrap border-b-2 px-ds-4 pb-ds-3 text-ds-sm font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                    selected
                                        ? 'border-ds-action-primary text-ds-content-link'
                                        : 'border-transparent text-ds-content-secondary hover:text-ds-content'
                                }`}
                            >
                                <TabIcon size={18} aria-hidden="true" /> {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Outcome. Replaces the four blocking `alert()` calls; wording preserved. */}
                <CreateOutcome outcome={outcome} />

                {/* --- TAB 1: CREATE COMPANY --- */}
                {activeTab === 'company' && (
                    <div
                        role="tabpanel"
                        id={`${tabsId}-panel-company`}
                        aria-labelledby={`${tabsId}-tab-company`}
                        tabIndex={0}
                        className="focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        <form onSubmit={handleCompanySubmit}>
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
                                    <Button type="submit" variant="primary" size="lg" disabled={loading} loading={loading}>
                                        {!loading && <Save size={20} aria-hidden="true" />} Create Company
                                    </Button>
                                </div>
                            </Stack>
                        </form>
                    </div>
                )}

                {/* --- TAB 2: CREATE USER --- */}
                {activeTab === 'user' && (
                    <div
                        role="tabpanel"
                        id={`${tabsId}-panel-user`}
                        aria-labelledby={`${tabsId}-tab-user`}
                        tabIndex={0}
                        className="focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        <form onSubmit={handleUserSubmit}>
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
                                    <Button type="submit" variant="primary" size="lg" disabled={loading} loading={loading}>
                                        {!loading && <UserPlus size={20} aria-hidden="true" />} Create User
                                    </Button>
                                </div>
                            </Stack>
                        </form>
                    </div>
                )}
            </Stack>
        </div>
    );
}

/**
 * The submit outcome. Every one of these messages was previously a blocking
 * `alert()`; the text is preserved verbatim, including the `Error: ` / `Failed: `
 * prefixes that carry the underlying message.
 *
 * Both regions are always mounted so assistive technology has a live region to
 * announce into when the outcome arrives.
 */
function CreateOutcome({ outcome }) {
    const isError = outcome?.tone === 'error';

    return (
        <>
            <div role="status">
                {outcome && !isError && (
                    <Card padding="md" className="flex items-start gap-ds-3 border-ds-status-success-border bg-ds-status-success-bg">
                        <CheckCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ds-status-success-fg" />
                        <p className="break-words text-ds-sm font-medium text-ds-status-success-fg">{outcome.message}</p>
                    </Card>
                )}
            </div>
            <div role="alert">
                {isError && (
                    <Card padding="md" className="flex items-start gap-ds-3 border-ds-status-danger-border bg-ds-status-danger-bg">
                        <AlertCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ds-status-danger-fg" />
                        <p className="break-words text-ds-sm font-medium text-ds-status-danger-fg">{outcome.message}</p>
                    </Card>
                )}
            </div>
        </>
    );
}
