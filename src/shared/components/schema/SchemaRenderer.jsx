// src/shared/components/schema/SchemaRenderer.jsx
/**
 * SchemaRenderer - Renders fields based on schema definition
 *
 * This component reads field definitions from applicationSchema.js and renders
 * the appropriate UI for both INPUT mode (driver wizard) and DISPLAY mode (admin dashboard).
 *
 * This is the key component that ensures Mirror Law compliance:
 * - One schema definition drives both input and output
 * - No more manual duplication between Step components and Section components
 */

import React from 'react';
import { APPLICATION_SCHEMA, getFieldByKey, isFieldConditionallyVisible } from '@/config/applicationSchema';
import {
    Checkbox,
    ChoiceGroup,
    FieldDisplay,
    FormField,
    Input,
    Link,
    Radio,
    Textarea,
} from '@design-system/components';
import InputField from '@shared/components/form/InputField';

// Field type constants for type checking (matches config schema string types)
const FIELD_TYPES = {
    TEXT: 'text',
    EMAIL: 'email',
    PHONE: 'tel',
    DATE: 'date',
    SELECT: 'select',
    RADIO: 'radio',
    CHECKBOX: 'checkbox',
    TEXTAREA: 'textarea',
    FILE: 'file',
    SIGNATURE: 'signature',
    ARRAY: 'array'
};


/**
 * Normalize a radio/select option to a { value, label } pair.
 * Schema options come in two shapes: plain strings (['yes', 'no']) and objects
 * ({ label: 'Yes', value: 'yes' } from form-options.js). Rendering the object
 * form directly as a React child throws "Objects are not valid as a React child"
 * (React error #31), which crashes the edit form for any yes/no field.
 */
function normalizeOption(opt) {
    if (opt && typeof opt === 'object') {
        const value = opt.value;
        return { value, label: opt.label ?? String(value) };
    }
    return { value: opt, label: String(opt) };
}

/**
 * Render a single field based on schema and mode
 *
 * @param {string} fieldKey - The key from the schema
 * @param {object} data - Current form/application data
 * @param {function} onChange - Handler for input changes (name, value)
 * @param {'input' | 'display'} mode - Render mode
 * @param {boolean} isEditing - For display mode editing
 * @param {object} config - Optional company-specific config overrides
 */
export function SchemaField({
    fieldKey,
    data,
    onChange,
    mode = 'display',
    isEditing = false,
    config = {},
    // C5: optional on-blur validation wiring. `errors` is a map keyed by field key;
    // `onBlur` is the (name, value) passthrough. Both default to no-ops so existing
    // call sites are unaffected.
    errors = {},
    onBlur,
    // Re-signed file URLs keyed by field key (display mode), so file links use a
    // fresh signed URL instead of the expired persisted one.
    fileUrls = {}
}) {
    const definition = getFieldByKey(fieldKey);

    if (!definition) {
        console.warn(`[SchemaRenderer] Unknown field key: "${fieldKey}"`);
        return null;
    }

    // Check company config for hidden fields
    if (config[fieldKey]?.hidden) {
        return null;
    }

    // Check conditional visibility
    if (!isFieldConditionallyVisible(definition, data)) {
        return null;
    }

    const value = data[fieldKey];
    const isRequired = config[fieldKey]?.required ?? definition.required;

    // --- INPUT MODE ---
    if (mode === 'input') {
        return renderInputMode(definition, value, onChange, isRequired, errors[fieldKey], onBlur);
    }

    // --- DISPLAY MODE ---
    return renderDisplayMode(definition, value, onChange, isEditing, fileUrls);
}

/**
 * Render field in input mode (driver wizard forms)
 */
