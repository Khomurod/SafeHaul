import React from 'react';
import RadioGroup from '@shared/components/form/RadioGroup';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { YES_NO_OPTIONS, EXPERIENCE_OPTIONS } from '@/config/form-options';
import { StepNavigation } from './components/StepNavigation';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives and the shared `RadioGroup` adapter (2026-07-27). Field keys,
 * `YES_NO_OPTIONS` / `EXPERIENCE_OPTIONS`, the conditional drug-test
 * explanation, the frozen DOT question wording, and the VAL-1
 * `form.checkValidity()` gate are unchanged.
 *
 * The per-step "Step 2 of 9" heading was removed: `Stepper` renders the
 * authoritative step title as the page `<h1>`, and this copy also said "of 9"
 * even when custom questions made it ten steps.
 */
const Step2_Qualifications = ({ formData, updateFormData, onNavigate }) => {
    const yesNoOptions = YES_NO_OPTIONS;
    const drugTestPositive = formData['drug-test-positive'] === 'yes';
    const experienceOptions = EXPERIENCE_OPTIONS;

    // VAL-1: Validate required radio fields before advancing.
    // form.checkValidity() does not catch radio groups unless they have a required attribute
    // tied to an actual <input>, so we validate explicitly here.
    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        onNavigate('next');
    };

    return (
        <div id="page-2" className="form-step space-y-ds-6">
            <FormSection title="General Qualifications">
                <RadioGroup
                    label="Legally eligible to work in the U.S.?"
                    name="legal-work"
                    options={yesNoOptions}
                    value={formData['legal-work']}
                    onChange={updateFormData}
                    required={true}
                />
                <RadioGroup
                    label="Can you read, write, speak and understand English?"
                    name="english-fluency"
                    options={yesNoOptions}
                    value={formData['english-fluency']}
                    onChange={updateFormData}
                    required={true}
                />
            </FormSection>

            <FormSection title="Drug & Alcohol History">
                <p className="text-ds-sm text-ds-content-secondary">
                    Have you ever tested positive, or refused to test on a pre-employment drug or alcohol test by an employer to whom you applied, but did not obtain safety-sensitive transportation work covered by DOT drug and alcohol testing regulations, or have you ever tested positive or refused to test on any DOT-mandated drug or alcohol test?
                </p>
                <RadioGroup
                    label="Drug and alcohol positive tests or refusals?"
                    name="drug-test-positive"
                    options={yesNoOptions}
                    value={formData['drug-test-positive']}
                    onChange={updateFormData}
                    required={true}
                />
                {drugTestPositive && (
                    <div id="drug-test-details" className="border-t border-ds-border-subtle pt-ds-4">
                        <FormField id="drug-test-explanation" label="Please explain:">
                            <Textarea
                                name="drug-test-explanation"
                                rows="3"
                                value={formData['drug-test-explanation'] || ""}
                                onChange={(e) => updateFormData(e.target.name, e.target.value)}
                            />
                        </FormField>
                    </div>
                )}
                <RadioGroup
                    label="Can you provide documentation, if requested, that confirms successful completion of the DOT return to duty process?"
                    name="dot-return-to-duty"
                    options={yesNoOptions}
                    value={formData['dot-return-to-duty']}
                    onChange={updateFormData}
                    required={true}
                />
            </FormSection>

            <FormSection title="Commercial Experience">
                <RadioGroup
                    label="Years of commercial driving experience?"
                    name="experience-years"
                    options={experienceOptions}
                    value={formData['experience-years']}
                    onChange={updateFormData}
                    required={true}
                    horizontal={false}
                />
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step2_Qualifications;
