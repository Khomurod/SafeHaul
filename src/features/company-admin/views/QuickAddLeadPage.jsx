import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { db } from '@lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Icon, Save, X } from '@design-system/icons';
import { ATS_STATUS_NEW } from '@shared/constants/atsStatus';
import { normalizePhone } from '@shared/utils/helpers';
import { normalizeSearchEmail } from '@shared/utils/searchNormalization';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import {
    Button, Card, FormField, FormSection, Input, Select, Textarea,
} from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { COMPANY_NAV_GROUPS } from '@app/routes/companyRouteManifest';
import { leadsBackLink, leadsListPath } from './leadsListPath';

/**
 * Add lead: manual single-lead entry, open to every staff member and reached
 * from the Leads page's header (`LeadsHeaderActions`).
 *
 * Feature-owned: the field set, the required rule, the Firestore write to
 * `companies/{companyId}/leads`, who the lead is assigned to, and every
 * user-facing string. All layout and controls come from the design system.
 *
 * Rules this page keeps:
 *
 *  1. **Every field has an accessible name.** `FormField` owns the
 *     label/field association.
 *  2. **The application owns validation.** The form is `noValidate`, so the
 *     browser's own bubble cannot block submission before `handleSubmit` runs:
 *     the frozen message "Please fill in required fields (First Name, Last Name,
 *     Phone)." is shown, the offending fields are marked `aria-invalid` with an
 *     associated error, and focus moves to the first invalid field. `required` /
 *     `aria-required` are still exposed for semantics, and the rule itself is
 *     frozen.
 *  3. **Duplicate submission is blocked by a ref guard.** `isSaving` is React
 *     state, so two fast activations inside one render could both pass it.
 *  4. **Fields carry autocomplete tokens**, so browser autofill can help.
 *  5. One field grid, sized by the page's width rather than the window's
 *     (`FIELD_GRID`): four columns from 1024px of page, two below it, never
 *     three; on a phone one column, with City | State and Years | CDL paired.
 *     The DOM and Tab order are the field order at every width.
 *  6. Cancel and Save Lead are the header's actions, on the title's row from
 *     768px; on a phone they are the bar pinned to the
 *     bottom of the screen (`mobileActions="sticky"`) — the same two buttons,
 *     never copies.
 *
 * Frozen: the nine form keys and their initial values (`cdlClass: 'A'`), the
 * First Name / Last Name / Phone required rule, the CDL options, the exact
 * payload (`companyId`, derived `name`, `createdAt`, `updatedAt`,
 * `ATS_STATUS_NEW`, `source: 'manual_entry'`, `createdBy`), and all four
 * messages.
 *
 * Saving and Cancel return to the person's leads list (`leadsListPath`); once
 * saved, the new lead's dossier opens over it (the company shell opens the
 * `openRecordId` the navigation names, a lead: `openRecordCollection`).
 */
/** The section of the menu this page belongs to, above its title. */
const EYEBROW = COMPANY_NAV_GROUPS.applications.label;

/*
 * Two columns, four where the page is at least 1024px wide (a container query
 * on the wrapper the page draws, so a collapsed menu counts). On a phone a
 * field takes the whole row unless it is one of a pair (City | State,
 * Years | CDL Class), which keep the two columns.
 */
const FIELD_GRID = 'grid min-w-0 grid-cols-2 gap-x-ds-3 gap-y-ds-4 md:gap-ds-5 [@container_(min-width:1024px)]:grid-cols-4';
const PHONE_FULL_ROW = 'col-span-2 md:col-span-1';

const REQUIRED_FIELDS = [
    { name: 'firstName', label: 'First Name' },
    { name: 'lastName', label: 'Last Name' },
    { name: 'phone', label: 'Phone' },
];

/**
 * Who a new lead is assigned to. A company admin's stays unassigned (`''`, as
 * the lists' Unassigned filter asks for), for the admin to hand out; anyone
 * else's is theirs (decision Д13), so it is in their My Leads at once. Named as
 * their account is, as the lead import names the person importing.
 */
function assigneeOf(isCompanyAdmin, user) {
    if (isCompanyAdmin || !user?.uid) return { assignedTo: '', assignedToName: '' };
    return { assignedTo: user.uid, assignedToName: user.displayName || user.email || '' };
}

