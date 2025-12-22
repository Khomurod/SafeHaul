const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

// 1. Initialize App (Guard against multiple initializations)
if (!admin.apps.length) {
  admin.initializeApp();
}

// 2. Get Firestore Instance
const db = getFirestore();

// 3. Prevent "Invalid data: undefined" errors
db.settings({ ignoreUndefinedProperties: true });

console.log("✅ Firebase Admin Initialized Successfully");

module.exports = { admin, db };