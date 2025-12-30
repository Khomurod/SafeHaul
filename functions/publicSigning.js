const { onCall, HttpsError } = require("firebase-functions/v2/https");
// FIX: Added 'admin' to the import list
const { admin, db, storage } = require("./firebaseAdmin"); 

// 1. GET PUBLIC DOCUMENT (Read Only)
exports.getPublicEnvelope = onCall({ cors: true }, async (request) => {
    if (!request.data) throw new HttpsError('invalid-argument', 'Missing data payload.');
    const { companyId, requestId, accessToken } = request.data;
    
    if (!companyId || !requestId || !accessToken) {
        throw new HttpsError('invalid-argument', 'Missing parameters.');
    }

    try {
        const docRef = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) throw new HttpsError('not-found', 'Document not found.');
        
        const data = docSnap.data();

        if (data.accessToken !== accessToken) {
            console.warn(`Token Mismatch.`);
            throw new HttpsError('permission-denied', 'Invalid Access Token.');
        }

        if (data.status === 'signed') {
             return { status: 'signed', recipientName: data.recipientName };
        }

        if (!data.storagePath) {
            throw new HttpsError('failed-precondition', 'Document file reference is missing.');
        }

        const bucket = storage.bucket(); 
        let filePath = data.storagePath;
        
        if (filePath.startsWith('gs://')) {
             const bucketName = bucket.name;
             filePath = filePath.replace(`gs://${bucketName}/`, '');
        }

        const fileRef = bucket.file(filePath);
        
        try {
            const [url] = await fileRef.getSignedUrl({
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000 
            });
            
            return {
                title: data.title,
                recipientName: data.recipientName,
                recipientEmail: data.recipientEmail,
                fields: data.fields || [],
                pdfUrl: url,
                status: data.status
            };

        } catch (signErr) {
            console.error("Signing Error:", signErr);
            throw new HttpsError('internal', 'Server permission error: Cannot sign URL.');
        }

    } catch (error) {
        console.error("CRITICAL ERROR in getPublicEnvelope:", error);
        throw new HttpsError('internal', error.message);
    }
});

// 2. SUBMIT SIGNED DOCUMENT (Write)
exports.submitPublicEnvelope = onCall({ cors: true }, async (request) => {
    const { companyId, requestId, accessToken, fieldValues, auditData } = request.data;
    if (!companyId || !requestId) throw new HttpsError('invalid-argument', 'Missing parameters.');

    try {
        const docRef = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) throw new HttpsError('not-found', 'Document not found');
        
        const data = docSnap.data();
        if (data.accessToken !== accessToken) throw new HttpsError('permission-denied', 'Unauthorized');

        const bucket = storage.bucket();
        const finalValues = {};

        for (const [key, value] of Object.entries(fieldValues)) {
            if (typeof value === 'string' && value.startsWith('data:image')) {
                const base64Image = value.split(';base64,').pop();
                const buffer = Buffer.from(base64Image, 'base64');
                const filePath = `secure_documents/${companyId}/signatures/${requestId}_${key}.png`;
                
                await bucket.file(filePath).save(buffer, {
                    metadata: { contentType: 'image/png' }
                });
                finalValues[key] = filePath; 
            } else {
                finalValues[key] = value;
            }
        }

        await docRef.update({
            status: 'pending_seal',
            fieldValues: finalValues,
            // Now 'admin' is defined, so this will work!
            signedAt: admin.firestore.FieldValue.serverTimestamp(),
            auditTrail: {
                ...auditData,
                timestamp: new Date().toISOString(),
                method: 'Public Secure Link'
            }
        });

        return { success: true };

    } catch (error) {
        console.error("Submit Error:", error);
        throw new HttpsError('internal', error.message);
    }
});