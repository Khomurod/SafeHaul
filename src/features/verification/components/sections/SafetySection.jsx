import React from 'react';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { TEXT_ANSWER_MAX_LENGTH } from './textLimits';
import { ChoiceQuestion } from './ChoiceQuestion';
import { RETURN_TO_DUTY_OPTIONS, YES_NO_OPTIONS } from './choiceOptions';

/** Return-to-duty answers after which a follow-up testing plan applies. */
const FOLLOW_UP_ANSWERS = ['yes', 'in_progress'];

/** Section 2: Safety & Compliance (FMCSA required). Only rendered when
 *  formData.wasEmployed is truthy (the parent controls that). The questions
 *  about other accidents, the follow-up testing plan and their details are
 *  optional; Violation Details is required after a violation. */
export function SafetySection({ formData, formErrors, updateField }) {
    return (
        <FormSection
            title="Section 2: Safety & Compliance (FMCSA Required)"
            description="This information is required by federal regulation"
        >
            <ChoiceQuestion
                name="subjectToFmcsrs"
                legend="Was this driver subject to the Federal Motor Carrier Safety Regulations (FMCSRs)?"
                description="i.e., Did they operate a commercial motor vehicle (CMV) for your company?"
                options={YES_NO_OPTIONS}
                required
                formData={formData}
                formErrors={formErrors}
                updateField={updateField}
            />

            <ChoiceQuestion
                name="subjectToDotTesting"
                legend="Was this driver subject to DOT drug & alcohol testing requirements?"
                options={YES_NO_OPTIONS}
                required
                formData={formData}
                formErrors={formErrors}
                updateField={updateField}
            />

            {formData.subjectToDotTesting && (
                <Stack gap="md" className="rounded-ds-lg border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-4">
                    <ChoiceQuestion
                        name="hadDrugAlcoholViolations"
                        legend="Did this driver have any DOT drug or alcohol violations?"
                        description="Including positive tests, refusals, or other violations per 49 CFR Part 40"
                        options={YES_NO_OPTIONS}
                        required
                        formData={formData}
                        formErrors={formErrors}
                        updateField={updateField}
                    />

                    {formData.hadDrugAlcoholViolations && (
                        <Stack gap="md">
                            <FormField
                                id="verify-violation-details"
                                label="Violation Details"
                                required
                                error={formErrors.violationDetails}
                            >
                                <Textarea
                                    rows={3}
                                    required={false}
                                    aria-required="true"
                                    maxLength={TEXT_ANSWER_MAX_LENGTH}
                                    value={formData.violationDetails}
                                    onChange={(e) => updateField('violationDetails', e.target.value)}
                                    placeholder="Describe the nature of the violation(s), date(s), substance(s) involved..."
                                />
                            </FormField>
                            <ChoiceQuestion
                                name="completedReturnToDuty"
                                legend="Did the driver complete the return-to-duty process per 49 CFR Part 40, Subpart O?"
                                options={RETURN_TO_DUTY_OPTIONS}
                                formData={formData}
                                formErrors={formErrors}
                                updateField={updateField}
                            />
                            {FOLLOW_UP_ANSWERS.includes(formData.completedReturnToDuty) && (
                                <FormField
                                    id="verify-follow-up-testing-plan"
                                    label="Follow-up testing plan"
                                    description="Number and frequency of follow-up tests, how many are done and how many remain, the end date, and the SAP's name."
                                >
                                    <Textarea
                                        rows={3}
                                        maxLength={TEXT_ANSWER_MAX_LENGTH}
                                        value={formData.followUpTestingPlan}
                                        onChange={(e) => updateField('followUpTestingPlan', e.target.value)}
                                    />
                                </FormField>
                            )}
                        </Stack>
                    )}
                </Stack>
            )}

            <div className="border-t border-ds-border-subtle pt-ds-4">
                <h3 className="mb-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                    Accident History
                </h3>
                <ChoiceQuestion
                    name="hadAccidents"
                    legend="Were there any DOT-recordable accidents involving this driver in the last 3 years?"
                    description="Per 49 CFR §390.5: accidents involving fatality, bodily injury requiring medical treatment away from the scene, or disabling damage to any vehicle requiring tow-away"
                    options={YES_NO_OPTIONS}
                    required
                    formData={formData}
                    formErrors={formErrors}
                    updateField={updateField}
                />

                {formData.hadAccidents && (
                    <div className="mt-ds-4">
                        <FormField id="verify-accident-details" label="Accident Details">
                            <Textarea
                                rows={3}
                                maxLength={TEXT_ANSWER_MAX_LENGTH}
                                value={formData.accidentDetails}
                                onChange={(e) => updateField('accidentDetails', e.target.value)}
                                placeholder="For each accident, provide: Date, Location, Nature of accident, Fatalities (Y/N), Injuries (Y/N), Hazmat spill (Y/N)"
                            />
                        </FormField>
                    </div>
                )}

                <div className="mt-ds-4">
                    <ChoiceQuestion
                        name="hadNonRecordableAccidents"
                        legend="Were there any other accidents involving this driver in the last 3 years that were not DOT-recordable?"
                        description="Optional. For example, minor collisions or property damage below the DOT definition above."
                        options={YES_NO_OPTIONS}
                        formData={formData}
                        formErrors={formErrors}
                        updateField={updateField}
                    />
                </div>

                {formData.hadNonRecordableAccidents && (
                    <div className="mt-ds-4">
                        <FormField id="verify-non-recordable-accident-details" label="Other Accident Details">
                            <Textarea
                                rows={3}
                                maxLength={TEXT_ANSWER_MAX_LENGTH}
                                value={formData.nonRecordableAccidentDetails}
                                onChange={(e) => updateField('nonRecordableAccidentDetails', e.target.value)}
                                placeholder="For each accident: Date, Location, What happened"
                            />
                        </FormField>
                    </div>
                )}
            </div>
        </FormSection>
    );
}

export default SafetySection;
