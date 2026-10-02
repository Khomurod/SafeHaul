const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, FieldPath, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// 1. Initialize App
if (!getApps().length) {
  initializeApp();
}

// 2. Get Instances
const db = getFirestore();
const auth = getAuth();
const storage = getStorage();

// 3. Settings
db.settings({ ignoreUndefinedProperties: true });

// 4. The `admin.*` calls the rest of functions/ makes. firebase-admin 14 has no
// namespace export, so they are built here from the modular API, over the same
// instances: `admin.firestore()` is `db`, settings included.
const admin = {
  firestore: Object.assign(() => db, { FieldValue, FieldPath, Timestamp }),
  auth: () => auth,
  storage: () => storage,
};

console.log("✅ Firebase Admin Initialized Successfully");

// 5. Export everything (including storage)
module.exports = { admin, db, auth, storage };
