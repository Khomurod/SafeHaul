const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin (Assumes GOOGLE_APPLICATION_CREDENTIALS or default auth is set)
// If running from root, we might need to adjust paths, but let's try standard init.
if (!admin.apps.length) {
    try {
        // Try to load service account if available locally (optional, otherwise relies on default)
        const serviceAccount = require(path.join(__dirname, '../service-account.json'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.log("No service-account.json found, using default credentials...");
        admin.initializeApp();
    }
}

const db = admin.firestore();

async function migrateEmailSettings() {
    console.log("Starting Email Settings Migration...");

    const companiesRef = db.collection('companies');
    const snapshot = await companiesRef.get();

    if (snapshot.empty) {
        console.log("No companies found.");
        return;
    }

    console.log(`Found ${snapshot.size} companies. Processing...`);

    let migratedCount = 0;
    let errors = 0;
    const batchSize = 50;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const companyData = doc.data();
        const companyId = doc.id;

        // Check if emailSettings exists
        if (companyData.emailSettings) {
            console.log(`Migrating settings for company: ${companyId}`);

            // 1. Define the new secure location
            const secureRef = companiesRef.doc(companyId).collection('system_settings').doc('email_config');

            // 2. Add to batch: Set new doc
            batch.set(secureRef, {
                ...companyData.emailSettings,
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 3. Add to batch: Delete old field (Update parent doc)
            batch.update(doc.ref, {
                emailSettings: admin.firestore.FieldValue.delete()
            });

            migratedCount++;
            batchCount++;

            // Commit batch if limit reached
            if (batchCount >= batchSize) {
                await batch.commit();
                console.log(`Committed batch of ${batchCount} updates.`);
                batch = db.batch(); // New batch
                batchCount = 0;
            }
        }
    }

    // Commit remaining
    if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${batchCount} updates.`);
    }

    console.log("------------------------------------------------");
    console.log(`Migration Complete.`);
    console.log(`Total Companies Scanned: ${snapshot.size}`);
    console.log(`Settings Migrated: ${migratedCount}`);
    console.log("------------------------------------------------");
}

migrateEmailSettings().catch(console.error);
