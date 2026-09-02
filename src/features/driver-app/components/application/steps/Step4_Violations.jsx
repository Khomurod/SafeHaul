import React, { useEffect } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { YES_NO_OPTIONS } from '@/config/form-options';
import { normalizeApplicationAnswers } from '@/config/applicationRules';
import { Button, FieldMessage, FormField, FormSection, Textarea } from '@/design-system/components';
import { useData } from '@/context/DataContext';
import { useApplicationAgreements } from '@features/driver-app/hooks/useApplicationAgreements';
import { useStepGate } from '@features/driver-app/hooks/useApplicationRules';
import { StepNavigation } from './components/StepNavigation';
import { StepIssues } from './components/StepIssues';

/**
 * Motor Vehicle Record step: the MVR authorization, the FMCSA licence
 * disclosures, and moving violations.
 *
 * Unchanged: the `consent-mvr` / `revoked-licenses` / `driving-convictions` /
 * `drug-alcohol-convictions` field keys and their frozen FMCSA question wording,
 * the three conditional explanations, the `violations` row shape and the
 * `form.checkValidity()` gate. `consent-mvr-yes`, `revoked-licenses-no`,
 * `driving-convictions-no` and `drug-alcohol-convictions-no` are element ids the
 * guest E2E specs click via `label[for=…]`.
 *
 * 2026-09-02 — ONE MVR authorization. The step used to ask "I Consent to MVR
 * Check" under two sentences of prose that recorded nothing, while a separate
 * "MVR Consent Form" upload lived on the licence step and the FCRA disclosure
 * mentioned driving records again. The Yes/No question now sits under the
 * versioned `mvrAuthorization` agreement from the server registry, and a Yes is
 * recorded exactly like the consent-step agreements (`agreementAcceptances`,
 * with the version shown). Whether a No stops the application is the company's
 * `mvrAuthorization` rule; the explanation is the rule engine's own wording, the
 * same the server gives.
 *
 * A clear Yes/No violations question (`has-violations`) now precedes the list.
 * A record written before it existed, with rows but no answer, reads as Yes; an
 * explicit No hides the list and drops leftover rows at submission.
 */
