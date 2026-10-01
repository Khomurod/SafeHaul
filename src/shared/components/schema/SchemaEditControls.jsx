// src/shared/components/schema/SchemaEditControls.jsx
//
// How a schema `select` and `checkbox` are edited in place, by the company's two
// editors (the carrier's prep editor and the dossier's Edit Application). Both used
// to be a text box, which wrote values the driver's wizard could not show. Split out
// of `SchemaRenderer.jsx` on 2026-10-01; see that file for the rest of edit mode.
import React from 'react';
import { Checkbox, ChoiceGroup, FormField, Select } from '@design-system/components';
import { domIdSegment } from '@shared/utils/domId';
import { listValues, normalizeOption } from './schemaOptions';

/**
 * A select in edit mode: the field's own options, never free text.
 *
 * Free text is how a carrier's "TX" reached a driver's state picker, which lists
 * names and rendered it as "Alabama". A stored value the options do not hold is
 * offered as itself, so the form shows what the record says — the same rule as
 * `StateSelectField` on the driver's side.
 */
export function SchemaEditSelect({ definition, value, onChange }) {
    const { key, label, options } = definition;
    const choices = (options || []).map(normalizeOption);
    const current = value === undefined || value === null ? '' : String(value);
    const unlisted = current && !choices.some((choice) => String(choice.value) === current) ? current : null;
    return (
        <div className="col-span-1">
            <FormField id={`${key}-edit`} label={label}>
                <Select value={current} onChange={(e) => onChange(key, e.target.value)}>
                    <option value="">Select…</option>
                    {unlisted && <option value={unlisted}>{unlisted}</option>}
                    {choices.map((choice) => (
                        <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                </Select>
            </FormField>
        </div>
    );
}

/**
 * A checkbox in edit mode, in the wizard's own storage format.
 *
 * With options (endorsements) it is a group whose checked values are joined by
 * commas, exactly as `Step3_License` writes them; an entry the options do not name
 * is shown checked rather than kept invisibly. Without options it is one yes/no
 * question ("Known by other name(s)?"), stored as 'yes'/'no' like the wizard's.
 * A text box here produced values the wizard could not show — "Hazmat, tanker",
 * or a name typed into a yes/no question.
 */
export function SchemaEditCheckbox({ definition, value, onChange }) {
    const { key, label, options } = definition;
    if (!options || options.length === 0) {
        return (
            <div className="col-span-1">
                <Checkbox
                    id={`${key}-edit`}
                    name={key}
                    label={label}
                    checked={value === true || value === 'yes'}
                    onChange={(e) => onChange(key, e.target.checked ? 'yes' : 'no')}
                />
            </div>
        );
    }
    const selected = listValues(value);
    const choices = options.map(normalizeOption).map((choice) => ({ ...choice, value: String(choice.value) }));
    const named = new Set(choices.map((choice) => choice.value));
    const extras = selected.filter((item) => !named.has(item)).map((item) => ({ value: item, label: item }));
    const toggle = (choiceValue, checked) => {
        const rest = selected.filter((item) => item !== choiceValue);
        onChange(key, (checked ? [...rest, choiceValue] : rest).join(','));
    };
    return (
        <div className="col-span-1">
            <ChoiceGroup legend={label} orientation="horizontal">
                {[...choices, ...extras].map((choice) => (
                    <Checkbox
                        key={choice.value}
                        id={`${key}-edit-${domIdSegment(choice.value)}`}
                        name={key}
                        label={choice.label}
                        checked={selected.includes(choice.value)}
                        onChange={(e) => toggle(choice.value, e.target.checked)}
                    />
                ))}
            </ChoiceGroup>
        </div>
    );
}
