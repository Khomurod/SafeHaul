import React from 'react';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { RadioGroup } from '../RadioGroup';

/** Section 2: Safety & Compliance (FMCSA required). Only rendered when
 *  formData.wasEmployed is truthy (the parent controls that). Field names,
 *  option values, conditionals, and messages are unchanged. */
export function SafetySection({ formData, formErrors, updateField }) {
    return (
        <FormSection
            title="Section 2: Safety & Compliance (FMCSA Required)"
            description="This information is required by federal regulation"
        >
            <RadioGroup
                name="subjectToFmcsrs"
                legend="Was this driver subject to the Federal Motor Carrier Safety Regulations (FMCSRs)?"
                description="i.e., Did they operate a commercial motor vehicle (CMV) for your company?"
                required
                value={formData.subjectToFmcsrs}
                onChange={(v) => updateField('subjectToFmcsrs', v)}
                options={[
                    { value: true, label: 'Yes' },
                    { value: false, label: 'No' },
                ]}
                error={formErrors.subjectToFmcsrs}
            />

            <RadioGroup
                name="subjectToDotTesting"
                legend="Was this driver subject to DOT drug & alcohol testing requirements?"
                required
                value={formData.subjectToDotTesting}
                onChange={(v) => updateField('subjectToDotTesting', v)}
                options={[
                    { value: true, label: 'Yes' },
                    { value: false, label: 'No' },
                ]}
                error={formErrors.subjectToDotTesting}
            />

            {formData.subjectToDotTesting && (
                <Stack gap="md" className="rounded-ds-lg border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-4">
                    <RadioGroup
                        name="hadDrugAlcoholViolations"
                        legend="Did this driver have any DOT drug or alcohol violations?"
                        description="Including positive tests, refusals, or other violations per 49 CFR Part 40"
                        required
                        value={formData.hadDrugAlcoholViolations}
                        onChange={(v) => updateField('hadDrugAlcoholViolations', v)}
                        options={[
                            { value: true, label: 'Yes' },
                            { value: false, label: 'No' },
                        ]}
                        error={formErrors.hadDrugAlcoholViolations}
                    />

                    {formData.hadDrugAlcoholViolations && (
                        <Stack gap="md">
                            <FormField id="verify-violation-details" label="Violation Details" required>
                                <Textarea
                                    rows={3}
                                    required={false}
                                    aria-required="true"
                                    value={formData.violationDetails}
                                    onChange={(e) => updateField('violationDetails', e.target.value)}
                                    placeholder="Describe the nature of the violation(s), date(s), substance(s) involved..."
                                />
                            </FormField>
                            <RadioGroup
                                name="completedReturnToDuty"
                                legend="Did the driver complete the return-to-duty process per 49 CFR Part 40, Subpart O?"
                                value={formData.completedReturnToDuty}
                                onChange={(v) => updateField('completedReturnToDuty', v)}
                                options={[
                                    { value: 'yes', label: 'Yes' },
                                    { value: 'no', label: 'No' },
                                    { value: 'in_progress', label: 'In Progress' },
                                ]}
                            />
                        </Stack>
                    )}
                </Stack>
            )}

            <div className="border-t border-ds-border-subtle pt-ds-4">
                <h3 className="mb-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                    Accident History
                </h3>
                <RadioGroup
                    name="hadAccidents"
                    legend="Were there any DOT-recordable accidents involving this driver in the last 3 years?"
                    description="Per 49 CFR §390.5: accidents involving fatality, bodily injury requiring medical treatment away from the scene, or disabling damage to any vehicle requiring tow-away"
                    required
                    value={formData.hadAccidents}
                    onChange={(v) => updateField('hadAccidents', v)}
                    options={[
                        { value: true, label: 'Yes' },
                        { value: false, label: 'No' },
                    ]}
                    error={formErrors.hadAccidents}
                />

                {formData.hadAccidents && (
                    <div className="mt-ds-4">
                        <FormField id="verify-accident-details" label="Accident Details">
                            <Textarea
                                rows={3}
                                value={formData.accidentDetails}
                                onChange={(e) => updateField('accidentDetails', e.target.value)}
                                placeholder="For each accident, provide: Date, Location, Nature of accident, Fatalities (Y/N), Injuries (Y/N), Hazmat spill (Y/N)"
                            />
                        </FormField>
                    </div>
                )}
            </div>
        </FormSection>
    );
}

export default SafetySection;
