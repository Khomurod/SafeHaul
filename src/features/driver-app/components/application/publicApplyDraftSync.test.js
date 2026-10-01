import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileServerDraftOnLoad } from './publicApplyDraftSync';

/**
 * Where the late server-draft reconciliation leaves the applicant.
 *
 * It runs on load and again after a continuation link's identity check, and it is
 * a round trip — a cold-startable callable, on a phone. Until 2026-10-01 it applied
 * `Math.max(current, saved)` when it landed, so a driver who went back a page in
 * that window was put straight back where they had been: reproduced in a real
 * browser against the real callables by delaying `resumeApplicationDraft` 1.5s.
 */

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function harness({ stepAtStart }) {
    const pending = deferred();
    const stepUpdates = [];
    const latestDraftRef = { current: { formData: {}, currentStep: stepAtStart } };
    reconcileServerDraftOnLoad({
        slug: 'reconcile-step-test',
        invite: { status: 'absent' },
        resetGenerationRef: { current: 0 },
        restoredFromDraftRef: { current: false },
        draftIdRef: { current: null },
        discardGuardsRef: { current: { discardedElsewhere: () => false, handleDiscardedElsewhere: vi.fn() } },
        latestDraftRef,
        restoreFromStoredToken: () => pending.promise,
        onIdentitySatisfied: vi.fn(),
        setFormData: vi.fn(),
        setCurrentStep: (update) => stepUpdates.push(update),
        setIntakeMode: vi.fn(),
    });
    const land = async (stepIndex) => {
        pending.resolve({ formData: { firstName: 'Marcus' }, stepIndex, clientSeq: 3, applicantKey: 'k1' });
        await pending.promise;
        await Promise.resolve();
    };
    return { stepUpdates, latestDraftRef, land };
}

afterEach(() => localStorage.clear());

describe('reconcileServerDraftOnLoad and the step', () => {
    it('keeps a Back the applicant pressed while the server copy was in flight', async () => {
        const { stepUpdates, latestDraftRef, land } = harness({ stepAtStart: 2 });
        // The applicant presses Back: License (2) → Qualification (1).
        latestDraftRef.current = { ...latestDraftRef.current, currentStep: 1 };
        await land(2);
        expect(stepUpdates).toHaveLength(1);
        expect(stepUpdates[0](1)).toBe(1);
    });

    it('still takes the applicant to the furthest saved page when they have not moved', async () => {
        const { stepUpdates, land } = harness({ stepAtStart: 0 });
        await land(4);
        expect(stepUpdates[0](0)).toBe(4);
    });

    it('never moves an applicant backwards from where they are', async () => {
        const { stepUpdates, land } = harness({ stepAtStart: 5 });
        await land(3);
        expect(stepUpdates[0](5)).toBe(5);
    });

    it('still advances an applicant whose server copy is further on than a page they moved forward to', async () => {
        const { stepUpdates, latestDraftRef, land } = harness({ stepAtStart: 1 });
        latestDraftRef.current = { ...latestDraftRef.current, currentStep: 2 };
        await land(4);
        expect(stepUpdates[0](2)).toBe(4);
    });
});
