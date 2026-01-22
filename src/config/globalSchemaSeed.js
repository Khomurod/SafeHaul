/**
 * Global Application Schema Seed Data
 * 
 * This file defines the initial schema to be seeded into Firestore at:
 * system_settings/application_schema
 * 
 * All DOT/FMCSA required fields are marked with dotRequired: true
 */

export const GLOBAL_SCHEMA_SEED = {
    version: "2.0.0",
    sections: [
        // =================================================================
        // STEP 1: PERSONAL INFORMATION
        // =================================================================
        {
            id: "personalInfo",
            title: "Personal Information",
            stepNumber: 1,
            order: 0,
            fields: [
                {
                    key: "firstName",
                    label: "First Name",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(a)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "John"
                },
                {
                    key: "middleName",
                    label: "Middle Name",
                    type: "text",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true,
                    placeholder: "M"
                },
                {
                    key: "lastName",
                    label: "Last Name",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(a)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "Doe"
                },
                {
                    key: "suffix",
                    label: "Suffix",
                    type: "text",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true,
                    placeholder: "Jr."
                },
                {
                    key: "known-by-other-name",
                    label: "Known by other name(s)?",
                    type: "checkbox",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true
                },
                {
                    key: "otherName",
                    label: "Other Name(s)",
                    type: "text",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true,
                    dependsOn: "known-by-other-name",
                    showWhen: "yes"
                },
                {
                    key: "ssn",
                    label: "Social Security Number",
                    type: "text",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: false,
                    placeholder: "XXX-XX-XXXX",
                    helpText: "Required for background check"
                },
                {
                    key: "dob",
                    label: "Date of Birth",
                    type: "date",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(a)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    helpText: "Must be at least 21 for interstate"
                },
                {
                    key: "phone",
                    label: "Phone",
                    type: "tel",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(a)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "(555) 555-5555"
                },
                {
                    key: "email",
                    label: "Email",
                    type: "email",
                    required: true,
                    dotRequired: false,
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "you@example.com"
                },
                {
                    key: "sms-consent",
                    label: "Can we send you SMS messages?",
                    type: "radio",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                },
                {
                    key: "referralSource",
                    label: "How did you hear about us?",
                    type: "text",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: true,
                    canCompanyModify: true,
                    placeholder: "e.g. Facebook, Indeed, Friend..."
                }
            ]
        },
        // =================================================================
        // STEP 1: ADDRESS
        // =================================================================
        {
            id: "currentAddress",
            title: "Current Address",
            stepNumber: 1,
            order: 1,
            fields: [
                {
                    key: "street",
                    label: "Address 1",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(1)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "123 Main St"
                },
                {
                    key: "city",
                    label: "City",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(1)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "state",
                    label: "State",
                    type: "select",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(1)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "zip",
                    label: "ZIP Code",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(1)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    placeholder: "12345"
                },
                {
                    key: "residence-3-years",
                    label: "Lived at this residence for 3 years or more?",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(2)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ],
                    helpText: "DOT requires 3 years of address history"
                }
            ]
        },
        // =================================================================
        // STEP 2: QUALIFICATIONS
        // =================================================================
        {
            id: "qualifications",
            title: "Qualification Information",
            stepNumber: 2,
            order: 0,
            fields: [
                {
                    key: "legal-work",
                    label: "Legally eligible to work in the U.S.?",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(8)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                },
                {
                    key: "english-fluency",
                    label: "Can you read, write, speak and understand English?",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.11(b)(2)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                }
            ]
        },
        {
            id: "drugAlcohol",
            title: "Drug & Alcohol History",
            stepNumber: 2,
            order: 1,
            fields: [
                {
                    key: "drug-test-positive",
                    label: "Have you ever tested positive or refused a DOT drug/alcohol test?",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 40.25(j)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                },
                {
                    key: "drug-test-explanation",
                    label: "Please explain",
                    type: "textarea",
                    required: false,
                    dotRequired: false,
                    canCompanyHide: false,
                    canCompanyModify: true,
                    dependsOn: "drug-test-positive",
                    showWhen: "yes"
                },
                {
                    key: "dot-return-to-duty",
                    label: "Can you provide documentation for DOT return to duty process?",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 40.285",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                }
            ]
        },
        // =================================================================
        // STEP 3: LICENSE
        // =================================================================
        {
            id: "license",
            title: "License Information",
            stepNumber: 3,
            order: 0,
            fields: [
                {
                    key: "cdlState",
                    label: "License State",
                    type: "select",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(3)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "cdlClass",
                    label: "License Class",
                    type: "radio",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(3)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Class A", value: "Class A" },
                        { label: "Class B", value: "Class B" },
                        { label: "Class C", value: "Class C" },
                        { label: "Non-CDL", value: "Non-CDL" }
                    ]
                },
                {
                    key: "cdlNumber",
                    label: "License Number",
                    type: "text",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(3)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "cdlExpiration",
                    label: "License Expiration",
                    type: "date",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(3)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "endorsements",
                    label: "Endorsements",
                    type: "checkboxes",
                    required: false,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(b)(3)",
                    canCompanyHide: false,
                    canCompanyModify: false,
                    options: [
                        { label: "Hazmat (H)", value: "H" },
                        { label: "Tanker (N)", value: "N" },
                        { label: "Doubles/Triples (T)", value: "T" },
                        { label: "Passenger (P)", value: "P" },
                        { label: "School Bus (S)", value: "S" }
                    ]
                }
            ]
        },
        // =================================================================
        // STEP 9: CERTIFICATION
        // =================================================================
        {
            id: "consent",
            title: "Certification & Signature",
            stepNumber: 9,
            order: 0,
            fields: [
                {
                    key: "final-certification",
                    label: "I certify that all information is true and complete",
                    type: "checkbox",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(e)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "signature",
                    label: "Signature",
                    type: "signature",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(e)",
                    canCompanyHide: false,
                    canCompanyModify: false
                },
                {
                    key: "signature-date",
                    label: "Date",
                    type: "date",
                    required: true,
                    dotRequired: true,
                    fmcsaReference: "49 CFR 391.21(e)",
                    canCompanyHide: false,
                    canCompanyModify: false
                }
            ]
        }
    ]
};

export default GLOBAL_SCHEMA_SEED;
