import React from 'react';
import { FormField, FormSection, Select } from '@/design-system/components';

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
 * DEFECT FIXED (2026-09-02): the selects fell back to `'0'` and `'<6 months'`,
 * neither of which is in its option list, so the control silently displayed the
 * FIRST option ("Student / Recent Grad") while nothing was saved. An unanswered
 * select now shows a placeholder, and a stored value the current options do not
 * contain is rendered as its own option so it stays visible and unchanged.
 */
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

    return (
        <FormSection title="Experience by Vehicle Type">
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                {categories.map((category) => (
                    <React.Fragment key={category.id}>
                        <OptionSelect
                            id={kebab(category.milesField)}
                            label={`Miles Driven in ${category.label}`}
                            name={category.milesField}
                            value={formData[category.milesField]}
                            options={milesOptions}
                            onChange={handleChange}
                        />
                        <OptionSelect
                            id={kebab(category.expField)}
                            label={`Experience in ${category.label}`}
                            name={category.expField}
                            value={formData[category.expField]}
                            options={expOptions}
                            onChange={handleChange}
                        />
                    </React.Fragment>
                ))}
            </div>
        </FormSection>
    );
};

export default VehicleExperienceSection;
