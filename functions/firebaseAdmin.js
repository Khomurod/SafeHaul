const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// 1. Initialize App with Explicit Bucket
if (!admin.apps.length) {
  admin.initializeApp({
      // This tells Firebase exactly where to look for files
      storageBucket: "truckerapp-system.firebasestorage.app" 
  });
}

// 2. Get Instances
const db = getFirestore();
const auth = admin.auth();
const storage = getStorage(); // This was missing before!

// 3. Settings
db.settings({ ignoreUndefinedProperties: true });

console.log("✅ Firebase Admin Initialized Successfully");

// 4. Export everything (including storage)
module.exports = { admin, db, auth, storage };