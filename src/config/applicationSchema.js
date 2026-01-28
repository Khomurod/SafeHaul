/**
 * Shared Application Schema - Source of Truth
 * 
 * This file defines the complete structure of the driver application form.
 * Both the DriverApplicationWizard (input) and ApplicationDetailViewV2 (output)
 * should reference this schema to ensure consistency.
 * 
 * Adding a field here ensures it appears in both the driver app and recruiter dashboard,
 * eliminating "Mirror Law" violations and hidden data risks.
 */

import {
    YES_NO_OPTIONS,
    EXPERIENCE_OPTIONS,
    LICENSE_CLASS_OPTIONS,
    ENDORSEMENT_OPTIONS,
    MILITARY_BRANCH_OPTIONS,
    MILES_DRIVEN_OPTIONS
} from './form-options';

// ============================================================================
// FIELD TYPE DEFINITIONS
// ============================================================================

/**
 * @typedef {'text' | 'email' | 'tel' | 'date' | 'month' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'signature' | 'array'} FieldType
 */

/**
 * @typedef {Object} FieldDefinition
 * @property {string} key - The formData key (e.g., 'firstName', 'sms-consent')
 * @property {string} label - Display label
 * @property {FieldType} type - Input type
 * @property {boolean} [required=false] - Whether field is required
 * @property {string} [placeholder] - Placeholder text
 * @property {string} [configKey] - Key in applicationConfig for company-level overrides
 * @property {Array} [options] - For select/radio types
 * @property {string} [dependsOn] - Field key this depends on (for conditional display)
 * @property {*} [showWhen] - Value of dependsOn field that triggers display
 * @property {Object} [validation] - Validation rules
 */

// ============================================================================
// SECTION 1: PERSONAL INFORMATION (Step 1)
// ============================================================================

