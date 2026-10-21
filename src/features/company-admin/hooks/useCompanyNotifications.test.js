/**
 * The bell shows the team's notifications, and a reminder only to the person it
 * is for (`recipientId`, written by the server for a callback). All ids below
 * are artificial.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ docs: [] }));

vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}),
    query: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    doc: () => ({}),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(),
    onSnapshot: (_query, next) => {
        next({ docs: fb.docs.map((data) => ({ id: data.id, data: () => data })) });
        return () => {};
    },
}));

import { useCompanyNotifications } from './useCompanyNotifications';

describe('the bell', () => {
    it('shows team notifications and the reader\'s own reminders, not someone else\'s', async () => {
        fb.docs = [
            { id: 'team', type: 'new_application', read: false },
            { id: 'mine', type: 'callback_scheduled', recipientId: 'recruiter-1', read: false },
            { id: 'theirs', type: 'callback_scheduled', recipientId: 'recruiter-2', read: false },
        ];
        const { result } = renderHook(() => useCompanyNotifications('co-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notifications.map((n) => n.id)).toEqual(['team', 'mine']);
        expect(result.current.unreadCount).toBe(2);
    });
});
