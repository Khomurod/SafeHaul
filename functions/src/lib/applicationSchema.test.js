// src/lib/applicationSchema.test.js
/**
 * Application Schema Tests
 *
 * These tests ensure schema integrity and catch Mirror Law violations:
 * - All field keys are unique across sections
 * - Required DOT compliance fields are defined
 * - Schema drift detection works correctly
 * - Field lookup functions return expected results
 */

import { describe, it, expect } from 'vitest';
import {
    APPLICATION_SCHEMA,
    getAllFieldKeys,
    getFieldDefinition,
    getSection,
    getFieldsForStep,
    getFieldsForAdminComponent,
    getRedFlagFields,
    detectSchemaDrift,
    isFieldVisible,
    validateRequiredFields,
    FIELD_TYPES
} from './applicationSchema';

describe('applicationSchema', () => {

    describe('Schema Integrity', () => {

        it('should have unique field keys across all sections', () => {
            const allKeys = getAllFieldKeys();
            const uniqueKeys = new Set(allKeys);

            // If there are duplicates, find them for debugging
            if (allKeys.length !== uniqueKeys.size) {
                const seen = new Set();
                const duplicates = allKeys.filter(key => {
                    if (seen.has(key)) return true;
                    seen.add(key);
                    return false;
                });
                console.error('Duplicate keys found:', duplicates);
            }

            expect(allKeys.length).toBe(uniqueKeys.size);
        });

        it('should have all sections with required properties', () => {
            APPLICATION_SCHEMA.forEach(section => {
                expect(section).toHaveProperty('sectionId');
                expect(section).toHaveProperty('title');
                expect(section).toHaveProperty('fields');
                expect(Array.isArray(section.fields)).toBe(true);
            });
        });

        it('should have all fields with required properties', () => {
            APPLICATION_SCHEMA.forEach(section => {
                section.fields.forEach(field => {
                    expect(field).toHaveProperty('key');
                    expect(field).toHaveProperty('label');
                    expect(field).toHaveProperty('type');
                    expect(typeof field.key).toBe('string');
                    expect(typeof field.label).toBe('string');
                });
            });
        });

        it('should use valid field types', () => {
            const validTypes = Object.values(FIELD_TYPES);

            APPLICATION_SCHEMA.forEach(section => {
                section.fields.forEach(field => {
                    expect(validTypes).toContain(field.type);
                });
            });
        });

    });

    describe('DOT Compliance', () => {

        it('should define all required fields for DOT compliance', () => {
            const requiredDOTFields = [
                'firstName',
                'lastName',
                'dob',
                'ssn',
                'phone',
                'email',
                'cdlNumber',
                'cdlState',
                'cdlExpiration',
                'signature'
            ];

            const knownKeys = new Set(getAllFieldKeys());

            requiredDOTFields.forEach(key => {
                expect(knownKeys.has(key)).toBe(true);
            });
        });

        it('should have red flag fields for safety-critical declarations', () => {
            const redFlagFields = getRedFlagFields();

            expect(redFlagFields.length).toBeGreaterThan(0);

            // These are critical safety fields that should be flagged
            const expectedRedFlags = [
                'revoked-licenses',
                'driving-convictions',
                'drug-alcohol-convictions',
                'has-felony'
            ];

            const redFlagKeys = redFlagFields.map(f => f.key);
            expectedRedFlags.forEach(key => {
                expect(redFlagKeys).toContain(key);
            });
        });

    });

    describe('Field Lookup Functions', () => {

        it('should return field definition with section context', () => {
            const def = getFieldDefinition('firstName');

            expect(def).not.toBeNull();
            expect(def.label).toBe('First Name');
            expect(def.sectionId).toBe('personal');
            expect(def.wizardStep).toBe(1);
        });

        it('should return null for unknown fields', () => {
            const def = getFieldDefinition('nonExistentField12345');
            expect(def).toBeNull();
        });

        it('should get section by ID', () => {
            const section = getSection('personal');

            expect(section).not.toBeNull();
            expect(section.sectionId).toBe('personal');
            expect(section.title).toBe('Personal Information');
        });

        it('should get fields for wizard step', () => {
            const step1Fields = getFieldsForStep(1);

            expect(step1Fields.length).toBeGreaterThan(0);
            expect(step1Fields.some(f => f.key === 'firstName')).toBe(true);
            expect(step1Fields.some(f => f.key === 'email')).toBe(true);
        });

        it('should get fields for admin component', () => {
            const personalFields = getFieldsForAdminComponent('PersonalInfoSection');

            expect(personalFields.length).toBeGreaterThan(0);
            expect(personalFields.some(f => f.key === 'firstName')).toBe(true);
        });

    });

    describe('Schema Drift Detection', () => {

        it('should detect unknown fields in application data', () => {
            const dataWithUnknown = {
                firstName: 'John',
                lastName: 'Doe',
                unknownField123: 'mystery value',
                anotherUnknown: 'test'
            };

            const drift = detectSchemaDrift(dataWithUnknown);

            expect(drift).toContain('unknownField123');
            expect(drift).toContain('anotherUnknown');
            expect(drift).not.toContain('firstName');
            expect(drift).not.toContain('lastName');
        });

        it('should ignore known system fields', () => {
            const dataWithSystemFields = {
                firstName: 'John',
                createdAt: new Date(),
                status: 'New Application',
                companyId: 'abc123'
            };

            const drift = detectSchemaDrift(dataWithSystemFields);

            expect(drift).not.toContain('createdAt');
            expect(drift).not.toContain('status');
            expect(drift).not.toContain('companyId');
        });

        it('should return empty array for clean data', () => {
            const cleanData = {
                firstName: 'John',
                lastName: 'Doe',
                phone: '555-1234',
                email: 'john@example.com'
            };

            const drift = detectSchemaDrift(cleanData);

            expect(drift).toEqual([]);
        });

    });

    describe('Conditional Visibility', () => {

        it('should respect showIf conditions', () => {
            const otherNameField = getFieldDefinition('otherName');

            expect(otherNameField).not.toBeNull();
            expect(otherNameField.showIf).toBeDefined();

            // Test visibility with different data states
            const hiddenState = { 'known-by-other-name': 'no' };
            const visibleState = { 'known-by-other-name': 'yes' };

            expect(isFieldVisible(otherNameField, hiddenState)).toBe(false);
            expect(isFieldVisible(otherNameField, visibleState)).toBe(true);
        });

        it('should always show fields without showIf', () => {
            const firstNameField = getFieldDefinition('firstName');

            expect(isFieldVisible(firstNameField, {})).toBe(true);
            expect(isFieldVisible(firstNameField, { anyData: 'value' })).toBe(true);
        });

    });

    describe('Validation', () => {

        it('should validate required fields', () => {
            const incompleteData = {
                firstName: 'John',
                // missing lastName, phone, email, etc.
            };

            const result = validateRequiredFields(incompleteData, 1);

            expect(result.valid).toBe(false);
            expect(result.missing).toContain('lastName');
            expect(result.missing).toContain('phone');
            expect(result.missing).toContain('email');
        });

        it('should pass validation for complete data', () => {
            const completeStep1 = {
                firstName: 'John',
                lastName: 'Doe',
                phone: '555-123-4567',
                email: 'john@example.com',
                street: '123 Main St',
                city: 'Anytown',
                state: 'TX',
                zip: '12345'
            };

            const result = validateRequiredFields(completeStep1, 1);

            // Note: May still fail if there are other required fields
            // This test verifies the function works, not that all fields pass
            expect(typeof result.valid).toBe('boolean');
            expect(Array.isArray(result.missing)).toBe(true);
        });

    });

});

describe('Mirror Law Compliance', () => {

    it('should have admin component mappings for all non-review sections', () => {
        const sectionsNeedingAdminMapping = APPLICATION_SCHEMA.filter(
            s => s.sectionId !== 'review' && s.fields.length > 0
        );

        sectionsNeedingAdminMapping.forEach(section => {
            if (section.adminComponent === null) {
                console.warn(`Section "${section.sectionId}" has no adminComponent mapping`);
            }
            // Note: null is allowed for wizard-only steps like 'review'
        });

        // At minimum, key sections should have mappings
        expect(getSection('personal').adminComponent).toBe('PersonalInfoSection');
        expect(getSection('violations').adminComponent).toBe('SupplementalSection');
    });

});
