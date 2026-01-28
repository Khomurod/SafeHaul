// Quick script to check applicant data in Firestore using Application Default Credentials
const admin = require('firebase-admin');

// Initialize with default credentials 
admin.initializeApp({
    projectId: 'safehaul-official'
});

const db = admin.firestore();

async function checkApplicantData() {
    console.log('Searching for applicant: Kholmurod...\n');

    // Query all companies for this applicant
    const companiesSnap = await db.collection('companies').get();

    for (const companyDoc of companiesSnap.docs) {
        const companyId = companyDoc.id;
        const companyName = companyDoc.data().companyName || companyId;

        // Check applications
        const appsSnap = await db.collection('companies').doc(companyId)
            .collection('applications')
            .where('firstName', '==', 'Kholmurod')
            .get();

        if (!appsSnap.empty) {
            console.log(`\n=== Found in ${companyName} ===`);

            for (const appDoc of appsSnap.docs) {
                const data = appDoc.data();
                console.log(`\nApplication ID: ${appDoc.id}`);
                console.log(`Name: ${data.firstName} ${data.lastName}`);
                console.log(`\n--- CDL/Med Card Fields ---`);
                console.log(`cdl-front:`, data['cdl-front'] ? JSON.stringify(data['cdl-front'], null, 2) : 'NOT FOUND');
                console.log(`cdl-back:`, data['cdl-back'] ? JSON.stringify(data['cdl-back'], null, 2) : 'NOT FOUND');
                console.log(`medical-card-upload:`, data['medical-card-upload'] ? JSON.stringify(data['medical-card-upload'], null, 2) : 'NOT FOUND');
                console.log(`medCardExpiration:`, data.medCardExpiration || 'NOT FOUND');
                console.log(`\n--- Signature Fields ---`);
                console.log(`signature:`, data.signature ? 'EXISTS (length: ' + data.signature.length + ')' : 'NOT FOUND');
                console.log(`signature-date:`, data['signature-date'] || 'NOT FOUND');
                console.log(`signatureDate:`, data.signatureDate || 'NOT FOUND');
                console.log(`submittedAt:`, data.submittedAt || 'NOT FOUND');
                console.log(`createdAt:`, data.createdAt || 'NOT FOUND');

                // Check dq_files subcollection
                const dqSnap = await db.collection('companies').doc(companyId)
                    .collection('applications').doc(appDoc.id)
                    .collection('dq_files').get();

                console.log(`\n--- DQ Files Subcollection ---`);
                console.log(`Total DQ Files: ${dqSnap.size}`);
                dqSnap.docs.forEach(d => {
                    console.log(`  - ${d.data().fileType}: ${d.data().fileName || 'N/A'}`);
                });
            }
        }
    }

    console.log('\n\nDone checking.');
    process.exit(0);
}

checkApplicantData().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
