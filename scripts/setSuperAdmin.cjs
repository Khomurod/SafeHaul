const admin = require('firebase-admin');

// Robust dependency loading
let auth;
try {
    const pkg = require('firebase-admin');
    if (!pkg.apps.length) pkg.initializeApp();
    auth = pkg.auth();
} catch (e) {
    try {
        const pkg = require('../functions/node_modules/firebase-admin');
        if (!pkg.apps.length) pkg.initializeApp();
        auth = pkg.auth();
    } catch (e2) {
        console.error("Could not find firebase-admin.");
        process.exit(1);
    }
}

async function setSuperAdmin(email) {
    try {
        const user = await auth.getUserByEmail(email);
        console.log(`Found user: ${user.email} (${user.uid})`);

        const currentClaims = user.customClaims || {};
        await auth.setCustomUserClaims(user.uid, {
            ...currentClaims,
            globalRole: 'super_admin'
        });

        console.log(`SUCCESS: Granting 'super_admin' role to ${email}`);
        console.log(`UID: ${user.uid}`); // Print UID so user can save it for fallback
    } catch (error) {
        console.error("Error setting claim:", error);
    }
}

// Run for the specific admin email
const adminEmail = process.argv[2] || 'holmurod96@gmail.com';
setSuperAdmin(adminEmail);
