/**
 * The bell shows the team's notifications, and one addressed to a person
 * (`recipientId`: a callback reminder, a status change on their record, an
 * assignment) only to that person. It reads twice: the company's newest
 * notifications ("team", filtered here) and the reader's own newest ("own",
 * `where('recipientId', '==', uid)`), so other people's cannot push the
 * reader's own out of the bell. A team notification about someone's own action
 * (`actorId`) is not shown to them. Read state is per person: opening one adds
 * the reader to `readBy`, and an older `read: true` counts as read for everyone.
 * The fake routes each listener by whether its query holds a `where`. All ids
 * below are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What each read answers; set in `beforeEach`. `ownLater` holds the own read's
// answer back until a test calls its listener's `answer`.
const fb = vi.hoisted(() => ({ listeners: [], updates: [], batches: [] }));

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
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    arrayUnion: (...items) => ({ arrayUnion: items }),
    updateDoc: async (ref, data) => { fb.updates.push({ path: ref.path, data }); },
    writeBatch: () => {
        const batch = { updates: [], committed: false };
        fb.batches.push(batch);
        return {
            update: (ref, data) => batch.updates.push({ path: ref.path, data }),
            commit: async () => { batch.committed = true; },
        };
    },
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
        updates: [], batches: [],
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

describe('who sees a notification', () => {
    it('hides a team notification about the reader\'s own action, and shows the rest', async () => {
        fb.team = [
            { id: 'mine-done', type: 'status_change', actorId: 'recruiter-1', read: false, createdAt: minute(3) },
            { id: 'theirs-done', type: 'status_change', actorId: 'recruiter-2', read: false, createdAt: minute(2) },
        ];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['theirs-done']);
    });

    it('shows a notification addressed to the reader even when it names them as who acted', async () => {
        // A callback reminder is for the recruiter who logged it.
        const reminderToSelf = { ...reminder('mine', 'recruiter-1', 3), actorId: 'recruiter-1' };
        fb.team = [reminderToSelf];
        fb.own = [reminderToSelf];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.notifications.map((n) => n.id)).toEqual(['mine']));
    });
});

describe('read state, per person', () => {
    it('counts a notification someone else opened as still unread for this reader', async () => {
        fb.team = [
            { id: 'opened-by-other', type: 'new_application', readBy: ['recruiter-2'], createdAt: minute(3) },
            { id: 'opened-by-me', type: 'new_application', readBy: ['recruiter-2', 'recruiter-1'], createdAt: minute(2) },
        ];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => [n.id, n.read])).toEqual([
            ['opened-by-other', false],
            ['opened-by-me', true],
        ]);
        expect(result.current.unreadCount).toBe(1);
    });

    it('counts an older shared read: true as read for everyone', async () => {
        fb.team = [{ id: 'legacy', type: 'new_application', read: true, createdAt: minute(3) }];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications[0].read).toBe(true);
        expect(result.current.unreadCount).toBe(0);
    });

    it('marks one read for the reader only, leaving the shared flag alone', async () => {
        fb.team = [{ id: 'n-1', type: 'new_application', read: false, createdAt: minute(3) }];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(() => result.current.markAsRead('n-1'));

        expect(fb.updates).toEqual([{
            path: 'companies/co-1/notifications/n-1',
            data: { readBy: { arrayUnion: ['recruiter-1'] } },
        }]);
    });

    it('marks all read for the reader only: each row still unread for them, in one batch', async () => {
        fb.team = [
            { id: 'unread', type: 'new_application', read: false, createdAt: minute(5) },
            { id: 'other-read', type: 'new_application', readBy: ['recruiter-2'], createdAt: minute(4) },
            { id: 'me-read', type: 'new_application', readBy: ['recruiter-1'], createdAt: minute(3) },
            { id: 'legacy-read', type: 'new_application', read: true, createdAt: minute(2) },
        ];
        fb.own = [reminder('mine', 'recruiter-1', 1)];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(() => result.current.markAllAsRead());

        expect(fb.updates).toEqual([]);
        expect(fb.batches).toHaveLength(1);
        expect(fb.batches[0].committed).toBe(true);
        expect(fb.batches[0].updates).toEqual(['unread', 'other-read', 'mine'].map((id) => ({
            path: `companies/co-1/notifications/${id}`,
            data: { readBy: { arrayUnion: ['recruiter-1'] } },
        })));
    });

    it('writes nothing when every row is already read for the reader', async () => {
        fb.team = [{ id: 'me-read', type: 'new_application', readBy: ['recruiter-1'], createdAt: minute(3) }];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(() => result.current.markAllAsRead());

        expect(fb.batches).toEqual([]);
    });

    it('keeps a row the reader has read in its place among the newest 20', async () => {
        fb.team = Array.from({ length: 15 }, (_, i) => ({
            ...reminder(`team-${i}`, undefined, 2 * i + 1), readBy: i % 2 ? ['recruiter-1'] : [],
        }));
        fb.own = Array.from({ length: 10 }, (_, i) => ({
            ...reminder(`mine-${i}`, 'recruiter-1', 2 * i + 2), readBy: ['recruiter-1'],
        }));
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.createdAt.getUTCMinutes())).toEqual([
            29, 27, 25, 23, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
        ]);
        // Unread for this reader: the team's at even indexes, minutes 29, 25, 21, 17, 13, 9.
        expect(result.current.unreadCount).toBe(6);
    });
});
