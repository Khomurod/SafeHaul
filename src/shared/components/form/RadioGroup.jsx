import React from 'react';
import { ChoiceGroup, Radio } from '@/design-system/components';

/**
 * Compatibility adapter over the approved `ChoiceGroup` / `Radio` primitives.
 *
 * Frozen contracts (asserted by `e2e/public-application.spec.cjs`,
 * `e2e/helpers/wizardHelpers.cjs` and the verification/driver-application unit
 * tests):
 *
 * - Each option's element id is `${name}-${option.value}` — for example
 *   `consent-mvr-yes`, `has-twic-no`, `experience-years-1`. The specs click
 *   `label[for="…"]`, so these ids and their label association must not change.
 *   `idPrefix` overrides the id base *without* touching the payload key.
 * - `onChange(name, value)` is always called with the field `name`, never with
 *   the id base or the grouping name, so saved payload keys are unchanged.
 * - `horizontal` defaults to `true`.
 *
 * DEFECT FIXED (2026-07-27): inside `DynamicRow` the same `name` was reused for
 * every row, so every row emitted the *same* element ids and the same radio
 * grouping name. `label[for="commercial-yes"]` then resolved to row 1's input,
 * which meant clicking row 2's "Yes" toggled row 1 — and the browser treated all
 * rows as one radio group. Callers inside a repeating row now pass a
 * row-unique `idPrefix` / `groupName`; both default to `name`, so every
 * single-instance call site keeps its existing ids byte-for-byte.
 */
const RadioGroup = ({
    label,
    name,
    options,
    value,
    onChange,
    required = false,
    horizontal = true,
    idPrefix,
    groupName,
    error,
}) => {
    // Payload key stays `name`; only the DOM id base and the browser's grouping
    // name may be scoped by the caller.
    const optionIdBase = idPrefix || name;
    const radioName = groupName || name;

    const handleChange = (e) => {
        onChange(name, e.target.value);
    };

    return (
        <ChoiceGroup
            legend={label}
            required={required}
            error={error}
            orientation={horizontal ? 'horizontal' : 'vertical'}
        >
            {options.map((option) => (
                <Radio
                    key={option.value}
                    id={`${optionIdBase}-${option.value}`}
                    name={radioName}
                    value={option.value}
                    label={option.label}
                    checked={value === option.value}
                    onChange={handleChange}
                    required={required}
                    requiredMark={false}
                />
            ))}
        </ChoiceGroup>
    );
};

export default RadioGroup;
