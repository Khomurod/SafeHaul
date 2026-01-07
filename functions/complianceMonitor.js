const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");

exports.checkExpiringDocuments = onSchedule("every 24 hours", async (event) => {
    // 1. Calculate Target Date (Today + 7 Days)
    const today = new Date();
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + 7);
    const targetDateString = targetDate.toISOString().split('T')[0]; // "YYYY-MM-DD"

    const db = getFirestore();

    try {
        console.log(`Checking for documents expiring on: ${targetDateString}`);

        // 2. Query Collection Group
        // Note: Requires Index on 'expirationDate' ASC/DESC
        const snapshot = await db.collectionGroup('dq_files')
            .where('expirationDate', '==', targetDateString)
            .get();

        if (snapshot.empty) {
            console.log("No expiring documents found.");
            return;
        }

        // 3. Process Results
        const notifications = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            // The parent path is companies/{cid}/applications/{aid}/dq_files/{docId}
            const parentPath = doc.ref.parent.parent ? doc.ref.parent.parent.path : 'unknown';

            notifications.push({
                fileType: data.fileType,
                fileName: data.fileName,
                path: parentPath,
                expirationDate: data.expirationDate
            });
        }

        console.log(`Found ${notifications.length} expiring documents. Sending alerts...`);

        // 4. Simulate Sending Emails (Log them)
        notifications.forEach(note => {
            console.log(`ALERT: Document '${note.fileName}' (${note.fileType}) at ${note.path} expires in 7 days!`);
        });

    } catch (error) {
        console.error("Compliance Monitor Error:", error);
    }
});
