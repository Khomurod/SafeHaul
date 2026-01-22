// src/lib/applicationSchema.js
/**
 * APPLICATION SCHEMA - Single Source of Truth
 *
 * This file is the ONLY place to define application fields.
 * Both the Driver Wizard and Admin Dashboard derive their UI from this schema.
 *
 * MIRROR LAW COMPLIANCE:
 * Any field added here will automatically be available in both input and display modes.
 * This eliminates the "Hidden Data Liability" problem where data is collected but not displayed.
 *
 * @see ARCHITECT_MAP.md Section 5 for the original Mirror Law documentation
 */

// ============================================================================
// FIELD TYPES
// ============================================================================

export const FIELD_TYPES = {
    TEXT: 'text',
    EMAIL: 'email',
    PHONE: 'phone',
    DATE: 'date',
    SELECT: 'select',
    RADIO: 'radio',
    CHECKBOX: 'checkbox',
    TEXTAREA: 'textarea',
    FILE: 'file',
    ARRAY: 'array',         // For repeating groups (employment history, violations)
    SIGNATURE: 'signature',
    HIDDEN: 'hidden'        // For internal fields not rendered
};

// ============================================================================
// SECTION 1: PERSONAL INFORMATION (Step 1)
// ============================================================================

export const PERSONAL_INFO_SECTION = {
    sectionId: 'personal',
    title: 'Personal Information',
    wizardStep: 1,
    adminComponent: 'PersonalInfoSection',
    fields: [
        // Identity
        { key: 'firstName', label: 'First Name', type: FIELD_TYPES.TEXT, required: true },
        { key: 'middleName', label: 'Middle Name', type: FIELD_TYPES.TEXT, required: false },
        { key: 'lastName', label: 'Last Name', type: FIELD_TYPES.TEXT, required: true },
        { key: 'suffix', label: 'Suffix', type: FIELD_TYPES.TEXT, required: false, placeholder: 'Jr.' },
        { key: 'known-by-other-name', label: 'Known by Other Name?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'] },
        { key: 'otherName', label: 'Other Name(s)', type: FIELD_TYPES.TEXT, showIf: (d) => d['known-by-other-name'] === 'yes' },

        // Contact
        { key: 'phone', label: 'Phone', type: FIELD_TYPES.PHONE, required: true },
        { key: 'email', label: 'Email', type: FIELD_TYPES.EMAIL, required: true },
        { key: 'sms-consent', label: 'SMS Consent', type: FIELD_TYPES.RADIO, options: ['yes', 'no'] },

        // Identity (Sensitive)
        { key: 'ssn', label: 'Social Security Number', type: FIELD_TYPES.TEXT, configurable: true, sensitive: true, mask: '***-**-{last4}' },
        { key: 'dob', label: 'Date of Birth', type: FIELD_TYPES.DATE, configurable: true },

        // Current Address
        { key: 'street', label: 'Street Address', type: FIELD_TYPES.TEXT, required: true },
        { key: 'city', label: 'City', type: FIELD_TYPES.TEXT, required: true },
        { key: 'state', label: 'State', type: FIELD_TYPES.SELECT, required: true },
        { key: 'zip', label: 'ZIP Code', type: FIELD_TYPES.TEXT, required: true },
        { key: 'residence-3-years', label: 'Lived Here 3+ Years?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'] },

        // Previous Address (Array)
        { key: 'previousAddresses', label: 'Previous Addresses', type: FIELD_TYPES.ARRAY, arraySchema: ['street', 'city', 'state', 'zip', 'startDate', 'endDate'] },

        // Referral
        { key: 'referralSource', label: 'How did you hear about us?', type: FIELD_TYPES.TEXT, configurable: true }
    ]
};

// ============================================================================
// SECTION 2: QUALIFICATIONS (Step 2)
// ============================================================================

