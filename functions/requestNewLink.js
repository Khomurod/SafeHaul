/**
 * requestNewLink.js — "Ask <Company> for a new link" on a public link that no
 * longer works (`/sign`, `/verify`, `/review-change`): the person asks, and the
 * company is told in its bell. Nothing here makes a link. The company sends one
 * with the resend it already has (Remind on a document, a new verification
 * request, Email review link), so the deadline stays the company's and the page
 * shows no contact detail of the company's.
 *
 * Input: `{ kind: 'sign', companyId, requestId }`, `{ kind: 'verify', token }`
 * or `{ kind: 'review', token }`. Rate-limited per caller address, fail-closed.
 *
 * The answer is `{ ok: true }` for every well-formed request: whether the record
 * exists, is still outstanding, or was already asked about today, a public
 * caller learns nothing about a link from it. A notice is written only while
 * what the link was sent for is still outstanding:
 *  - a document still waiting for its signer (`sent`, what Remind sends again);
 *  - a verification not answered (`completed`) or being answered (`processing`);
 *    a replaced one while the request that replaced it is not;
 *  - a review not completed whose application still has a change waiting for the
 *    driver (Email review link needs one too).
 * One notice per record per UTC day (`createNotification` with a fixed id), for
 * the team member who sent it while on the team, else the team, opening the
 * record. The whole team can read every notification, so it holds names and a
 * title only. A token never appears in a notice or a log: a verification's or a
 * review's token answers as the person who holds it, so those notices are named
 * by the request's id or a hash of the application's path.
 */
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { trustedClientIp } = require('./shared/clientIp');
const { createNotification } = require('./shared/createNotification');
const { clipText, plainGuestText } = require('./shared/plainText');
const { recipientFor } = require('./sealNotifications');
const { assigneeOnTeam } = require('./shared/notificationAudience');
const { requestIdOf } = require('./employmentVerification/requestLifecycle');

/** Requests one caller address may make in `RATE_WINDOW_SECONDS`. */
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60 * 60;
/** How many replacements of a verification are followed to the newest. */
const MAX_REPLACEMENTS = 5;
/** Verification statuses with nothing left to send a link for. */
const PEV_DONE = new Set(['completed', 'processing']);
const TITLE = 'New link requested';

/** A document id as a link carries it: no slash or space, at most 128 characters. */
function idOf(value) {
    if (typeof value !== 'string' || !/^[^/\s]{1,128}$/.test(value)) return null;
    if (value === '.' || value === '..' || /^__.*__$/.test(value)) return null;
    return value;
}

function readInput(data) {
    const kind = data?.kind;
    if (kind === 'sign') {
        const companyId = idOf(data.companyId);
        const requestId = idOf(data.requestId);
        if (companyId && requestId) return { kind, companyId, requestId };
    } else if (kind === 'verify' || kind === 'review') {
        const token = idOf(data.token);
        if (token) return { kind, token };
    }
    throw new HttpsError('invalid-argument', 'This request is not complete.');
}

const textOf = (value) => (typeof value === 'string' && value ? value : null);
const relatedTypeOf = (collectionName) => (collectionName === 'leads' ? 'lead' : 'application');
/** A token's name in a record the team reads: never the token itself. */
const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);

async function signingNotice({ companyId, requestId }) {
    const snap = await db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId).get();
    const request = snap.exists ? (snap.data() || {}) : null;
    if (request?.status !== 'sent') return null;
    const applicationId = textOf(request.sourceApplicationId);
    const leadId = applicationId ? null : textOf(request.sourceLeadId);
    const signer = clipText(request.recipientName, 80) || 'The signer';
    const title = clipText(request.title, 80);
    return {
        companyId,
        name: requestId,
        // The sender, else the assignee of the document's application, else the team, as for its seal.
        recipientId: await recipientFor(db, companyId, request, applicationId),
        notification: {
            type: 'signing_link_requested',
            title: TITLE,
            message: `${signer} asked for a new link to sign ${title ? `“${title}”` : 'a document'}.`,
            // The record the document was sent from, which the bell opens on its documents; else E-Docs.
            relatedType: applicationId ? 'application' : (leadId ? 'lead' : 'signing_request'),
            relatedId: applicationId || leadId || requestId,
        },
    };
}

