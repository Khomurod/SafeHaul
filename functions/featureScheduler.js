const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");

exports.enforceFeatureSchedules = onSchedule({ schedule: "every 15 minutes", timeoutSeconds: 120, region: "us-central1" }, async (event) => {
    const db = getFirestore();
    const now = new Date();

    // Every company's schedules, checked in memory since it's a manageable size.
    // Only `featureSchedules` is read: the run needs nothing else of a company,
    // and a company document carries its team, questions and settings.
    const companiesSnapshot = await db.collection("companies").select("featureSchedules").get();

    let processedCount = 0;

    const batch = db.batch();

    for (const doc of companiesSnapshot.docs) {
        const data = doc.data();
        if (!data.featureSchedules) continue;

        let needsUpdate = false;
        const updates = {};

        for (const [featureKey, scheduleStr] of Object.entries(data.featureSchedules)) {
            if (!scheduleStr) continue;

            const scheduledTime = new Date(scheduleStr);
            if (scheduledTime <= now) {
                // Time has passed, turn the feature off
                updates[`features.${featureKey}`] = false;
                updates[`featureSchedules.${featureKey}`] = null;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            batch.update(doc.ref, updates);
            processedCount++;
        }
    }

    if (processedCount > 0) {
        await batch.commit();
        console.log(`Enforced feature schedules for ${processedCount} companies.`);
    } else {
        console.log("No feature schedules needed enforcement at this time.");
    }
});
