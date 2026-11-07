// functions/bulkActions/workers/sendLoop.js
//
// The sequential send loop: one lead at a time — mid-batch cancel check,
// idempotency check, data fetch, blacklist check, an applicant's SMS consent
// (`shared/smsPermission.js`), the send itself, the
// atomic log+pointer transaction, the lead timestamp, and the SMS/email
// dedup ledgers, with the 3-second pacing (`sendPacing.js`). Extracted
// verbatim from `batchWorker.js` except the seam: the batch counters are
// locals here and are returned, where the worker used to close over them.
// The loop starts no send once the batch's send window is used (the next
// batch carries on), and stops at the third text the SMS provider never
// answered with no sent text between them (each may have gone out).

const { admin, db } = require("../../firebaseAdmin");
const { isBlacklisted } = require("../../blacklist");
const { agreedToSms } = require("../../shared/smsPermission");
const { normalizePhone } = require("../../utils/phoneUtils");
const { pauseBeforeNextSend, SEND_WINDOW_MS } = require("./sendPacing");
const BaseAdapter = require("../../integrations/adapters/BaseAdapter");
const { escapeHtml, plainGuestText, plainGuestSmsText } = require("../../shared/plainText");
const { emailLedgerKey } = require("../helpers/recentlyMessaged");
const { isPlaceholderEmail } = require("../../shared/placeholderDomains");

// This many texts the SMS provider never answered, with no sent text between
// them, stop the campaign: the provider is not answering.
const UNCONFIRMED_PAUSE_AFTER = 3;

