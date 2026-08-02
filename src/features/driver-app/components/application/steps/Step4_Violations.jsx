import React from 'react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { YES_NO_OPTIONS } from '@/config/form-options';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives (2026-07-27).
 *
 * Unchanged: the `consent-mvr` / `revoked-licenses` / `driving-convictions` /
 * `drug-alcohol-convictions` field keys and their frozen FMCSA question wording,
 * the exact MVR consent copy, the three conditional required explanations, the
 * `violations` row shape, and the `form.checkValidity()` gate.
 *
 * `consent-mvr-yes`, `revoked-licenses-no`, `driving-convictions-no` and
 * `drug-alcohol-convictions-no` are element ids the guest E2E specs click via
 * `label[for=…]`; the shared `RadioGroup` adapter keeps generating them.
 */
const Step4_Violations = ({ formData, updateFormData, onNavigate }) => {
    const yesNoOptions = YES_NO_OPTIONS;
    const ty = new Date().getFullYear();
    const initialViolation = { date: '', charge: '', location: '', penalty: '' };

    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form) {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
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
            {/* The full-width span belongs on the grid item, not on the <input>
                inside it — the previous `className="sm:col-span-2"` landed on the
                input and therefore did nothing. */}
            <div className="sm:col-span-2">
                <InputField
                    label="Location (City, State)"
                    id={'violation-location-' + index}
                    name="location"
                    value={item.location}
                    onChange={handleChange}
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
        <FormField
            id={id}
            label="Please provide details (date, location, circumstances):"
            required
        >
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
            <FormSection title="Consent & Revocations">
                <div className="space-y-ds-2">
                    {/* Was a bare `<label>` with no control, so assistive tech
                        announced a label pointing at nothing. Same copy, now a
                        real sub-heading under the section's `<h2>`. */}
                    <h3 className="text-ds-sm font-semibold text-ds-content">Motor Vehicle Record (MVR) Check</h3>
                    <p className="text-ds-sm text-ds-content-secondary">This is required for employment. We will pull your driving record from all states where you have held a license in the past 3 years.</p>
                    <RadioGroup
                        label="I Consent to MVR Check"
                        name="consent-mvr"
                        options={yesNoOptions}
                        value={formData['consent-mvr']}
                        onChange={updateFormData}
                        required={true}
                    />
                </div>

                <RadioGroup
                    label="Has any license, permit or privilege ever been denied, suspended, or revoked for any reason?"
                    name="revoked-licenses"
                    options={yesNoOptions}
                    value={formData['revoked-licenses']}
                    onChange={updateFormData}
                    required={true}
                />
                {formData['revoked-licenses'] === 'yes' && (
                    <ConditionalExplanation
                        id="revocation-explanation"
                        name="revocationExplanation"
                        value={formData.revocationExplanation}
                    />
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
                    <ConditionalExplanation
                        id="conviction-explanation"
                        name="convictionExplanation"
                        value={formData.convictionExplanation}
                    />
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
                    <ConditionalExplanation
                        id="drug-conviction-explanation"
                        name="drugConvictionExplanation"
                        value={formData.drugConvictionExplanation}
                    />
                )}

                {/* REMOVED: Upload Signed MVR Consent Form section */}
            </FormSection>

            <FormSection title="Moving Violations (Past 3 Years)">
                <p className="text-ds-sm text-ds-content-secondary">Please list all moving violations or traffic convictions within the past 3 years (whether in a personal or commercial vehicle).</p>
                <DynamicRow
                    listKey="violations"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderViolationRow}
                    initialItemState={initialViolation}
                    addButtonLabel="+ Add Violation"
                />
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step4_Violations;
