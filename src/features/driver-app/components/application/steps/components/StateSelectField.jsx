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
 *
 * A stored value that is not in the list is shown AS ITSELF. Without that option
 * the browser shows the first one it can, so a "TX" from a CDL auto-fill or a
 * carrier's typing rendered as "Alabama" while the form still held "TX", and the
 * required check passed because the field was not empty (found 2026-10-01). The
 * writers now normalise to listed names (`toUsStateName`); this is what keeps a
 * value they could not normalise, or one saved before they did, honest on screen.
 *
 * `autoComplete` has no default: only the applicant's own current address passes
 * `address-level1`. A built-in token would let the browser put that state into
 * every employer, accident and licence row too.
 *
 * `error` goes to `FormField`, which marks the select invalid and says why.
 *
 * `groups` replaces `states` with labelled lists, `[{ label, options }]`: the
 * employer rows offer Canada's and Mexico's regions after the US states
 * (`northAmericanRegions.js`).
 */
export function StateSelectField({
    id,
    name,
    value,
    onChange,
    states,
    groups,
    label = 'State',
    placeholder = 'Select State',
    required = true,
    autoComplete,
    error,
}) {
    const listed = groups ? groups.flatMap((group) => group.options) : states;
    const unlisted = typeof value === 'string' && value && !listed.includes(value) ? value : null;
    const optionsOf = (names) => names.map((state) => <option key={state} value={state}>{state}</option>);
    return (
        <FormField id={id} label={label} required={required} error={error}>
            <Select name={name} value={value || ''} onChange={onChange} autoComplete={autoComplete}>
                <option value="" disabled>{placeholder}</option>
                {unlisted && <option value={unlisted}>{unlisted}</option>}
                {groups
                    ? groups.map((group) => <optgroup key={group.label} label={group.label}>{optionsOf(group.options)}</optgroup>)
                    : optionsOf(states)}
            </Select>
        </FormField>
    );
}

export default StateSelectField;