const Step4_Violations = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const yesNoOptions = YES_NO_OPTIONS;
    const ty = new Date().getFullYear();
    const initialViolation = { date: '', charge: '', location: '', penalty: '' };

    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id || formData?.companyId || null;
    const { agreements, loading: agreementsLoading, error: agreementsError, retry } = useApplicationAgreements(companyId);
    const mvrAgreement = agreements.find((agreement) => agreement.presentedOn === 'drivingRecord') || null;

    const { rules, blocking, attempted, issuesRef, refuseIfBlocked } = useStepGate('violations', formData);
    const hasViolations = formData['has-violations'];
    const mvrRequired = rules.mvrAuthorization === 'required';

    // Legacy drafts: rows with no Yes/No answer mean Yes.
    useEffect(() => {
        if (hasViolations) return;
        const derived = normalizeApplicationAnswers(formData)['has-violations'];
        if (derived) updateFormData('has-violations', derived);
    }, [hasViolations, formData, updateFormData]);

    /** The authorization answer and, for a Yes, the acceptance evidence beside it. */
    const handleMvrChange = (name, value) => {
        updateFormData(name, value);
        const next = { ...(formData.agreementAcceptances || {}) };
        if (value === 'yes' && mvrAgreement) {
            next.mvrAuthorization = {
                accepted: true,
                acceptedAt: new Date().toISOString(),
                version: mvrAgreement.version,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            };
        } else {
            // Withdrawing removes the evidence rather than marking it false.
            delete next.mvrAuthorization;
        }
        updateFormData('agreementAcceptances', next);
    };

    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        if (refuseIfBlocked()) return;
        onNavigate('next');
    };

    const renderViolationRow = (index, item, handleChange) => (
        <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
            <DateTripletField
                label="Date of Conviction"
                idPrefix={'violation-date-' + index}
                name="date"
                value={item.date}
                onChange={handleChange}
                required={true}
                maxToday={true}
                minYear={ty - 15}
                helpText="Past 3 years — pick month, day, year."
            />
            <InputField
                label="Charge"
                id={'violation-charge-' + index}
                name="charge"
                value={item.charge}
                onChange={handleChange}
                required={true}
            />
            <div className="sm:col-span-2">
                <InputField
                    label="Location (City, State)"
                    id={'violation-location-' + index}
                    name="location"
                    value={item.location}
                    onChange={handleChange}
                    required={rules.requireViolationDetails}
                />
            </div>
            <div className="sm:col-span-2">
                <InputField
                    label="Penalty"
                    id={'violation-penalty-' + index}
                    name="penalty"
                    value={item.penalty}
                    onChange={handleChange}
                />
            </div>
        </div>
    );

    /** Required free-text explanation shown when a disclosure question is "yes". */
    const ConditionalExplanation = ({ id, name, value }) => (
        <FormField id={id} label="Please provide details (date, location, circumstances):" required>
            <Textarea
                name={name}
                rows="3"
                value={value || ""}
                onChange={(e) => updateFormData(e.target.name, e.target.value)}
                placeholder="Provide details here..."
            />
        </FormField>
    );

    return (
        <div id="page-4" className="form-step space-y-ds-6">
            <StepIssues ref={issuesRef} blocking={blocking} showBlocking={attempted} />

            <FormSection title="Motor Vehicle Record (MVR) Authorization">
                <p className="text-ds-sm text-ds-content-secondary">
                    We will request your driving record from every state where you have held a license in the past 3 years.
                    {mvrRequired
                        ? ' This carrier requires your authorization to consider your application.'
                        : ' You may decline; the carrier will discuss it with you.'}
                </p>
                {agreementsLoading && (
                    <div role="status" className="flex items-center gap-ds-2 py-ds-2 text-ds-sm text-ds-content-muted">
                        <Loader2 className="animate-spin" size={16} aria-hidden="true" /> Loading the authorization wording…
                    </div>
                )}
                {agreementsError && !agreementsLoading && (
                    <div role="alert" className="flex items-start gap-ds-3 rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3 text-ds-sm text-ds-status-danger-fg">
                        <AlertCircle size={16} className="mt-px shrink-0" aria-hidden="true" />
                        <div className="space-y-ds-2">
                            <p>{agreementsError}</p>
                            <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
                        </div>
                    </div>
                )}
                {mvrAgreement && (
                    <div
                        tabIndex={0}
                        role="group"
                        aria-label={`${mvrAgreement.title} full text`}
                        data-testid="mvr-authorization-wording"
                        className="max-h-60 overflow-y-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                    >
                        <p className="whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-content-secondary">{mvrAgreement.body}</p>
                    </div>
                )}
                <RadioGroup
                    label="I authorize this motor vehicle record check"
                    name="consent-mvr"
                    options={yesNoOptions}
                    value={formData['consent-mvr']}
                    onChange={handleMvrChange}
                    required={true}
                />
                {mvrRequired && formData['consent-mvr'] === 'no' && (
                    <FieldMessage tone="error" data-testid="mvr-declined-message">
                        This carrier needs your authorization to obtain your motor vehicle record before the application can
                        continue. Choose Yes to continue, or contact the carrier if you have questions.
                    </FieldMessage>
                )}
            </FormSection>

            <FormSection title="License Disclosures">
                <RadioGroup
                    label="Has any license, permit or privilege ever been denied, suspended, or revoked for any reason?"
                    name="revoked-licenses"
                    options={yesNoOptions}
                    value={formData['revoked-licenses']}
                    onChange={updateFormData}
                    required={true}
                />
                {formData['revoked-licenses'] === 'yes' && (
                    <ConditionalExplanation id="revocation-explanation" name="revocationExplanation" value={formData.revocationExplanation} />
                )}

                <RadioGroup
                    label="Have you ever been convicted of driving during license suspension or revocation, or driving without a valid license or an expired license, or are any charges pending?"
                    name="driving-convictions"
                    options={yesNoOptions}
                    value={formData['driving-convictions']}
                    onChange={updateFormData}
                    required={true}
                />
                {formData['driving-convictions'] === 'yes' && (
                    <ConditionalExplanation id="conviction-explanation" name="convictionExplanation" value={formData.convictionExplanation} />
                )}

                <RadioGroup
                    label="Have you ever been convicted for any alcohol or controlled substance related offense while operating a motor vehicle, or are any charges pending?"
                    name="drug-alcohol-convictions"
                    options={yesNoOptions}
                    value={formData['drug-alcohol-convictions']}
                    onChange={updateFormData}
                    required={true}
                />
                {formData['drug-alcohol-convictions'] === 'yes' && (
                    <ConditionalExplanation id="drug-conviction-explanation" name="drugConvictionExplanation" value={formData.drugConvictionExplanation} />
                )}
            </FormSection>

            <FormSection title="Moving Violations (Past 3 Years)">
                <RadioGroup
                    label="Have you had any moving violations or traffic convictions in the past 3 years (in a personal or commercial vehicle)?"
                    name="has-violations"
                    options={yesNoOptions}
                    value={hasViolations}
                    onChange={updateFormData}
                    required={true}
                />
                {hasViolations === 'yes' && (
                    <>
                        <p className="text-ds-sm text-ds-content-secondary">
                            List each moving violation or traffic conviction within the past 3 years.
                            {rules.requireViolationDetails && ' This carrier needs at least one complete record: the date, the charge and the location.'}
                        </p>
                        <DynamicRow
                            listKey="violations"
                            formData={formData}
                            updateFormData={updateFormData}
                            renderRow={renderViolationRow}
                            initialItemState={initialViolation}
                            addButtonLabel="+ Add Violation"
                        />
                    </>
                )}
                {hasViolations === 'no' && (
                    <p className="text-ds-sm text-ds-content-muted" data-testid="no-violations-note">No violations will be listed on your application.</p>
                )}
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onSaveDraft={onPartialSubmit}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step4_Violations;
