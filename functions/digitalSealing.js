// functions/digitalSealing.js
const functions = require('firebase-functions/v1');
const { admin, db, storage } = require('./firebaseAdmin');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto'); // M2 FIX

// Fail-fast: If pdf-lib is missing, crash immediately at cold start
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

exports.sealDocument = functions.runWith({
    memory: '1GB',
    timeoutSeconds: 300
}).firestore
    .document('companies/{companyId}/signing_requests/{requestId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();

        // 1. Only run if status changed to 'pending_seal'
        if (newData.status !== 'pending_seal' || previousData.status === 'pending_seal') {
            return null;
        }

        const sealStartedAt = Date.now();

        // pdf-lib is guaranteed to exist (fail-fast at cold start)

        const { companyId, requestId } = context.params;
        const tempPdfPath = path.join(os.tmpdir(), `orig_${requestId}.pdf`);
        const outputPdfPath = path.join(os.tmpdir(), `final_${requestId}.pdf`);
        const tempSigPaths = [];

        try {
            const bucket = storage.bucket();

            // 2. Download Original PDF
            let srcPath = newData.storagePath;
            if (srcPath.startsWith('gs://')) {
                srcPath = srcPath.replace(`gs://${bucket.name}/`, '');
            }

            // SECURITY: Path Traversal Prevention
            // Ensure path MUST start with allowed prefixes for this company
            const allowedPrefixes = [
                `companies/${companyId}/`,
                `secure_documents/${companyId}/`
            ];

            const isAllowed = allowedPrefixes.some(prefix => srcPath.startsWith(prefix));
            if (!isAllowed) {
                console.error(`[Security] unauthorized access attempt. Company ${companyId} tried to access ${srcPath}`);
                throw new Error("Security Violation: Unauthorized document path.");
            }

            await bucket.file(srcPath).download({ destination: tempPdfPath });

            // 3. Load PDF
            const pdfBytes = fs.readFileSync(tempPdfPath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

            // 4. PROCESS FIELDS
            const fields = newData.fields || [];
            const values = newData.fieldValues || {};

            // ESIGN-3 FIX: Track which required fields are missing so we can fail properly
            // instead of silently marking the document as 'signed' with blank required fields.
            const missingRequiredFields = [];
            const sigPathsToDelete = []; // ESIGN-9: collect paths for cleanup after sealing

            for (const field of fields) {
                // SAFETY: Skip null/undefined entries that may exist from corrupted Firestore data
                if (!field) continue;

                const val = values[field.id] || field.defaultValue;
                if (!val) {
                    // ESIGN-3 FIX: Track missing required fields
                    if (field.required) {
                        missingRequiredFields.push(field.id);
                    }
                    continue;
                }

                const pageIndex = Math.max(0, (field.pageNumber || field.page || 1) - 1);
                if (pageIndex >= pdfDoc.getPages().length) continue;

                const page = pdfDoc.getPages()[pageIndex];
                const { width, height } = page.getSize();

                // Accept both naming conventions: xPosition/yPosition (legacy) and x/y (current)
                const fieldX = field.xPosition ?? field.x ?? 0;
                const fieldY = field.yPosition ?? field.y ?? 0;

                // Calculate Coordinates from Percentages
                const x = (fieldX / 100) * width;
                const y = height - ((fieldY / 100) * height);
                const fieldW = (field.width / 100) * width;
                const fieldH = (field.height / 100) * height;

                if (field.type === 'text' || field.type === 'date') {
                    // DYNAMIC FONT SCALING with fontSize override
                    const calculatedSize = field.fontSize && field.fontSize !== 'Auto'
                        ? parseInt(field.fontSize)
                        : Math.max(6, fieldH * 0.7);

                    page.drawText(String(val), {
                        x: x + 2,
                        y: y - (fieldH * 0.8), // Vertical centering adjustment
                        size: calculatedSize,
                        font: helvetica,
                        color: rgb(0, 0, 0),
                        maxWidth: fieldW - 4 // Prevent text from bleeding out of the box
                    });
                }
                else if (field.type === 'checkbox' && val === true) {
                    // DRAW CHECKMARK (X) scaled to field size
                    const inset = fieldW * 0.2;
                    page.drawLine({
                        start: { x: x + inset, y: y - inset },
                        end: { x: x + fieldW - inset, y: y - fieldH + inset },
                        thickness: Math.max(1, fieldW * 0.1),
                        color: rgb(0, 0, 0),
                    });
                    page.drawLine({
                        start: { x: x + fieldW - inset, y: y - inset },
                        end: { x: x + inset, y: y - fieldH + inset },
                        thickness: Math.max(1, fieldW * 0.1),
                        color: rgb(0, 0, 0),
                    });
                }
                else if (field.type === 'signature' || field.type === 'initial') {
                    // PHASE 5: Handle both signature and initial types identically
                    const sigTempPath = path.join(os.tmpdir(), `sig_${field.id}.png`);
                    try {
                        let sigPath = val;
                        if (sigPath.startsWith('gs://')) {
                            sigPath = sigPath.replace(`gs://${bucket.name}/`, '');
                        }

                        // Validate signature path belongs to this company
                        const sigAllowedPrefix = `secure_documents/${companyId}/signatures/`;
                        if (!sigPath.startsWith(sigAllowedPrefix)) {
                            console.error(`[Security] Signature path rejected: ${sigPath}`);
                            if (field.required) missingRequiredFields.push(field.id);
                            continue; // Skip this field — don't throw, continue sealing
                        }

                        await bucket.file(sigPath).download({ destination: sigTempPath });
                        tempSigPaths.push(sigTempPath);
                        // ESIGN-9 FIX: Track Storage paths for post-sealing cleanup
                        sigPathsToDelete.push(sigPath);

                        const sigBytes = fs.readFileSync(sigTempPath);
                        const sigImage = await pdfDoc.embedPng(sigBytes);

                        // Scale image to fit the drawn box while maintaining aspect ratio
                        const scale = Math.min(fieldW / sigImage.width, fieldH / sigImage.height);
                        const sigDims = sigImage.scale(scale);

                        page.drawImage(sigImage, {
                            x: x,
                            y: y - sigDims.height,
                            width: sigDims.width,
                            height: sigDims.height,
                        });
                    } catch (sigErr) {
                        console.error(`Failed to load signature ${field.id}:`, sigErr);
                        if (field.required) missingRequiredFields.push(field.id);
                    }
                }
            }

            // ESIGN-3 FIX: Fail sealing if any required fields were missing or skipped.
            // Previously the function would seal a "complete" document with blank fields
            // and mark it 'signed', creating a legally void document.
            if (missingRequiredFields.length > 0) {
                console.error(`[Seal] Required fields missing: ${missingRequiredFields.join(', ')}`);
                await change.after.ref.update({
                    status: 'error_sealing',
                    errorLog: `Required fields not completed: ${missingRequiredFields.join(', ')}`,
                    missingFields: missingRequiredFields,
                });
                return;
            }

            // 5. Append Enhanced Audit Trail Page
            const auditPage = pdfDoc.addPage();
            const auditHeight = auditPage.getHeight();

            auditPage.drawText('Certificate of Completion', { x: 50, y: auditHeight - 50, size: 24, font: helvetica });
            auditPage.drawText(`Envelope ID: ${requestId}`, { x: 50, y: auditHeight - 80, size: 10, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

            const auditLog = `
        DOCUMENT TITLE: ${newData.title || 'Untitled Document'}
        SIGNER NAME: ${newData.recipientName || 'Authorized User'}
        SIGNER EMAIL: ${newData.recipientEmail || 'N/A'}
        COMPLETED AT: ${new Date().toISOString()}
        IP ADDRESS: ${newData.auditTrail?.ip || 'Recorded'}
        USER AGENT: ${newData.auditTrail?.userAgent || 'N/A'}

        SECURITY VERIFICATION:
        This document was securely signed and sealed via SafeHaul.
        The layout and metadata are preserved in the platform's audit logs.
      `;

            auditPage.drawText(auditLog, {
                x: 50,
                y: auditHeight - 150,
                size: 10,
                font: helvetica,
                lineHeight: 16
            });

            // 6. Save & Upload Final PDF
            const finalPdfBytes = await pdfDoc.save();
            fs.writeFileSync(outputPdfPath, finalPdfBytes);

            const finalStoragePath = `secure_documents/${companyId}/completed/${requestId}_signed.pdf`;

            await bucket.upload(outputPdfPath, {
                destination: finalStoragePath,
                metadata: { contentType: 'application/pdf' }
            });

            // M2 FIX: Real SHA-256 checksum of the sealed PDF bytes
            const sha256 = crypto.createHash('sha256').update(Buffer.from(finalPdfBytes)).digest('hex');

            // 7. Update Firestore
            await change.after.ref.update({
                status: 'signed',
                signedPdfUrl: finalStoragePath,
                sha256Checksum: sha256,
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // ESIGN-9 FIX: Delete the raw signature PNG files from Cloud Storage after sealing.
            // They are embedded in the sealed PDF and no longer needed as standalone files.
            // Keeping them is a PII retention risk under GDPR/CCPA.
            const failedDeletions = [];
            for (const sigPath of sigPathsToDelete) {
                try {
                    await bucket.file(sigPath).delete();
                } catch (delErr) {
                    console.warn(`[Seal] Could not delete signature file ${sigPath}:`, delErr.message);
                    failedDeletions.push(sigPath);
                }
            }

            // If any deletions failed, record the orphaned paths in Firestore so a
            // scheduled cleanup job can retry them (prevents indefinite PII retention).
            if (failedDeletions.length > 0) {
                try {
                    await db.collection('orphaned_signature_cleanup').add({
                        paths: failedDeletions,
                        requestId,
                        companyId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                } catch (trackErr) {
                    console.error('[Seal] Could not record orphaned paths for cleanup:', trackErr.message);
                }
            }

        } catch (err) {
            console.error("Sealing Failed:", err);
            await change.after.ref.update({ status: 'error_sealing', errorLog: err.message });
        } finally {
            console.log(`[sealDocument] wall_ms=${Date.now() - sealStartedAt} companyId=${context.params.companyId} requestId=${context.params.requestId}`);
            try {
                if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
                if (fs.existsSync(outputPdfPath)) fs.unlinkSync(outputPdfPath);
                tempSigPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
            } catch (e) {
                // Best-effort temp file cleanup.
            }
        }
    });

// ESIGN-9 FIX: Scheduled cleanup job for orphaned signature PNG files.
// When signature deletion fails after sealing, the path is recorded in
// `orphaned_signature_cleanup`. This job runs nightly to retry those deletions.
// Without this job, PII (signature images) would accumulate in Storage indefinitely.
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.cleanupOrphanedSignatures = onSchedule(
    { schedule: 'every 24 hours', region: 'us-central1', timeoutSeconds: 300 },
    async () => {
        // LOW-2 FIX: Use the imported `db` instead of re-declaring
        const bucket = storage.bucket();
        const collRef = db.collection('orphaned_signature_cleanup');

        // Process entries older than 1 hour (give immediate retries time to complete)
        const cutoff = new Date(Date.now() - 60 * 60 * 1000);
        const snap = await collRef.where('createdAt', '<', cutoff).limit(100).get();

        if (snap.empty) {
            console.log('[CleanupJob] No orphaned signature files to process.');
            return;
        }

        let deletedCount = 0;
        let failedCount = 0;
        const batch = db.batch();

        for (const doc of snap.docs) {
            const { paths } = doc.data();
            let allDeleted = true;

            for (const sigPath of (paths || [])) {
                try {
                    await bucket.file(sigPath).delete();
                    deletedCount++;
                } catch (err) {
                    if (err.code === 404) {
                        // File already deleted — treat as success
                        deletedCount++;
                    } else {
                        console.warn(`[CleanupJob] Still cannot delete ${sigPath}:`, err.message);
                        failedCount++;
                        allDeleted = false;
                    }
                }
            }

            if (allDeleted) {
                batch.delete(doc.ref);
            }
        }

        await batch.commit();
        console.log(`[CleanupJob] Orphaned signatures: ${deletedCount} deleted, ${failedCount} still pending.`);
    }
);
