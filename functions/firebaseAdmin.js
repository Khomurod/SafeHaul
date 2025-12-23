const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

// 1. Initialize App (Guard against multiple initializations)
if (!admin.apps.length) {
  admin.initializeApp();
}

// 2. Get Firestore Instance
const db = getFirestore();

// 3. Get Auth Instance (CRITICAL MISSING PIECE)
const auth = admin.auth();

// 4. Prevent "Invalid data: undefined" errors
db.settings({ ignoreUndefinedProperties: true });

console.log("✅ Firebase Admin Initialized Successfully");

// Export auth so other files can use it
module.exports = { admin, db, auth };