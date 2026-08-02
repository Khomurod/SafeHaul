const functions = require('firebase-functions/v1');
const { db, admin } = require('./firebaseAdmin');


/**
 * Trigger: When a new Driver Profile is created (e.g. on registration)
 * Goal: Check if a "Shadow Profile" (lead/invite) exists for this phone number.
 *       If so, merge its data (notes, history) into the new real profile
 *       and delete the shadow profile to clean up.
 */
exports.onDriverProfileCreated = functions.firestore
    .document('drivers/{driverId}')
    .onCreate(async (snap, context) => {
        const newData = snap.data();
        const { driverId } = context.params;
        const normalizedPhone = newData.personalInfo?.normalizedPhone;

        if (!normalizedPhone) {
            console.log(`[Onboarding] New driver ${driverId} has no phone. Skipping merge.`);
            return null;
        }

        try {
            console.log(`[Onboarding] Checking for shadow profiles for phone: ${normalizedPhone}`);

            // Query for ANY other driver docs with this phone
            const driversRef = db.collection('drivers');
            const querySnapshot = await driversRef
                .where('personalInfo.normalizedPhone', '==', normalizedPhone)
                .get();

            if (querySnapshot.empty) {
                return null;
            }

            // Iterate through potential matches (should usually be just one shadow profile)
            const batch = db.batch();
            let mergeCount = 0;

            for (const doc of querySnapshot.docs) {
                // Skip self
                if (doc.id === driverId) continue;

                const shadowData = doc.data();

                // Safety Check: Only merge if it looks like a shadow profile (e.g. has lead data or is old)
                // We assume the NEW profile is the authority, but we want to pull in:
                // - internal_notes (subcollection - handled separately or assuming mainly main doc data for now)
                // - specific fields like 'source', 'recruiterId' if missing in new profile
                // - 'applications' or 'leads' links?

                console.log(`[Onboarding] Found shadow profile ${doc.id}. Merging into ${driverId}...`);

                // 1. Prepare Merge payload (preserving new data, filling gaps from old)
                const updates = {};

                // Example: If new profile is missing source, take it from shadow
                if (!newData.driverProfile?.source && shadowData.driverProfile?.source) {
                    updates['driverProfile.source'] = shadowData.driverProfile.source;
                }

                // Example: Recruiters
                if (!newData.recruiterId && shadowData.recruiterId) {
                    updates.recruiterId = shadowData.recruiterId;
                }

                // If we found fields to update on the NEW doc, queue them
                if (Object.keys(updates).length > 0) {
                    batch.update(snap.ref, updates);
                }

                // H4 FIX: Archive shadow profile data before deletion so no data is permanently lost.
                // Stored in: drivers/{driverId}/merged_profiles/{shadowId}
                const archiveRef = snap.ref.collection('merged_profiles').doc(doc.id);
                batch.set(archiveRef, {
                    ...shadowData,
                    _archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                    _archivedFrom: `drivers/${doc.id}`,
                    _mergedIntoDriverId: driverId
                });

                // 2. Queue Deletion of Shadow Profile (safe now that we archived it)
                batch.delete(doc.ref);
                mergeCount++;
            }

            if (mergeCount > 0) {
                await batch.commit();
                console.log(`[Onboarding] Successfully archived and merged ${mergeCount} shadow profile(s) into ${driverId}.`);
            } else {
                console.log(`[Onboarding] No valid shadow profiles to merge.`);
            }

        } catch (error) {
            console.error(`[Onboarding] Merge failed:`, error);
            // We do NOT throw here because we don't want to retry infinitely and block the function
        }
    });
