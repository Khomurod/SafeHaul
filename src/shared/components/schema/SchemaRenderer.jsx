// src/shared/components/schema/SchemaRenderer.jsx
/**
 * SchemaRenderer - Renders fields based on schema definition
 *
 * This component reads field definitions from applicationSchema.js and shows
 * them on the company side: read-only, or edited in place where a screen allows
 * it (the dossier's Application tab, the carrier's preparation editor).
 */

import React from 'react';
import { APPLICATION_SCHEMA, getFieldByKey, isFieldConditionallyVisible } from '@/config/applicationSchema';
import {
    ChoiceGroup,
    FieldDisplay,
    FormField,
    Input,
    Link,
    Radio,
    Textarea,
} from '@design-system/components';
import { domIdSegment } from '@shared/utils/domId';
import { isEditableInPlace, normalizeOption } from './schemaOptions';
import { SchemaEditCheckbox, SchemaEditSelect } from './SchemaEditControls';

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
 * Render a single field based on schema
 *
 * @param {string} fieldKey - The key from the schema
 * @param {object} data - Current form/application data
 * @param {function} onChange - Handler for edits (name, value)
 * @param {boolean} isEditing - Whether the field is edited in place
 * @param {object} config - Optional company-specific config overrides
 */
export function SchemaField({
    fieldKey,
    data,
    onChange,
    isEditing = false,
    config = {},
    // Re-signed file URLs keyed by field key, so file links use a
    // fresh signed URL instead of the expired persisted one.
    fileUrls = {},
    // True while those URLs are still being signed.
    filesPending = false
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

    return renderDisplayMode(definition, data[fieldKey], onChange, isEditing, fileUrls, filesPending);
}

/**
 * Render field in display mode (admin dashboard sections)
 */
function renderDisplayMode(definition, value, onChange, isEditing, fileUrls = {}, filesPending = false) {
    const { key, label, type, options } = definition;

    const displayValue = formatDisplayValue(value, definition, fileUrls, filesPending);

    // Editing mode in admin panel
    if (isEditing && !definition.readOnly && isEditableInPlace(type)) {
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
                                id={`${key}-edit-${domIdSegment(opt.value)}`}
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

        // Never a text box: see `SchemaEditControls.jsx` for what free text wrote.
        if (type === FIELD_TYPES.SELECT) {
            return <SchemaEditSelect definition={definition} value={value} onChange={onChange} />;
        }
        if (type === FIELD_TYPES.CHECKBOX) {
            return <SchemaEditCheckbox definition={definition} value={value} onChange={onChange} />;
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
function formatDisplayValue(value, definition, fileUrls = {}, filesPending = false) {
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
        const freshHref = definition?.key && fileUrls[definition.key];
        // While the dossier signs its files, an upload's stored link has already
        // expired: its name stands in until the fresh one arrives.
        if (!freshHref && filesPending && value.storagePath) {
            return (
                <span>
                    📎 {value.name || 'File'} <span className="text-ds-content-muted">(preparing link…)</span>
                </span>
            );
        }
        const resolvedHref = freshHref || value.url;
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
    // Field keys that stay read-only even while the section is editing. A caller
    // uses this for a value that identifies the record and must not change once it
    // exists — e.g. the email and phone that key a carrier-prepared draft, which
    // would strand an already-sent invite link if re-keyed. Empty by default, so
    // every existing call site is unaffected.
    lockedKeys = [],
    // Re-signed file URLs keyed by field key, so file links (CDL etc.) use a
    // fresh signed URL instead of the expired persisted one.
    fileUrls = {},
    // True while those URLs are still being signed.
    filesPending = false
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
            // A locked key renders read-only even while the rest of the section
            // edits — `SchemaField` already shows a value read-only when not
            // editing, so this needs no new field mode.
            isEditing={isEditing && !lockedKeys.includes(field.key)}
            config={config}
            fileUrls={fileUrls}
            filesPending={filesPending}
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
                                    const displayVal = formatDisplayValue(val, field, fileUrls, filesPending);
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
