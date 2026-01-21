import { useState, useEffect, useRef, useMemo } from 'react';
import { subscribeToNotifications, markNotificationAsRead, markAllAsRead } from '@lib/notificationService';

const ALERT_SOUND_URL = "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3";

export function useNotifications(userId) {
    const [notifications, setNotifications] = useState([]);
    const [upcomingCount, setUpcomingCount] = useState(0);
    const alertedIdsRef = useRef(new Set());
    const audioRef = useRef(null);

    useEffect(() => {
        audioRef.current = new Audio(ALERT_SOUND_URL);
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!userId) return;
        const unsubscribe = subscribeToNotifications(userId, (data) => {
            setNotifications(data);
        });
        return () => unsubscribe();
    }, [userId]);

    const { general, callbacks } = useMemo(() => {
        const gen = [];
        const call = [];
        
        notifications.forEach(n => {
            if (n.type === 'callback' && n.scheduledFor) {
                call.push(n);
            } else {
                gen.push(n);
            }
        });

        gen.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        call.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

        return { general: gen, callbacks: call };
    }, [notifications]);

    useEffect(() => {
        const checkUpcoming = () => {
            const now = new Date();
            const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60000);
            
            let urgentCount = 0;
            let shouldPlaySound = false;

            callbacks.forEach(n => {
                if (n.isRead) return; 

                const scheduledTime = new Date(n.scheduledFor);
                
                if (scheduledTime <= fiveMinutesFromNow) {
                    urgentCount++;
                    
                    if (!alertedIdsRef.current.has(n.id)) {
                        shouldPlaySound = true;
                        alertedIdsRef.current.add(n.id);
                    }
                }
            });

            setUpcomingCount(urgentCount);
            
            if (shouldPlaySound && audioRef.current) {
                audioRef.current.play().catch(e => console.warn("Audio play blocked:", e));
            }
        };

        checkUpcoming();
        const interval = setInterval(checkUpcoming, 30000);
        
        return () => clearInterval(interval);
    }, [callbacks]);

    const markAsRead = (id) => markNotificationAsRead(id);
    const markListAsRead = (type) => {
        const list = type === 'callbacks' ? callbacks : general;
        markAllAsRead(list);
    };

    return {
        notifications,
        general,
        callbacks,
        upcomingCount,
        markAsRead,
        markListAsRead
    };
}
