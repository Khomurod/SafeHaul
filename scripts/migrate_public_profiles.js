// scripts/migrate_public_profiles.js
// ONE-TIME MIGRATION: Populate public_profiles from existing companies data.
// Run locally with: node scripts/migrate_public_profiles.js
// Requires: scripts/service-account-key.json

const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "service-account-key.json");

try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (err) {
    console.error("ERROR: Could not find service-account-key.json in scripts/ directory.");
    console.error("Place your Firebase Admin SDK service account key there and try again.");
    process.exit(1);
}

const db = admin.firestore();

async function migrate() {
    console.log("Starting Public Profile Migration...");
    const snap = await db.collection("companies").get();
    let count = 0;
    const batchHandler = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        const safeData = {
            companyName: data.companyName || "Unknown",
            appSlug: data.appSlug || null,
            logoUrl: data.logoUrl || null,
            brandColor: data.brandColor || "#1e40af",
            isActive: data.isActive ?? true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        batchHandler.push(db.collection("public_profiles").doc(doc.id).set(safeData));
        count++;
        if (batchHandler.length >= 400) {
            await Promise.all(batchHandler);
            batchHandler.length = 0;
            console.log(`Migrated ${count} companies...`);
        }
    }
    await Promise.all(batchHandler);
    console.log(`DONE. Migrated ${count} profiles to public_profiles collection.`);
}

migrate().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
