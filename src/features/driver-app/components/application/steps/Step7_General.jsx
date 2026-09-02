import React from 'react';
import RadioGroup from '@shared/components/form/RadioGroup';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, MILES_DRIVEN_OPTIONS, EXPERIENCE_OPTIONS } from '@/config/form-options';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import BusinessInfoSection from './components/BusinessInfoSection';
import VehicleExperienceSection from './components/VehicleExperienceSection';
import EmergencyContactsSection from './components/EmergencyContactsSection';
import { StepNavigation } from './components/StepNavigation';
import { StepIssues } from './components/StepIssues';
import { HoursOfServiceSection } from './components/HoursOfServiceSection';
import { resolveApplicationGate } from '@/config/applicationGates';
import { visibleVehicleCategories } from '@/config/applicationRules';
import { useStepGate } from '@features/driver-app/hooks/useApplicationRules';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives (2026-07-27).
 *
 * Unchanged: the `positionType` owner/lease-operator gate on the business
 * section, the `has-felony` key and its conditional explanation, and the
 * `form.checkValidity()` gate.
 *
 * The emergency-contacts gate now supplies BOTH halves of its setting. It used
 * to supply only visibility, and the section hard-coded Contact #1 as required —
 * so "visible but optional" was unreachable and blocked the applicant.
 *
 * Company rules applied here (2026-09-02): the vehicle categories and their
 * wording (`vehicleExperienceHidden` / `vehicleExperienceLabels`), whether a
 * felony explanation is mandatory (`requireFelonyExplanation`), and the optional
 * Hours of Service statement (`hoursOfServiceStatement: 'application'`), which
 * renders here rather than as a tenth step so no company's application grows a
 * mandatory page it did not ask for.
 */
const Step7_General = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    // Resolved through the shared gate resolver so the canonical
    // `emergencyContacts` setting works alongside the legacy
    // `showEmergencyContacts` boolean. Default stays hidden, as before.
    const emergencyContactsConfig = resolveApplicationGate(
        currentCompany?.applicationConfig,
        'emergencyContacts',
    );

    const yesNoOptions = YES_NO_OPTIONS;
    const milesOptions = MILES_DRIVEN_OPTIONS;
    const expOptions = EXPERIENCE_OPTIONS;
    const hasFelony = formData['has-felony'] === 'yes';
    const { rules, blocking, attempted, issuesRef, refuseIfBlocked } = useStepGate('general', formData);
    const vehicleCategories = visibleVehicleCategories(rules);

    const handleContinue = () => {
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

    return (
        <div id="page-7" className="form-step space-y-ds-6">
            <StepIssues ref={issuesRef} blocking={blocking} showBlocking={attempted} />
            {(formData.positionType === 'ownerOperator' || formData.positionType === 'leaseOperator') && (
                <BusinessInfoSection
                    formData={formData}
                    updateFormData={updateFormData}
                    states={states}
                />
            )}

            <VehicleExperienceSection
                formData={formData}
                updateFormData={updateFormData}
                milesOptions={milesOptions}
                expOptions={expOptions}
                categories={vehicleCategories}
            />

            {!emergencyContactsConfig.hidden && (
                <EmergencyContactsSection
                    formData={formData}
                    updateFormData={updateFormData}
                    required={emergencyContactsConfig.required}
                />
            )}

            {rules.hoursOfServiceStatement === 'application' && (
                <HoursOfServiceSection formData={formData} updateFormData={updateFormData} />
            )}

            <FormSection title="Felony History">
                <RadioGroup
                    label="Have you ever been convicted of a felony?"
                    name="has-felony"
                    options={yesNoOptions}
                    value={formData['has-felony']}
                    onChange={updateFormData}
                    required={true}
                />
                {hasFelony && (
                    <div id="felony-details" className="border-t border-ds-border-subtle pt-ds-4">
                        <FormField id="felony-explanation" label="Please explain:" required={rules.requireFelonyExplanation}>
                            <Textarea
                                name="felonyExplanation"
                                rows="3"
                                value={formData.felonyExplanation || ""}
                                onChange={(e) => updateFormData(e.target.name, e.target.value)}
                            />
                        </FormField>
                    </div>
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

export default Step7_General;
