import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  updateDoc,
  writeBatch 
} from "firebase/firestore";
import { db } from '@lib/firebase';

export async function sendNotification({ recipientId, title, message, type = 'info', link = null, scheduledFor = null, metadata = {} }) {
  if (!recipientId) return;
  try {
      await addDoc(collection(db, "notifications"), {
          recipientId,
          title,
          message,
          type,
          link,
          scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
          metadata,
          isRead: false,
          status: 'new',
          createdAt: serverTimestamp()
      });
  } catch (error) {
      console.error("Error sending notification:", error);
  }
}

export function subscribeToNotifications(userId, callback) {
  if (!userId) return () => {};
  
  const q = query(
      collection(db, "notifications"),
      where("recipientId", "==", userId),
      orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snapshot) => {
      const notifications = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(n => n.status !== 'dismissed');
      
      callback(notifications);
  });
}

export async function updateNotificationStatus(notificationId, status) {
    if (!notificationId || !status) return;
    const ref = doc(db, "notifications", notificationId);
    
    const updates = { status };
    
    if (status === 'read' || status === 'completed' || status === 'dismissed') {
        updates.isRead = true;
    }
    
    if (status === 'completed') {
        updates.completedAt = serverTimestamp();
    }
    
    if (status === 'dismissed') {
        updates.dismissedAt = serverTimestamp();
    }

    await updateDoc(ref, updates);
}

export async function markNotificationAsRead(notificationId) {
  await updateNotificationStatus(notificationId, 'read');
}

export async function markAllAsRead(notifications) {
  if (!notifications || notifications.length === 0) return;

  const unreadNotifications = notifications.filter(n => !n.isRead);
  if (unreadNotifications.length === 0) return;

  const BATCH_SIZE = 500;

  for (let i = 0; i < unreadNotifications.length; i += BATCH_SIZE) {
      const chunk = unreadNotifications.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      chunk.forEach(note => {
          const ref = doc(db, "notifications", note.id);
          batch.update(ref, { isRead: true, status: 'read' });
      });

      await batch.commit();
  }
}