export const QUALIFICATIONS_SECTION = {
    sectionId: 'qualifications',
    title: 'Qualification Information',
    wizardStep: 2,
    adminComponent: 'QualificationsSection',
    fields: [
        // General Qualifications
        { key: 'legal-work', label: 'Legally Eligible to Work in U.S.?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true },
        { key: 'english-fluency', label: 'Can Read/Write/Speak English?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true },

        // Drug & Alcohol History
        { key: 'drug-test-positive', label: 'Drug Test Positive/Refusal?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true, redFlag: true },
        { key: 'drug-test-explanation', label: 'Drug Test Explanation', type: FIELD_TYPES.TEXTAREA, showIf: (d) => d['drug-test-positive'] === 'yes' },
        { key: 'dot-return-to-duty', label: 'DOT Return to Duty Documentation?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true },

        // Experience
        { key: 'experience-years', label: 'Years of Commercial Experience', type: FIELD_TYPES.SELECT, required: true }
    ]
};

// ============================================================================
// SECTION 3: LICENSE INFORMATION (Step 3)
// ============================================================================

export const LICENSE_SECTION = {
    sectionId: 'license',
    title: 'License Information',
    wizardStep: 3,
    adminComponent: 'QualificationsSection', // Rendered in Qualifications admin section
    fields: [
        // Current License
        { key: 'cdlState', label: 'License State', type: FIELD_TYPES.SELECT, required: true },
        { key: 'cdlClass', label: 'License Class', type: FIELD_TYPES.RADIO, options: ['A', 'B', 'C'], required: true },
        { key: 'cdlNumber', label: 'License Number', type: FIELD_TYPES.TEXT, required: true },
        { key: 'cdlExpiration', label: 'License Expiration', type: FIELD_TYPES.DATE, required: true },
        { key: 'endorsements', label: 'Endorsements', type: FIELD_TYPES.TEXT }, // Comma-separated

        // Additional Licenses
        { key: 'has-other-licenses', label: 'License in Other State (Past 3 Years)?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'] },
        { key: 'additionalLicenses', label: 'Additional Licenses', type: FIELD_TYPES.ARRAY, showIf: (d) => d['has-other-licenses'] === 'yes', arraySchema: ['state', 'number', 'class', 'expiration'] },

        // CDL Uploads
        { key: 'cdl-front', label: 'CDL (Front)', type: FIELD_TYPES.FILE, configurable: true },
        { key: 'cdl-back', label: 'CDL (Back)', type: FIELD_TYPES.FILE, configurable: true },
        { key: 'medical-card-upload', label: 'Medical Card', type: FIELD_TYPES.FILE, configurable: true },

        // TWIC Card
        { key: 'has-twic', label: 'Has TWIC Card?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true },
        { key: 'twicExpiration', label: 'TWIC Expiration', type: FIELD_TYPES.DATE, showIf: (d) => d['has-twic'] === 'yes' },
        { key: 'twic-card-upload', label: 'TWIC Card Upload', type: FIELD_TYPES.FILE, showIf: (d) => d['has-twic'] === 'yes' }
    ]
};

// ============================================================================
// SECTION 4: VIOLATIONS / MOTOR VEHICLE RECORD (Step 4)
// ============================================================================

export const VIOLATIONS_SECTION = {
    sectionId: 'violations',
    title: 'Motor Vehicle Record',
    wizardStep: 4,
    adminComponent: 'SupplementalSection',
    fields: [
        // MVR Consent
        { key: 'consent-mvr', label: 'Consent to MVR Check', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true },

        // Revocations / Suspensions
        { key: 'revoked-licenses', label: 'License Ever Denied/Suspended/Revoked?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true, redFlag: true },
        { key: 'revocationExplanation', label: 'Revocation Details', type: FIELD_TYPES.TEXTAREA, showIf: (d) => d['revoked-licenses'] === 'yes' },

        // Driving Convictions
        { key: 'driving-convictions', label: 'Convicted Driving While Suspended?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true, redFlag: true },
        { key: 'convictionExplanation', label: 'Conviction Details', type: FIELD_TYPES.TEXTAREA, showIf: (d) => d['driving-convictions'] === 'yes' },

        // Drug/Alcohol Convictions
        { key: 'drug-alcohol-convictions', label: 'Drug/Alcohol Related Conviction?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true, redFlag: true },
        { key: 'drugConvictionExplanation', label: 'Drug Conviction Details', type: FIELD_TYPES.TEXTAREA, showIf: (d) => d['drug-alcohol-convictions'] === 'yes' },

        // Violations Array
        { key: 'violations', label: 'Traffic Violations (Past 3 Years)', type: FIELD_TYPES.ARRAY, arraySchema: ['date', 'charge', 'location', 'penalty'] }
    ]
};

// ============================================================================
// SECTION 5: ACCIDENTS (Step 5)
// ============================================================================

export const ACCIDENTS_SECTION = {
    sectionId: 'accidents',
    title: 'Accident History',
    wizardStep: 5,
    adminComponent: 'SupplementalSection',
    fields: [
        { key: 'accidents', label: 'Accidents (Past 3 Years)', type: FIELD_TYPES.ARRAY, arraySchema: ['date', 'city', 'state', 'details', 'fatalities', 'injuries', 'commercial', 'preventable'] }
    ]
};

// ============================================================================
// SECTION 6: EMPLOYMENT HISTORY (Step 6)
// ============================================================================

export const EMPLOYMENT_SECTION = {
    sectionId: 'employment',
    title: 'Employment History',
    wizardStep: 6,
    adminComponent: 'SupplementalSection',
    fields: [
        { key: 'employers', label: 'Employers (Past 10 Years)', type: FIELD_TYPES.ARRAY, arraySchema: ['name', 'address', 'city', 'state', 'zip', 'phone', 'position', 'dates', 'reason', 'contactAllowed'] },
        { key: 'unemployment', label: 'Employment Gaps', type: FIELD_TYPES.ARRAY, arraySchema: ['startDate', 'endDate', 'details'] }
    ]
};

// ============================================================================
// SECTION 7: GENERAL / CUSTOM QUESTIONS (Step 7)
// ============================================================================

export const GENERAL_SECTION = {
    sectionId: 'general',
    title: 'General Information',
    wizardStep: 7,
    adminComponent: 'SupplementalSection',
    fields: [
        // Custom Questions (Company-Specific)
        { key: 'customAnswers', label: 'Custom Question Answers', type: FIELD_TYPES.HIDDEN },

        // Business Info (Owner Operators)
        { key: 'businessName', label: 'Business Name', type: FIELD_TYPES.TEXT, showIf: (d) => d.positionType === 'ownerOperator' || d.positionType === 'leaseOperator' },
        { key: 'ein', label: 'EIN', type: FIELD_TYPES.TEXT, showIf: (d) => d.positionType === 'ownerOperator' || d.positionType === 'leaseOperator' },
        { key: 'positionType', label: 'Position Type', type: FIELD_TYPES.SELECT },

        // Vehicle Experience
        { key: 'expStraightTruckExp', label: 'Straight Truck Experience (Years)', type: FIELD_TYPES.TEXT },
        { key: 'expStraightTruckMiles', label: 'Straight Truck Miles', type: FIELD_TYPES.TEXT },
        { key: 'expSemiTrailerExp', label: 'Semi-Trailer Experience (Years)', type: FIELD_TYPES.TEXT },
        { key: 'expSemiTrailerMiles', label: 'Semi-Trailer Miles', type: FIELD_TYPES.TEXT },

        // Emergency Contacts
        { key: 'ec1Name', label: 'Emergency Contact 1 Name', type: FIELD_TYPES.TEXT },
        { key: 'ec1Phone', label: 'Emergency Contact 1 Phone', type: FIELD_TYPES.PHONE },
        { key: 'ec1Relationship', label: 'Emergency Contact 1 Relationship', type: FIELD_TYPES.TEXT },
        { key: 'ec2Name', label: 'Emergency Contact 2 Name', type: FIELD_TYPES.TEXT },
        { key: 'ec2Phone', label: 'Emergency Contact 2 Phone', type: FIELD_TYPES.PHONE },
        { key: 'ec2Relationship', label: 'Emergency Contact 2 Relationship', type: FIELD_TYPES.TEXT },

        // Felony History
        { key: 'has-felony', label: 'Felony Conviction?', type: FIELD_TYPES.RADIO, options: ['yes', 'no'], required: true, redFlag: true },
        { key: 'felonyExplanation', label: 'Felony Explanation', type: FIELD_TYPES.TEXTAREA, showIf: (d) => d['has-felony'] === 'yes' }
    ]
};

// ============================================================================
// SECTION 8: REVIEW (Step 8)
// ============================================================================

export const REVIEW_SECTION = {
    sectionId: 'review',
    title: 'Application Review',
    wizardStep: 8,
    adminComponent: null, // Review step is wizard-only
    fields: [] // No new fields, just displays summary
};

// ============================================================================
// SECTION 9: SIGNATURE & CONSENT (Step 9)
// ============================================================================

export const SIGNATURE_SECTION = {
    sectionId: 'signature',
    title: 'Signature & Consent',
    wizardStep: 9,
    adminComponent: 'SupplementalSection',
    fields: [
        { key: 'signature', label: 'Digital Signature', type: FIELD_TYPES.SIGNATURE, required: true },
        { key: 'signature-date', label: 'Signature Date', type: FIELD_TYPES.DATE },
        { key: 'final-certification', label: 'Certification Agreement', type: FIELD_TYPES.CHECKBOX, required: true }
    ]
};

// ============================================================================
// EDUCATION & MILITARY (Optional Sections)
// ============================================================================

export const EDUCATION_SECTION = {
    sectionId: 'education',
    title: 'Education & Military',
    wizardStep: null, // May be included in different steps
    adminComponent: 'SupplementalSection',
    fields: [
        { key: 'schools', label: 'Driving Schools', type: FIELD_TYPES.ARRAY, arraySchema: ['name', 'location', 'dates'] },
        { key: 'military', label: 'Military Service', type: FIELD_TYPES.ARRAY, arraySchema: ['branch', 'rank', 'start', 'end', 'honorable'] }
    ]
};

// ============================================================================
// AGGREGATE SCHEMA
// ============================================================================

export const APPLICATION_SCHEMA = [
    PERSONAL_INFO_SECTION,
    QUALIFICATIONS_SECTION,
    LICENSE_SECTION,
    VIOLATIONS_SECTION,
    ACCIDENTS_SECTION,
    EMPLOYMENT_SECTION,
    GENERAL_SECTION,
    REVIEW_SECTION,
    SIGNATURE_SECTION,
    EDUCATION_SECTION
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all field keys defined in the schema (flat list)
 * @returns {string[]} Array of all field keys
 */
export function getAllFieldKeys() {
    return APPLICATION_SCHEMA.flatMap(section =>
        section.fields.map(f => f.key)
    );
}

/**
 * Get field definition by key, including section context
 * @param {string} key - Field key to lookup
 * @returns {object|null} Field definition with section info, or null
 */
export function getFieldDefinition(key) {
    for (const section of APPLICATION_SCHEMA) {
        const field = section.fields.find(f => f.key === key);
        if (field) {
            return {
                ...field,
                sectionId: section.sectionId,
                sectionTitle: section.title,
                wizardStep: section.wizardStep,
                adminComponent: section.adminComponent
            };
        }
    }
    return null;
}

/**
 * Get section by ID
 * @param {string} sectionId - Section ID to lookup
 * @returns {object|null} Section definition or null
 */
export function getSection(sectionId) {
    return APPLICATION_SCHEMA.find(s => s.sectionId === sectionId) || null;
}

/**
 * Get all fields for a specific wizard step
 * @param {number} stepNumber - Wizard step number (1-9)
 * @returns {object[]} Array of field definitions
 */
export function getFieldsForStep(stepNumber) {
    const section = APPLICATION_SCHEMA.find(s => s.wizardStep === stepNumber);
    return section ? section.fields : [];
}

/**
 * Get all fields for a specific admin component
 * @param {string} componentName - Admin component name (e.g., 'PersonalInfoSection')
 * @returns {object[]} Array of field definitions
 */
export function getFieldsForAdminComponent(componentName) {
    return APPLICATION_SCHEMA
        .filter(s => s.adminComponent === componentName)
        .flatMap(s => s.fields);
}

/**
 * Get all fields marked as red flags (safety-critical)
 * @returns {object[]} Array of red flag field definitions
 */
export function getRedFlagFields() {
    return APPLICATION_SCHEMA
        .flatMap(s => s.fields.filter(f => f.redFlag));
}

/**
 * Detect schema drift: find keys in application data that aren't in schema
 * This helps catch fields that were added without updating the schema
 *
 * @param {object} applicationData - Application document data
 * @returns {string[]} Array of unrecognized field keys
 */
export function detectSchemaDrift(applicationData) {
    const knownKeys = new Set(getAllFieldKeys());

    // System fields that are expected but not in schema
    const systemFields = new Set([
        'id', 'createdAt', 'updatedAt', 'status', 'submittedAt', 'companyId',
        'driverId', 'userId', 'source', 'recruiterCode', 'assignedTo', 'isPlatformLead',
        'originalLeadId', 'confirmationNumber', 'applicationId', 'processingStatus',
        'pdfUrl', 'pdfGeneratedAt', 'lastStatusChange', 'statusHistory'
    ]);

    return Object.keys(applicationData).filter(key =>
        !knownKeys.has(key) && !systemFields.has(key)
    );
}

/**
 * Check if a field should be visible based on its showIf condition
 * @param {object} fieldDef - Field definition
 * @param {object} data - Current form data
 * @returns {boolean} Whether field should be visible
 */
export function isFieldVisible(fieldDef, data) {
    if (!fieldDef.showIf) return true;
    return fieldDef.showIf(data);
}

/**
 * Validate that required fields are present
 * @param {object} data - Application data
 * @param {number} stepNumber - Optional: validate only specific step
 * @returns {{valid: boolean, missing: string[]}} Validation result
 */
export function validateRequiredFields(data, stepNumber = null) {
    const sections = stepNumber
        ? APPLICATION_SCHEMA.filter(s => s.wizardStep === stepNumber)
        : APPLICATION_SCHEMA;

    const missing = [];

    for (const section of sections) {
        for (const field of section.fields) {
            if (field.required && isFieldVisible(field, data)) {
                const value = data[field.key];
                if (value === undefined || value === null || value === '') {
                    missing.push(field.key);
                }
            }
        }
    }

    return { valid: missing.length === 0, missing };
}
