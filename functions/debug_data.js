const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function debugData() {
    const companyId = 'iHexmEEmD8ygvL6qZ5Zd';
    const userId = '5921L1GIU7Z7O5dq22DuMZ0dzMY2'; // From previous logs

    console.log(`--- DEBUGGING DATA FOR Company: ${companyId} / User: ${userId} ---`);

    // 1. Fetch Company
    const companySnap = await db.collection('companies').doc(companyId).get();
    if (companySnap.exists) {
        const d = companySnap.data();
        console.log("COMPANY DOC:");
        console.log(JSON.stringify({
            ownerId: d.ownerId,
            createdBy: d.createdBy,
            adminId: d.adminId,
            userId: d.userId,
            ownerEmail: d.ownerEmail,
            email: d.email,
            teamEmails: d.teamEmails
        }, null, 2));
    } else {
        console.log("COMPANY DOC: NOT FOUND");
    }

    // 2. Fetch User
    const userSnap = await db.collection('users').doc(userId).get();
    if (userSnap.exists) {
        const d = userSnap.data();
        console.log("USER DOC:");
        console.log(JSON.stringify({
            email: d.email,
            role: d.role,
            globalRole: d.globalRole,
            companyId: d.companyId
        }, null, 2));
    } else {
        console.log("USER DOC: NOT FOUND (Will default to Auth email)");
    }

    // 3. Check specific subcollection path
    const memberSnap = await db.collection('companies').doc(companyId).collection('team').doc(userId).get();
    console.log(`TEAM SUBCOLLECTION CHECK: ${memberSnap.exists ? 'FOUND' : 'NOT FOUND'}`);
}

debugData().catch(console.error);
