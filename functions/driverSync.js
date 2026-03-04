// hr portal/functions/driverSync.js

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
// UPDATED: Import from shared singleton
const { admin, db, auth } = require("./firebaseAdmin");
const { LIFECYCLE_STATUSES } = require("./shared/constants");
const { isPlaceholderEmail } = require("./shared/placeholderDomains");

/**
 * SHARED HELPER: Finds or Creates the Auth User and syncs data to the Master Profile.
 * This is triggered by Lead (unbranded), Application (branded), and Company Lead submissions.
 * @param {object} data - The raw data from the submitted lead or application document.
 * @param {string} docId - The ID of the document that triggered the event.
 */
async function processDriverData(data, docId) {
  const email = data.email;
  const phone = data.phone;

  // Check if this is a placeholder email (covers @placeholder.com, @system.local, etc.)
  const isPlaceholder = isPlaceholderEmail(email);

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

  const { encrypt } = require("./integrations/encryption");

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
        // STRICT ENCRYPTION for SSN
        ssn: data.ssn ? encrypt(data.ssn) : null
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
  const data = event.data.data();
  const companyId = event.params.companyId;
  const appId = event.params.applicationId;

  // IDEMPOTENCY CHECK: Prevent double-processing
  const statusRef = db.collection("processing_status").doc(`app_${companyId}_${appId}`);
  const appRef = db.collection("companies").doc(companyId).collection("applications").doc(appId);

  try {
    await db.runTransaction(async (transaction) => {
      const statusDoc = await transaction.get(statusRef);

      if (statusDoc.exists && statusDoc.data().completed) {
        console.log(`[onApplicationSubmitted] Already processed: ${appId}, skipping.`);
        return; // Already processed - skip
      }

      // Mark as processing
      transaction.set(statusRef, {
        started: admin.firestore.FieldValue.serverTimestamp(),
        companyId,
        applicationId: appId,
        completed: false,
      }, { merge: true });

      // Update lifecycle to processing
      transaction.update(appRef, {
        'lifecycle.status': LIFECYCLE_STATUSES.PROCESSING,
        'lifecycle.processingStartedAt': admin.firestore.FieldValue.serverTimestamp(),
        'lifecycle.triggerVersion': '2.0-bulletproof',
      });
    });
  } catch (txError) {
    console.error(`[onApplicationSubmitted] Transaction failed for ${appId}:`, txError);
    // Continue processing anyway - the status check is defensive, not blocking
  }

  // AUTO-ASSIGN LOGIC
  if (data.recruiterCode && !data.assignedTo) {
    try {
      const linkSnap = await db.collection("recruiter_links").doc(data.recruiterCode).get();
      const assignedTo = linkSnap.exists ? linkSnap.data().userId : data.recruiterCode;

      await appRef.update({
        assignedTo: assignedTo
      });
      console.log(`[onApplicationSubmitted] Auto-assigned app ${appId} to recruiter ${assignedTo}`);
    } catch (e) {
      console.error("Auto-assign failed:", e);
    }
  }

  // VALIDATION: Ensure signature exists for PDF generation
  // STRICT ENFORCEMENT: Reject if missing or invalid format
  const sig = data.signature;
  const hasValidSig = sig && (typeof sig === 'string') && (
    sig.startsWith('data:image/') ||
    sig.startsWith('TEXT_SIGNATURE:')
  );

  if (!hasValidSig) {
    console.error(`[onApplicationSubmitted] REJECTED: Application ${appId} missing valid signature.`);

    // Set status to validation_error but DO NOT process further
    await appRef.update({
      status: 'validation_error',
      statusMessage: 'Missing or invalid signature. Application rejected.',
      'lifecycle.status': LIFECYCLE_STATUSES.FAILED,
      'lifecycle.failureReason': 'invalid_signature',
      'lifecycle.rejectedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    // Abort Sync - Do not create driver profile for invalid app
    return;
  }

  // Process the driver data
  await processDriverData(data, appId);

  // --- FAN-OUT FILES TO DQ_FILES (Fix for Recruiter Dashboard) ---
  const fileMappings = [
    { field: 'cdl-front', type: 'license_front', label: 'CDL Front' },
    { field: 'cdl-back', type: 'license_back', label: 'CDL Back' },
    { field: 'medical-card-upload', type: 'medical_card', label: 'Medical Card' },
    { field: 'twic-card-upload', type: 'twic_card', label: 'TWIC Card' },
    { field: 'mvr-upload', type: 'mvr', label: 'MVR' },
    { field: 'mvr-consent-upload', type: 'mvr_consent', label: 'MVR Consent' },
    { field: 'drug-test-consent-upload', type: 'drug_test_consent', label: 'Drug Test Consent' },
    { field: 'ssc-upload', type: 'ssn_card', label: 'SSN Card' }
  ];

  const dqRef = appRef.collection('dq_files');

  for (const mapping of fileMappings) {
    const fileData = data[mapping.field];
    if (fileData && fileData.url) {
      // We use a deterministic ID based on the file type
      const docId = mapping.type;

      await dqRef.doc(docId).set({
        type: mapping.type,
        fileType: mapping.label, // Added for consistency with client-side sync
        label: mapping.label,
        status: 'pending_review', // Default status for new uploads
        fileUrl: fileData.url,
        url: fileData.url, // Added for consistency with client-side
        storagePath: fileData.ref || fileData.storagePath || '', // Handle varied naming
        fileName: fileData.name || `${mapping.label}.jpg`,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy: 'driver_app',
        applicationId: appId,
        isSynced: true,
        sourceField: mapping.field
      }, { merge: true });

      console.log(`[onApplicationSubmitted] Fanned out ${mapping.type} to dq_files for ${appId}`);
    }
  }

  // Mark processing as complete
  try {
    await statusRef.set({
      completed: true,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await appRef.update({
      'lifecycle.status': LIFECYCLE_STATUSES.COMPLETE,
      'lifecycle.processingCompletedAt': admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[onApplicationSubmitted] Successfully processed ${appId}`);
  } catch (completeError) {
    console.error(`[onApplicationSubmitted] Failed to mark complete for ${appId}:`, completeError);
  }
});

/**
 * Sync Files on Application Update
 * Handles files that are uploaded AFTER the initial application submission.
 * This ensures DQ files are synced even when documents are added later.
 */
exports.onApplicationUpdated = onDocumentUpdated({
  document: "companies/{companyId}/applications/{applicationId}",
  maxInstances: 3
}, async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  const companyId = event.params.companyId;
  const appId = event.params.applicationId;

  // FILE MAPPINGS - same as in onApplicationSubmitted
  const fileMappings = [
    { field: 'cdl-front', type: 'license_front', label: 'CDL Front' },
    { field: 'cdl-back', type: 'license_back', label: 'CDL Back' },
    { field: 'medical-card-upload', type: 'medical_card', label: 'Medical Card' },
    { field: 'twic-card-upload', type: 'twic_card', label: 'TWIC Card' },
    { field: 'mvr-upload', type: 'mvr', label: 'MVR' },
    { field: 'mvr-consent-upload', type: 'mvr_consent', label: 'MVR Consent' },
    { field: 'drug-test-consent-upload', type: 'drug_test_consent', label: 'Drug Test Consent' },
    { field: 'ssc-upload', type: 'ssn_card', label: 'SSN Card' }
  ];

  const appRef = db.collection("companies").doc(companyId).collection("applications").doc(appId);
  const dqRef = appRef.collection('dq_files');

  let syncCount = 0;

  for (const mapping of fileMappings) {
    const beforeFile = beforeData[mapping.field];
    const afterFile = afterData[mapping.field];

    // Check if a NEW file was added (didn't exist before, exists now)
    const hadFileBefore = beforeFile && beforeFile.url;
    const hasFileNow = afterFile && afterFile.url;

    // Only sync if file was newly added or URL changed
    if (hasFileNow && (!hadFileBefore || beforeFile.url !== afterFile.url)) {
      const docId = mapping.type;

      try {
        await dqRef.doc(docId).set({
          type: mapping.type,
          fileType: mapping.label, // Added for consistency with client-side sync
          label: mapping.label,
          status: 'pending_review',
          fileUrl: afterFile.url,
          url: afterFile.url, // Added for consistency with client-side
          storagePath: afterFile.storagePath || afterFile.ref || '',
          fileName: afterFile.name || `${mapping.label}.jpg`,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          uploadedBy: 'driver_app',
          applicationId: appId,
          isSynced: true,
          sourceField: mapping.field
        }, { merge: true });

        syncCount++;
        console.log(`[onApplicationUpdated] Synced NEW file ${mapping.type} for ${appId}`);
      } catch (syncError) {
        console.error(`[onApplicationUpdated] Failed to sync ${mapping.type}:`, syncError);
      }
    }
  }

  if (syncCount > 0) {
    console.log(`[onApplicationUpdated] Synced ${syncCount} new files for application ${appId}`);
  }
});

// HELPER: Real-time Stats Verification (Sharded)
async function updateLeadStats(data, delta) {
  try {
    const inc = admin.firestore.FieldValue.increment;
    const updates = { 'stats.total': inc(delta) };

    const phone = data.phone || data.normalizedPhone || '';
    const email = data.email || '';
    const firstName = data.firstName || '';
    const lastName = data.lastName || '';
    const name = `${firstName} ${lastName} ${data.fullName || ''}`.toLowerCase();

    if (!phone && !email) updates['stats.missingContact'] = inc(delta);
    if (!firstName && !lastName && !data.fullName) updates['stats.missingNames'] = inc(delta);
    if (email.includes('placeholder') || email.includes('no_email')) updates['stats.placeholderEmails'] = inc(delta);

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length < 10) updates['stats.shortPhones'] = inc(delta);
    if (name.includes('test') || name.includes('health check')) updates['stats.testData'] = inc(delta);

    // WRITE HOTSPOT FIX: Use Random Shard (0-9)
    const shardId = Math.floor(Math.random() * 10).toString();
    const shardRef = db.collection('system_settings').doc('lead_pool_stats')
      .collection('shards').doc(shardId);

    await shardRef.set(updates, { merge: true });
  } catch (e) {
    console.warn("Failed to update lead stats:", e);
  }
}

// 2. Global Leads (Unbranded)
exports.onLeadSubmitted = onDocumentCreated({
  document: "leads/{leadId}",
  maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  const data = event.data.data();
  await processDriverData(data, event.params.leadId);
  await updateLeadStats(data, 1);
});

// 4. Sync Driver Log Activity (Fix for Permission Error + Support both 'activities' and 'activity_logs')
exports.syncDriverOnActivity = onDocumentCreated({
  document: "companies/{companyId}/{collectionId}/{leadId}/activities/{logId}",
  maxInstances: 5
}, async (event) => {
  return handleLogSync(event);
});

exports.syncDriverOnLog = onDocumentCreated({
  document: "companies/{companyId}/{collectionId}/{leadId}/activity_logs/{logId}",
  maxInstances: 5
}, async (event) => {
  return handleLogSync(event);
});

async function handleLogSync(event) {
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
    console.error(`[handleLogSync] Failed to sync driver ${leadId}:`, error);
  }
}

// 3. Company Leads (Bulk Uploads / Private) - NEW
exports.onCompanyLeadSubmitted = onDocumentCreated({
  document: "companies/{companyId}/leads/{leadId}",
  maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  await processDriverData(event.data.data(), event.params.leadId);
});