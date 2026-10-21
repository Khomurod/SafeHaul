/**
 * The "no answer" email a call log sends: to the lead's real address, never to
 * the made-up one the lead import gives a lead without an email
 * (`src/config/placeholderDomains.js`).
 *
 * All names and addresses below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({
    sendAutomatedEmail: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    functions: {},
    auth: { currentUser: { uid: 'recruiter-1', displayName: 'Rita Recruiter', email: 'rita@example.com' } },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    collection: (_db, ...segments) => ({ path: segments.join('/') }),
    serverTimestamp: () => 'ts',
    getDoc: async () => ({ exists: () => true, data: () => ({ appSlug: 'blue-line' }) }),
    setDoc: async () => {},
    updateDoc: async () => {},
    addDoc: async () => ({ id: 'log-1' }),
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (...args) => fb.httpsCallable(...args),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import { useCallOutcome } from './useCallOutcome';

const leadWith = (email) => ({ id: 'lead-1', firstName: 'Bob', lastName: 'Driver', phone: '5551234567', email });

async function logCall(lead, outcome) {
    const { result } = renderHook(() => useCallOutcome(lead, 'co-1', vi.fn(), vi.fn()));
    act(() => result.current.setOutcome(outcome));
    await act(() => result.current.handleSave());
}

beforeEach(() => {
    vi.clearAllMocks();
    fb.sendAutomatedEmail.mockResolvedValue({ data: { success: true } });
    fb.httpsCallable.mockImplementation(() => fb.sendAutomatedEmail);
});

describe('the "no answer" email of a call log', () => {
    it.each(['no_answer', 'voicemail'])('goes to the lead\'s real address after %s', async (outcome) => {
        await logCall(leadWith('driver@example.com'), outcome);

        expect(fb.httpsCallable).toHaveBeenCalledWith({}, 'sendAutomatedEmail');
        expect(fb.sendAutomatedEmail).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 'co-1',
            recipientEmail: 'driver@example.com',
            triggerType: 'no_answer',
        }));
    });

    it.each([
        // What the import writes for a row without an email, now and before.
        'placeholder_9f2c1a@placeholder.safehaulapp.com',
        'no_email_1760000000000_lead1@placeholder.safehaulapp.com',
        'driver_123@placeholder.com',
        '',
        undefined,
    ])('is not sent to %o', async (email) => {
        await logCall(leadWith(email), 'no_answer');

        expect(fb.sendAutomatedEmail).not.toHaveBeenCalled();
    });

    it('is not sent after a call someone answered', async () => {
        await logCall(leadWith('driver@example.com'), 'interested');

        expect(fb.sendAutomatedEmail).not.toHaveBeenCalled();
    });
});
