import React from 'react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives (2026-07-27).
 *
 * Unchanged: the `accidents` row shape
 * `{ date, city, state, commercial, details, preventable }`, the yes/no defaults
 * `commercial: 'no'` / `preventable: 'no'`, every required flag, and the VAL-1
 * `form.checkValidity()` gate.
 *
 * DEFECT FIXED (2026-07-27): both per-row radio groups used the bare field name,
 * so every accident row rendered ids `commercial-yes` / `preventable-yes`. Ids
 * must be unique — `label[for="commercial-yes"]` resolved to row 1, so clicking
 * row 2's "Yes" toggled row 1, and the browser treated all rows as one radio
 * group. Each row now scopes its ids and grouping name with `accident-…-<index>`
 * while `name` (the saved key) stays `commercial` / `preventable`.
 */
const Step5_Accidents = ({ formData, updateFormData, onNavigate }) => {
    const ty = new Date().getFullYear();
    const { states } = useUtils();
    const yesNoOptions = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
    const initialAccident = { date: '', city: '', state: '', commercial: 'no', details: '', preventable: 'no' };

    // VAL-1: Run native form validation before allowing navigation forward.
    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
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
                <InputField
                    label="City"
                    id={'accident-city-' + index}
                    name="city"
                    value={item.city}
                    onChange={handleChange}
                    required={true}
                />
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
            <FormField id={'accident-details-' + index} label="Accident details" required>
                <Textarea
                    name="details"
                    rows="3"
                    value={item.details || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
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
            <FormSection title="Accident History (Past 3 Years)">
                <p className="text-ds-sm text-ds-content-secondary">Please list all motor vehicle accidents in which you were involved in the past 3 years.</p>
                <DynamicRow
                    listKey="accidents"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderAccidentRow}
                    initialItemState={initialAccident}
                    addButtonLabel="+ Add Accident"
                />
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step5_Accidents;
