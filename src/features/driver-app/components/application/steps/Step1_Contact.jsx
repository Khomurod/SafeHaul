import React, { useEffect, useMemo, useCallback } from 'react';
import InputField from '@shared/components/form/InputField';
import { useFieldValidation } from '@shared/hooks/useFieldValidation';
import { required, email as emailRule, phone as phoneRule } from '@shared/utils/fieldValidators';
import DateTripletField from '@shared/components/form/DateTripletField';
import MonthYearField from '@shared/components/form/MonthYearField';
import { ageFromIsoDate } from '@shared/utils/dateFormHelpers';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { AlertCircle } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { Checkbox, FormSection } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';
import { resolveApplicationGate } from '@/config/applicationGates';

// Map validator field names to their input element ids (for focus-on-error).
const FIELD_ID_BY_NAME = {
    firstName: 'first-name',
    lastName: 'last-name',
    phone: 'phone',
    email: 'email',
    street: 'street',
    city: 'city',
    zip: 'zip',
};

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Select` /
 * `Checkbox` primitives and the shared field adapters (2026-07-27).
 *
 * Unchanged: every field key, the `applicationConfig` hidden/required resolution,
 * the `known-by-other-name` default-to-'no' effect, the on-blur/revalidate
 * behaviour, the soft-format warnings, the authoritative `validateStep()` order
 * and its exact toast strings, the age-21 rules, the focus-first-error behaviour,
 * and the `previousAddresses` row shape.
 *
 * The per-step "Step 1 of 9" legend was removed: `Stepper` renders the
 * authoritative step title as the page `<h1>`, and this copy also said "of 9"
 * even when custom questions made it ten steps.
 */
const Step1_Contact = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const ty = new Date().getFullYear();
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const { showError } = useToast();
    const currentCompany = currentCompanyProfile;

    // --- Configuration Helper ---
    // One resolver for every surface (see src/config/applicationGates.js):
    // canonical gate ids, legacy aliases and shared defaults, so this step, the
    // submission validator and the immutable snapshot always agree.
    const getConfig = (fieldId) => resolveApplicationGate(currentCompany?.applicationConfig, fieldId);

    const ssnConfig = getConfig('ssn');
    const dobConfig = getConfig('dob');
    const historyConfig = getConfig('addressHistory');
    const referralConfig = getConfig('referralSource');

    // --- Logic ---
    const residenceThreeYears = formData['residence-3-years'];
    const knownByOtherName = formData['known-by-other-name'] === 'yes';

    useEffect(() => {
        if (formData['known-by-other-name'] === undefined) {
            updateFormData('known-by-other-name', 'no');
        }
    }, [formData, updateFormData]);

    const yesNoOptions = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];

    // C5: per-field on-blur validation. Rules reuse the canonical validation.js
    // predicates via the shared factories, so inline and submit-time validation
    // stay in lockstep.
    const fieldValidators = useMemo(() => ({
        firstName: required('First Name'),
        lastName: required('Last Name'),
        phone: phoneRule('Phone'),
        email: emailRule('Email'),
        street: required('Address 1'),
        city: required('City'),
        zip: required('ZIP Code'),
    }), []);
    const { errors, handleBlur, revalidate, validateAll } = useFieldValidation(fieldValidators);

    // Update value, then re-validate the field if it has already been touched
    // (revalidate-on-change-once-touched). Untouched fields stay quiet.
    const handleChange = useCallback((name, value) => {
        updateFormData(name, value);
        revalidate(name, value, { ...formData, [name]: value });
    }, [updateFormData, revalidate, formData]);

    const handleFieldBlur = useCallback((name, value) => {
        handleBlur(name, value, formData);
    }, [handleBlur, formData]);

    const handleOtherNameToggle = (e) => {
        updateFormData('known-by-other-name', e.target.checked ? 'yes' : 'no');
    };

    const handleStateChange = (name, value) => {
        updateFormData(name, value);
    };

    const validateStep = () => {
        const requiredFields = {
            firstName: 'First Name',
            lastName: 'Last Name',
            phone: 'Phone',
            email: 'Email',
            street: 'Address 1',
            city: 'City',
            state: 'State',
            zip: 'ZIP Code'
        };

        // 1. Check Not Empty
        for (const [field, label] of Object.entries(requiredFields)) {
            if (!formData[field] || formData[field].trim() === '') {
                showError(`${label} is required.`);
                return false;
            }
        }

        // 2. Strict Email Regex
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(formData.email)) {
            showError("Please enter a valid email address.");
            return false;
        }

        // 3. Phone (at least 10 digits)
        const digitsOnly = formData.phone.replace(/\D/g, '');
        if (digitsOnly.length < 10) {
            showError("Phone number must have at least 10 digits.");
            return false;
        }

        if (!dobConfig.hidden && dobConfig.required) {
            if (!formData.dob || String(formData.dob).trim() === '') {
                showError('Date of birth is required.');
                return false;
            }
            const age = ageFromIsoDate(formData.dob);
            if (age === null) {
                showError('Please enter a valid date of birth.');
                return false;
            }
            if (age < 21) {
                showError('You must be at least 21 years old for interstate CMV positions.');
                return false;
            }
        } else if (!dobConfig.hidden && formData.dob) {
            const age = ageFromIsoDate(formData.dob);
            if (age !== null && age < 21) {
                showError('Date of birth indicates under 21 — interstate CMV roles typically require age 21+. Please verify.');
                return false;
            }
        }

        return true;
    };

    const handleContinue = () => {
        // C5: surface per-field inline errors for the basic fields, then fall
        // through to the authoritative validateStep() gate (which also enforces
        // DOB/age rules and shows the summary toast).
        const { firstErrorField } = validateAll(formData);
        if (firstErrorField) {
            document.getElementById(FIELD_ID_BY_NAME[firstErrorField] || firstErrorField)?.focus?.();
        }
        if (!validateStep()) return;

        const form = document.getElementById('driver-form');
        if (form) {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
        onNavigate('next');
    };

    // --- Soft Validation Helpers ---
    const hasPhoneWarning = (val) => val && val.length > 5 && !/^\D?(\d{3})\D?\D?(\d{3})\D?(\d{4})$/.test(val);
    const hasEmailWarning = (val) => val && val.length > 5 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    const hasSSNWarning = (val) => val && val.length > 7 && !/^\d{3}-?\d{2}-?\d{4}$/.test(val);
    const hasZipWarning = (val) => val && val.length > 0 && !/^\d{5}(-\d{4})?$/.test(val);

    // Advisory-only formatting hints. They are not blocking errors, so they use
    // `role="status"` rather than the `role="alert"` an invalid field gets.
    const ValidationWarning = ({ message }) => (
        <p role="status" className="mt-ds-1 flex items-center gap-ds-1 text-ds-xs font-medium text-ds-status-warning-fg">
            <AlertCircle size={12} aria-hidden="true" />
            <span>{message}</span>
        </p>
    );

    return (
        <div id="page-1" className="form-step space-y-ds-6">

            {/* --- Personal Details --- */}
            <FormSection title="Personal Information">
                <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                    <InputField label="First Name" id="first-name" name="firstName" required={true} value={formData.firstName} onChange={handleChange} onBlur={handleFieldBlur} error={errors.firstName} placeholder="John" />
                    <InputField label="Middle Name" id="middle-name" name="middleName" value={formData.middleName} onChange={updateFormData} placeholder="M" />
                    <InputField label="Last Name" id="last-name" name="lastName" required={true} value={formData.lastName} onChange={handleChange} onBlur={handleFieldBlur} error={errors.lastName} placeholder="Doe" />
                    <InputField label="Suffix" id="suffix" name="suffix" value={formData.suffix} onChange={updateFormData} placeholder="Jr." />
                </div>

                <div className="border-t border-ds-border-subtle pt-ds-4">
                    <Checkbox
                        id="known-by-other-name"
                        name="known-by-other-name"
                        label="Known by other name(s)?"
                        checked={knownByOtherName}
                        onChange={handleOtherNameToggle}
                    />
                </div>

                {knownByOtherName && (
                    <div id="other-name-field">
                        <InputField label="Other Name(s)" id="other-name" name="otherName" value={formData.otherName} onChange={updateFormData} placeholder="e.g., Johnny" />
                    </div>
                )}

                <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                    {/* SSN Field - Configurable */}
                    {!ssnConfig.hidden && (
                        <div>
                            <InputField
                                label="Social Security Number (SSN)"
                                id="ssn"
                                name="ssn"
                                type="password"
                                required={ssnConfig.required}
                                value={formData.ssn}
                                onChange={updateFormData}
                                placeholder="XXX-XX-XXXX"
                                autoComplete="off"
                            />
                            {hasSSNWarning(formData.ssn) && <ValidationWarning message="Format usually matches XXX-XX-XXXX" />}
                        </div>
                    )}

                    {/* DOB Field - Configurable */}
                    {!dobConfig.hidden && (
                        <DateTripletField
                            label="Date of Birth"
                            idPrefix="dob"
                            name="dob"
                            required={dobConfig.required}
                            value={formData.dob}
                            onChange={updateFormData}
                            maxToday={true}
                            minYear={1920}
                            helpText="Select month, day, and year — easier than scrolling a calendar."
                        />
                    )}
                </div>

                <div className="grid grid-cols-1 gap-ds-6 border-t border-ds-border-subtle pt-ds-4 sm:grid-cols-2">
                    <div>
                        <InputField label="Phone" id="phone" name="phone" type="tel" required={true} value={formData.phone} onChange={handleChange} onBlur={handleFieldBlur} error={errors.phone} placeholder="(555) 555-5555" />
                        {!errors.phone && hasPhoneWarning(formData.phone) && <ValidationWarning message="Please double-check phone format." />}
                    </div>
                    <div>
                        <InputField label="Email" id="email" name="email" type="email" required={true} value={formData.email} onChange={handleChange} onBlur={handleFieldBlur} error={errors.email} placeholder="you@example.com" />
                        {!errors.email && hasEmailWarning(formData.email) && <ValidationWarning message="Email address looks incomplete." />}
                    </div>
                </div>

                <RadioGroup
                    label="Can we send you SMS messages?"
                    name="sms-consent"
                    options={yesNoOptions}
                    value={formData['sms-consent']}
                    onChange={updateFormData}
                    horizontal={true}
                />

                {/* Referral Source - Configurable */}
                {!referralConfig.hidden && (
                    <div className="border-t border-ds-border-subtle pt-ds-4">
                        <InputField
                            label="How did you hear about us?"
                            id="referral-source"
                            name="referralSource"
                            required={referralConfig.required}
                            value={formData.referralSource}
                            onChange={updateFormData}
                            placeholder="e.g. Facebook, Indeed, Friend..."
                        />
                    </div>
                )}
            </FormSection>

            {/* --- Current Address --- */}
            <FormSection title="Current Address">
                <div>
                    <InputField label="Address 1" id="street" name="street" required={true} value={formData.street} onChange={handleChange} onBlur={handleFieldBlur} error={errors.street} placeholder="123 Main St" />
                </div>
                <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-3">
                    <InputField label="City" id="city" name="city" required={true} value={formData.city} onChange={handleChange} onBlur={handleFieldBlur} error={errors.city} placeholder="Anytown" />
                    <StateSelectField
                        id="state"
                        name="state"
                        states={states}
                        value={formData.state}
                        onChange={(e) => handleStateChange(e.target.name, e.target.value)}
                    />
                    <div>
                        <InputField label="ZIP Code" id="zip" name="zip" required={true} value={formData.zip} onChange={handleChange} onBlur={handleFieldBlur} error={errors.zip} placeholder="12345" />
                        {!errors.zip && hasZipWarning(formData.zip) && <ValidationWarning message="Standard ZIP is 5 digits." />}
                    </div>
                </div>

                {/* Only show "3 Years" question if history is not hidden */}
                {!historyConfig.hidden && (
                    <RadioGroup
                        label="Lived at this residence for 3 years or more?"
                        name="residence-3-years"
                        options={yesNoOptions}
                        value={residenceThreeYears}
                        onChange={updateFormData}
                        horizontal={true}
                        required={historyConfig.required}
                    />
                )}
            </FormSection>

            {/*
              --- Previous Address History (Past 3 Years) ---

              Gated by the SAME `addressHistory` setting as the three-year
              question above. Hiding only the question left the editor — its
              heading, its Add button and its six required fields per row —
              on screen at a company that had turned address history off, so
              "Hidden" hid half a section. Hidden means the whole section.

              Row fields stay required regardless of the gate's requiredness:
              that is per-row completeness, not per-section. A driver who chose
              to add a previous address is asked to finish it; a driver at a
              company where the section is optional simply adds no rows.
            */}
            {!historyConfig.hidden && (
                <DynamicRow
                    listKey="previousAddresses"
                    title="Previous Addresses (Past 3 Years)"
                    formData={formData}
                    updateFormData={updateFormData}
                    initialItemState={{ street: '', city: '', state: '', zip: '', startDate: '', endDate: '' }}
                    addButtonLabel="Add Previous Address"
                    renderRow={(index, item, handleRowChange) => (
                        <div className="space-y-ds-4">
                            <InputField
                                label="Address"
                                id={`prev-street-${index}`}
                                name="street"
                                value={item.street}
                                onChange={(n, v) => handleRowChange('street', v)}
                                placeholder="123 Old St"
                                required={true}
                            />
                            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-3">
                                <InputField
                                    label="City"
                                    id={`prev-city-${index}`}
                                    name="city"
                                    value={item.city}
                                    onChange={(n, v) => handleRowChange('city', v)}
                                    placeholder="City"
                                    required={true}
                                />
                                <StateSelectField
                                    id={`prev-state-${index}`}
                                    name="state"
                                    states={states}
                                    value={item.state}
                                    onChange={(e) => handleRowChange('state', e.target.value)}
                                />
                                <InputField
                                    label="ZIP Code"
                                    id={`prev-zip-${index}`}
                                    name="zip"
                                    value={item.zip}
                                    onChange={(n, v) => handleRowChange('zip', v)}
                                    placeholder="Zip"
                                    required={true}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                                <MonthYearField
                                    label="From (month / year)"
                                    idPrefix={`prev-start-${index}`}
                                    name="startDate"
                                    value={item.startDate}
                                    onChange={(n, v) => handleRowChange('startDate', v)}
                                    required={true}
                                    maxToday={true}
                                    minYear={ty - 80}
                                    helpText="Same easy dropdowns as employment gaps — no calendar picker."
                                />
                                <MonthYearField
                                    label="To (month / year)"
                                    idPrefix={`prev-end-${index}`}
                                    name="endDate"
                                    value={item.endDate}
                                    onChange={(n, v) => handleRowChange('endDate', v)}
                                    required={true}
                                    maxToday={true}
                                    minYear={ty - 80}
                                />
                            </div>
                        </div>
                    )}
                />
            )}

            {/* --- Buttons --- */}
            <StepNavigation
                onContinue={handleContinue}
                onSaveDraft={onPartialSubmit}
            />
        </div>
    );
};

export default Step1_Contact;
