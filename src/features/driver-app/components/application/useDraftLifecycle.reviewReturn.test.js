// After Edit on the Review page, Continue on the edited step goes straight back to
// Review instead of walking every later page again — once, only from that step, and
// only while that application lasts.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./applicationDraftStorage', () => ({
    readApplicationDraft: vi.fn(),
    saveApplicationDraft: vi.fn(() => ({ localSeq: 1, draftId: 'draft-1' })),
    clearApplicationDraft: vi.fn(),
    writeDiscardMark: vi.fn(),
}));
vi.mock('../../services/applicationDraftService', () => ({ closeDraftAfterSubmission: vi.fn() }));

import { useDraftLifecycle } from './useDraftLifecycle';

const REVIEW = 8;

/** The hook on a wizard that starts at `startStep`; `go` navigates and returns the new step. */
function wizardAt(startStep) {
    let step = startStep;
    const saveDraftToServer = vi.fn();
    const discardMarkRef = { current: 'mark-1' };
    const props = () => ({
        slug: 'acme',
        sandbox: false,
        formData: {},
        currentStep: step,
        draftIdRef: { current: null },
        restoredFromDraftRef: { current: false },
        discardMarkRef,
        discardedElsewhere: () => false,
        handleDiscardedElsewhere: vi.fn(),
        continueExisting: vi.fn(),
        startOver: vi.fn(),
        forgetDraftOwnership: vi.fn(),
        saveDraftToServer,
        setFormData: vi.fn(),
        setCurrentStep: (next) => { step = next; },
        setIntakeMode: vi.fn(),
        showSuccess: vi.fn(),
        showError: vi.fn(),
        showInfo: vi.fn(),
    });
    const hook = renderHook(() => useDraftLifecycle(props()));
    const go = (direction) => {
        act(() => hook.result.current.handleNavigate(direction));
        hook.rerender();
        return step;
    };
    /** What a discard elsewhere or a Start Over does: a new mark, and the wizard reset. */
    const reset = (toStep) => {
        discardMarkRef.current = 'mark-2';
        step = toStep;
        hook.rerender();
    };
    return { go, reset, saveDraftToServer };
}

describe('Continue after Edit on Review', () => {
    it('returns to Review from the step the Edit opened, and saves that step', () => {
        const { go, saveDraftToServer } = wizardAt(REVIEW);

        expect(go(2)).toBe(2);
        expect(go('next')).toBe(REVIEW);
        expect(saveDraftToServer).toHaveBeenLastCalledWith(expect.objectContaining({ stepIndex: REVIEW }));
    });

    it('does so once: from Review the wizard moves one page at a time again', () => {
        const { go } = wizardAt(REVIEW);

        go(2);
        go('next');
        expect(go('next')).toBe(REVIEW + 1);
    });

    it('is forgotten after Back, so Continue walks forward from there', () => {
        const { go } = wizardAt(REVIEW);

        go(2);
        expect(go('back')).toBe(1);
        expect(go('next')).toBe(2);
        expect(go('next')).toBe(3);
    });

    it('is forgotten when that application ends, so a fresh page one walks forward', () => {
        const { go, reset } = wizardAt(REVIEW);

        go(0);
        reset(0);

        expect(go('next')).toBe(1);
    });

    it('never applies without an Edit', () => {
        const { go } = wizardAt(3);

        expect(go('next')).toBe(4);
    });
});
