const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./firebaseAdmin");

/**
 * Compliance Firewall: Manages the global blacklist and opt-outs.
 */

/**
 * Trigger: Watch for incoming SMS (mock or real) to detect STOP keywords.
 * In a real scenario, this would be an HTTP webhook from Twilio/Telnyx.
 */
exports.handleOptOut = onDocumentCreated("companies/{companyId}/inbound_messages/{msgId}", async (event) => {
    const data = event.data.data();
    const companyId = event.params.companyId;
    const text = (data.text || "").toUpperCase().trim();

    if (text === "STOP" || text === "UNSUBSCRIBE" || text === "QUIT") {
        const phone = data.from;
        if (!phone) return;

        console.log(`Opt-out received from ${phone}. Adding to blacklist.`);

        // Add to company-specific blacklist
        await db.collection('companies').doc(companyId).collection('blacklist').doc(phone).set({
            reason: 'STOP keyword',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            originalMessageId: event.params.msgId
        });

        // Add to global blacklist (Optional, but recommended for professional tools)
        await db.collection('blacklist').doc(phone).set({
            reason: `Opt-out via company ${companyId}`,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});

/**
 * Helper to check if a phone number is blacklisted.
 */
async function isBlacklisted(companyId, phone) {
    if (!phone) return true;

    // Check company blacklist
    const companyBlacklist = await db.collection('companies').doc(companyId)
        .collection('blacklist').doc(phone).get();
    if (companyBlacklist.exists) return true;

    // Check global blacklist
    const globalBlacklist = await db.collection('blacklist').doc(phone).get();
    if (globalBlacklist.exists) return true;

    return false;
}

exports.isBlacklisted = isBlacklisted;
