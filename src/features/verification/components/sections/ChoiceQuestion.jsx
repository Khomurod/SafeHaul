import React from 'react';
import { ChoiceGroup, Radio } from '@/design-system/components';

/**
 * One choice question of the portal: the design system's `ChoiceGroup` with one
 * `Radio` per option, in a row. `name` is both the radios' group and the answer's
 * field. What is saved is the option's own `value` (`choiceOptions.js`), passed
 * straight to `updateField`; its string form is only the radio's DOM value. A
 * required question shows its error from `formErrors` and marks its radios
 * `aria-required`, never the native `required`, so the form's own validation runs.
 */
export function ChoiceQuestion({ name, legend, description, options, required = false, formData, formErrors, updateField }) {
    return (
        <ChoiceGroup
            legend={legend}
            description={description}
            required={required}
            orientation="horizontal"
            error={required ? formErrors?.[name] : undefined}
        >
            {options.map((opt) => (
                <Radio
                    key={String(opt.value)}
                    name={name}
                    value={String(opt.value)}
                    label={opt.label}
                    checked={formData[name] === opt.value}
                    onChange={() => updateField(name, opt.value)}
                    aria-required={required ? 'true' : undefined}
                />
            ))}
        </ChoiceGroup>
    );
}

export default ChoiceQuestion;
