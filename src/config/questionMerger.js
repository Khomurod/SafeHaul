/**
 * Question Merger Utility
 * 
 * Merges global schema with company-specific overrides to produce
 * the final field list for driver applications.
 */

/**
 * Merge global schema with company overrides
 * @param {Object} globalSchema - From system_settings/application_schema
 * @param {Object} companyOverrides - From companies/{id}/settings/custom_questions
 * @returns {Object} Merged schema ready for rendering
 */
export function getMergedSchema(globalSchema, companyOverrides = {}) {
    if (!globalSchema?.sections) {
        return { sections: [], fields: [] };
    }

    const hiddenFields = new Set(companyOverrides.hiddenFields || []);
    const fieldOverrides = companyOverrides.fieldOverrides || {};
    const additionalQuestions = companyOverrides.additionalQuestions || [];

    // Process each section
    const mergedSections = globalSchema.sections.map(section => {
        // Filter out hidden fields (only if canCompanyHide is true)
        const visibleFields = (section.fields || []).filter(field => {
            // DOT-required fields can never be hidden
            if (field.dotRequired) return true;
            // Check if company can hide and has hidden this field
            if (field.canCompanyHide && hiddenFields.has(field.key)) return false;
            return true;
        });

        // Apply field overrides (label changes, etc. - only if canCompanyModify)
        const modifiedFields = visibleFields.map(field => {
            const override = fieldOverrides[field.key];
            if (!override) return field;

            // Only apply if field allows modification
            if (!field.canCompanyModify) return field;

            return {
                ...field,
                label: override.label || field.label,
                helpText: override.helpText || field.helpText,
                placeholder: override.placeholder || field.placeholder
            };
        });

        return {
            ...section,
            fields: modifiedFields
        };
    });

    // Add company custom questions as a new section (Step 8)
    if (additionalQuestions.length > 0) {
        const customSection = {
            id: 'companyCustomQuestions',
            title: 'Additional Questions',
            stepNumber: 8,
            order: 50,
            isCustom: true,
            fields: additionalQuestions.map((q, idx) => ({
                ...q,
                key: q.key || q.id || `custom-${idx}`,
                isCustom: true
            }))
        };
        mergedSections.push(customSection);
    }

    // Flatten all fields for easy access
    const allFields = mergedSections.flatMap(section =>
        (section.fields || []).map(field => ({
            ...field,
            sectionId: section.id,
            sectionTitle: section.title,
            stepNumber: section.stepNumber
        }))
    );

    return {
        version: globalSchema.version,
        sections: mergedSections,
        fields: allFields
    };
}

/**
 * Get fields for a specific step
 * @param {Object} mergedSchema - Output from getMergedSchema
 * @param {number} stepNumber - Step number (1-9)
 * @returns {Array} Fields for that step
 */
export function getFieldsForStep(mergedSchema, stepNumber) {
    if (!mergedSchema?.sections) return [];

    return mergedSchema.sections
        .filter(s => s.stepNumber === stepNumber)
        .flatMap(s => s.fields || []);
}

/**
 * Get sections grouped by step
 * @param {Object} mergedSchema - Output from getMergedSchema
 * @returns {Object} Map of stepNumber -> sections[]
 */
export function getSectionsByStep(mergedSchema) {
    if (!mergedSchema?.sections) return {};

    const stepMap = {};
    for (const section of mergedSchema.sections) {
        const step = section.stepNumber || 0;
        if (!stepMap[step]) stepMap[step] = [];
        stepMap[step].push(section);
    }
    return stepMap;
}

/**
 * Check if field should be conditionally visible
 * @param {Object} field - Field definition
 * @param {Object} formData - Current form data
 * @returns {boolean} Whether field should be shown
 */
export function isFieldVisible(field, formData = {}) {
    if (!field.dependsOn) return true;
    return formData[field.dependsOn] === field.showWhen;
}

/**
 * Validate required fields for a step
 * @param {Object} mergedSchema - Merged schema
 * @param {number} stepNumber - Step to validate
 * @param {Object} formData - Current form data
 * @returns {{ valid: boolean, missingFields: Array }}
 */
export function validateStep(mergedSchema, stepNumber, formData = {}) {
    const fields = getFieldsForStep(mergedSchema, stepNumber);
    const missingFields = [];

    for (const field of fields) {
        if (!field.required) continue;
        if (!isFieldVisible(field, formData)) continue;

        const value = formData[field.key];
        if (value === undefined || value === null || value === '') {
            missingFields.push(field);
        }
    }

    return {
        valid: missingFields.length === 0,
        missingFields
    };
}

export default {
    getMergedSchema,
    getFieldsForStep,
    getSectionsByStep,
    isFieldVisible,
    validateStep
};
