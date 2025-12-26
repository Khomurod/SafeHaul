// functions/digitalSealing.js
const functions = require('firebase-functions/v1');
const { admin, db, storage } = require('./firebaseAdmin'); // Use shared instance
const path = require('path');
const os = require('os');
const fs = require('fs');

// Lazy load pdf-lib to prevent cold-start crashes if it's missing
let PDFDocument, StandardFonts, rgb;
try {
    const pdfLib = require('pdf-lib');
    PDFDocument = pdfLib.PDFDocument;
    StandardFonts = pdfLib.StandardFonts;
    rgb = pdfLib.rgb;
} catch (e) {
    console.warn("WARNING: pdf-lib dependency is missing. Sealing will fail.");
}

exports.sealDocument = functions.firestore
  .document('companies/{companyId}/signing_requests/{requestId}')
  .onUpdate(async (change, context) => {
    const newData = change.after.data();
    const previousData = change.before.data();

    // 1. Only run if status changed to 'pending_seal'
    if (newData.status !== 'pending_seal' || previousData.status === 'pending_seal') {
      return null;
    }

    if (!PDFDocument) {
        console.error("Critical Error: pdf-lib not installed.");
        await change.after.ref.update({ status: 'error_system', errorLog: "Backend dependency 'pdf-lib' is missing." });
        return null;
    }

    const { companyId, requestId } = context.params;
    console.log(`Starting seal for Request: ${requestId}`);

    const tempPdfPath = path.join(os.tmpdir(), `orig_${requestId}.pdf`);
    const outputPdfPath = path.join(os.tmpdir(), `final_${requestId}.pdf`);
    const tempSigPaths = []; // Track temp signature files to delete later

    try {
      const bucket = storage.bucket();

      // 2. Download Original PDF
      // Handle cases where storagePath might include the 'gs://' prefix
      let srcPath = newData.storagePath;
      if (srcPath.startsWith('gs://')) {
          const bucketName = bucket.name;
          srcPath = srcPath.replace(`gs://${bucketName}/`, '');
      }

      await bucket.file(srcPath).download({ destination: tempPdfPath });

      // 3. Load PDF
      const pdfBytes = fs.readFileSync(tempPdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // 4. PROCESS FIELDS
      const fields = newData.fields || [];
      const values = newData.fieldValues || {};

      for (const field of fields) {
          const val = values[field.id];
          if (!val) continue; // Skip empty fields

          // Get Page
          const pageIndex = Math.max(0, (field.pageNumber || 1) - 1);
          if (pageIndex >= pdfDoc.getPages().length) continue;

          const page = pdfDoc.getPages()[pageIndex];
          const { width, height } = page.getSize();

          // Calculate Coordinates
          // X/Y are stored as percentages (0-100)
          const x = (field.xPosition / 100) * width;
          const y = height - ((field.yPosition / 100) * height); // Top-down flip

          if (field.type === 'text' || field.type === 'date') {
              // DRAW TEXT
              page.drawText(String(val), {
                  x: x + 2, // Slight padding
                  y: y - 12, // Adjust for font height (approx)
                  size: 10,
                  font: helvetica,
                  color: rgb(0, 0, 0),
              });
          } 
          else if (field.type === 'checkbox' && val === true) {
              // DRAW CHECKMARK (X)
              page.drawLine({
                  start: { x: x, y: y },
                  end: { x: x + 10, y: y - 10 },
                  thickness: 2,
                  color: rgb(0, 0, 0),
              });
              page.drawLine({
                  start: { x: x + 10, y: y },
                  end: { x: x, y: y - 10 },
                  thickness: 2,
                  color: rgb(0, 0, 0),
              });
          }
          else if (field.type === 'signature') {
              // DRAW SIGNATURE IMAGE
              // Value is the storage path to the signature PNG
              const sigTempPath = path.join(os.tmpdir(), `sig_${field.id}.png`);

              try {
                  // Clean path if needed
                  let sigPath = val;
                  if (sigPath.startsWith('gs://')) {
                      sigPath = sigPath.replace(`gs://${bucket.name}/`, '');
                  }

                  await bucket.file(sigPath).download({ destination: sigTempPath });
                  tempSigPaths.push(sigTempPath);

                  const sigBytes = fs.readFileSync(sigTempPath);
                  const sigImage = await pdfDoc.embedPng(sigBytes);

                  const sigScale = 150 / sigImage.width;
                  const sigDims = sigImage.scale(sigScale);

                  page.drawImage(sigImage, {
                      x: x,
                      y: y - sigDims.height, // Image draws from bottom-left
                      width: sigDims.width,
                      height: sigDims.height,
                  });
              } catch (sigErr) {
                  console.error(`Failed to load signature ${field.id}:`, sigErr);
              }
          }
      }

      // 5. Append Audit Trail Page
      const auditPage = pdfDoc.addPage();
      const auditHeight = auditPage.getHeight();

      auditPage.drawText('Certificate of Completion', { x: 50, y: auditHeight - 50, size: 24, font: helvetica });
      auditPage.drawText(`Envelope ID: ${requestId}`, { x: 50, y: auditHeight - 80, size: 10, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

      const auditLog = `
        Signer Name: ${newData.recipientName || 'Authorized User'}
        Signer Email: ${newData.recipientEmail || 'N/A'}
        Completed At: ${new Date().toISOString()}
        IP Address: ${newData.auditTrail?.ip || 'Recorded'}
        User Agent: ${newData.auditTrail?.userAgent || 'N/A'}

        This document was securely signed and sealed via SafeHaul.
        Digital Checksum: ${requestId.substring(0, 8)}-${Date.now()}
      `;

      auditPage.drawText(auditLog, { 
          x: 50, 
          y: auditHeight - 150, 
          size: 10, 
          font: helvetica, 
          lineHeight: 14 
      });

      // 6. Save & Upload Final PDF
      const finalPdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPdfPath, finalPdfBytes);

      const finalStoragePath = `secure_documents/${companyId}/completed/${requestId}_signed.pdf`;

      await bucket.upload(outputPdfPath, {
          destination: finalStoragePath,
          metadata: { contentType: 'application/pdf' }
      });

      // 7. Update Firestore
      await change.after.ref.update({
          status: 'signed',
          signedPdfUrl: finalStoragePath,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Sealing Complete:", finalStoragePath);

    } catch (err) {
      console.error("Sealing Failed:", err);
      await change.after.ref.update({
        status: 'error_sealing',
        errorLog: err.message
      });
    } finally {
      // Cleanup Temp Files
      try {
          if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
          if (fs.existsSync(outputPdfPath)) fs.unlinkSync(outputPdfPath);
          tempSigPaths.forEach(p => {
              if (fs.existsSync(p)) fs.unlinkSync(p);
          });
      } catch (cleanupErr) { console.error("Cleanup warning:", cleanupErr); }
    }
  });