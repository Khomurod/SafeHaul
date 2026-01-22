/**
 * Schema-Driven UI Helpers
 * 
 * These utilities enable rendering form fields and display sections
 * directly from the applicationSchema, ensuring consistency between
 * the DriverApplicationWizard and ApplicationDetailViewV2.
 */

import { APPLICATION_SCHEMA, getFieldByKey, isFieldVisible, isFieldConditionallyVisible } from './applicationSchema';

/**
 * @typedef {Object} FieldRenderContext
 * @property {Object} formData - Current form data
 * @property {boolean} isEditing - Whether in edit mode
 * @property {Function} onChange - Handler for field changes
 * @property {Object} applicationConfig - Company-level field configuration
 */

/**
 * Get fields for a section that should be displayed based on config and conditions
 * @param {Object} section - Schema section
 * @param {Object} formData - Current form data
 * @param {Object} applicationConfig - Company config
 * @returns {Array} Visible fields
 */
export function getVisibleFields(section, formData = {}, applicationConfig = {}) {
    const fields = section.fields || [];

    return fields.filter(field => {
        // Check company config
        if (!isFieldVisible(field, applicationConfig)) return false;

        // Check conditional visibility
        if (!isFieldConditionallyVisible(field, formData)) return false;

        return true;
    });
}

/**
 * Get all sections for a specific step
 * @param {number} stepNumber 
 * @returns {Array} Sections for that step
 */
export function getSectionsForStep(stepNumber) {
    return APPLICATION_SCHEMA.sections.filter(s => s.stepNumber === stepNumber);
}

/**
 * Render a field value for display (read-only mode)
 * @param {Object} field - Field definition
 * @param {*} value - Field value
 * @returns {string|JSX.Element} Formatted display value
 */
export function formatFieldValue(field, value) {
    if (value === undefined || value === null || value === '') {
        return '-';
    }

    switch (field.type) {
        case 'date':
            // Format as readable date
            if (typeof value === 'string' && value.includes('-')) {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }
            return value;

        case 'checkbox':
            return value === true || value === 'yes' ? 'YES' : 'NO';

        case 'radio':
            // Find the label from options
            const option = field.options?.find(o => o.value === value);
            return option?.label || value;

        case 'file':
            return value?.fileName || value?.url ? 'Uploaded' : 'Not uploaded';

        default:
            return String(value);
    }
}

/**
 * Get CSS classes for a field value badge (yes/no fields)
 */
export function getYesNoBadgeClasses(value) {
    const isYes = value === 'yes' || value === true;
    return isYes
        ? 'bg-green-100 text-green-700 px-2 py-1 rounded text-sm font-bold'
        : 'bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm font-bold';
}

/**
 * Validate all required fields in a section
 * @param {Object} section - Schema section
 * @param {Object} formData - Current form data
 * @returns {{ isValid: boolean, missingFields: Array }}
 */
export function validateSection(section, formData = {}) {
    const missingFields = [];

    for (const field of section.fields || []) {
        if (!field.required) continue;

        const value = formData[field.key];
        if (value === undefined || value === null || value === '') {
            missingFields.push(field);
        }
    }

    return {
        isValid: missingFields.length === 0,
        missingFields
    };
}

/**
 * Get completion percentage for an application
 * @param {Object} formData - Application data
 * @returns {number} Percentage complete (0-100)
 */
export function getApplicationCompletionPercentage(formData = {}) {
    let totalRequired = 0;
    let completedRequired = 0;

    for (const section of APPLICATION_SCHEMA.sections) {
        for (const field of section.fields || []) {
            if (!field.required) continue;

            // Skip conditional fields if their condition isn't met
            if (field.dependsOn && formData[field.dependsOn] !== field.showWhen) {
                continue;
            }

            totalRequired++;
            const value = formData[field.key];
            if (value !== undefined && value !== null && value !== '') {
                completedRequired++;
            }
        }
    }

    if (totalRequired === 0) return 100;
    return Math.round((completedRequired / totalRequired) * 100);
}

/**
 * Extract all field values from formData that match schema fields
 * Useful for sanitizing/filtering data before submission
 */
export function extractSchemaFields(formData = {}) {
    const extracted = {};

    for (const section of APPLICATION_SCHEMA.sections) {
        // Regular fields
        for (const field of section.fields || []) {
            if (formData[field.key] !== undefined) {
                extracted[field.key] = formData[field.key];
            }
        }

        // Array sections
        if (section.type === 'array' && section.id) {
            if (Array.isArray(formData[section.id])) {
                extracted[section.id] = formData[section.id];
            }
        }
    }

    return extracted;
}

export default {
    getVisibleFields,
    getSectionsForStep,
    formatFieldValue,
    getYesNoBadgeClasses,
    validateSection,
    getApplicationCompletionPercentage,
    extractSchemaFields
};
