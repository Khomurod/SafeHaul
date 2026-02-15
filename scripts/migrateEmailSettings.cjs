const path = require('path');
let admin;

// Robust dependency loading: Try root, then functions folder
try {
    admin = require('firebase-admin');
} catch (e) {
    try {
        admin = require('../functions/node_modules/firebase-admin');
    } catch (e2) {
        console.error("Could not find firebase-admin module. Please install it or run from functions directory.");
        process.exit(1);
    }
}

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp();
        console.log("Initialized Firebase Admin with default credentials.");
    } catch (e) {
        console.error("Failed to initialize admin:", e);
        process.exit(1);
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
    let batchSize = 50;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const companyData = doc.data();
        const companyId = doc.id;

        // Check if emailSettings exists and has keys
        if (companyData.emailSettings && Object.keys(companyData.emailSettings).length > 0) {
            console.log(`Migrating settings for company: ${companyId}`);

            // 1. Define the new secure location
            const secureRef = companiesRef.doc(companyId).collection('system_settings').doc('email_config');

            // 2. Add to batch: Set new doc
            batch.set(secureRef, {
                ...companyData.emailSettings,
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 3. Add to batch: Delete old field
            batch.update(doc.ref, {
                emailSettings: admin.firestore.FieldValue.delete()
            });

            migratedCount++;
            batchCount++;

            // Commit batch if limit reached
            if (batchCount >= batchSize) {
                await batch.commit();
                console.log(`Committed batch of ${batchCount} updates.`);
                batch = db.batch();
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
