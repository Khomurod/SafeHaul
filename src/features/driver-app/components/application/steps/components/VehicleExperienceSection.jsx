import React from 'react';
import { Checkbox, FormField, FormSection, Select } from '@/design-system/components';
import { NO_EXPERIENCE } from '@/config/form-options';

/**
 * Paired miles/experience dropdowns, one pair per vehicle category the company
 * shows. Presentation uses the approved `FormSection` / `FormField` / `Select`
 * primitives.
 *
 * The categories, their wording and which of them are shown come from the
 * company's Application Rules (`visibleVehicleCategories`). The saved KEYS
 * (`expStraightTruckMiles`, …) and element ids (`exp-straight-truck-miles`, …)
 * never change, whatever the wording — a company renaming "Tractor + Semi
 * Trailer" cannot corrupt an answer stored under the old name.
 *
 * An unanswered select shows a placeholder, never a fallback value outside its
 * option list, which the control would silently display as its FIRST option
 * while nothing was saved. A stored value the current options do not contain is
 * rendered as its own option so it stays visible and unchanged.
 *
 * "None" comes first in every list, so a driver without that experience says so
 * instead of leaving the field blank, which reads as "not answered" on the
 * review, the record and the PDF. The "None" box above the lists answers every
 * shown field with it at once; it is ticked exactly when they all say "None",
 * so choosing a real value anywhere unticks it, and unticking clears them.
 */
const NONE_OPTION = { label: 'None', value: NO_EXPERIENCE };
const kebab = (fieldName) => fieldName.replace(/([A-Z])/g, '-$1').toLowerCase();

function OptionSelect({ id, label, name, value, options, onChange }) {
    const stored = value || '';
    const known = options.some((option) => option.value === stored);
    return (
        <FormField id={id} label={label}>
            <Select name={name} value={stored} onChange={onChange}>
                <option value="">Select…</option>
                {stored && !known && <option value={stored}>{stored}</option>}
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
        </FormField>
    );
}

const VehicleExperienceSection = ({ formData, updateFormData, milesOptions, expOptions, categories }) => {
    const handleChange = (e) => updateFormData(e.target.name, e.target.value);
    if (!categories || categories.length === 0) return null;

    const fields = categories.flatMap((category) => [category.milesField, category.expField]);
    const noExperience = fields.every((field) => formData[field] === NO_EXPERIENCE);
    const answerNone = (e) => {
        for (const field of fields) updateFormData(field, e.target.checked ? NO_EXPERIENCE : '');
    };
    const milesChoices = [NONE_OPTION, ...milesOptions];
    const expChoices = [NONE_OPTION, ...expOptions];

    return (
        <FormSection title="Experience by Vehicle Type">
            <Checkbox
                id="no-vehicle-experience"
                name="no-vehicle-experience"
                label="None — I have not driven any of these vehicle types"
                checked={noExperience}
                onChange={answerNone}
            />
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                {categories.map((category) => (
                    <React.Fragment key={category.id}>
                        <OptionSelect
                            id={kebab(category.milesField)}
                            label={`Miles Driven in ${category.label}`}
                            name={category.milesField}
                            value={formData[category.milesField]}
                            options={milesChoices}
                            onChange={handleChange}
                        />
                        <OptionSelect
                            id={kebab(category.expField)}
                            label={`Experience in ${category.label}`}
                            name={category.expField}
                            value={formData[category.expField]}
                            options={expChoices}
                            onChange={handleChange}
                        />
                    </React.Fragment>
                ))}
            </div>
        </FormSection>
    );
};

export default VehicleExperienceSection;
