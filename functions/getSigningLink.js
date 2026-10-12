/**
 * getSigningLink.js — ADV-1 FIX: Secure callable function to retrieve
 * the full signing link (including token) for company team members.
 *
 * Since BUG-2 moved the accessToken to a secrets subcollection that clients
 * can't read, this function provides an authenticated way for team members
 * to retrieve the full link from the History view.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./firebaseAdmin");
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");
const { settleSigningLink } = require("./shared/signingLink");

exports.getSigningLink = onCall({ cors: true }, async (request) => {
    // 1. Require authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const { companyId, requestId } = request.data;
    if (!companyId || !requestId) {
        throw new HttpsError('invalid-argument', 'Missing companyId or requestId.');
    }

    // 2. Verify the caller has company access through canonical RBAC sources.
    await assertCompanyAccessForRequest(request, companyId, 'getSigningLink');

    // 3. Read the signing request and its token (Admin SDK bypasses rules), in
    // a transaction: when a correction left the link with an email or phone the
    // request no longer has, the token is replaced first, so the copied link is
    // the one the correction sends (`shared/signingLink.js`).
    const reqRef = db.collection('companies').doc(companyId)
        .collection('signing_requests').doc(requestId);
    const { reqData, accessToken } = await db.runTransaction(async (tx) => {
        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists) {
            throw new HttpsError('not-found', 'Signing request not found.');
        }

        const data = reqSnap.data();
        if (data.status === 'signed') {
            throw new HttpsError('failed-precondition', 'This document has already been signed.');
        }
        const settled = await settleSigningLink(tx, reqRef, data);
        return { reqData: data, accessToken: settled.accessToken };
    });

    if (!accessToken) {
        throw new HttpsError('not-found', 'No active signing token found. The link may have been used or expired.');
    }

    // 4. Build and return the full link
    // DOMAIN FIX: Use the sender's origin domain stored at creation time
    const baseUrl = reqData.appBaseUrl || process.env.APP_BASE_URL || 'https://app.safehaul.io';
    const signingLink = `${baseUrl}/sign/${companyId}/${requestId}?token=${accessToken}`;

    return { signingLink };
});
