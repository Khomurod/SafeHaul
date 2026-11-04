/**
 * The bell shows the team's notifications, and a reminder only to the person it
 * is for (`recipientId`, written by the server for a callback). It reads twice:
 * the company's newest notifications ("team", filtered here) and the reader's own
 * newest reminders ("own", `where('recipientId', '==', uid)`), so other people's
 * reminders cannot push the reader's own out of the bell. The fake routes each
 * listener by whether its query holds a `where`. All ids below are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What each read answers; set in `beforeEach`. `ownLater` holds the own read's
// answer back until a test calls its listener's `answer`.
const fb = vi.hoisted(() => ({ listeners: [] }));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { get currentUser() { return fb.uid ? { uid: fb.uid } : null; } },
}));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}),
    query: (...a) => ({ __query: a }),
    where: (...a) => ({ __where: a }),
    orderBy: () => ({}),
    limit: () => ({}),
    doc: () => ({}),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(),
    onSnapshot: (q, next, fail) => {
        const own = q.__query.some((constraint) => constraint && constraint.__where);
        const listener = {
            own,
            unsubscribe: vi.fn(),
            answer: (rows) => next({ docs: rows.map((data) => ({ id: data.id, data: () => data })) }),
        };
        fb.listeners.push(listener);
        const error = own ? fb.ownError : fb.teamError;
        if (error) fail(error);
        else if (!(own && fb.ownLater)) listener.answer(own ? fb.own : fb.team);
        return listener.unsubscribe;
    },
}));

import { useCompanyNotifications } from './useCompanyNotifications';

const minute = (m) => new Date(Date.UTC(2026, 9, 13, 6, m));
const reminder = (id, recipientId, m) => ({
    id, type: 'callback_scheduled', recipientId, read: false, createdAt: minute(m),
});

beforeEach(() => {
    Object.assign(fb, {
        uid: 'recruiter-1', team: [], own: [], teamError: null, ownError: null, ownLater: false, listeners: [],
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the bell', () => {
    it('shows team notifications and the reader\'s own reminders, not someone else\'s', async () => {
        const mine = { id: 'mine', type: 'callback_scheduled', recipientId: 'recruiter-1', read: false };
        fb.team = [
            { id: 'team', type: 'new_application', read: false },
            mine,
            { id: 'theirs', type: 'callback_scheduled', recipientId: 'recruiter-2', read: false },
        ];
        fb.own = [mine];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['team', 'mine']);
        expect(result.current.unreadCount).toBe(2);
    });

    it('keeps the reader\'s own reminder when 20 newer notifications belong to others', async () => {
        fb.team = Array.from({ length: 20 }, (_, i) => reminder(`theirs-${i}`, 'recruiter-2', 40 - i));
        fb.own = [reminder('mine', 'recruiter-1', 1)];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['mine']);
        expect(result.current.unreadCount).toBe(1);
        expect(result.current.error).toBeNull();
    });

    it('subscribes to both reads and unsubscribes from both on unmount', async () => {
        const { result, unmount } = renderHook(() => useCompanyNotifications('co-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(fb.listeners.map((l) => l.own).sort()).toEqual([false, true]);
        fb.listeners.forEach((l) => expect(l.unsubscribe).not.toHaveBeenCalled());
        unmount();
        fb.listeners.forEach((l) => expect(l.unsubscribe).toHaveBeenCalledTimes(1));
    });

    it('keeps loading until the own read has answered too', async () => {
        fb.ownLater = true;
        fb.team = [reminder('team', undefined, 2)];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.notifications.map((n) => n.id)).toEqual(['team']));
        expect(result.current.loading).toBe(true);
        act(() => fb.listeners.find((l) => l.own).answer([reminder('mine', 'recruiter-1', 1)]));
        expect(result.current.loading).toBe(false);
        expect(result.current.notifications.map((n) => n.id)).toEqual(['team', 'mine']);
    });

    it('lists a reminder that both reads return once', async () => {
        const mine = reminder('mine', 'recruiter-1', 5);
        fb.team = [reminder('team', undefined, 6), mine];
        fb.own = [mine];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.notifications.map((n) => n.id)).toEqual(['team', 'mine']));
        expect(result.current.unreadCount).toBe(2);
    });

    it('shows the newest 20 of both reads, newest first', async () => {
        fb.team = Array.from({ length: 15 }, (_, i) => reminder(`team-${i}`, undefined, 2 * i + 1));
        fb.own = Array.from({ length: 10 }, (_, i) => reminder(`mine-${i}`, 'recruiter-1', 2 * i + 2));
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        // The team's at odd minutes 1-29, the reader's own at even minutes 2-20:
        // the newest 20 of the 25 run from minute 29 down to minute 6.
        expect(result.current.notifications.map((n) => n.createdAt.getUTCMinutes())).toEqual([
            29, 27, 25, 23, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
        ]);
        expect(result.current.unreadCount).toBe(20);
    });

    it('orders a Timestamp, plain seconds and a Date together', async () => {
        const at = (m) => minute(m).getTime();
        fb.team = [
            { id: 'timestamp', createdAt: { toMillis: () => at(3), seconds: 0 } },
            { id: 'date', createdAt: minute(1) },
        ];
        fb.own = [{ id: 'seconds', recipientId: 'recruiter-1', createdAt: { seconds: at(2) / 1000, nanoseconds: 0 } }];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['timestamp', 'seconds', 'date']);
    });

    it('reads only the team\'s notifications when nobody is signed in', async () => {
        fb.uid = null;
        fb.team = [reminder('team', undefined, 2), reminder('theirs', 'recruiter-2', 1)];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fb.listeners.map((l) => l.own)).toEqual([false]);
        expect(result.current.notifications.map((n) => n.id)).toEqual(['team']);
    });

    it('keeps the team\'s notifications, with no error, when the own read fails', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        fb.team = [reminder('team', undefined, 2)];
        fb.ownError = Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' });
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['team']);
        expect(result.current.error).toBeNull();
        expect(log).toHaveBeenCalled();
    });

    it('still says "Failed to load notifications" when the team read fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fb.teamError = new Error('Missing or insufficient permissions.');
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('Failed to load notifications');
    });
});
