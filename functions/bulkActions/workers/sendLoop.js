// functions/bulkActions/workers/sendLoop.js
//
// The sequential send loop: one lead at a time — mid-batch cancel check,
// idempotency check, data fetch, blacklist check, the send itself, the
// atomic log+pointer transaction, the lead timestamp, and the SMS/email
// dedup ledgers, with the 3-second pacing (`sendPacing.js`). Extracted
// verbatim from `batchWorker.js` except the seam: the batch counters are
// locals here and are returned, where the worker used to close over them.

const { admin, db } = require("../../firebaseAdmin");
const { isBlacklisted } = require("../../blacklist");
const { normalizePhone } = require("../../utils/phoneUtils");
const { pauseBeforeNextSend } = require("./sendPacing");
const { escapeHtml, plainGuestText } = require("../../shared/plainText");

/** Returns `{ batchSuccessCount, batchFailCount, pointerAdvanceCount }`. */
async function runSendLoop({
    batchIds,
    sessionRef,
    sessionId,
    companyId,
    sessionData,
    leadSourceType,
    config,
    companyName,
    recruiterName,
    senderId,
    adapter,
    emailTransporter,
}) {
    // A function replacer, so a "$&" in a name is text and not a replacement pattern.
    // The lead's name can come from a public form: it goes out as plain text without
    // its links, as in the other emails a company sends (`shared/plainText.js`).
    const fillPlaceholders = (text, leadData) => text
        .replace(/\[Driver Name\]/g, () => plainGuestText(leadData.firstName, 40) || 'Driver')
        .replace(/\[Company Name\]/g, () => companyName)
        .replace(/\[Recruiter Name\]/g, () => recruiterName || 'your recruiter');

    let batchSuccessCount = 0;
    let batchFailCount = 0;
    let pointerAdvanceCount = 0;


        try {

            for (let i = 0; i < batchIds.length; i++) {
                const leadId = batchIds[i];
                // Note: Lead ID not logged to avoid exposing PII in Cloud Function logs

                // Status check before every send (including first) so pause/cancel
                // cannot slip a message through on batch start.
                try {
                    const midCheck = await sessionRef.get();
                    if (!midCheck.exists || !['active'].includes(midCheck.data().status)) {
                        console.log(`[BatchWorker] Mid-batch cancel detected at item ${i}/${batchIds.length}. Breaking.`);
                        break;
                    }
                } catch (checkErr) {
                    console.warn('[BatchWorker] Mid-batch status check failed (continuing):', checkErr.message);
                }

                const loopStart = Date.now();
                let success = false;
                let errorMsg = null;
                let recipientName = "Unknown";
                let recipientIdentity = "N/A";

                // Declare variables in loop scope
                let leadData = {};
                let leadDocRef = null;

                try {
                    // Idempotency Check
                    const logRef = sessionRef.collection('logs').doc(leadId);
                    const logSnap = await logRef.get();
                    if (logSnap.exists) {
                        await sessionRef.update({
                            'progress.currentPointer': admin.firestore.FieldValue.increment(1),
                            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        pointerAdvanceCount++;
                        continue; // Already processed
                    }

                    // 1. Fetch Data
                    if (leadSourceType === 'import') {
                        // AUDIT FIX #3: For retries, target docs live under the ORIGINAL session
                        const sourceSessionId = sessionData.importSourceSessionId || sessionId;
                        const tSnap = await db.collection('companies').doc(companyId)
                            .collection('bulk_sessions').doc(sourceSessionId)
                            .collection('targets').doc(leadId).get();
                        
                        if (tSnap.exists) leadData = tSnap.data();
                        else errorMsg = "Imported target data missing";
                    } else {
                        if (leadSourceType === 'leads') {
                            leadDocRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
                        } else {
                            leadDocRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);
                        }
                        const lSnap = await leadDocRef.get();
                        if (lSnap.exists) leadData = lSnap.data();
                        else errorMsg = "CRM lead data missing";
                    }


                    if (!errorMsg) {
                        recipientName = `${leadData.firstName || 'Driver'} ${leadData.lastName || ''}`.trim();
                        const phone = leadData.phone || leadData.phoneNumber;

                        // 2. Blacklist Check
                        const blacklisted = await isBlacklisted(companyId, phone);

                        if (blacklisted) {
                            errorMsg = "Number is blacklisted (Opt-out)";
                            success = false;
                        } else if (config.method === 'sms') {
                            if (!adapter) throw new Error("SMS Configuration Invalid");
                            recipientIdentity = phone || "No Phone";

                            if (recipientIdentity !== "No Phone") {
                                const finalMsg = fillPlaceholders(config.message, leadData);

                                await adapter.sendSMS(recipientIdentity, finalMsg, senderId);
                                success = true;
                            } else {
                                errorMsg = "No valid phone number";
                            }
                        } else if (config.method === 'email') {
                            if (!emailTransporter) throw new Error("Email Settings Invalid");
                            recipientIdentity = leadData.email || "No Email";

                            if (recipientIdentity !== "No Email") {
                                const finalBody = fillPlaceholders(config.message, leadData);

                                await emailTransporter.sendMail({
                                    from: `"${companyName}" <${emailTransporter.transporter.options.auth.user}>`,
                                    to: recipientIdentity,
                                    // The composer offers the placeholders in the subject too.
                                    subject: config.subject ? fillPlaceholders(config.subject, leadData) : `Update from ${companyName}`,
                                    text: finalBody,
                                    html: `<p>${escapeHtml(finalBody).replace(/\n/g, '<br>')}</p>`
                                });
                                success = true;
                            } else {
                                errorMsg = "No valid email";
                            }
                        }
                    }

                } catch (err) {
                    console.error(`Error processing lead ${leadId}:`, err);
                    errorMsg = err.message || "Unknown error";
                    success = false;
                }

                // 3. Log result + advance pointer atomically so pause/cancel never skips work.
                const logPayload = {
                    leadId,
                    recipientName,
                    recipientIdentity,
                    status: success ? 'delivered' : 'failed',
                    error: errorMsg,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    isSuccess: success
                };
                try {
                    const applied = await db.runTransaction(async (t) => {
                        const logRef = sessionRef.collection('logs').doc(leadId);
                        const [sessionDoc, logDoc] = await Promise.all([
                            t.get(sessionRef),
                            t.get(logRef)
                        ]);
                        if (!sessionDoc.exists) return { alreadyLogged: false };

                        const updates = {
                            'progress.currentPointer': admin.firestore.FieldValue.increment(1),
                            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                        };

                        if (logDoc.exists) {
                            t.update(sessionRef, updates);
                            return { alreadyLogged: true };
                        }

                        t.set(logRef, logPayload);
                        t.update(sessionRef, {
                            ...updates,
                            'progress.processedCount': admin.firestore.FieldValue.increment(1),
                            'progress.successCount': admin.firestore.FieldValue.increment(success ? 1 : 0),
                            'progress.failedCount': admin.firestore.FieldValue.increment(success ? 0 : 1),
                        });
                        return { alreadyLogged: false };
                    });

                    if (!applied?.alreadyLogged) {
                        if (success) batchSuccessCount++;
                        else batchFailCount++;
                    }
                    pointerAdvanceCount++;
                } catch (e) {
                    console.error("Failed to write log + progress transaction:", e);
                }

                // 4.5 Update Lead Timestamp (Smart Exclusion)
                // AUDIT FIX #7: Log errors instead of silently swallowing them
                if (success && leadDocRef) {
                    leadDocRef.update({
                        lastBulkMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastContactedAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(e => {
                        console.error(`[BatchWorker] Failed to update lead timestamp for ${leadId}:`, e.message);
                    });
                }

                // 4.6 Update Send Ledgers (7-Day Dedup) for SMS *and* Email
                // AUDIT FIX #7 / BUG-8: Log errors to detect dedup gaps. Email now
                // mirrors the SMS ledger so `sessionController` can skip recently
                // contacted addresses in BOTH channels.
                if (success && config.method === 'sms') {
                    const normPhone = normalizePhone(recipientIdentity);
                    if (normPhone) {
                        db.collection('companies').doc(companyId)
                            .collection('sms_sent_phones').doc(normPhone)
                            .set({
                                lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                sessionId: sessionId
                            }, { merge: true })
                            .catch(e => {
                                console.error(`[BatchWorker] Failed to update sms_sent_phones for ${normPhone}:`, e.message);
                            });
                    }
                } else if (success && config.method === 'email') {
                    const normEmail = String(recipientIdentity || '').trim().toLowerCase();
                    // Doc IDs cannot contain "/" — Base64 the email to keep it path-safe.
                    if (normEmail && normEmail.includes('@')) {
                        const docId = Buffer.from(normEmail, 'utf8').toString('base64')
                            .replace(/=+$/, '')
                            .replace(/\//g, '_')
                            .replace(/\+/g, '-');
                        db.collection('companies').doc(companyId)
                            .collection('email_sent_addresses').doc(docId)
                            .set({
                                email: normEmail,
                                lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                sessionId: sessionId
                            }, { merge: true })
                            .catch(e => {
                                console.error(`[BatchWorker] Failed to update email_sent_addresses for ${normEmail}:`, e.message);
                            });
                    }
                }

                // 5. Safety Delay (3s requirement)
                await pauseBeforeNextSend(Date.now() - loopStart);
            }
        } catch (loopError) {
            console.error("Critical Loop Error:", loopError);
            // Fallthrough to save progress
        }

    return { batchSuccessCount, batchFailCount, pointerAdvanceCount };
}

module.exports = { runSendLoop };
