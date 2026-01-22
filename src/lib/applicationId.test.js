/**
 * Unit tests for Application ID Generator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    generateApplicationId,
    generateApplicationIdSync,
    generateConfirmationNumber,
    parseConfirmationNumber,
    isValidApplicationId,
} from './applicationId';

describe('Application ID Generator', () => {

    describe('generateApplicationId (async)', () => {
        it('should generate a 20-character hex ID', async () => {
            const id = await generateApplicationId('company-1', 'test@example.com', '555-123-4567');

            expect(id).toBeDefined();
            expect(id.length).toBe(20);
            expect(/^[a-f0-9]{20}$/.test(id)).toBe(true);
        });

        it('should generate the same ID for the same inputs', async () => {
            const id1 = await generateApplicationId('company-1', 'john@test.com', '555-111-2222');
            const id2 = await generateApplicationId('company-1', 'john@test.com', '555-111-2222');

            expect(id1).toBe(id2);
        });

        it('should generate different IDs for different companies', async () => {
            const id1 = await generateApplicationId('company-A', 'same@email.com', '555-999-8888');
            const id2 = await generateApplicationId('company-B', 'same@email.com', '555-999-8888');

            expect(id1).not.toBe(id2);
        });

        it('should generate different IDs for different emails', async () => {
            const id1 = await generateApplicationId('company-1', 'user1@test.com', '555-000-0000');
            const id2 = await generateApplicationId('company-1', 'user2@test.com', '555-000-0000');

            expect(id1).not.toBe(id2);
        });

        it('should generate different IDs for different phones', async () => {
            const id1 = await generateApplicationId('company-1', 'same@test.com', '111-111-1111');
            const id2 = await generateApplicationId('company-1', 'same@test.com', '222-222-2222');

            expect(id1).not.toBe(id2);
        });

        it('should normalize email (case insensitive)', async () => {
            const id1 = await generateApplicationId('company-1', 'TEST@EXAMPLE.COM', '555-123-4567');
            const id2 = await generateApplicationId('company-1', 'test@example.com', '555-123-4567');

            expect(id1).toBe(id2);
        });

        it('should normalize phone (ignore formatting)', async () => {
            const id1 = await generateApplicationId('company-1', 'test@test.com', '(555) 123-4567');
            const id2 = await generateApplicationId('company-1', 'test@test.com', '5551234567');

            expect(id1).toBe(id2);
        });

        it('should work with only email (no phone)', async () => {
            const id = await generateApplicationId('company-1', 'only@email.com', '');

            expect(id).toBeDefined();
            expect(id.length).toBe(20);
        });

        it('should work with only phone (no email)', async () => {
            const id = await generateApplicationId('company-1', '', '555-123-4567');

            expect(id).toBeDefined();
            expect(id.length).toBe(20);
        });

        it('should generate anonymous ID when both email and phone are missing', async () => {
            const id = await generateApplicationId('company-1', '', '');

            expect(id).toBeDefined();
            expect(id.startsWith('anon_')).toBe(true);
        });

        it('should throw if companyId is missing', async () => {
            await expect(
                generateApplicationId('', 'test@test.com', '555-123-4567')
            ).rejects.toThrow('companyId is required');
        });
    });

    describe('generateApplicationIdSync', () => {
        it('should generate a deterministic ID', () => {
            const id1 = generateApplicationIdSync('company-1', 'test@example.com', '5551234567');
            const id2 = generateApplicationIdSync('company-1', 'test@example.com', '5551234567');

            // The timestamp portion will be same within test execution
            expect(id1.split('_')[0]).toBe(id2.split('_')[0]);
        });

        it('should handle missing email/phone with anonymous fallback', () => {
            const id = generateApplicationIdSync('company-1', '', '');
            expect(id.startsWith('anon_')).toBe(true);
        });

        it('should throw if companyId is missing', () => {
            expect(() => {
                generateApplicationIdSync('', 'test@test.com', '12345');
            }).toThrow('companyId is required');
        });
    });

    describe('generateConfirmationNumber', () => {
        it('should generate a valid confirmation number', () => {
            const conf = generateConfirmationNumber();

            expect(conf).toMatch(/^SAF-\d{4}-[A-Z0-9]{5}$/);
        });

        it('should include current year', () => {
            const conf = generateConfirmationNumber();
            const year = new Date().getFullYear();

            expect(conf).toContain(`SAF-${year}-`);
        });

        it('should generate unique numbers', () => {
            const numbers = new Set();
            for (let i = 0; i < 100; i++) {
                numbers.add(generateConfirmationNumber());
            }

            // At least 95% should be unique (accounting for very rare collisions)
            expect(numbers.size).toBeGreaterThanOrEqual(95);
        });
    });

    describe('parseConfirmationNumber', () => {
        it('should extract year from valid confirmation number', () => {
            const year = parseConfirmationNumber('SAF-2026-ABC12');
            expect(year).toBe(2026);
        });

        it('should return null for invalid format', () => {
            expect(parseConfirmationNumber('INVALID')).toBeNull();
            expect(parseConfirmationNumber('SAF-YEAR-XXXXX')).toBeNull();
            expect(parseConfirmationNumber('')).toBeNull();
            expect(parseConfirmationNumber(null)).toBeNull();
        });
    });

    describe('isValidApplicationId', () => {
        it('should validate 20-char hex IDs', () => {
            expect(isValidApplicationId('1234567890abcdef1234')).toBe(true);
            expect(isValidApplicationId('abcdef1234567890abcd')).toBe(true);
        });

        it('should validate anonymous IDs', () => {
            expect(isValidApplicationId('anon_abc123_xyz789')).toBe(true);
        });

        it('should validate sync-format IDs', () => {
            expect(isValidApplicationId('1234567_test_abc123')).toBe(true);
        });

        it('should reject invalid IDs', () => {
            expect(isValidApplicationId('')).toBe(false);
            expect(isValidApplicationId(null)).toBe(false);
            expect(isValidApplicationId(123)).toBe(false);
            expect(isValidApplicationId('too-short')).toBe(false);
            expect(isValidApplicationId('has spaces in it')).toBe(false);
        });
    });
});