/**
 * The request as it stands now: a replaced one, followed to the request that
 * replaced it. Still `superseded` when the chain runs longer than is followed or
 * breaks, and then nothing is known to be outstanding.
 */
async function newestVerification(request) {
    let current = request;
    for (let hop = 0; hop < MAX_REPLACEMENTS && current.status === 'superseded'; hop += 1) {
        const newerId = textOf(current.supersededBy);
        if (!newerId) break;
        const newer = await db.collection('verification_requests').where('requestId', '==', newerId).limit(1).get();
        if (newer.empty) break;
        current = newer.docs[0].data() || {};
    }
    return current;
}

async function verificationNotice({ token }) {
    const snap = await db.collection('verification_requests').doc(token).get();
    const request = snap.exists ? (snap.data() || {}) : null;
    const companyId = textOf(request?.companyId);
    const applicationId = textOf(request?.applicationId);
    if (!companyId || !applicationId) return null;
    const newest = await newestVerification(request);
    if (newest.status === 'superseded' || PEV_DONE.has(newest.status)) return null;
    const employer = plainGuestText(request.employerName, 80) || 'A past employer';
    const applicant = plainGuestText(request.applicantName, 80) || 'the applicant';
    return {
        companyId,
        name: requestIdOf(request, token),
        recipientId: textOf(request.createdBy),
        notification: {
            type: 'pev_link_requested',
            title: TITLE,
            message: `${employer} asked for a new link to answer the employment verification for ${applicant}.`,
            relatedType: relatedTypeOf(request.collectionName),
            relatedId: applicationId,
        },
    };
}

async function reviewNotice({ token }) {
    const snap = await db.collection('change_reviews').doc(token).get();
    const review = snap.exists ? (snap.data() || {}) : null;
    const companyId = textOf(review?.companyId);
    const applicationId = textOf(review?.applicationId);
    if (!companyId || !applicationId || review.status === 'completed') return null;
    const collectionName = review.collectionName === 'leads' ? 'leads' : 'applications';
    const waiting = await db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId)
        .collection('pending_changes').where('status', '==', 'pending').limit(1).get();
    if (waiting.empty) return null;
    const named = clipText(review.applicantName, 80);
    // `createChangeReview` writes "Driver" for an application with no name.
    const driver = named && named !== 'Driver' ? named : 'The driver';
    return {
        companyId,
        // The application's changes, whichever of its review links asked: an older
        // link and its replacement tell the company once.
        name: hashOf(`${companyId}/${collectionName}/${applicationId}`),
        recipientId: textOf(review.createdBy),
        notification: {
            type: 'review_link_requested',
            title: TITLE,
            message: `${driver} asked for a new link to review the changes to their application.`,
            relatedType: relatedTypeOf(collectionName),
            relatedId: applicationId,
        },
    };
}

const NOTICES = { sign: signingNotice, verify: verificationNotice, review: reviewNotice };

exports.requestNewLink = onCall({ cors: true }, async (request) => {
    const input = readInput(request.data);
    const ip = trustedClientIp(request.rawRequest);
    if (!(await checkRateLimit(`new_link_request_${ip}`, RATE_LIMIT, RATE_WINDOW_SECONDS, 'closed'))) {
        throw new HttpsError('resource-exhausted', 'Too many requests from this network. Please wait before asking again.');
    }

    try {
        const found = await NOTICES[input.kind](input);
        if (found) {
            const day = new Date().toISOString().slice(0, 10);
            // The sender while on the team; one who has left reads nothing, so the team is told.
            const recipientId = await assigneeOnTeam(db, found.companyId, found.recipientId);
            const created = await createNotification(db, found.companyId, {
                ...found.notification,
                ...(recipientId ? { recipientId } : {}),
            }, { id: `new_link_${input.kind}_${found.name}_${day}` });
            if (created) logger.info(`[requestNewLink] ${input.kind}: company ${found.companyId} told.`);
        }
    } catch (error) {
        // The code only: a Firestore error can name the document, whose id may be a token.
        logger.error(`[requestNewLink] A ${input.kind} request could not be passed on.`, { code: error?.code || 'error' });
        throw new HttpsError('internal', 'That request could not be sent. Please try again later.');
    }
    return { ok: true };
});