export const PERSONAL_INFO_SECTION = {
    id: 'personalInfo',
    title: 'Personal Information',
    stepNumber: 1,
    fields: [
        // --- Name Fields ---
        { key: 'firstName', label: 'First Name', type: 'text', required: true, placeholder: 'John' },
        { key: 'middleName', label: 'Middle Name', type: 'text', placeholder: 'M' },
        { key: 'lastName', label: 'Last Name', type: 'text', required: true, placeholder: 'Doe' },
        { key: 'suffix', label: 'Suffix', type: 'text', placeholder: 'Jr.' },
        { key: 'known-by-other-name', label: 'Known by other name(s)?', type: 'checkbox' },
        { key: 'otherName', label: 'Other Name(s)', type: 'text', dependsOn: 'known-by-other-name', showWhen: 'yes' },

        // --- Sensitive Fields (Configurable) ---
        { key: 'ssn', label: 'Social Security Number (SSN)', type: 'text', configKey: 'ssn', placeholder: 'XXX-XX-XXXX' },
        { key: 'dob', label: 'Date of Birth', type: 'date', configKey: 'dob' },

        // --- Contact Fields ---
        { key: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '(555) 555-5555' },
        { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
        { key: 'sms-consent', label: 'Can we send you SMS messages?', type: 'radio', options: YES_NO_OPTIONS },

        // --- Referral (Configurable) ---
        { key: 'referralSource', label: 'How did you hear about us?', type: 'text', configKey: 'referralSource', placeholder: 'e.g. Facebook, Indeed, Friend...' },
    ]
};

export const ADDRESS_SECTION = {
    id: 'currentAddress',
    title: 'Current Address',
    stepNumber: 1,
    fields: [
        { key: 'street', label: 'Address 1', type: 'text', required: true, placeholder: '123 Main St' },
        { key: 'city', label: 'City', type: 'text', required: true, placeholder: 'Anytown' },
        { key: 'state', label: 'State', type: 'select', required: true },
        { key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '12345' },
        { key: 'residence-3-years', label: 'Lived at this residence for 3 years or more?', type: 'radio', options: YES_NO_OPTIONS, configKey: 'addressHistory' },
    ]
};

export const PREVIOUS_ADDRESSES_SECTION = {
    id: 'previousAddresses',
    title: 'Previous Addresses (Past 3 Years)',
    stepNumber: 1,
    type: 'array',
    itemFields: [
        { key: 'street', label: 'Address', type: 'text', required: true },
        { key: 'city', label: 'City', type: 'text', required: true },
        { key: 'state', label: 'State', type: 'select', required: true },
        { key: 'zip', label: 'ZIP Code', type: 'text', required: true },
        { key: 'startDate', label: 'From Date', type: 'month', required: true },
        { key: 'endDate', label: 'To Date', type: 'month', required: true },
    ]
};

// ============================================================================
// SECTION 2: QUALIFICATIONS (Step 2)
// ============================================================================

export const QUALIFICATIONS_SECTION = {
    id: 'qualifications',
    title: 'Qualification Information',
    stepNumber: 2,
    fields: [
        { key: 'legal-work', label: 'Legally eligible to work in the U.S.?', type: 'radio', options: YES_NO_OPTIONS, required: true },
        { key: 'english-fluency', label: 'Can you read, write, speak and understand English?', type: 'radio', options: YES_NO_OPTIONS, required: true },
    ]
};

export const DRUG_ALCOHOL_SECTION = {
    id: 'drugAlcohol',
    title: 'Drug & Alcohol History',
    stepNumber: 2,
    fields: [
        { key: 'drug-test-positive', label: 'Drug and alcohol positive tests or refusals?', type: 'radio', options: YES_NO_OPTIONS, required: true },
        { key: 'drug-test-explanation', label: 'Please explain', type: 'textarea', dependsOn: 'drug-test-positive', showWhen: 'yes' },
        { key: 'dot-return-to-duty', label: 'Can you provide documentation for DOT return to duty process?', type: 'radio', options: YES_NO_OPTIONS, required: true },
    ]
};

export const EXPERIENCE_SECTION = {
    id: 'experience',
    title: 'Commercial Experience',
    stepNumber: 2,
    fields: [
        { key: 'experience-years', label: 'Years of commercial driving experience?', type: 'radio', options: EXPERIENCE_OPTIONS, required: true },
    ]
};

// ============================================================================
// SECTION 3: LICENSE INFORMATION (Step 3)
// ============================================================================

export const LICENSE_SECTION = {
    id: 'license',
    title: 'License Information',
    stepNumber: 3,
    fields: [
        { key: 'cdlState', label: 'License State', type: 'select', required: true },
        { key: 'cdlClass', label: 'License Class', type: 'radio', options: LICENSE_CLASS_OPTIONS, required: true },
        { key: 'cdlNumber', label: 'License Number', type: 'text', required: true },
        { key: 'cdlExpiration', label: 'License Expiration', type: 'date', required: true },
        { key: 'endorsements', label: 'Endorsements', type: 'checkbox', options: ENDORSEMENT_OPTIONS },
        { key: 'has-other-licenses', label: 'Have you held a license in any other state in the past 3 years?', type: 'radio', options: YES_NO_OPTIONS, required: true },
    ]
};

export const ADDITIONAL_LICENSES_SECTION = {
    id: 'additionalLicenses',
    title: 'Additional Licenses (Past 3 Years)',
    stepNumber: 3,
    type: 'array',
    dependsOn: 'has-other-licenses',
    showWhen: 'yes',
    itemFields: [
        { key: 'state', label: 'State', type: 'select', required: true },
        { key: 'number', label: 'License Number', type: 'text', required: true },
        { key: 'class', label: 'Class', type: 'select', options: LICENSE_CLASS_OPTIONS, required: true },
        { key: 'expiration', label: 'Expiration Date', type: 'date', required: true },
    ]
};

export const CDL_UPLOADS_SECTION = {
    id: 'cdlUploads',
    title: 'CDL Documents',
    stepNumber: 3,
    configKey: 'cdlUpload',
    fields: [
        { key: 'cdl-front', label: 'Upload CDL (Front)', type: 'file' },
        { key: 'cdl-back', label: 'Upload CDL (Back)', type: 'file' },
    ]
};

export const MEDICAL_CARD_SECTION = {
    id: 'medicalCard',
    title: 'Medical Card',
    stepNumber: 3,
    configKey: 'medCardUpload',
    fields: [
        { key: 'medical-card-upload', label: 'Upload Medical Card', type: 'file' },
        { key: 'medCardExpiration', label: 'Medical Card Expiration', type: 'date' },
    ]
};

export const TWIC_SECTION = {
    id: 'twic',
    title: 'TWIC Card',
    stepNumber: 3,
    fields: [
        { key: 'has-twic', label: 'Do you have a TWIC card?', type: 'radio', options: YES_NO_OPTIONS, required: true },
        { key: 'twicExpiration', label: 'TWIC Expiration Date', type: 'date', dependsOn: 'has-twic', showWhen: 'yes' },
        { key: 'twic-card-upload', label: 'Upload TWIC Card', type: 'file', dependsOn: 'has-twic', showWhen: 'yes' },
    ]
};

// ============================================================================
// SECTION 4-7: VIOLATIONS, ACCIDENTS, EMPLOYMENT, GENERAL
// (Simplified - expand as needed)
// ============================================================================

export const VIOLATIONS_SECTION = {
    id: 'violations',
    title: 'Traffic Violations',
    stepNumber: 4,
    type: 'array',
    fields: [
        { key: 'has-violations', label: 'Any violations in the past 3 years?', type: 'radio', options: YES_NO_OPTIONS, required: true },
    ],
    itemFields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'location', label: 'Location', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'text', required: true },
    ]
};

export const ACCIDENTS_SECTION = {
    id: 'accidents',
    title: 'Accident History',
    stepNumber: 5,
    type: 'array',
    fields: [
        { key: 'has-accidents', label: 'Any accidents in the past 3 years?', type: 'radio', options: YES_NO_OPTIONS, required: true },
    ],
    itemFields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'location', label: 'Location', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea', required: true },
        { key: 'injuries', label: 'Injuries?', type: 'radio', options: YES_NO_OPTIONS },
        { key: 'fatalities', label: 'Fatalities?', type: 'radio', options: YES_NO_OPTIONS },
    ]
};