function renderInputMode(definition, value, onChange, isRequired, error, onBlur) {
    const { key, label, type, placeholder, options } = definition;

    switch (type) {
        case FIELD_TYPES.TEXT:
        case FIELD_TYPES.EMAIL:
        case FIELD_TYPES.PHONE:
        case FIELD_TYPES.DATE:
            return (
                <InputField
                    label={label}
                    id={key}
                    name={key}
                    type={mapFieldType(type)}
                    required={isRequired}
                    value={value || ''}
                    onChange={onChange}
                    onBlur={onBlur}
                    error={error}
                    placeholder={placeholder}
                />
            );

        case FIELD_TYPES.RADIO:
            return (
                /*
                 * A real fieldset/legend through `ChoiceGroup`, so the question is
                 * announced once rather than repeated inside every option label.
                 * The previous markup was a bare `<label>` above loose radios: the
                 * group had no accessible name at all, so a screen-reader user
                 * heard "yes radio, no radio" with no idea what was being asked.
                 */
                <ChoiceGroup legend={label} orientation="horizontal" error={error}>
                    {(options || ['yes', 'no']).map(normalizeOption).map(opt => (
                        <Radio
                            key={opt.value}
                            name={key}
                            id={`${key}-${opt.value}`}
                            label={opt.label}
                            value={opt.value}
                            checked={value === opt.value}
                            onChange={(e) => onChange(key, e.target.value)}
                            requiredMark={false}
                        />
                    ))}
                </ChoiceGroup>
            );

        case FIELD_TYPES.TEXTAREA:
            return (
                <FormField id={key} label={label} required={isRequired} error={error}>
                    <Textarea
                        name={key}
                        rows={3}
                        required={isRequired}
                        value={value || ''}
                        onChange={(e) => onChange(key, e.target.value)}
                        onBlur={onBlur ? (e) => onBlur(key, e.target.value) : undefined}
                        placeholder={placeholder}
                    />
                </FormField>
            );

        case FIELD_TYPES.CHECKBOX:
            return (
                <Checkbox
                    id={key}
                    name={key}
                    label={label}
                    checked={value === true || value === 'yes'}
                    onChange={(e) => onChange(key, e.target.checked)}
                />
            );

        default:
            return (
                <InputField
                    label={label}
                    name={key}
                    value={value || ''}
                    onChange={onChange}
                />
            );
    }
}

/**
 * Render field in display mode (admin dashboard sections)
 */
function renderDisplayMode(definition, value, onChange, isEditing, fileUrls = {}) {
    const { key, label, type, sensitive, mask, options } = definition;

    const displayValue = formatDisplayValue(value, definition, fileUrls);

    // Editing mode in admin panel
    if (isEditing && !definition.readOnly) {
        /*
         * The admin edit surface. Every control here was previously unlabelled —
         * a `<label>` with no `htmlFor` above a control with no `id`, so nothing
         * connected them and each field announced as an anonymous textbox. The
         * approved primitives own that wiring, so the fix comes with the
         * migration rather than being a separate pass.
         */
        if (type === FIELD_TYPES.RADIO) {
            return (
                <div className="col-span-1">
                    <ChoiceGroup legend={label} orientation="horizontal">
                        {(options || ['yes', 'no']).map(normalizeOption).map(opt => (
                            <Radio
                                key={opt.value}
                                name={key}
                                id={`${key}-edit-${opt.value}`}
                                label={opt.label}
                                value={opt.value}
                                checked={value === opt.value}
                                onChange={(e) => onChange(key, e.target.value)}
                                requiredMark={false}
                            />
                        ))}
                    </ChoiceGroup>
                </div>
            );
        }

        return (
            <div className="col-span-1">
                <FormField id={`${key}-edit`} label={label}>
                    {type === FIELD_TYPES.TEXTAREA ? (
                        <Textarea
                            rows={3}
                            value={value || ''}
                            onChange={(e) => onChange(key, e.target.value)}
                        />
                    ) : (
                        <Input
                            type={mapFieldType(type)}
                            value={value || ''}
                            onChange={(e) => onChange(key, e.target.value)}
                        />
                    )}
                </FormField>
            </div>
        );
    }

    // Read-only display.
    return (
        <div className="col-span-1">
            <FieldDisplay label={label} emphasis="strong">{displayValue}</FieldDisplay>
        </div>
    );
}

/**
 * Map schema field types to HTML input types
 */
function mapFieldType(schemaType) {
    const map = {
        [FIELD_TYPES.TEXT]: 'text',
        [FIELD_TYPES.EMAIL]: 'email',
        [FIELD_TYPES.PHONE]: 'tel',
        [FIELD_TYPES.DATE]: 'date'
    };
    return map[schemaType] || 'text';
}

/**
 * Format a value for display, handling sensitive data and empty values
 */
