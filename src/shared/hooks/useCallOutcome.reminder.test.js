/**
 * A call result with a callback time reminds the recruiter who logged it: the
 * activity log carries the time, and the server puts "Call back …" in that
 * recruiter's bell (`functions/notificationTriggers.js`). "Remind me in 1 Hour"
 * keeps the result No Answer.
 *
 * All names below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ addDoc: vi.fn() }));

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
    addDoc: (...args) => fb.addDoc(...args),
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => vi.fn().mockResolvedValue({ data: { success: true } }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import { useCallOutcome } from './useCallOutcome';

const LEAD = { id: 'lead-1', firstName: 'Ivan', lastName: 'Driver', phone: '5551234567', email: 'ivan@example.com' };

const written = (suffix) => fb.addDoc.mock.calls
    .filter(([ref]) => ref.path.endsWith(suffix))
    .map(([, data]) => data);

function render() {
    return renderHook(() => useCallOutcome(LEAD, 'co-1', vi.fn(), vi.fn())).result;
}

beforeEach(() => {
    fb.addDoc.mockReset();
    fb.addDoc.mockResolvedValue({ id: 'doc-1' });
});
afterEach(() => vi.useRealTimers());

describe('a callback reminder', () => {
    it('is carried by the activity log, with the time as the recruiter chose it', async () => {
        const result = render();
        act(() => {
            result.current.setOutcome('callback');
            result.current.setCallbackDate('2026-10-22');
            result.current.setCallbackTime('15:00');
        });
        await act(() => result.current.handleSave());

        expect(written('activity_logs')).toEqual([expect.objectContaining({
            outcome: 'callback',
            callbackAt: new Date('2026-10-22T15:00').toISOString(),
            callbackLabel: 'Oct 22 at 3:00 PM',
            performedBy: 'recruiter-1',
        })]);
        expect(written('internal_notes')[0].text).toContain('Callback: Oct 22 at 3:00 PM');
        // Nothing to the top-level `notifications`, which the rules refuse to any browser.
        expect(fb.addDoc.mock.calls.map(([ref]) => ref.path)).not.toContain('notifications');
    });

    it('in 1 hour keeps the result No Answer', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-22T09:10'));
        const result = render();
        act(() => result.current.setOutcome('no_answer'));
        act(() => result.current.onQuickReminder());

        expect(result.current.outcome).toBe('no_answer');
        expect(result.current.reminderLabel).toBe('Oct 22 at 10:10 AM');
        await act(() => result.current.handleSave());

        expect(written('activity_logs')).toEqual([expect.objectContaining({
            outcome: 'no_answer',
            outcomeLabel: 'No Answer',
            callbackAt: new Date('2026-10-22T10:10').toISOString(),
            callbackLabel: 'Oct 22 at 10:10 AM',
        })]);
    });

    it.each([
        // 7:30 pm on 12 October in Chicago, 00:30 on 13 October in UTC.
        ['2026-10-13T00:30:00Z', '2026-10-12', '20:30'],
        // 11:30 pm in Chicago: the hour crosses local midnight.
        ['2026-10-13T04:30:00Z', '2026-10-13', '00:30'],
    ])('in 1 hour from %s is on the recruiter\'s own day', (now, day, clock) => {
        const zone = process.env.TZ;
        process.env.TZ = 'America/Chicago';
        try {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date(now));
            const result = render();
            act(() => result.current.setOutcome('no_answer'));
            act(() => result.current.onQuickReminder());
            expect([result.current.callbackDate, result.current.callbackTime]).toEqual([day, clock]);
        } finally {
            if (zone === undefined) delete process.env.TZ;
            else process.env.TZ = zone;
        }
    });

    it('in 1 hour is dropped when the result changes', async () => {
        const result = render();
        act(() => result.current.setOutcome('no_answer'));
        act(() => result.current.onQuickReminder());
        act(() => result.current.setOutcome('voicemail'));

        expect(result.current.reminderLabel).toBe('');
        await act(() => result.current.handleSave());
        expect(written('activity_logs')[0]).not.toHaveProperty('callbackAt');
    });

    it('is not written for a result without one', async () => {
        const result = render();
        act(() => result.current.setOutcome('interested'));
        await act(() => result.current.handleSave());
        expect(written('activity_logs')[0]).not.toHaveProperty('callbackAt');
    });
});
