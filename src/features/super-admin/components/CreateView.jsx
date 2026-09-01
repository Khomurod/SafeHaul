import React, { useEffect, useId, useRef, useState } from 'react';
import { createNewCompany, loadCompanies } from '@features/companies';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import {
    UserPlus, X, Briefcase, CheckCircle, AlertCircle,
} from 'lucide-react';
import {
    Button, Card,
    TabList,
    TabPanel,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { SUPER_ADMIN_VIEWS } from '../config/views';
import { CreateCompanyForm } from './create/CreateCompanyForm';
import { CreateUserForm } from './create/CreateUserForm';

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

                <TabList
                    ariaLabel="Entity type"
                    idBase={tabsId}
                    tabs={TABS}
                    activeTab={activeTab}
                    onChange={selectTab}
                    className="overflow-x-auto"
                />

                {/* Outcome. Replaces the four blocking `alert()` calls; wording preserved. */}
                <CreateOutcome outcome={outcome} />

                {/* --- TAB 1: CREATE COMPANY --- */}
                {activeTab === 'company' && (
                    <TabPanel idBase={tabsId} tabId="company">
                        <CreateCompanyForm
                            companyForm={companyForm}
                            setCompanyForm={setCompanyForm}
                            withAdmin={withAdmin}
                            setWithAdmin={setWithAdmin}
                            companyAdminData={companyAdminData}
                            setCompanyAdminData={setCompanyAdminData}
                            loading={loading}
                            onSubmit={handleCompanySubmit}
                        />
                    </TabPanel>
                )}

                {/* --- TAB 2: CREATE USER --- */}
                {activeTab === 'user' && (
                    <TabPanel idBase={tabsId} tabId="user">
                        <CreateUserForm
                            userForm={userForm}
                            setUserForm={setUserForm}
                            companies={companies}
                            loading={loading}
                            onSubmit={handleUserSubmit}
                        />
                    </TabPanel>
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
