const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// 1. Initialize App
if (!admin.apps.length) {
  admin.initializeApp();
}

// 2. Get Instances
const db = getFirestore();
const auth = admin.auth();
const storage = getStorage();

// 3. Settings
db.settings({ ignoreUndefinedProperties: true });

console.log("✅ Firebase Admin Initialized Successfully");

// 4. Export everything (including storage)
module.exports = { admin, db, auth, storage };