function formatDisplayValue(value, definition, fileUrls = {}) {
    if (value === undefined || value === null || value === '') {
        return <span className="italic text-ds-content-muted">-</span>;
    }

    // Handle sensitive data masking
    if (definition.sensitive && definition.mask) {
        const strValue = String(value);
        if (definition.mask.includes('{last4}')) {
            return '***-**-' + strValue.slice(-4);
        }
        return definition.mask;
    }

    // Handle file objects (AF4 fix)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Prefer the freshly re-signed URL (useAppFetch -> fileUrls keyed by field)
        // over the persisted value.url, which is a short-lived signed URL that has
        // expired by dossier-view time (CDL "ExpiredToken" bug).
        const resolvedHref = (definition?.key && fileUrls[definition.key]) || value.url;
        if (resolvedHref) {
            return (
                /*
                 * `external` rather than a hand-written `target="_blank"`: this
                 * opened a new tab with no announcement, so a screen-reader user
                 * lost the page with no warning. `Link` adds the hint and the
                 * `rel` that closes the reverse-tabnabbing hole.
                 */
                <Link href={resolvedHref} external>
                    📎 {value.name || 'View File'}
                </Link>
            );
        }
        // Firestore timestamp objects
        if (value.seconds) {
            return new Date(value.seconds * 1000).toLocaleDateString();
        }
        return <span className="italic text-ds-content-muted">-</span>;
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(', ') : '-';
    }

    // Inline image data URLs (e.g. signature / initials) — render the image,
    // not the raw base64 string (which otherwise looks like a "token").
    if (typeof value === 'string' && value.startsWith('data:image')) {
        return (
            <img
                src={value}
                alt={definition?.label || 'Signature'}
                className="max-h-20 w-auto rounded-ds-sm border border-ds-border-subtle bg-ds-surface-subtle p-ds-1"
            />
        );
    }

    // Handle booleans / yes/no
    if (value === true || value === 'yes') return 'Yes';
    if (value === false || value === 'no') return 'No';

    return String(value);
}

// Mapping of section IDs to the data keys that hold the array items
const ARRAY_DATA_KEYS = {
    'employmentHistory': 'employers',
    'previousAddresses': 'previousAddresses',
    'additionalLicenses': 'additionalLicenses',
    'violations': 'violations',
    'accidents': 'accidents',
};

/**
 * Render a complete section based on schema
 * Used for admin display sections that want to auto-render all fields
 */
export function SchemaSection({
    sectionId,
    data,
    isEditing = false,
    onChange,
    config = {},
    className = '',
    // Re-signed file URLs keyed by field key, so file links (CDL etc.) use a
    // fresh signed URL instead of the expired persisted one.
    fileUrls = {}
}) {
    // Find section directly from APPLICATION_SCHEMA
    const section = APPLICATION_SCHEMA.sections.find(s => s.id === sectionId);

    if (!section) {
        console.warn(`[SchemaSection] Unknown section: "${sectionId}"`);
        return null;
    }

    // Render regular fields (if any)
    const regularFields = (section.fields || []).map(field => (
        <SchemaField
            key={field.key}
            fieldKey={field.key}
            data={data}
            onChange={onChange}
            mode="display"
            isEditing={isEditing}
            config={config}
            fileUrls={fileUrls}
        />
    ));

    // AF3 fix: Render array items if this section has type: 'array' and itemFields
    let arrayContent = null;
    if (section.type === 'array' && section.itemFields) {
        const dataKey = ARRAY_DATA_KEYS[section.id] || section.id;
        const items = data[dataKey];
        const itemArray = Array.isArray(items) ? items : [];

        if (itemArray.length > 0) {
            arrayContent = (
                <div className="space-y-4 mt-4">
                    {itemArray.map((item, idx) => (
                        <div key={idx} className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                            <p className="mb-ds-3 text-ds-xs font-bold uppercase text-ds-content-muted">Entry {idx + 1}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {section.itemFields.map(field => {
                                    // Support legacy field name fallbacks for employers
                                    let val = item[field.key];
                                    if (val === undefined && section.id === 'employmentHistory') {
                                        const legacyMap = { companyName: 'name', address: 'street', reasonForLeaving: 'reason' };
                                        if (legacyMap[field.key]) val = item[legacyMap[field.key]];
                                    }
                                    const displayVal = formatDisplayValue(val, field, fileUrls);
                                    return (
                                        <div key={field.key} className="col-span-1">
                                            <FieldDisplay label={field.label}>{displayVal}</FieldDisplay>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            );
        } else {
            arrayContent = (
                <p className="mt-ds-2 text-ds-sm italic text-ds-content-muted">No entries provided.</p>
            );
        }
    }

    return (
        <div className={className}>
            {regularFields.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {regularFields}
                </div>
            )}
            {arrayContent}
        </div>
    );
}

export default SchemaField;
