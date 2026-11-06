// "Finish later": the save every Continue makes, without moving on, and what the
// step footer may then tell the driver about coming back. Another device is
// mentioned only once the server has confirmed this copy and the facts it is
// matched on are on the page. Real local storage; the server save is a double.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/applicationDraftService', () => ({ closeDraftAfterSubmission: vi.fn() }));

import { canBeFoundElsewhere, useDraftLifecycle } from './useDraftLifecycle';
import { draftSyncState, markDraftSynced } from './applicationDraftStorage';
import { heldIdentityTracker } from './resumeIdentity';

const SLUG = 'acme';
const IDENTIFIED = {
    firstName: 'Ada',
    lastName: 'Driver',
    dob: '1984-03-14',
    ssn: '123-45-6789',
    email: 'ada@example.com',
    phone: '5125550142',
};

/** What the server confirmed holding, as `useDiscardAwareResume` tracks it. */
let server;

/** A server that acknowledges the save it receives, as `sendSave` does. */
const acknowledgingServer = () => vi.fn(async ({ formData, localSeq, draftId }) => {
    markDraftSynced(SLUG, localSeq, { draftId });
    server.record(formData, { saved: true });
});

function lifecycle({ formData = IDENTIFIED, saveDraftToServer = acknowledgingServer(), ...overrides } = {}) {
    const props = {
        slug: SLUG,
        sandbox: false,
        formData,
        currentStep: 2,
        draftIdRef: { current: null },
        restoredFromDraftRef: { current: false },
        discardMarkRef: { current: null },
        discardedElsewhere: () => false,
        handleDiscardedElsewhere: vi.fn(),
        continueExisting: vi.fn(),
        startOver: vi.fn(),
        forgetDraftOwnership: vi.fn(),
        saveDraftToServer,
        serverHoldsIdentity: (answers) => server.holds(answers),
        setFormData: vi.fn(),
        setCurrentStep: vi.fn(),
        setIntakeMode: vi.fn(),
        showSuccess: vi.fn(),
        showError: vi.fn(),
        showInfo: vi.fn(),
        sendFile: vi.fn(),
        ...overrides,
    };
    const { result } = renderHook(() => useDraftLifecycle(props));
    let outcome;
    act(() => { outcome = result.current.handlePartialSubmit(); });
    return { outcome, props };
}

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    server = heldIdentityTracker();
});

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Finish later', () => {
    it('saves here and to the server, records the page, and says so without a toast', async () => {
        const { outcome, props } = lifecycle();

        expect(outcome).toMatchObject({ saved: true });
        const stored = JSON.parse(localStorage.getItem(`draft_${SLUG}`));
        expect(stored.lastStep).toBe(2);
        expect(stored.data.ssn).toBeUndefined();
        expect(props.saveDraftToServer).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 2 }));
        expect(props.showSuccess).not.toHaveBeenCalled();
        await expect(outcome.anotherDevice).resolves.toBe(true);
    });

    it('does not mention another device while the server has not confirmed this copy', async () => {
        const { outcome } = lifecycle({ saveDraftToServer: vi.fn(async () => undefined) });

        expect(outcome.saved).toBe(true);
        expect(draftSyncState(SLUG).dirty).toBe(true);
        await expect(outcome.anotherDevice).resolves.toBe(false);
    });

    it('does not mention another device when the server save fails', async () => {
        const { outcome } = lifecycle({ saveDraftToServer: vi.fn(async () => { throw new Error('offline'); }) });

        await expect(outcome.anotherDevice).resolves.toBe(false);
    });

    it('does not mention another device for an SSN the server never received', async () => {
        // Saved and confirmed without an SSN: the local copy is clean.
        const first = lifecycle({ formData: { ...IDENTIFIED, ssn: '' } });
        await expect(first.outcome.anotherDevice).resolves.toBe(false);
        expect(draftSyncState(SLUG).dirty).toBe(false);

        // The SSN typed since is stripped from the local copy, so the copy stays
        // clean, and the save carrying it does not land (it fails quietly).
        const { outcome } = lifecycle({ saveDraftToServer: vi.fn(async () => undefined) });

        expect(draftSyncState(SLUG).dirty).toBe(false);
        await expect(outcome.anotherDevice).resolves.toBe(false);
    });

    it('does not mention another device without the facts it is matched on, but still saves', async () => {
        const { outcome, props } = lifecycle({ formData: { ...IDENTIFIED, ssn: '' } });

        expect(outcome.saved).toBe(true);
        expect(props.saveDraftToServer).toHaveBeenCalled();
        await expect(outcome.anotherDevice).resolves.toBe(false);
    });

    it('never mentions another device in the sandbox', async () => {
        const { outcome } = lifecycle({ sandbox: true });

        await expect(outcome.anotherDevice).resolves.toBe(false);
    });

    it('says nothing about coming back when the local copy cannot be written', () => {
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        const { outcome, props } = lifecycle();

        expect(outcome).toBeNull();
        expect(props.showError).toHaveBeenCalledWith(
            'Could not save progress locally. Your data is still here — please continue filling the form.',
        );
        expect(props.saveDraftToServer).not.toHaveBeenCalled();
    });

    it('saves nothing for an application discarded in another tab', () => {
        const { outcome, props } = lifecycle({ discardedElsewhere: () => true });

        expect(outcome).toBeNull();
        expect(props.handleDiscardedElsewhere).toHaveBeenCalled();
        expect(props.saveDraftToServer).not.toHaveBeenCalled();
        expect(localStorage.getItem(`draft_${SLUG}`)).toBeNull();
    });
});

describe('canBeFoundElsewhere', () => {
    it('needs a last name, a date of birth, a nine-digit SSN and an email or phone', () => {
        expect(canBeFoundElsewhere(IDENTIFIED)).toBe(true);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, email: '' })).toBe(true);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, email: '', phone: ' ' })).toBe(false);
        // A phone is matched on ten digits (a leading US 1 aside), so a short one is no way back.
        expect(canBeFoundElsewhere({ ...IDENTIFIED, email: '', phone: '555-0101' })).toBe(false);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, email: '', phone: '(555) 010-1234' })).toBe(true);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, email: '', phone: '+1 555 010 1234' })).toBe(true);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, lastName: '' })).toBe(false);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, dob: '' })).toBe(false);
        expect(canBeFoundElsewhere({ ...IDENTIFIED, ssn: '123-45-678' })).toBe(false);
        expect(canBeFoundElsewhere(undefined)).toBe(false);
    });
});
