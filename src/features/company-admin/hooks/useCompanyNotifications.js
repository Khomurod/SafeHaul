import { useState, useEffect } from 'react';
import { arrayUnion, collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '@lib/firebase';

const BELL_SIZE = 20;

// The server writes `createdAt` as a Timestamp; fixtures may hold plain
// `seconds` or a Date.
const millisOf = (value) => {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return 0;
};

/** Both reads as one list: each notification once, the newest 20. */
const newestOfBoth = (team, own) => {
    const byId = new Map();
    [...team, ...own].forEach((item) => byId.set(item.id, item));
    return [...byId.values()]
        .sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt))
        .slice(0, BELL_SIZE);
};

const rowsOf = (snapshot) => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

/**
 * Shown to this reader: one addressed to a person (`recipientId`) to them only;
 * one for the team to all of it but the person whose action it reports
 * (`actorId`). Both only hide a row: the team may read every notification.
 */
const shownTo = (item, uid) => (item.recipientId ? item.recipientId === uid : !uid || item.actorId !== uid);

/**
 * Read by this reader: they are in `readBy`. A `read: true` from before read
 * state was per person counts as read for everyone.
 */
const isReadBy = (item, uid) => item.read === true
    || (Boolean(uid) && Array.isArray(item.readBy) && item.readBy.includes(uid));

/**
 * Hook to manage company notifications. A notification with a `recipientId` (a
 * callback reminder, a status change on the reader's record, an assignment to
 * them, a seal or PEV outcome they sent) is shown only to that person; one for
 * the team is not shown to the person whose action it reports (`actorId`).
 * Read state is per person: each row's `read` here says whether this reader
 * has read it, and marking read adds them to its `readBy`.
 *
 * Two live reads, merged: the company's newest 20 (the team's notifications and
 * everyone's own, filtered here to the team's and the reader's), and the
 * reader's own newest 20 (`recipientId == uid`, which has its own index). The
 * second exists because other people's notifications take slots in the first:
 * in a busy team they would push a recruiter's own "Call back …" out of the
 * bell. The bell shows the newest 20 of both, read or not. If the own read
 * fails (say, its index is still building) that is only logged, and the bell
 * shows the first read alone.
 * @param {string} companyId - The ID of the company
 * @returns {Object} Notifications data and management functions
 */
export function useCompanyNotifications(companyId) {
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!companyId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const notificationsRef = collection(db, 'companies', companyId, 'notifications');
        const uid = auth.currentUser?.uid;
        const rows = { team: [], own: [] };
        // Without a uid there is no own read to wait for.
        const settled = { team: false, own: !uid };
        const show = () => {
            setNotifications(newestOfBoth(rows.team, rows.own).map((item) => ({ ...item, read: isReadBy(item, uid) })));
            if (settled.team && settled.own) setLoading(false);
        };

        const q = query(
            notificationsRef,
            orderBy('createdAt', 'desc'),
            limit(BELL_SIZE)
        );

        const unsubscribeTeam = onSnapshot(q, (snapshot) => {
            rows.team = rowsOf(snapshot).filter(item => shownTo(item, uid));
            settled.team = true;
            setError(null);
            show();
        }, (err) => {
            console.error('Error fetching notifications:', err);
            setError('Failed to load notifications');
            settled.team = true;
            show();
        });

        const unsubscribeOwn = uid ? onSnapshot(
            query(notificationsRef, where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(BELL_SIZE)),
            (snapshot) => {
                rows.own = rowsOf(snapshot);
                settled.own = true;
                show();
            },
            (err) => {
                console.error('Error fetching own reminders:', err);
                settled.own = true;
                show();
            },
        ) : null;

        return () => {
            unsubscribeTeam();
            unsubscribeOwn?.();
        };
    }, [companyId]);

    const unreadCount = notifications.filter(n => !n.read).length;

    // For this reader only: the shared `read` flag is left as it is.
    const markAsRead = async (notificationId) => {
        const uid = auth.currentUser?.uid;
        if (!companyId || !notificationId || !uid) return;
        try {
            const notifRef = doc(db, 'companies', companyId, 'notifications', notificationId);
            await updateDoc(notifRef, { readBy: arrayUnion(uid) });
        } catch (err) {
            console.error('Error marking notification as read:', err);
            throw err;
        }
    };

    // Every row the bell shows still unread for this reader, for them only.
    const markAllAsRead = async () => {
        const uid = auth.currentUser?.uid;
        if (!companyId || !uid || notifications.length === 0) return;
        const unreadRows = notifications.filter(n => !n.read);
        if (unreadRows.length === 0) return;

        try {
            const batch = writeBatch(db);
            unreadRows.forEach(n => {
                const notifRef = doc(db, 'companies', companyId, 'notifications', n.id);
                batch.update(notifRef, { readBy: arrayUnion(uid) });
            });
            await batch.commit();
        } catch (err) {
            console.error('Error marking all as read:', err);
            throw err;
        }
    };

    return {
        notifications,
        unreadCount,
        loading,
        error,
        markAsRead,
        markAllAsRead
    };
}
