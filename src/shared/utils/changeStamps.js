import { serverTimestamp } from 'firebase/firestore';

/**
 * Who changed an application's or a lead's status or assignment, written in the
 * same update as the change. The bell's triggers read it so that nobody is told
 * about their own action, and trust it only when its time changed in that
 * write (`functions/shared/notificationAudience.js`). Nothing without a uid.
 */
export const statusChangeStamp = (uid) => (uid
    ? { statusChangedBy: uid, statusChangedAt: serverTimestamp() }
    : {});

export const assignmentChangeStamp = (uid) => (uid
    ? { assignmentChangedBy: uid, assignmentChangedAt: serverTimestamp() }
    : {});
