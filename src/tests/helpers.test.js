// src/tests/helpers.test.js
import { describe, it, expect } from 'vitest';
import { 
    normalizePhone, 
    formatPhoneNumber, 
    getFieldValue, 
    getStatusColor 
} from '../utils/helpers';

describe('Utility Helpers', () => {
    
    // --- 1. Phone Normalization Tests ---
    describe('normalizePhone', () => {
        it('removes non-digit characters', () => {
            expect(normalizePhone('(123) 456-7890')).toBe('1234567890');
            expect(normalizePhone('123-456-7890')).toBe('1234567890');
            expect(normalizePhone('123.456.7890')).toBe('1234567890');
            expect(normalizePhone('123 456 7890')).toBe('1234567890');
        });

        it('strips US country code (+1) if present', () => {
            expect(normalizePhone('+1 123 456 7890')).toBe('1234567890');
            expect(normalizePhone('1-123-456-7890')).toBe('1234567890');
            expect(normalizePhone('11234567890')).toBe('1234567890');
        });

        it('handles dirty input/whitespace', () => {
            expect(normalizePhone('  (123) 456 7890  ')).toBe('1234567890');
        });

        it('handles empty or null input gracefully', () => {
            expect(normalizePhone('')).toBe('');
            expect(normalizePhone(null)).toBe('');
            expect(normalizePhone(undefined)).toBe('');
        });

        it('returns partial numbers as digits', () => {
            expect(normalizePhone('555-12')).toBe('55512');
        });
    });

    // --- 2. Phone Formatting Tests ---
    describe('formatPhoneNumber', () => {
        it('formats clean 10-digit numbers to (XXX) XXX-XXXX', () => {
            expect(formatPhoneNumber('1234567890')).toBe('(123) 456-7890');
        });

        it('formats messy input correctly', () => {
            expect(formatPhoneNumber('+1 (123) 456-7890')).toBe('(123) 456-7890');
        });

        it('returns original string for non-standard lengths', () => {
            // Short numbers
            expect(formatPhoneNumber('555')).toBe('555'); 
            // International/Long numbers
            expect(formatPhoneNumber('123456789012345')).toBe('123456789012345'); 
        });

        it('returns "Not Specified" for empty input', () => {
            expect(formatPhoneNumber('')).toBe('Not Specified');
            expect(formatPhoneNumber(null)).toBe('Not Specified');
            expect(formatPhoneNumber(undefined)).toBe('Not Specified');
        });
    });

    // --- 3. Field Value Tests ---
    describe('getFieldValue', () => {
        it('returns "Not Specified" for null/undefined/empty string', () => {
            expect(getFieldValue('')).toBe('Not Specified');
            expect(getFieldValue(null)).toBe('Not Specified');
            expect(getFieldValue(undefined)).toBe('Not Specified');
        });

        it('returns valid values as-is', () => {
            expect(getFieldValue('John Doe')).toBe('John Doe');
            expect(getFieldValue('123 Main St')).toBe('123 Main St');
        });

        it('handles numeric 0 correctly', () => {
            // 0 is falsy in JS, but a valid value in forms
            expect(getFieldValue(0)).toBe(0); 
        });
        
        it('handles boolean values', () => {
            expect(getFieldValue(true)).toBe(true);
            expect(getFieldValue(false)).toBe(false);
        });
    });

    // --- 4. Status Color Logic Tests ---
    describe('getStatusColor', () => {
        it('returns green for Approved', () => {
            const result = getStatusColor('Approved');
            expect(result).toContain('bg-green-100');
            expect(result).toContain('text-green-800');
        });

        it('returns red for Rejected', () => {
            const result = getStatusColor('Rejected');
            expect(result).toContain('bg-red-100');
            expect(result).toContain('text-red-800');
        });

        it('returns purple for Background Check', () => {
            const result = getStatusColor('Background Check');
            expect(result).toContain('bg-purple-100');
        });

        it('returns default gray for unknown status', () => {
            expect(getStatusColor('Unknown Status')).toContain('bg-gray-100');
            expect(getStatusColor('')).toContain('bg-gray-100');
            expect(getStatusColor(null)).toContain('bg-gray-100');
        });
    });
});