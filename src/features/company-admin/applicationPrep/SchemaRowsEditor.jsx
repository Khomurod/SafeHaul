import React from 'react';
import DynamicRow from '@shared/components/form/DynamicRow';
import { ChoiceGroup, FormField, Input, Radio, Select, Textarea } from '@/design-system/components';
import { US_STATE_OPTIONS } from '@/config/form-options';
import { normalizeOption } from '@shared/components/schema/schemaOptions';
import { domIdSegment } from '@shared/utils/domId';

/**
 * Rows of a repeating answer, edited field by field from the schema's row table.
 *
 * For the lists whose wizard row is written inside its step rather than as a
 * component of its own: violations, accidents and other licences. The fields,
 * their types and their options are the schema's (`itemFields`), the table the
 * dossier displays the same rows by, so each value is stored as the wizard
 * stores it: a choice as its option's value, a date as `YYYY-MM-DD`, a state by
 * its name.
 */
const INPUT_TYPES = Object.freeze({ date: 'date', month: 'month', number: 'number', tel: 'tel' });

function RowField({ field, rowId, value, onChange }) {
    const id = `${rowId}-${domIdSegment(field.key)}`;
    const options = (field.options || (field.key === 'state' ? US_STATE_OPTIONS : [])).map(normalizeOption);
    const current = value === undefined || value === null ? '' : String(value);

    if (field.type === 'radio') {
        return (
            <ChoiceGroup legend={field.label} orientation="horizontal">
                {options.map((option) => (
                    <Radio
                        key={option.value}
                        id={`${id}-${domIdSegment(option.value)}`}
                        name={id}
                        label={option.label}
                        value={option.value}
                        checked={current === String(option.value)}
                        onChange={() => onChange(field.key, option.value)}
                        requiredMark={false}
                    />
                ))}
            </ChoiceGroup>
        );
    }
    if (field.type === 'select') {
        // A stored value the options do not hold is offered as itself, so the
        // row shows what it says rather than the first option.
        const unlisted = current && !options.some((option) => String(option.value) === current) ? current : null;
        return (
            <FormField id={id} label={field.label}>
                <Select value={current} onChange={(e) => onChange(field.key, e.target.value)}>
                    <option value="">Select…</option>
                    {unlisted && <option value={unlisted}>{unlisted}</option>}
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </Select>
            </FormField>
        );
    }
    if (field.type === 'textarea') {
        return (
            <FormField id={id} label={field.label}>
                <Textarea rows={3} value={current} onChange={(e) => onChange(field.key, e.target.value)} />
            </FormField>
        );
    }
    return (
        <FormField id={id} label={field.label}>
            <Input
                type={INPUT_TYPES[field.type] || 'text'}
                value={current}
                onChange={(e) => onChange(field.key, e.target.value)}
            />
        </FormField>
    );
}

export function SchemaRowsEditor({ listKey, itemFields, formData, updateFormData, addButtonLabel, title }) {
    const initialItemState = Object.fromEntries(itemFields.map((field) => [field.key, '']));
    return (
        <DynamicRow
            listKey={listKey}
            title={title}
            formData={formData}
            updateFormData={updateFormData}
            initialItemState={initialItemState}
            addButtonLabel={addButtonLabel}
            renderRow={(index, item, handleChange) => (
                <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                    {itemFields.map((field) => (
                        <RowField
                            key={field.key}
                            field={field}
                            rowId={`${listKey}-${index}`}
                            value={item[field.key]}
                            onChange={handleChange}
                        />
                    ))}
                </div>
            )}
        />
    );
}

export default SchemaRowsEditor;
