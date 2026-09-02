import React, { useEffect } from 'react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { YES_NO_OPTIONS } from '@/config/form-options';
import { normalizeApplicationAnswers } from '@/config/applicationRules';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { useStepGate } from '@features/driver-app/hooks/useApplicationRules';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';
import { StepIssues } from './components/StepIssues';

/**
 * Accident history.
 *
 * Unchanged: the `accidents` row shape's original keys
 * `{ date, city, state, commercial, details, preventable }`, the yes/no defaults
 * `commercial: 'no'` / `preventable: 'no'`, the per-row scoped radio ids
 * (`accident-…-<index>`), and the VAL-1 `form.checkValidity()` gate.
 *
 * 2026-09-02 — a proper accident module. A clear Yes/No question
 * (`has-accidents`) precedes the list, and each row carries the details
 * 49 CFR 391.21(b)(7) actually asks for: fatalities, injuries and whether
 * hazardous materials were spilled (`fatalities` / `injuries` / `hazmatSpill`,
 * appended after the original keys so stored rows keep their order). They are
 * optional unless the company's `requireAccidentDetails` rule is on, in which
 * case every row must be complete before the applicant continues — and the
 * server refuses the same submission with the same wording.
 *
 * A record written before the question existed, with rows but no answer, reads
 * as Yes; an explicit No hides the list and drops leftover rows at submission.
 */
const Step5_Accidents = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const ty = new Date().getFullYear();
    const { states } = useUtils();
    const yesNoOptions = YES_NO_OPTIONS;
    const initialAccident = {
        date: '', city: '', state: '', commercial: 'no', details: '', preventable: 'no',
        fatalities: '', injuries: '', hazmatSpill: '',
    };

    const { rules, blocking, attempted, issuesRef, refuseIfBlocked } = useStepGate('accidents', formData);
    const detailsRequired = rules.requireAccidentDetails;
    const hasAccidents = formData['has-accidents'];

    useEffect(() => {
        if (hasAccidents) return;
        const derived = normalizeApplicationAnswers(formData)['has-accidents'];
        if (derived) updateFormData('has-accidents', derived);
    }, [hasAccidents, formData, updateFormData]);

    // VAL-1: Run native form validation before allowing navigation forward.
    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        if (refuseIfBlocked()) return;
        onNavigate('next');
    };

    const renderAccidentRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <DateTripletField
                label="Date of Accident"
                idPrefix={'accident-date-' + index}
                name="date"
                value={item.date}
                onChange={handleChange}
                required={true}
                maxToday={true}
                minYear={ty - 15}
                helpText="Pick month, day, year."
            />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <InputField label="City" id={'accident-city-' + index} name="city" value={item.city} onChange={handleChange} required={true} />
                <StateSelectField
                    id={'accident-state-' + index}
                    name="state"
                    states={states}
                    value={item.state}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </div>
            <RadioGroup
                label="Were you in a commercial vehicle?"
                name="commercial"
                idPrefix={'accident-commercial-' + index}
                groupName={'accident-commercial-' + index}
                options={yesNoOptions}
                value={item.commercial}
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={true}
            />
            <FormField id={'accident-details-' + index} label="Nature of the accident (what happened)" required>
                <Textarea
                    name="details"
                    rows="3"
                    value={item.details || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <InputField
                    label="Number of fatalities"
                    id={'accident-fatalities-' + index}
                    name="fatalities"
                    type="number"
                    min="0"
                    max="999"
                    value={item.fatalities}
                    onChange={handleChange}
                    required={detailsRequired}
                    placeholder="0"
                />
                <InputField
                    label="Number of injuries"
                    id={'accident-injuries-' + index}
                    name="injuries"
                    type="number"
                    min="0"
                    max="999"
                    value={item.injuries}
                    onChange={handleChange}
                    required={detailsRequired}
                    placeholder="0"
                />
            </div>
            <RadioGroup
                label="Was there a hazardous material spill?"
                name="hazmatSpill"
                idPrefix={'accident-hazmat-' + index}
                groupName={'accident-hazmat-' + index}
                options={yesNoOptions}
                value={item.hazmatSpill}
                onChange={(name, value) => handleChange(name, value)}
                required={detailsRequired}
                horizontal={true}
            />
            <RadioGroup
                label="Was this accident preventable?"
                name="preventable"
                idPrefix={'accident-preventable-' + index}
                groupName={'accident-preventable-' + index}
                options={yesNoOptions}
                value={item.preventable}
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={true}
            />
        </div>
    );

    return (
        <div id="page-5" className="form-step space-y-ds-6">
            <StepIssues ref={issuesRef} blocking={blocking} showBlocking={attempted} />

            <FormSection title="Accident History (Past 3 Years)">
                <RadioGroup
                    label="Have you been involved in any motor vehicle accidents in the past 3 years?"
                    name="has-accidents"
                    options={yesNoOptions}
                    value={hasAccidents}
                    onChange={updateFormData}
                    required={true}
                />
                {hasAccidents === 'yes' && (
                    <>
                        <p className="text-ds-sm text-ds-content-secondary">
                            List every accident you were involved in during the past 3 years.
                            {detailsRequired && ' This carrier needs the date, what happened, the number of fatalities, the number of injuries and whether hazardous materials were spilled for each one.'}
                        </p>
                        <DynamicRow
                            listKey="accidents"
                            formData={formData}
                            updateFormData={updateFormData}
                            renderRow={renderAccidentRow}
                            initialItemState={initialAccident}
                            addButtonLabel="+ Add Accident"
                        />
                    </>
                )}
                {hasAccidents === 'no' && (
                    <p className="text-ds-sm text-ds-content-muted" data-testid="no-accidents-note">No accidents will be listed on your application.</p>
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

export default Step5_Accidents;
