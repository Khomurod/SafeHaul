const { db } = require('../firebaseAdmin');

async function backfillPhoneNumbers() {
    console.log("Starting Phone Number Normalization Backfill...");

    // UTILITY
    const normalize = (phone) => {
        if (!phone) return null;
        const p = String(phone).replace(/\D/g, '');
        if (p.length === 10) return p;
        if (p.length === 11 && p.startsWith('1')) return p.substring(1);
        return p; // fallback or incomplete
    };

    let totalUpdated = 0;
    let batch = db.batch();
    let opCount = 0;

    const commitBatch = async () => {
        if (opCount > 0) {
            await batch.commit();
            totalUpdated += opCount;
            console.log(`Committed batch of ${opCount} updates.`);
            batch = db.batch();
            opCount = 0;
        }
    };

    try {
        // 1. DRIVERS
        console.log("Processing Drivers...");
        const driversSnap = await db.collection('drivers').get();
        for (const doc of driversSnap.docs) {
            const data = doc.data();
            const rawPhone = data.phone;
            const normalized = normalize(rawPhone);

            // Only update if normalized exists and is different or missing
            if (normalized && data.phoneNormalized !== normalized) {
                batch.update(doc.ref, { phoneNormalized: normalized });
                opCount++;
            }

            if (opCount >= 400) await commitBatch();
        }

        // 2. APPLICATIONS
        console.log("Processing Applications...");
        const appsSnap = await db.collection('applications').get();
        for (const doc of appsSnap.docs) {
            const data = doc.data();
            // Check various phone fields
            const rawPhone = data.phone || data.applicantPhone || data.personalInfo?.phone;
            const normalized = normalize(rawPhone);

            if (normalized && data.phoneNormalized !== normalized) {
                batch.update(doc.ref, { phoneNormalized: normalized });
                opCount++;
            }

            if (opCount >= 400) await commitBatch();
        }

        // 3. LEADS (Optional)
        console.log("Processing Leads...");
        const leadsSnap = await db.collection('leads').get();
        for (const doc of leadsSnap.docs) {
            const data = doc.data();
            const rawPhone = data.phone || data.driverPhone;
            const normalized = normalize(rawPhone);

            if (normalized && data.phoneNormalized !== normalized) {
                batch.update(doc.ref, { phoneNormalized: normalized });
                opCount++;
            }

            if (opCount >= 400) await commitBatch();
        }


        // Final Commit
        await commitBatch();

        console.log(`Backfill Complete! Total documents updated: ${totalUpdated}`);
        process.exit(0);

    } catch (error) {
        console.error("Backfill failed:", error);
        process.exit(1);
    }
}

backfillPhoneNumbers();
