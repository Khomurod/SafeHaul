import { describe, expect, it } from 'vitest';
import { required, email, phone, ssn, fromFieldDefinition } from './fieldValidators';

describe('fieldValidators (C5)', () => {
    it('required flags empty / whitespace and passes non-empty', () => {
        const v = required('First Name');
        expect(v('')).toMatch(/required/i);
        expect(v('   ')).toMatch(/required/i);
        expect(v(undefined)).toMatch(/required/i);
        expect(v('John')).toBeNull();
    });

    it('email checks presence then format', () => {
        const v = email('Email');
        expect(v('')).toMatch(/required/i);
        expect(v('not-an-email')).toMatch(/valid email/i);
        expect(v('a@b.co')).toBeNull();
    });

    it('email respects isRequired: false', () => {
        const v = email('Email', { isRequired: false });
        expect(v('')).toBeNull();
        expect(v('bad')).toMatch(/valid email/i);
    });

    it('phone checks presence then 10/11-digit format', () => {
        const v = phone('Phone');
        expect(v('')).toMatch(/required/i);
        expect(v('555')).toMatch(/valid phone/i);
        expect(v('(555) 123-4567')).toBeNull();
        expect(v('15551234567')).toBeNull();
    });

    it('ssn validates 9 digits', () => {
        const v = ssn('SSN');
        expect(v('123-45-678')).toMatch(/9 digits/i);
        expect(v('123-45-6789')).toBeNull();
    });

    it('fromFieldDefinition derives a validator from schema type/required', () => {
        expect(fromFieldDefinition({ label: 'Email', type: 'email', required: true })('bad'))
            .toMatch(/valid email/i);
        expect(fromFieldDefinition({ label: 'Phone', type: 'tel', required: true })('123'))
            .toMatch(/valid phone/i);
        expect(fromFieldDefinition({ label: 'Name', type: 'text', required: true })(''))
            .toMatch(/required/i);
        // Non-required text field never errors.
        expect(fromFieldDefinition({ label: 'Suffix', type: 'text', required: false })(''))
            .toBeNull();
    });
});