export const EMPLOYMENT_SECTION = {
    id: 'employmentHistory',
    title: 'Employment History (Past 10 Years)',
    stepNumber: 6,
    type: 'array',
    itemFields: [
        { key: 'companyName', label: 'Company Name', type: 'text', required: true },
        { key: 'address', label: 'Address', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'state', label: 'State', type: 'select' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'startDate', label: 'Start Date', type: 'month', required: true },
        { key: 'endDate', label: 'End Date', type: 'month' },
        { key: 'position', label: 'Position', type: 'text' },
        { key: 'reasonForLeaving', label: 'Reason for Leaving', type: 'text' },
        { key: 'supervisorName', label: 'Supervisor Name', type: 'text' },
        { key: 'mayContact', label: 'May we contact?', type: 'radio', options: YES_NO_OPTIONS },
    ]
};

export const MILITARY_SECTION = {
    id: 'military',
    title: 'Military Service',
    stepNumber: 7,
    fields: [
        { key: 'military-service', label: 'Have you served in the military?', type: 'radio', options: YES_NO_OPTIONS },
        { key: 'military-branch', label: 'Branch', type: 'select', options: MILITARY_BRANCH_OPTIONS, dependsOn: 'military-service', showWhen: 'yes' },
        { key: 'military-mos', label: 'MOS/Rating', type: 'text', dependsOn: 'military-service', showWhen: 'yes' },
        { key: 'military-start', label: 'Start Date', type: 'month', dependsOn: 'military-service', showWhen: 'yes' },
        { key: 'military-end', label: 'End Date', type: 'month', dependsOn: 'military-service', showWhen: 'yes' },
    ]
};

// ============================================================================
// SECTION 9: CONSENT & SIGNATURE (Step 9)
// ============================================================================

export const CONSENT_SECTION = {
    id: 'consent',
    title: 'Certification & Signature',
    stepNumber: 9,
    fields: [
        { key: 'final-certification', label: 'I certify that all information is true and complete', type: 'checkbox', required: true },
        { key: 'signature', label: 'Signature', type: 'signature', required: true },
        { key: 'signature-date', label: 'Date', type: 'date', required: true },
    ]
};

// ============================================================================
// FULL SCHEMA (Ordered by step)
// ============================================================================

export const APPLICATION_SCHEMA = {
    version: '1.0.0',
    sections: [
        // Step 1: Personal Information
        PERSONAL_INFO_SECTION,
        ADDRESS_SECTION,
        PREVIOUS_ADDRESSES_SECTION,

        // Step 2: Qualifications
        QUALIFICATIONS_SECTION,
        DRUG_ALCOHOL_SECTION,
        EXPERIENCE_SECTION,

        // Step 3: License
        LICENSE_SECTION,
        ADDITIONAL_LICENSES_SECTION,
        CDL_UPLOADS_SECTION,
        MEDICAL_CARD_SECTION,
        TWIC_SECTION,

        // Step 4-5: Violations & Accidents
        VIOLATIONS_SECTION,
        ACCIDENTS_SECTION,

        // Step 6-7: Employment & General
        EMPLOYMENT_SECTION,
        MILITARY_SECTION,

        // Step 9: Consent
        CONSENT_SECTION,
    ]
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all field keys for a given step
 */
export function getFieldsForStep(stepNumber) {
    return APPLICATION_SCHEMA.sections
        .filter(s => s.stepNumber === stepNumber)
        .flatMap(s => s.fields || [])
        .map(f => f.key);
}

/**
 * Get field definition by key
 */
export function getFieldByKey(key) {
    for (const section of APPLICATION_SCHEMA.sections) {
        const field = section.fields?.find(f => f.key === key);
        if (field) return { ...field, section: section.id };

        const arrayField = section.itemFields?.find(f => f.key === key);
        if (arrayField) return { ...arrayField, section: section.id, isArrayField: true };
    }
    return null;
}

/**
 * Get all field keys in the entire schema (flat list)
 */
export function getAllFieldKeys() {
    const keys = new Set();

    for (const section of APPLICATION_SCHEMA.sections) {
        section.fields?.forEach(f => keys.add(f.key));
        section.itemFields?.forEach(f => keys.add(f.key));
    }

    return Array.from(keys);
}

/**
 * Check if a field should be visible based on company config
 */
export function isFieldVisible(field, applicationConfig) {
    if (!field.configKey) return true;
    const config = applicationConfig?.[field.configKey];
    return !config?.hidden;
}

/**
 * Check if a field should be visible based on conditional logic
 */
export function isFieldConditionallyVisible(field, formData) {
    if (!field.dependsOn) return true;
    return formData[field.dependsOn] === field.showWhen;
}

export default APPLICATION_SCHEMA;
