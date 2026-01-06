// hr portal/functions/driverSync.js

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
// UPDATED: Import from shared singleton
const { admin, db, auth } = require("./firebaseAdmin");

/**
 * SHARED HELPER: Finds or Creates the Auth User and syncs data to the Master Profile.
 * This is triggered by Lead (unbranded), Application (branded), and Company Lead submissions.
 * @param {object} data - The raw data from the submitted lead or application document.
 * @param {string} docId - The ID of the document that triggered the event.
 */
async function processDriverData(data, docId) {
  const email = data.email;
  const phone = data.phone;

  // Check if this is a placeholder email
  const isPlaceholder = !email || email.includes('@placeholder.com');

  // If we have neither a valid email nor a phone number, we can't identify the driver.
  if (isPlaceholder && !phone) {
    console.log("Skipping profile sync: No valid identity (Email or Phone) provided.");
    return;
  }

  let driverUid = null;

  // 1. Resolve Driver Identity (Auth UID or Database ID)
  try {
    if (!isPlaceholder) {
      // --- SCENARIO A: Valid Email ---
      // We try to match with an existing Firebase Auth User
      try {
        const existingUser = await auth.getUserByEmail(email);
        driverUid = existingUser.uid;
        console.log(`Driver exists (Auth): ${email}`);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          // --- CRITICAL FIX: DO NOT CREATE AUTH USER AUTOMATICALLY ---
          // Previously, we created an account here. Now, we treat this as a "Shadow Profile".
          // The driver receives a profile in the database, but NO login account yet.
          // They will claim this when they sign up on the app later.
          driverUid = docId;
          console.log(`Lead processed as Shadow Profile (No Auth yet): ${email}`);
        } else {
          throw e;
        }
      }
    } else {
      // --- SCENARIO B: Placeholder Email (Phone Only) ---
      // Strategy: Check if a Master Profile already exists in 'drivers' with this phone.

      const driversRef = db.collection('drivers');
      // We query the master profiles for this phone number
      const q = driversRef.where('personalInfo.phone', '==', phone).limit(1);
      const snap = await q.get();

      if (!snap.empty) {
        // Found existing profile -> Update it
        driverUid = snap.docs[0].id;
        console.log(`Matched existing driver by phone: ${phone}`);
      } else {
        // No match -> Create new Master Profile using the Source ID
        driverUid = docId;
        console.log(`Creating new shadow profile for phone: ${phone}`);
      }
    }
  } catch (error) {
    console.error("Error managing driver identity:", error);
    return;
  }

  if (!driverUid) return;

  // 2. Create Staging/Pending Update (Instead of Overwriting Master Profile)
  const driverDocRef = db.collection("drivers").doc(driverUid);

  // PHASE 2 FIX: STOP AUTO-MERGING
  // Instead of updating the main profile, we push to a 'pending_updates' subcollection.
  // The user (Mobile App) or Admin (Dashboard) can approve these changes.

  const stagingData = {
    source: docId.includes('lead') ? 'lead' : 'application',
    sourceId: docId,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    proposedChanges: {
      personalInfo: {
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        email: email,
        phone: data.phone || "",
        // ... strict subset of safe fields
      },
      qualifications: {
        experienceYears: data.experience || data['experience-years'] || "",
      },
      // Don't sync matching licenses blindly, put them in staging
      licenses: data.cdlNumber ? [{
        state: data.cdlState || "",
        number: data.cdlNumber || "",
        expiration: data.cdlExpiration || "",
        class: data.cdlClass || ""
      }] : []
    }
  };

  // Writing to subcollection
  await driverDocRef.collection('pending_updates').add(stagingData);

  console.log(`Redirected driver update for ${driverUid} to 'pending_updates'.`);
}

// --- EXPORT: Triggers for Driver Profile Sync ---

// 1. Direct Applications
exports.onApplicationSubmitted = onDocumentCreated({
  document: "companies/{companyId}/applications/{applicationId}",
  maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  await processDriverData(event.data.data(), event.params.applicationId);
});

// 2. Global Leads (Unbranded)
exports.onLeadSubmitted = onDocumentCreated({
  document: "leads/{leadId}",
  maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  await processDriverData(event.data.data(), event.params.leadId);
});

// 4. Sync Driver Log Activity (Fix for Permission Error)
exports.syncDriverOnLog = onDocumentCreated("companies/{companyId}/{collectionId}/{leadId}/activity_logs/{logId}", async (event) => {
  if (!event.data) return;

  const data = event.data.data();
  const leadId = event.params.leadId;

  // Only proceed if data changed OR it was a call
  if (data.dataChanged !== true && data.type !== 'call') return;

  console.log(`[syncDriverOnLog] Syncing log activity for driver: ${leadId}`);

  try {
    const globalDriverRef = db.collection("drivers").doc(leadId);
    const updateData = {};

    // 1. Update Last Call Info
    if (data.type === 'call') {
      updateData.lastNetworkCall = {
        outcome: data.outcomeLabel || data.outcome,
        timestamp: admin.firestore.FieldValue.serverTimestamp() // Use admin timestamp
      };
    }

    // 2. Sync Profile Changes (if flagged)
    if (data.dataChanged === true) {
      // We need to fetch the LEAD document to get the new values, 
      // because the log only says *that* it changed, not necessarily *what* (except in notes).
      // However, for efficiency, the client usually writes the *latest* state to the lead doc 
      // right before creating the log. So we fetch the parent lead doc.

      const parentCollectionPath = `companies/${event.params.companyId}/${event.params.collectionId}`;
      const leadSnap = await db.collection(parentCollectionPath).doc(leadId).get();

      if (leadSnap.exists) {
        const leadData = leadSnap.data();
        if (leadData.driverType) updateData['driverProfile.type'] = leadData.driverType;
        if (leadData.experienceLevel) updateData['qualifications.experienceYears'] = leadData.experienceLevel;
        updateData.infoSource = 'recruiter';
      }
    }

    if (Object.keys(updateData).length > 0) {
      await globalDriverRef.set(updateData, { merge: true });
      console.log(`[syncDriverOnLog] Successfully synced driver ${leadId}`);
    }

  } catch (error) {
    console.error(`[syncDriverOnLog] Failed to sync driver ${leadId}:`, error);
  }
});

// 3. Company Leads (Bulk Uploads / Private) - NEW
exports.onCompanyLeadSubmitted = onDocumentCreated({
  document: "companies/{companyId}/leads/{leadId}",
  maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  await processDriverData(event.data.data(), event.params.leadId);
});