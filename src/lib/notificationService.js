import { collection, addDoc, serverTimestamp } from "firebase/firestore";
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
