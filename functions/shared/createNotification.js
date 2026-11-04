/**
 * An in-app notification for a company's team, in
 * `companies/{companyId}/notifications`. One with a `recipientId` is shown only
 * to that person (useCompanyNotifications).
 *
 * `options.id` names the notification for an event that may be delivered more
 * than once (Firestore and Storage triggers run at least once): the first
 * delivery creates it and a repeat finds it there and adds nothing. Without an
 * id each call adds a new notification, as before.
 *
 * Returns the notification's id, or null when one with `options.id` already
 * existed.
 */
const ALREADY_EXISTS = 6;

async function createNotification(db, companyId, notification, options = {}) {
    const collection = db.collection('companies').doc(companyId).collection('notifications');
    const notifRef = options.id ? collection.doc(options.id) : collection.doc();
    const data = {
        ...notification,
        read: false,
        createdAt: new Date(),
    };

    if (!options.id) {
        await notifRef.set(data);
    } else {
        try {
            await notifRef.create(data);
        } catch (err) {
            if (err?.code === ALREADY_EXISTS || /already exists/i.test(err?.message || '')) {
                console.log(`[Notifications] Already created: ${options.id} for ${companyId}`);
                return null;
            }
            throw err;
        }
    }

    console.log(`[Notifications] Created: ${notification.type} for ${companyId}`);
    return notifRef.id;
}

module.exports = { createNotification };
