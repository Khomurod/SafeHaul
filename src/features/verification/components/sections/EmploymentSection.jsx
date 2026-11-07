import React from 'react';
import { ChoiceGroup, FormField, FormSection, Input, Radio, Select, Textarea } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { TEXT_ANSWER_MAX_LENGTH } from './textLimits';
import { NO_RECORD_OPTIONS, YES_NO_OPTIONS } from './choiceOptions';

/** Section 1: Employment Confirmation. After "No" to rehire the employer may
 *  say why; the explanation is optional. */
export function EmploymentSection({ formData, formErrors, updateField }) {
    return (
        <FormSection
            title="Section 1: Employment Confirmation"
            description="Confirm the applicant's employment details"
        >
            <ChoiceGroup
                legend="Was this individual employed by your company?"
                required
                orientation="horizontal"
                error={formErrors.wasEmployed}
            >
                {NO_RECORD_OPTIONS.map((opt) => (
                    <Radio
                        key={String(opt.value)}
                        name="wasEmployed"
                        value={String(opt.value)}
                        label={opt.label}
                        checked={formData.wasEmployed === opt.value}
                        onChange={() => updateField('wasEmployed', opt.value)}
                        aria-required="true"
                    />
                ))}
            </ChoiceGroup>

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

                    <ChoiceGroup legend="Eligible for Rehire?" orientation="horizontal">
                        {YES_NO_OPTIONS.map((opt) => (
                            <Radio
                                key={String(opt.value)}
                                name="eligibleForRehire"
                                value={String(opt.value)}
                                label={opt.label}
                                checked={formData.eligibleForRehire === opt.value}
                                onChange={() => updateField('eligibleForRehire', opt.value)}
                            />
                        ))}
                    </ChoiceGroup>
                    {formData.eligibleForRehire === false && (
                        <FormField id="verify-rehire-explanation" label="Please explain (optional)">
                            <Textarea
                                rows={3}
                                maxLength={TEXT_ANSWER_MAX_LENGTH}
                                value={formData.rehireExplanation}
                                onChange={(e) => updateField('rehireExplanation', e.target.value)}
                            />
                        </FormField>
                    )}
                </Stack>
            )}
        </FormSection>
    );
}

export default EmploymentSection;
