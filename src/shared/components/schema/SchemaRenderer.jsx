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
    config = {}
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
        return renderInputMode(definition, value, onChange, isRequired);
    }

    // --- DISPLAY MODE ---
    return renderDisplayMode(definition, value, onChange, isEditing);
}

/**
 * Render field in input mode (driver wizard forms)
 */
function renderInputMode(definition, value, onChange, isRequired) {
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
                    placeholder={placeholder}
                />
            );

        case FIELD_TYPES.RADIO:
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">{label}</label>
                    <div className="flex gap-4">
                        {(options || ['yes', 'no']).map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name={key}
                                    value={opt}
                                    checked={value === opt}
                                    onChange={(e) => onChange(key, e.target.value)}
                                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700 capitalize">{opt}</span>
                            </label>
                        ))}
                    </div>
                </div>
            );

        case FIELD_TYPES.TEXTAREA:
            return (
                <div>
                    <label htmlFor={key} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <textarea
                        id={key}
                        name={key}
                        rows={3}
                        required={isRequired}
                        value={value || ''}
                        onChange={(e) => onChange(key, e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={placeholder}
                    />
                </div>
            );

        case FIELD_TYPES.CHECKBOX:
            return (
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id={key}
                        name={key}
                        checked={value === true || value === 'yes'}
                        onChange={(e) => onChange(key, e.target.checked)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor={key} className="text-sm text-gray-700">{label}</label>
                </div>
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
function renderDisplayMode(definition, value, onChange, isEditing) {
    const { key, label, type, sensitive, mask, options } = definition;

    const displayValue = formatDisplayValue(value, definition);

    // Editing mode in admin panel
    if (isEditing && !definition.readOnly) {
        return (
            <div className="col-span-1">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{label}</label>
                {type === FIELD_TYPES.TEXTAREA ? (
                    <textarea
                        value={value || ''}
                        onChange={(e) => onChange(key, e.target.value)}
                        rows={3}
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                    />
                ) : type === FIELD_TYPES.RADIO ? (
                    <div className="flex gap-4">
                        {(options || ['yes', 'no']).map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
                                <input
                                    type="radio"
                                    name={key}
                                    value={opt}
                                    checked={value === opt}
                                    onChange={(e) => onChange(key, e.target.value)}
                                    className="h-4 w-4 text-blue-600"
                                />
                                <span className="capitalize">{opt}</span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <input
                        type={mapFieldType(type)}
                        value={value || ''}
                        onChange={(e) => onChange(key, e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                    />
                )}
            </div>
        );
    }

    // Read-only display
    return (
        <div className="col-span-1">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{label}</label>
            <p className="text-lg font-medium text-gray-900">{displayValue}</p>
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
function formatDisplayValue(value, definition) {
    if (value === undefined || value === null || value === '') {
        return <span className="text-gray-400 italic">-</span>;
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
        if (value.url) {
            return (
                <a href={value.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm">
                    📎 {value.name || 'View File'}
                </a>
            );
        }
        // Firestore timestamp objects
        if (value.seconds) {
            return new Date(value.seconds * 1000).toLocaleDateString();
        }
        return <span className="text-gray-400 italic">-</span>;
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(', ') : '-';
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
    className = ''
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
                        <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <p className="text-xs font-bold text-gray-400 uppercase mb-3">Entry {idx + 1}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {section.itemFields.map(field => {
                                    // Support legacy field name fallbacks for employers
                                    let val = item[field.key];
                                    if (val === undefined && section.id === 'employmentHistory') {
                                        const legacyMap = { companyName: 'name', address: 'street', reasonForLeaving: 'reason' };
                                        if (legacyMap[field.key]) val = item[legacyMap[field.key]];
                                    }
                                    const displayVal = formatDisplayValue(val, field);
                                    return (
                                        <div key={field.key} className="col-span-1">
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{field.label}</label>
                                            <p className="text-sm font-medium text-gray-900">{displayVal}</p>
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
                <p className="text-sm text-gray-400 italic mt-2">No entries provided.</p>
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