/**
 * Returns `{ batchSuccessCount, batchFailCount, pointerAdvanceCount, silentProvider }`;
 * `silentProvider` is true when the loop stopped after `UNCONFIRMED_PAUSE_AFTER`
 * unanswered texts with no sent text between them (`progress.unconfirmedInARow`,
 * kept across batches).
 */
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
    applicationLinkFor = null,
    senderId,
    adapter,
    emailTransporter,
}) {
    // A function replacer, so a "$&" in a name is text and not a replacement pattern.
    // The lead's name can come from a public form: it goes out as plain text without
    // its links, as in the other emails a company sends (`shared/plainText.js`), by
    // the cleaner for the channel it goes out on. The application link is the
    // company's own address, so it goes out as it is.
    const fillPlaceholders = (text, leadData, plainName, applicationLink) => text
        .replace(/\[Driver Name\]/g, () => plainName(leadData.firstName, 40) || 'Driver')
        .replace(/\[Company Name\]/g, () => companyName)
        .replace(/\[Recruiter Name\]/g, () => recruiterName || 'your recruiter')
        .replace(/\[Application Link\]/g, () => applicationLink || '');

    let batchSuccessCount = 0;
    let batchFailCount = 0;
    let pointerAdvanceCount = 0;
    let silentProvider = false;


        try {

            const windowEndsAt = Date.now() + SEND_WINDOW_MS;
            for (let i = 0; i < batchIds.length; i++) {
                const leadId = batchIds[i];
                // Note: Lead ID not logged to avoid exposing PII in Cloud Function logs

                // Every batch sends at least one; the next batch carries on from the pointer.
                if (i > 0 && Date.now() >= windowEndsAt) {
                    console.log(`[BatchWorker] Send window used at item ${i}/${batchIds.length}; the next batch carries on.`);
                    break;
                }

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
                // RingCentral's id for the text, so the delivery check finds what became of it.
                let receipt = null;
                // The SMS provider never answered this send: the text may have gone out.
                let sendUnconfirmed = false;

                // Declare variables in loop scope
                let leadData = {};
                let leadDocRef = null;
                let fromApplications = false;

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
                            fromApplications = true;
                            leadDocRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);
                        }
                        const lSnap = await leadDocRef.get();
                        if (lSnap.exists) leadData = lSnap.data();
                        else errorMsg = "CRM lead data missing";
                    }


                    if (!errorMsg) {
                        recipientName = `${leadData.firstName || 'Driver'} ${leadData.lastName || ''}`.trim();
                        const phone = leadData.phone || leadData.phoneNumber;
                        // Only when the message has [Application Link] (an uploaded
                        // row has no assignee: the plain apply page).
                        const applicationLink = applicationLinkFor ? await applicationLinkFor(leadData.assignedTo) : '';

                        // 2. Blacklist Check. An opt-out is kept under a phone
                        // number. For SMS the number is the address, so a missing
                        // or unusable one is refused here; an email to someone
                        // without a usable number has no opt-out to look up.
                        const blacklisted = (config.method === 'sms' || normalizePhone(phone))
                            ? await isBlacklisted(companyId, phone)
                            : false;

                        if (blacklisted) {
                            errorMsg = "Number is blacklisted (Opt-out)";
                            success = false;
                        } else if (config.method === 'sms' && fromApplications && !agreedToSms(leadData)) {
                            // An applicant is texted only after an explicit "Yes"
                            // to the application's SMS question (`smsPermission.js`).
                            errorMsg = "Driver did not agree to SMS";
                        } else if (config.method === 'sms') {
                            if (!adapter) throw new Error("SMS Configuration Invalid");
                            recipientIdentity = phone || "No Phone";

                            if (recipientIdentity !== "No Phone") {
                                const finalMsg = fillPlaceholders(config.message, leadData, plainGuestSmsText, applicationLink);

                                if (typeof adapter.sendSMSWithReceipt === 'function') {
                                    receipt = await adapter.sendSMSWithReceipt(recipientIdentity, finalMsg, senderId);
                                } else {
                                    await adapter.sendSMS(recipientIdentity, finalMsg, senderId);
                                }
                                success = true;
                            } else {
                                errorMsg = "No valid phone number";
                            }
                        } else if (config.method === 'email') {
                            if (!emailTransporter) throw new Error("Email Settings Invalid");
                            // An import without an email made up a placeholder address: nobody
                            // reads it, and the bounce counts against the company's mail server.
                            recipientIdentity = isPlaceholderEmail(leadData.email) ? "No Email" : leadData.email;

                            if (recipientIdentity !== "No Email") {
                                const finalBody = fillPlaceholders(config.message, leadData, plainGuestText, applicationLink);

                                await emailTransporter.sendMail({
                                    from: `"${companyName}" <${emailTransporter.transporter.options.auth.user}>`,
                                    to: recipientIdentity,
                                    // The composer offers the placeholders in the subject too.
                                    subject: config.subject ? fillPlaceholders(config.subject, leadData, plainGuestText, applicationLink) : `Update from ${companyName}`,
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
                    // The code only: a provider's or mail server's error can name the recipient.
                    // The reason itself is kept on the recipient's log below.
                    console.error(`[BatchWorker] Lead ${leadId} was not sent (${err?.code || err?.name || 'error'})`);
                    errorMsg = err.message || "Unknown error";
                    success = false;
                    sendUnconfirmed = err?.code === BaseAdapter.SEND_UNCONFIRMED;
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
                if (sendUnconfirmed) logPayload.sendUnconfirmed = true;
                if (success && config.method === 'sms') {
                    // Accepted is not delivered: the check fills in what the carrier did.
                    logPayload.delivery = { state: 'pending', providerStatus: receipt?.providerStatus || null };
                    if (receipt?.providerMessageId) logPayload.providerMessageId = receipt.providerMessageId;
                }
                let unconfirmedInARow = 0;
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

                        // Unanswered texts since the last sent one, across batches. A
                        // failure of any other kind neither counts nor resets it.
                        const before = sessionDoc.data().progress?.unconfirmedInARow || 0;
                        const inARow = success ? 0 : (sendUnconfirmed ? before + 1 : before);
                        t.set(logRef, logPayload);
                        t.update(sessionRef, {
                            ...updates,
                            'progress.processedCount': admin.firestore.FieldValue.increment(1),
                            'progress.successCount': admin.firestore.FieldValue.increment(success ? 1 : 0),
                            'progress.failedCount': admin.firestore.FieldValue.increment(success ? 0 : 1),
                            ...((success || sendUnconfirmed) ? { 'progress.unconfirmedInARow': inARow } : {}),
                        });
                        return { alreadyLogged: false, unconfirmedInARow: inARow };
                    });
                    unconfirmedInARow = applied?.unconfirmedInARow || 0;

                    if (!applied?.alreadyLogged) {
                        if (success) batchSuccessCount++;
                        else batchFailCount++;
                    }
                    pointerAdvanceCount++;
                } catch (e) {
                    console.error("Failed to write log + progress transaction:", e);
                }
                if (sendUnconfirmed && unconfirmedInARow >= UNCONFIRMED_PAUSE_AFTER) {
                    console.warn(`[BatchWorker] The SMS provider did not answer ${unconfirmedInARow} texts in a row. Stopping at item ${i + 1}/${batchIds.length}.`);
                    silentProvider = true;
                    break;
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
                                // The code only: a Firestore error can name the document, whose id is the number.
                                console.error(`[BatchWorker] Failed to update sms_sent_phones for lead ${leadId} (${e?.code || 'error'})`);
                            });
                    }
                } else if (success && config.method === 'email') {
                    const normEmail = String(recipientIdentity || '').trim().toLowerCase();
                    // The ledger keys an address the way the "recently messaged"
                    // check reads it back: base64url, since doc IDs cannot hold "/".
                    const docId = emailLedgerKey(normEmail);
                    if (docId) {
                        db.collection('companies').doc(companyId)
                            .collection('email_sent_addresses').doc(docId)
                            .set({
                                email: normEmail,
                                lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                sessionId: sessionId
                            }, { merge: true })
                            .catch(e => {
                                console.error(`[BatchWorker] Failed to update email_sent_addresses for lead ${leadId} (${e?.code || 'error'})`);
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

    return { batchSuccessCount, batchFailCount, pointerAdvanceCount, silentProvider };
}

module.exports = { runSendLoop };
