/**
 * An in-app notification for a company's team, in
 * `companies/{companyId}/notifications`. One with a `recipientId` is shown only
 * to that person (useCompanyNotifications).
 */
async function createNotification(db, companyId, notification) {
    const notifRef = db.collection('companies').doc(companyId).collection('notifications').doc();

    await notifRef.set({
        ...notification,
        read: false,
        createdAt: new Date()
    });

    console.log(`[Notifications] Created: ${notification.type} for ${companyId}`);
    return notifRef.id;
}

module.exports = { createNotification };
