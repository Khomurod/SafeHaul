import React, { useEffect, useRef, useState } from 'react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import UploadField from '../UploadField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, LICENSE_CLASS_OPTIONS, ENDORSEMENT_OPTIONS } from '@/config/form-options';
import { Checkbox, ChoiceGroup, FieldMessage, FormField, FormSection, Select } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';
import { StepIssues } from './components/StepIssues';
import { resolveApplicationGate } from '@/config/applicationGates';
import { dateStatus } from '@/config/applicationDates';
import { useStepGate } from '@features/driver-app/hooks/useApplicationRules';
import { ReportImportPanel } from './components/ReportImportPanel';
import { integrationEnabled } from '../reportSuggestions';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Select` /
 * `Checkbox` / `ChoiceGroup` primitives (2026-07-27).
 *
 * Unchanged: every field key, the `applicationConfig` upload hidden/required
 * resolution, the local `hasUploadedFile` rule, the exact "Please upload required
 * documents: …" message, the clear-on-upload/clear-on-state-change behaviour, the
 * `endorsements` comma-joined string, the `additionalLicenses` row shape, the
 * TWIC conditional block, and the `isUploading` disabled/"Uploading..." Continue
 * state.
 *
 * 2026-09-02 — company rules. An expiration date in the past is judged the
 * moment the date changes (`expiredCdl` / `expiredMedicalCard`: allow, warn or
 * block), the other-state licence list can be required to hold one complete
 * record (`requirePreviousLicenseDetails`), and the signed-form upload is
 * labelled as what it is — a paper form — so it is not mistaken for the MVR
 * authorization question on the next step.
 *
 * DEFECT FIXED (2026-07-27): the missing-upload message was a plain `<div>` — not
 * announced, and not focused. An applicant who pressed Continue with a document
 * missing got no feedback at all from a screen reader, and on a long step the
 * message could be off-screen. It is now a `role="alert"` region that receives
 * focus, so the reason Continue did nothing is always reachable.
 */
const Step3_License = ({ formData, updateFormData, handleFileUpload, onNavigate, isUploading, onPartialSubmit }) => {
    const ty = new Date().getFullYear();
    const expMaxYear = ty + 20;
    const expMinYear = ty - 30;
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    // --- Configuration ---
    // One resolver for every surface (see src/config/applicationGates.js):
    // canonical gate ids, legacy aliases and shared defaults, so this step, the
    // submission validator and the immutable snapshot always agree.
    const getConfig = (fieldId) => resolveApplicationGate(currentCompany?.applicationConfig, fieldId);

    const cdlUploadConfig = getConfig('cdlUpload');
    const medCardConfig = getConfig('medCardUpload');
    const mvrConsentConfig = getConfig('mvrConsent');
    const [validationError, setValidationError] = useState('');
    const validationErrorRef = useRef(null);
    const { rules, blocking, attempted, issuesRef, refuseIfBlocked } = useStepGate('license', formData);

    // Recomputed on every render, so the message follows the date immediately.
    const expiryMessage = (fieldId, level, label) => {
        if (level === 'allow' || dateStatus(formData[fieldId]) !== 'expired') return null;
        if (level === 'block') {
            return (
                <FieldMessage tone="error" className="mt-ds-1" data-testid={`${fieldId}-expired`}>
                    Your {label} expiration date is in the past. This carrier needs a current one before you can continue.
                </FieldMessage>
            );
        }
        return (
            <p role="status" className="mt-ds-1 text-ds-xs font-medium text-ds-status-warning-fg" data-testid={`${fieldId}-expired`}>
                Your {label} expiration date is in the past. You can continue, but the carrier will ask you about it.
            </p>
        );
    };

    useEffect(() => {
        if (validationError) validationErrorRef.current?.focus();
    }, [validationError]);

    const licenseClassOptions = LICENSE_CLASS_OPTIONS;
    const endorsementOptions = ENDORSEMENT_OPTIONS;
    const yesNoOptions = YES_NO_OPTIONS;
    const endorsements = (formData.endorsements || '').split(',').filter(e => e);

    const handleEndorsementChange = (e) => {
        const value = e.target.value;
        let newEndorsements;
        if (e.target.checked) {
            newEndorsements = [...endorsements, value];
        } else {
            newEndorsements = endorsements.filter(e => e !== value);
        }
        updateFormData('endorsements', newEndorsements.join(','));
    };

    const hasUploadedFile = (value) => {
        if (!value) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (typeof value === 'object') {
            return Boolean(value.url || value.storagePath || value.name);
        }
        return false;
    };

    const updateUploadedFile = (name, fileData) => {
        setValidationError('');
        updateFormData(name, fileData);
    };

    const handleStateChange = (name, value) => {
        setValidationError('');
        updateFormData(name, value);
    };

    const handleContinue = () => {
        setValidationError('');
        const missingUploads = [];
        if (!cdlUploadConfig.hidden && cdlUploadConfig.required) {
            if (!hasUploadedFile(formData['cdl-front'])) missingUploads.push('CDL Front');
            if (!hasUploadedFile(formData['cdl-back'])) missingUploads.push('CDL Back');
        }
        if (!medCardConfig.hidden && medCardConfig.required && !hasUploadedFile(formData['medical-card-upload'])) {
            missingUploads.push('Medical Card');
        }
        if (!mvrConsentConfig.hidden && mvrConsentConfig.required && !hasUploadedFile(formData['mvr-consent-upload'])) {
            missingUploads.push('Signed MVR authorization form');
        }
        if (missingUploads.length > 0) {
            setValidationError(`Please upload required documents: ${missingUploads.join(', ')}.`);
            return;
        }

        const form = document.getElementById('driver-form');
        if (form) {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
        if (refuseIfBlocked()) return;

        onNavigate('next');
    };

    const hasTwic = formData['has-twic'] === 'yes';

    return (
        <div id="page-3" className="form-step space-y-ds-6">
            <StepIssues ref={issuesRef} blocking={blocking} showBlocking={attempted} />
            {validationError && (
                <p
                    ref={validationErrorRef}
                    tabIndex={-1}
                    role="alert"
                    className="rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-danger-fg focus-visible:shadow-ds-focus"
                >
                    {validationError}
                </p>
            )}

            {/*
              Optional MVR import — only when the company switched it on. Licence
              details fill EMPTY fields only; violations are offered one by one and
              land on the next step. Nothing already typed is overwritten.
            */}
            {integrationEnabled(currentCompany, 'mvr') && (
                <ReportImportPanel kind="mvr" company={currentCompany} formData={formData} updateFormData={updateFormData} />
            )}

            <FormSection title="Current License Information">
                <StateSelectField
                    id="cdl-state"
                    name="cdlState"
                    label="License State"
                    states={states}
                    value={formData.cdlState}
                    onChange={(e) => handleStateChange(e.target.name, e.target.value)}
                />

                <RadioGroup
                    label="License Class"
                    name="cdlClass"
                    options={licenseClassOptions}
                    value={formData.cdlClass}
                    onChange={updateFormData}
                    required={true}
                    horizontal={false}
                />

                <InputField label="License Number" id="cdl-number" name="cdlNumber" required={true} value={formData.cdlNumber} onChange={updateFormData} />
                <div>
                    <DateTripletField
                        label="License Expiration"
                        idPrefix="cdl-expiration"
                        name="cdlExpiration"
                        required={true}
                        value={formData.cdlExpiration}
                        onChange={updateFormData}
                        minYear={expMinYear}
                        maxYear={expMaxYear}
                        helpText="Use Month / Day / Year."
                    />
                    {expiryMessage('cdlExpiration', rules.expiredCdl, 'license')}
                </div>

                <div className="border-t border-ds-border-subtle pt-ds-4">
                    <ChoiceGroup legend="Endorsements">
                        <div className="grid grid-cols-2 gap-ds-3 sm:grid-cols-3">
                            {endorsementOptions.map(option => (
                                <Checkbox
                                    key={option.value}
                                    id={'endorse-' + option.value}
                                    name="endorsements"
                                    value={option.value}
                                    label={option.label}
                                    checked={endorsements.includes(option.value)}
                                    onChange={handleEndorsementChange}
                                />
                            ))}
                        </div>
                    </ChoiceGroup>
                </div>

                {/* --- Additional Licenses from Other States --- */}
                <div className="space-y-ds-4 border-t border-ds-border-subtle pt-ds-6">
                    <RadioGroup
                        label="Have you held a license in any other state in the past 3 years?"
                        name="has-other-licenses"
                        options={yesNoOptions}
                        value={formData['has-other-licenses']}
                        onChange={updateFormData}
                        required={true}
                    />

                    {formData['has-other-licenses'] === 'yes' && rules.requirePreviousLicenseDetails && (
                        <FieldMessage tone="help" data-testid="previous-license-hint">
                            This carrier needs at least one complete record below: state, license number, class and expiration date.
                        </FieldMessage>
                    )}
                    {formData['has-other-licenses'] === 'yes' && (
                        <DynamicRow
                            listKey="additionalLicenses"
                            title="Additional Licenses (Past 3 Years)"
                            formData={formData}
                            updateFormData={updateFormData}
                            initialItemState={{ state: '', number: '', class: 'A', expiration: '' }}
                            addButtonLabel="Add Another License"
                            renderRow={(index, item, handleChange) => (
                                <div className="space-y-ds-4">
                                    <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                                        <StateSelectField
                                            id={`add-lic-state-${index}`}
                                            name="state"
                                            states={states}
                                            value={item.state}
                                            onChange={(e) => handleChange('state', e.target.value)}
                                        />
                                        <InputField
                                            label="License Number"
                                            id={`add-lic-number-${index}`}
                                            name="number"
                                            value={item.number}
                                            onChange={(n, v) => handleChange('number', v)}
                                            placeholder="License #"
                                            required={true}
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                                        <FormField id={`add-lic-class-${index}`} label="Class" required>
                                            <Select
                                                name="class"
                                                value={item.class || "A"}
                                                onChange={(e) => handleChange('class', e.target.value)}
                                            >
                                                {licenseClassOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </Select>
                                        </FormField>
                                        <DateTripletField
                                            label="Expiration Date"
                                            idPrefix={`add-lic-exp-${index}`}
                                            name="expiration"
                                            value={item.expiration}
                                            onChange={(n, v) => handleChange('expiration', v)}
                                            required={true}
                                            minYear={expMinYear}
                                            maxYear={expMaxYear}
                                            helpText="Month / Day / Year."
                                        />
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </div>

                {/* CDL UPLOADS */}
                {!cdlUploadConfig.hidden && (
                    <div className="space-y-ds-4 border-t border-ds-border-subtle pt-ds-4">
                        <UploadField
                            label="Upload CDL (Front)"
                            name="cdl-front"
                            value={formData['cdl-front']}
                            onUpload={handleFileUpload}
                            onChange={updateUploadedFile}
                            required={cdlUploadConfig.required && !formData['cdl-front']}
                        />
                        <UploadField
                            label="Upload CDL (Back)"
                            name="cdl-back"
                            value={formData['cdl-back']}
                            onUpload={handleFileUpload}
                            onChange={updateUploadedFile}
                            required={cdlUploadConfig.required && !formData['cdl-back']}
                        />
                    </div>
                )}

                {/* MEDICAL CARD UPLOAD */}
                {!medCardConfig.hidden && (
                    <div className="space-y-ds-4 border-t border-ds-border-subtle pt-ds-4">
                        <UploadField
                            label="Upload Medical Card"
                            name="medical-card-upload"
                            value={formData['medical-card-upload']}
                            onUpload={handleFileUpload}
                            onChange={updateUploadedFile}
                            required={medCardConfig.required && !formData['medical-card-upload']}
                        />
                        <div>
                            <DateTripletField
                                label="Medical Card Expiration"
                                idPrefix="medical-card-expiration"
                                name="medCardExpiration"
                                value={formData.medCardExpiration}
                                onChange={updateFormData}
                                minYear={expMinYear}
                                maxYear={expMaxYear}
                                helpText="Month / Day / Year (optional if not shown on card)."
                            />
                            {expiryMessage('medCardExpiration', rules.expiredMedicalCard, 'medical card')}
                        </div>
                    </div>
                )}

                {/*
                  SIGNED MVR AUTHORIZATION FORM (a paper form the company hands out)
                  Configurable in Settings → Questions. Hidden unless the company
                  asks for it, required only when the company marks it Required.
                  It is a DOCUMENT; the on-screen MVR authorization the applicant
                  answers Yes/No to lives on the next step, once, with its own
                  versioned wording.
                */}
                {!mvrConsentConfig.hidden && (
                    <div className="space-y-ds-4 border-t border-ds-border-subtle pt-ds-4">
                        <UploadField
                            label="Upload your signed MVR authorization form"
                            name="mvr-consent-upload"
                            value={formData['mvr-consent-upload']}
                            onUpload={handleFileUpload}
                            onChange={updateUploadedFile}
                            required={mvrConsentConfig.required && !formData['mvr-consent-upload']}
                        />
                    </div>
                )}

            </FormSection>

            <FormSection title="TWIC Card">
                <RadioGroup
                    label="Do you have a TWIC (Transportation Worker Identification Credential) card?"
                    name="has-twic"
                    options={yesNoOptions}
                    value={formData['has-twic']}
                    onChange={updateFormData}
                    required={true}
                />
                {hasTwic && (
                    <div id="twic-card-details" className="space-y-ds-4 border-t border-ds-border-subtle pt-ds-4">
                        <DateTripletField
                            label="Expiration Date"
                            idPrefix="twic-expiration"
                            name="twicExpiration"
                            value={formData.twicExpiration}
                            onChange={updateFormData}
                            minYear={expMinYear}
                            maxYear={expMaxYear}
                            helpText="Month / Day / Year."
                        />
                        <UploadField
                            label="Upload TWIC Card"
                            name="twic-card-upload"
                            value={formData['twic-card-upload']}
                            onUpload={handleFileUpload}
                            onChange={updateUploadedFile}
                        />
                    </div>
                )}
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onSaveDraft={onPartialSubmit}
                onContinue={handleContinue}
                continueLabel={isUploading ? 'Uploading...' : 'Continue'}
                continueLoading={isUploading}
            />
        </div>
    );
};

export default Step3_License;