export const QuickAddLeadPage = () => {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const { showSuccess, showError } = useToast();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    const listPath = leadsListPath(isCompanyAdmin);

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        city: '',
        state: '',
        yearsExperience: '',
        cdlClass: 'A',
        notes: ''
    });
    const [isSaving, setIsSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});

    const formRef = useRef(null);
    /**
     * Ref, not state: `isSaving` only takes effect on the next render, so two
     * activations dispatched before React re-renders would both get past it.
     */
    const submittingRef = useRef(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        setFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
    };

    const focusField = (name) => {
        formRef.current?.querySelector(`[name="${name}"]`)?.focus();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (submittingRef.current) return;

        // Security: Ensure companyId exists before write
        if (!companyId) {
            showError('No company selected. Cannot add lead.');
            return;
        }

        if (!formData.firstName || !formData.lastName || !formData.phone) {
            const missing = REQUIRED_FIELDS.filter(({ name }) => !formData[name]);
            setFieldErrors(Object.fromEntries(
                missing.map(({ name, label }) => [name, `${label} is required.`]),
            ));
            showError('Please fill in required fields (First Name, Last Name, Phone).');
            focusField(missing[0].name);
            return;
        }

        setFieldErrors({});
        submittingRef.current = true;
        setIsSaving(true);
        try {
            const leadData = {
                ...formData,
                // Tenant binding required by firestore.rules (tenantCompanyIdMatches).
                companyId: companyId,
                name: `${formData.firstName} ${formData.lastName}`.trim(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: ATS_STATUS_NEW,
                source: 'manual_entry',
                createdBy: currentUser?.uid || 'unknown',
                ...assigneeOf(isCompanyAdmin, currentUser),
                // As the lead import writes them: the phone key the import
                // finds a duplicate by, and the email an application is
                // matched to its lead by (functions/shared/leadApplicationLink.js).
                normalizedPhone: normalizePhone(formData.phone),
                emailNormalized: normalizeSearchEmail(formData.email),
            };

            const added = await addDoc(collection(db, 'companies', companyId, 'leads'), leadData);
            showSuccess('Lead added successfully!');
            navigate(listPath, { state: { openRecordId: added.id, openRecordCollection: 'leads' } });
        } catch (err) {
            console.error('Error adding lead:', err);
            showError('Failed to add lead. Please try again.');
        } finally {
            submittingRef.current = false;
            setIsSaving(false);
        }
    };

    // Guard: No company selected
    if (!companyId) {
        return (
            <div className="min-h-full bg-ds-canvas">
                <PageContainer width="standard">
                    <Card padding="lg" className="mx-auto max-w-md text-center">
                        <h1 className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">
                            No Company Selected
                        </h1>
                        <p className="mb-ds-6 text-ds-content-secondary">
                            Please select a company before adding leads.
                        </p>
                        <Button
                            variant="primary"
                            fullWidth
                            onClick={() => navigate('/company/settings')}
                        >
                            Select Company
                        </Button>
                    </Card>
                </PageContainer>
            </div>
        );
    }

    return (
        <div className="min-h-full bg-ds-canvas">
            <PageContainer width="standard">
                {/*
                  One form holds the header too: Save Lead sits on the title's
                  row (and, on a phone, in the bar pinned to the bottom of the
                  screen), and it stays this form's submit button, so Enter in
                  a field and the button submit the same way.
                */}
                <form ref={formRef} onSubmit={handleSubmit} noValidate>
                    <Stack gap="lg">
                        <PageHeader
                            eyebrow={EYEBROW}
                            back={leadsBackLink(isCompanyAdmin, navigate)}
                            title="Add lead"
                            description="Manually add a new lead to your pipeline."
                            mobileActions="sticky"
                            actions={(
                                <>
                                    <Button
                                        variant="secondary"
                                        onClick={() => navigate(listPath)}
                                    >
                                        <Icon icon={X} /> Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        disabled={isSaving}
                                        loading={isSaving}
                                    >
                                        {!isSaving && <Icon icon={Save} />}
                                        {isSaving ? 'Saving...' : 'Save Lead'}
                                    </Button>
                                </>
                            )}
                        />

                        {/* The fields' columns follow the width of the page, not the window. */}
                        <div className="min-w-0 [container-type:inline-size]">
                            <FormSection
                                header="bleed"
                                title="Lead details"
                                description="Fields marked with an asterisk are required."
                            >
                                <div className={FIELD_GRID}>
                                    <FormField
                                        className={PHONE_FULL_ROW}
                                        label="First Name"
                                        required
                                        error={fieldErrors.firstName}
                                    >
                                        <Input
                                            name="firstName"
                                            value={formData.firstName}
                                            onChange={handleChange}
                                            placeholder="John"
                                            autoComplete="given-name"
                                        />
                                    </FormField>
                                    <FormField
                                        className={PHONE_FULL_ROW}
                                        label="Last Name"
                                        required
                                        error={fieldErrors.lastName}
                                    >
                                        <Input
                                            name="lastName"
                                            value={formData.lastName}
                                            onChange={handleChange}
                                            placeholder="Doe"
                                            autoComplete="family-name"
                                        />
                                    </FormField>
                                    <FormField
                                        className={PHONE_FULL_ROW}
                                        label="Phone"
                                        required
                                        error={fieldErrors.phone}
                                    >
                                        <Input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleChange}
                                            placeholder="(555) 123-4567"
                                            autoComplete="tel"
                                        />
                                    </FormField>
                                    <FormField className={PHONE_FULL_ROW} label="Email">
                                        <Input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            placeholder="john.doe@email.com"
                                            autoComplete="email"
                                        />
                                    </FormField>
                                    <FormField label="City">
                                        <Input
                                            name="city"
                                            value={formData.city}
                                            onChange={handleChange}
                                            placeholder="Dallas"
                                            autoComplete="address-level2"
                                        />
                                    </FormField>
                                    <FormField label="State">
                                        <Input
                                            name="state"
                                            value={formData.state}
                                            onChange={handleChange}
                                            placeholder="TX"
                                            autoComplete="address-level1"
                                        />
                                    </FormField>
                                    <FormField label="Years of Experience">
                                        <Input
                                            type="number"
                                            name="yearsExperience"
                                            value={formData.yearsExperience}
                                            onChange={handleChange}
                                            placeholder="5"
                                            min="0"
                                        />
                                    </FormField>
                                    <FormField label="CDL Class">
                                        <Select
                                            name="cdlClass"
                                            value={formData.cdlClass}
                                            onChange={handleChange}
                                        >
                                            <option value="A">Class A</option>
                                            <option value="B">Class B</option>
                                            <option value="C">Class C</option>
                                            <option value="None">No CDL</option>
                                        </Select>
                                    </FormField>
                                    <FormField className="col-span-full" label="Notes">
                                        <Textarea
                                            name="notes"
                                            value={formData.notes}
                                            onChange={handleChange}
                                            rows={3}
                                            placeholder="Any additional notes about this lead..."
                                        />
                                    </FormField>
                                </div>
                            </FormSection>
                        </div>
                    </Stack>
                </form>
            </PageContainer>
        </div>
    );
};

export default QuickAddLeadPage;
