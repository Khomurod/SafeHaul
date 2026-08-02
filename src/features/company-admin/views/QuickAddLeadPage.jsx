import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { db } from '@lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Save, X } from 'lucide-react';
import { ATS_STATUS_NEW } from '@shared/constants/atsStatus';
import {
    Button, Card, FormField, FormSection, Input, Select, Textarea,
} from '@/design-system/components';
import {
    PageContainer, PageHeader, ResponsiveGrid, Stack,
} from '@/design-system/layouts';

/**
 * Manual single-lead entry.
 *
 * Feature-owned: the field set, the required rule, the Firestore write to
 * `companies/{companyId}/leads`, and every user-facing string. All layout and
 * controls come from the design system.
 *
 * Migrated 2026-07-27. Defects fixed:
 *
 *  1. **No field had an accessible name.** Every `<label>` was a bare element
 *     with no `htmlFor`, and no input had an `id`, so nothing was associated —
 *     a screen reader announced nine unlabelled edit boxes. `FormField` now owns
 *     the association.
 *  2. **The application-level required message was unreachable.** The inputs
 *     carried the native `required` attribute, so the browser blocked submission
 *     with its own bubble and `handleSubmit` never ran. The frozen message
 *     "Please fill in required fields (First Name, Last Name, Phone)." was dead
 *     code in any real browser. The form is now `noValidate` so the app owns
 *     validation: the same message is shown, the offending fields are marked
 *     `aria-invalid` with an associated error, and focus moves to the first
 *     invalid field. `required` / `aria-required` are still exposed for
 *     semantics, and the rule itself is unchanged.
 *  3. **Duplicate submission was possible.** `isSaving` is React state, so two
 *     fast activations inside one render could both pass the guard. A ref guard
 *     now closes that window.
 *  4. **No autocomplete tokens**, so browser autofill could not help.
 *  5. Hard-coded palette classes and a 2-column grid that did not reflow to the
 *     narrowest supported width are replaced by tokens and `ResponsiveGrid`.
 *
 * Frozen: the nine form keys and their initial values (`cdlClass: 'A'`), the
 * First Name / Last Name / Phone required rule, the CDL options, the exact
 * payload (`companyId`, derived `name`, `createdAt`, `updatedAt`,
 * `ATS_STATUS_NEW`, `source: 'manual_entry'`, `createdBy`), all four messages,
 * and every navigation destination.
 */
const REQUIRED_FIELDS = [
    { name: 'firstName', label: 'First Name' },
    { name: 'lastName', label: 'Last Name' },
    { name: 'phone', label: 'Phone' },
];

export const QuickAddLeadPage = () => {
    const { currentCompanyProfile, currentUser } = useData();
    const { showSuccess, showError } = useToast();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;

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
            };

            await addDoc(collection(db, 'companies', companyId, 'leads'), leadData);
            showSuccess('Lead added successfully!');
            navigate('/company/drivers/leads/company');
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
                <Stack gap="lg">
                    <PageHeader
                        title="Quick Add Lead"
                        description="Manually add a new lead to your pipeline."
                    />

                    <form
                        ref={formRef}
                        onSubmit={handleSubmit}
                        noValidate
                        className="mx-auto w-full max-w-2xl"
                    >
                        <FormSection
                            title="Lead details"
                            description="Fields marked with an asterisk are required."
                        >
                            <Stack gap="lg">
                                <ResponsiveGrid minItemWidth="220px">
                                    <FormField
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
                                </ResponsiveGrid>

                                <ResponsiveGrid minItemWidth="220px">
                                    <FormField
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
                                    <FormField label="Email">
                                        <Input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            placeholder="john.doe@email.com"
                                            autoComplete="email"
                                        />
                                    </FormField>
                                </ResponsiveGrid>

                                <ResponsiveGrid minItemWidth="220px">
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
                                </ResponsiveGrid>

                                <ResponsiveGrid minItemWidth="220px">
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
                                </ResponsiveGrid>

                                <FormField label="Notes">
                                    <Textarea
                                        name="notes"
                                        value={formData.notes}
                                        onChange={handleChange}
                                        rows={3}
                                        placeholder="Any additional notes about this lead..."
                                    />
                                </FormField>

                                <div className="flex flex-wrap justify-end gap-ds-3 border-t border-ds-border-subtle pt-ds-4">
                                    <Button
                                        variant="secondary"
                                        onClick={() => navigate('/company/dashboard')}
                                    >
                                        <X size={16} aria-hidden="true" /> Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        disabled={isSaving}
                                        loading={isSaving}
                                    >
                                        {!isSaving && <Save size={16} aria-hidden="true" />}
                                        {isSaving ? 'Saving...' : 'Save Lead'}
                                    </Button>
                                </div>
                            </Stack>
                        </FormSection>
                    </form>
                </Stack>
            </PageContainer>
        </div>
    );
};

export default QuickAddLeadPage;
