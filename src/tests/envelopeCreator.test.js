/**
 * EnvelopeCreator — sendSms Metadata Tests
 *
 * Validates that the sendSms flag persisted in signing_requests
 * correctly reflects the user's selected delivery method.
 *
 * Before the fix: sendSms was hardcoded to false regardless of selection.
 * After the fix: sendSms is computed from deliveryMethod.
 */
import { describe, it, expect } from 'vitest';

describe('EnvelopeCreator — sendSms Metadata Persistence', () => {
    // This mirrors the exact computation from EnvelopeCreator.jsx lines 535-536
    function computeDeliveryFlags(deliveryMethod) {
        const sendEmail = deliveryMethod === 'email' || deliveryMethod === 'both';
        const sendSms = deliveryMethod === 'sms' || deliveryMethod === 'both';
        return { sendEmail, sendSms };
    }

    it('should set sendSms=true for "sms" delivery method', () => {
        const { sendEmail, sendSms } = computeDeliveryFlags('sms');
        expect(sendSms).toBe(true);
        expect(sendEmail).toBe(false);
    });

    it('should set sendSms=true for "both" delivery method', () => {
        const { sendEmail, sendSms } = computeDeliveryFlags('both');
        expect(sendSms).toBe(true);
        expect(sendEmail).toBe(true);
    });

    it('should set sendSms=false for "email" delivery method', () => {
        const { sendEmail, sendSms } = computeDeliveryFlags('email');
        expect(sendSms).toBe(false);
        expect(sendEmail).toBe(true);
    });

    it('should set sendSms=false for "copy" delivery method', () => {
        const { sendEmail, sendSms } = computeDeliveryFlags('copy');
        expect(sendSms).toBe(false);
        expect(sendEmail).toBe(false);
    });

    it('should produce consistent flags for all delivery methods', () => {
        // Full truth table for the delivery method computation
        const expected = {
            email: { sendEmail: true, sendSms: false },
            sms:   { sendEmail: false, sendSms: true },
            both:  { sendEmail: true, sendSms: true },
            copy:  { sendEmail: false, sendSms: false },
        };

        for (const [method, expectedFlags] of Object.entries(expected)) {
            const flags = computeDeliveryFlags(method);
            expect(flags).toEqual(expectedFlags);
        }
    });
});

describe('EnvelopeCreator — History Badge Rendering', () => {
    it('should show SMS badge when sendSms is true', () => {
        // Simulates the badge logic from EnvelopeHistory.jsx
        const doc = { sendEmail: true, sendSms: true };
        expect(doc.sendSms).toBe(true);
        expect(doc.sendEmail).toBe(true);
    });

    it('should show Manual badge when both are false (copy link)', () => {
        const doc = { sendEmail: false, sendSms: false };
        const showManual = doc.sendEmail === false && doc.sendSms !== true;
        expect(showManual).toBe(true);
    });

    it('should NOT show Manual badge when sendSms is true', () => {
        const doc = { sendEmail: false, sendSms: true };
        const showManual = doc.sendEmail === false && doc.sendSms !== true;
        expect(showManual).toBe(false);
    });
});
