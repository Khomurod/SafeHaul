import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileServerDraftOnLoad } from './publicApplyDraftSync';
import { draftSyncState, readApplicationDraft, saveApplicationDraft } from './applicationDraftStorage';

/**
 * Where the late server-draft reconciliation leaves the applicant.
 *
 * It runs on load and again after a continuation link's identity check, and it is
 * a round trip — a cold-startable callable, on a phone. It must not apply
 * `Math.max(current, saved)` when it lands: a driver who went back a page in that
 * window would be put straight back where they had been.
 */

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function harness({
    stepAtStart, referralCode = null, serverFormData = { firstName: 'Marcus' }, discarded = false,
    invite = { status: 'absent' },
}) {
    const pending = deferred();
    const stepUpdates = [];
    const formUpdates = [];
    const latestDraftRef = { current: { formData: {}, currentStep: stepAtStart } };
    const draftIdRef = { current: null };
    reconcileServerDraftOnLoad({
        slug: 'reconcile-step-test',
        invite,
        referralCode,
        resetGenerationRef: { current: 0 },
        restoredFromDraftRef: { current: false },
        draftIdRef,
        discardGuardsRef: { current: { discardedElsewhere: () => discarded, handleDiscardedElsewhere: vi.fn() } },
        latestDraftRef,
        restoreFromStoredToken: () => pending.promise,
        onIdentitySatisfied: vi.fn(),
        setFormData: (update) => formUpdates.push(update),
        setCurrentStep: (update) => stepUpdates.push(update),
        setIntakeMode: vi.fn(),
    });
    const land = async (stepIndex) => {
        pending.resolve({ formData: serverFormData, stepIndex, clientSeq: 3, applicantKey: 'k1' });
        await pending.promise;
        await Promise.resolve();
    };
    // No server copy to restore: no token, or the server draft is gone.
    const landNothing = async () => {
        pending.resolve(null);
        await pending.promise;
        await Promise.resolve();
    };
    return { stepUpdates, formUpdates, latestDraftRef, draftIdRef, land, landNothing };
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

describe('reconcileServerDraftOnLoad and a referral link', () => {
    it('keeps the code of the link clicked over the one the server copy saved', async () => {
        const { formUpdates, land } = harness({
            stepAtStart: 0,
            referralCode: 'WXYZ6789',
            serverFormData: { firstName: 'Marcus', referralCode: 'ABCD2345' },
        });
        await land(2);
        expect(formUpdates).toHaveLength(1);
        expect(formUpdates[0]({ referralCode: 'WXYZ6789' })).toMatchObject({ firstName: 'Marcus', referralCode: 'WXYZ6789' });
    });

    it('stores the link code with the copy it writes back, still owed to the server', async () => {
        const { land } = harness({
            stepAtStart: 0,
            referralCode: 'WXYZ6789',
            serverFormData: { firstName: 'Marcus', referralCode: 'ABCD2345' },
        });
        await land(2);
        expect(readApplicationDraft('reconcile-step-test')?.data?.referralCode).toBe('WXYZ6789');
        expect(draftSyncState('reconcile-step-test')?.dirty).toBe(true);
    });

    it('stores the link code when this device\'s unsent copy wins too', async () => {
        saveApplicationDraft('reconcile-step-test', { firstName: 'Marcus', lastName: 'Lee', referralCode: 'ABCD2345' }, { lastStep: 3 });
        const { formUpdates, land } = harness({
            stepAtStart: 0,
            referralCode: 'WXYZ6789',
            serverFormData: { firstName: 'Marcus', referralCode: 'ABCD2345' },
        });
        await land(2);
        expect(formUpdates[0]({})).toMatchObject({ lastName: 'Lee', referralCode: 'WXYZ6789' });
        const stored = readApplicationDraft('reconcile-step-test');
        expect(stored?.data).toMatchObject({ lastName: 'Lee', referralCode: 'WXYZ6789' });
        expect(stored?.lastStep).toBe(3);
        expect(draftSyncState('reconcile-step-test')?.dirty).toBe(true);
    });

    it('remembers the name the winning copy is given when it had none', async () => {
        // An old draft, written before drafts carried a name or sequence.
        localStorage.setItem('draft_reconcile-step-test', JSON.stringify({ firstName: 'Marcus', referralCode: 'ABCD2345', lastStep: 3 }));
        const { draftIdRef, land } = harness({
            stepAtStart: 0,
            referralCode: 'WXYZ6789',
            serverFormData: { firstName: 'Marcus', referralCode: 'ABCD2345' },
        });
        await land(2);
        const stored = readApplicationDraft('reconcile-step-test');
        expect(stored?.data?.referralCode).toBe('WXYZ6789');
        expect(stored?.meta?.draftId).toBeTruthy();
        expect(draftIdRef.current).toBe(stored.meta.draftId);
    });

    it('stores the link code in the local copy when there is no server copy', async () => {
        saveApplicationDraft('reconcile-step-test', { firstName: 'Marcus', referralCode: 'ABCD2345' }, { lastStep: 3 });
        const { draftId } = readApplicationDraft('reconcile-step-test').meta;
        const { formUpdates, draftIdRef, landNothing } = harness({ stepAtStart: 0, referralCode: 'WXYZ6789' });
        await landNothing();
        const stored = readApplicationDraft('reconcile-step-test');
        expect(stored?.data).toMatchObject({ firstName: 'Marcus', referralCode: 'WXYZ6789' });
        expect(stored?.lastStep).toBe(3);
        expect(stored?.meta?.draftId).toBe(draftId);
        expect(draftIdRef.current).toBe(draftId);
        expect(formUpdates).toHaveLength(0);
    });

    it('writes nothing without a local copy, a link code, or after a discard', async () => {
        const empty = harness({ stepAtStart: 0, referralCode: 'WXYZ6789' });
        await empty.landNothing();
        expect(readApplicationDraft('reconcile-step-test')).toBeNull();

        saveApplicationDraft('reconcile-step-test', { firstName: 'Marcus', referralCode: 'ABCD2345' });
        const noCode = harness({ stepAtStart: 0 });
        await noCode.landNothing();
        expect(readApplicationDraft('reconcile-step-test')?.data?.referralCode).toBe('ABCD2345');

        const discarded = harness({ stepAtStart: 0, referralCode: 'WXYZ6789', discarded: true });
        await discarded.landNothing();
        expect(readApplicationDraft('reconcile-step-test')?.data?.referralCode).toBe('ABCD2345');

        // The stored copy is another applicant's, left in this browser by an earlier visit.
        const foreign = harness({
            stepAtStart: 0, referralCode: 'WXYZ6789', invite: { status: 'opened', foreignSlot: true },
        });
        await foreign.landNothing();
        expect(readApplicationDraft('reconcile-step-test')?.data?.referralCode).toBe('ABCD2345');
    });

    it('leaves the saved code alone when the address carries none', async () => {
        const { formUpdates, land } = harness({
            stepAtStart: 0,
            serverFormData: { firstName: 'Marcus', referralCode: 'ABCD2345' },
        });
        await land(2);
        expect(formUpdates[0]({})).toMatchObject({ referralCode: 'ABCD2345' });
    });
});
