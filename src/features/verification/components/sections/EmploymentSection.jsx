import React from 'react';
import { FormField, FormSection, Input, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { RadioGroup } from '../RadioGroup';

/** Section 1: Employment Confirmation. Presentation migrated; field names,
 *  option values, placeholders, and the conditional block are unchanged. */
export function EmploymentSection({ formData, formErrors, updateField }) {
    return (
        <FormSection
            title="Section 1: Employment Confirmation"
            description="Confirm the applicant's employment details"
        >
            <RadioGroup
                name="wasEmployed"
                legend="Was this individual employed by your company?"
                required
                value={formData.wasEmployed}
                onChange={(v) => updateField('wasEmployed', v)}
                options={[
                    { value: true, label: 'Yes' },
                    { value: false, label: 'No / No Record Found' },
                ]}
                error={formErrors.wasEmployed}
            />

            {formData.wasEmployed && (
                <Stack gap="md" className="border-l-2 border-ds-status-info-border pl-ds-4">
                    <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                        <FormField
                            id="verify-confirmed-start-date"
                            label="Confirmed Start Date"
                            required
                            error={formErrors.confirmedStartDate}
                        >
                            <Input
                                type="date"
                                required={false}
                                aria-required="true"
                                value={formData.confirmedStartDate}
                                onChange={(e) => updateField('confirmedStartDate', e.target.value)}
                            />
                        </FormField>
                        <FormField
                            id="verify-confirmed-end-date"
                            label="Confirmed End Date"
                            required
                            error={formErrors.confirmedEndDate}
                        >
                            <Input
                                type="date"
                                required={false}
                                aria-required="true"
                                value={formData.confirmedEndDate}
                                onChange={(e) => updateField('confirmedEndDate', e.target.value)}
                            />
                        </FormField>
                    </div>

                    <FormField
                        id="verify-position-held"
                        label="Position / Title Held"
                        required
                        error={formErrors.positionHeld}
                    >
                        <Input
                            type="text"
                            required={false}
                            aria-required="true"
                            value={formData.positionHeld}
                            onChange={(e) => updateField('positionHeld', e.target.value)}
                            placeholder="e.g., OTR Driver, Local Delivery Driver"
                        />
                    </FormField>

                    <FormField
                        id="verify-reason-for-leaving"
                        label="Reason for Leaving"
                        required
                        error={formErrors.reasonForLeaving}
                    >
                        <Select
                            required={false}
                            aria-required="true"
                            value={formData.reasonForLeaving}
                            onChange={(e) => updateField('reasonForLeaving', e.target.value)}
                        >
                            <option value="">Select...</option>
                            <option value="Voluntary Resignation">Voluntary Resignation</option>
                            <option value="Terminated">Terminated</option>
                            <option value="Laid Off">Laid Off</option>
                            <option value="Contract Ended">Contract Ended</option>
                            <option value="Mutual Agreement">Mutual Agreement</option>
                            <option value="Other">Other</option>
                        </Select>
                    </FormField>

                    <RadioGroup
                        name="eligibleForRehire"
                        legend="Eligible for Rehire?"
                        value={formData.eligibleForRehire}
                        onChange={(v) => updateField('eligibleForRehire', v)}
                        options={[
                            { value: true, label: 'Yes' },
                            { value: false, label: 'No' },
                        ]}
                    />
                </Stack>
            )}
        </FormSection>
    );
}

export default EmploymentSection;
