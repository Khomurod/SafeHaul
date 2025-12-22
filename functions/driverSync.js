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
                // User doesn't exist -> Create Auth User
                try {
                    const newDriverAuth = await auth.createUser({
                        email: email,
                        emailVerified: true,
                        displayName: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
                        // Only add phone if it's unique/valid, otherwise skip to avoid E.164 errors
                        phoneNumber: undefined 
                    });
                    driverUid = newDriverAuth.uid;

                    // Create the public User document for roles
                    await db.collection("users").doc(driverUid).set({
                        name: `${data.firstName} ${data.lastName}`,
                        email: email,
                        role: 'driver',
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`Created new Driver Auth: ${email}`);
                } catch (createErr) {
                    console.error("Failed to create Auth user:", createErr);
                    // Fallback: If Auth fails (e.g. bad password policy), use docId as driverUid
                    driverUid = docId;
                }
            } else {
                throw e;
            }
        }
    } else {
        // --- SCENARIO B: Placeholder Email (Phone Only) ---
        // We cannot use Auth easily because Auth requires unique emails.
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

  // 2. Create/Update Master Profile
  const driverDocRef = db.collection("drivers").doc(driverUid);

  const masterProfileData = {
    personalInfo: {
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      email: email,
      phone: data.phone || "",
      dob: data.dob || "",
      ssn: data.ssn || "",
      street: data.street || "",
      city: data.city || "",
      state: data.state || "",
      zip: data.zip || ""
    },
    qualifications: {
      experienceYears: data.experience || data['experience-years'] || "",
    },
    // Only overwrite licenses if new data has them
    ...(data.cdlNumber ? {
        licenses: [
          {
            state: data.cdlState || "",
            number: data.cdlNumber || "",
            expiration: data.cdlExpiration || "",
            class: data.cdlClass || ""
          }
        ]
    } : {}),
    lastApplicationDate: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await driverDocRef.set(masterProfileData, { merge: true });
  console.log(`Successfully synced Master Profile for ${driverUid}`);
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

// 3. Company Leads (Bulk Uploads / Private) - NEW
exports.onCompanyLeadSubmitted = onDocumentCreated({
    document: "companies/{companyId}/leads/{leadId}",
    maxInstances: 2
}, async (event) => {
  if (!event.data) return;
  await processDriverData(event.data.data(), event.params.leadId);
});