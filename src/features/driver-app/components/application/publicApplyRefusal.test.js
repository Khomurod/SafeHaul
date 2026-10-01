/**
 * Which submission failures count as the server refusing the answers, and so are
 * not retried or queued, and which wizard page a refusal sends the applicant to.
 *
 * The behaviour around them (no "Application Saved" screen, the queue entry
 * removed, the page changed) is pinned by
 * `PublicApplyHandler.submit.contract.test.jsx`. This file pins the boundary
 * itself: a failure to deliver must never be treated as a refusal, because that
 * would cost the applicant the offline queue.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/components/layout/Stepper', () => ({
    // The semantic step is under test here. The index it maps to belongs to the
    // Stepper's own contract.
    resolveWizardStepIndex: (semanticStep, hasCustomQuestions) => `${semanticStep}${hasCustomQuestions ? '+custom' : ''}`,
}));

import { isPermanentRefusal, refusalStepIndex } from './publicApplyRefusal';

describe('isPermanentRefusal', () => {
    it.each([
        'functions/invalid-argument',
        'functions/failed-precondition',
        'functions/permission-denied',
        'functions/not-found',
        'functions/already-exists',
        'functions/out-of-range',
        'functions/unauthenticated',
        'functions/unimplemented',
    ])('%s is the server reading the application and refusing it', (code) => {
        expect(isPermanentRefusal({ code })).toBe(true);
    });

    it.each([
        // How the SDK reports a request that never reached the function.
        'functions/internal',
        'functions/unavailable',
        'functions/deadline-exceeded',
        // The rate limiter: the same payload succeeds later.
        'functions/resource-exhausted',
        'functions/cancelled',
        'functions/unknown',
        'functions/aborted',
    ])('%s is a failure to deliver, so it stays retryable and queueable', (code) => {
        expect(isPermanentRefusal({ code })).toBe(false);
    });

    it('treats an error without a callable code as a failure to deliver', () => {
        expect(isPermanentRefusal(new TypeError('Failed to fetch'))).toBe(false);
        expect(isPermanentRefusal(undefined)).toBe(false);
        expect(isPermanentRefusal(null)).toBe(false);
    });
});

describe('refusalStepIndex', () => {
    it('goes to the page the first located issue names', () => {
        const error = {
            code: 'functions/invalid-argument',
            details: { issues: [{ code: 'x' }, { code: 'hos', semanticStep: 'general' }, { semanticStep: 'license' }] },
        };
        expect(refusalStepIndex(error, false)).toBe('general');
    });

    it('resolves that page in the order the applicant actually sees', () => {
        const error = { details: { issues: [{ semanticStep: 'employment' }] } };
        expect(refusalStepIndex(error, true)).toBe('employment+custom');
    });

    it('stays where the applicant is when the refusal names no page', () => {
        expect(refusalStepIndex({ code: 'functions/invalid-argument' }, false)).toBeNull();
        expect(refusalStepIndex({ details: {} }, false)).toBeNull();
        expect(refusalStepIndex({ details: { issues: [{ code: 'x' }] } }, false)).toBeNull();
        expect(refusalStepIndex(undefined, false)).toBeNull();
    });
});
