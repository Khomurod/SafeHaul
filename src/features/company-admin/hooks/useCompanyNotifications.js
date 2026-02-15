import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * Hook to manage company notifications
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
        const q = query(
            notificationsRef,
            orderBy('createdAt', 'desc'),
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setNotifications(items);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error('Error fetching notifications:', err);
            setError('Failed to load notifications');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAsRead = async (notificationId) => {
        if (!companyId || !notificationId) return;
        try {
            const notifRef = doc(db, 'companies', companyId, 'notifications', notificationId);
            await updateDoc(notifRef, { read: true });
        } catch (err) {
            console.error('Error marking notification as read:', err);
            throw err;
        }
    };

    const markAllAsRead = async () => {
        if (!companyId || notifications.length === 0) return;
        const unreadRows = notifications.filter(n => !n.read);
        if (unreadRows.length === 0) return;

        try {
            const batch = writeBatch(db);
            unreadRows.forEach(n => {
                const notifRef = doc(db, 'companies', companyId, 'notifications', n.id);
                batch.update(notifRef, { read: true });
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
