import React from 'react';
import { FormField, Select } from '@/design-system/components';

/**
 * Labelled US-state picker used by six places in the public application
 * (current address, previous addresses, additional licenses, accidents,
 * employers, and owner-operator business address).
 *
 * Feature-owned composition of the approved `FormField` + `Select`: the design
 * system owns the control, this owns the "Select State" placeholder and the
 * allow-list coming from `useUtils().states`.
 *
 * Declared at module scope on purpose — a component defined inside a step body
 * would be a new element type on every render and remount the select, dropping
 * focus while the applicant is typing elsewhere on the step.
 *
 * The element `id` is a frozen contract (`#state`, `#cdl-state`,
 * `#prev-state-<n>`, `#accident-state-<n>`, `#emp-state-<n>`,
 * `#add-lic-state-<n>`, `#business-state`); `e2e/helpers/wizardHelpers.cjs`
 * selects `#state` and `#cdl-state` directly.
 */
export function StateSelectField({
    id,
    name,
    value,
    onChange,
    states,
    label = 'State',
    required = true,
}) {
    return (
        <FormField id={id} label={label} required={required}>
            <Select name={name} value={value || ''} onChange={onChange}>
                <option value="" disabled>Select State</option>
                {states.map((state) => <option key={state} value={state}>{state}</option>)}
            </Select>
        </FormField>
    );
}

export default StateSelectField;
