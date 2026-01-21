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
import { getFieldDefinition, isFieldVisible, FIELD_TYPES } from '@lib/applicationSchema';
import InputField from '@shared/components/form/InputField';

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
    const definition = getFieldDefinition(fieldKey);

    if (!definition) {
        console.warn(`[SchemaRenderer] Unknown field key: "${fieldKey}"`);
        return null;
    }

    // Check company config for hidden fields
    if (config[fieldKey]?.hidden) {
        return null;
    }

    // Check conditional visibility
    if (!isFieldVisible(definition, data)) {
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

    // Handle arrays
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(', ') : '-';
    }

    // Handle booleans / yes/no
    if (value === true || value === 'yes') return 'Yes';
    if (value === false || value === 'no') return 'No';

    return String(value);
}

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
    const { getSection } = require('@lib/applicationSchema');
    const section = getSection(sectionId);

    if (!section) {
        console.warn(`[SchemaSection] Unknown section: "${sectionId}"`);
        return null;
    }

    return (
        <div className={className}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {section.fields.map(field => (
                    <SchemaField
                        key={field.key}
                        fieldKey={field.key}
                        data={data}
                        onChange={onChange}
                        mode="display"
                        isEditing={isEditing}
                        config={config}
                    />
                ))}
            </div>
        </div>
    );
}

export default SchemaField;
