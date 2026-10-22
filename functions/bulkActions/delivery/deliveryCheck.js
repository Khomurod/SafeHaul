// functions/bulkActions/delivery/deliveryCheck.js
//
// The two ways a campaign's texts get checked against RingCentral: every ten
// minutes for the campaigns the worker queued, and on request from the
// campaign report, which also works for a campaign sent before message ids
// were stored (`checkSessionDelivery.js` then matches by number and time).

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { assertCompanyAdmin } = require('../helpers/auth');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { checkSessionDelivery } = require('./checkSessionDelivery');
const { queueDeliveryCheck, dueDeliveryChecks, settleDeliveryCheck, RECHECK_DELAY_MS } = require('./deliveryQueue');

/** Campaigns checked per run; each is a few requests to RingCentral. */
const CHECKS_PER_RUN = 20;

// SMS_ENCRYPTION_KEY: the check reads RingCentral through the line's stored, encrypted credentials.
exports.checkSmsDeliveries = onSchedule({
    schedule: 'every 10 minutes',
    timeoutSeconds: 540,
    secrets: ['SMS_ENCRYPTION_KEY'],
}, async () => {
    const due = await dueDeliveryChecks(CHECKS_PER_RUN);
    for (const entry of due) {
        let result;
        try {
            result = await checkSessionDelivery({ companyId: entry.companyId, sessionId: entry.sessionId });
        } catch (error) {
            console.error(`[smsDelivery] Check of campaign ${entry.sessionId} failed:`, error.message);
            result = { status: 'error' };
        }
        try {
            await settleDeliveryCheck(entry, result);
        } catch (error) {
            console.error(`[smsDelivery] Could not requeue campaign ${entry.sessionId}:`, error.message);
        }
    }
});

exports.checkCampaignDelivery = onCall({ cors: true, timeoutSeconds: 120, secrets: ['SMS_ENCRYPTION_KEY'] }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { companyId, sessionId } = request.data || {};
    if (!companyId || !sessionId) throw new HttpsError('invalid-argument', 'companyId and sessionId are required.');
    await assertCompanyAdmin(request.auth.uid, companyId);

    // RingCentral allows the line a limited number of reads a minute; a repeated click should not spend them.
    const allowed = await checkRateLimit(`sms_delivery_check_${companyId}`, 30, 3600, 'closed');
    if (!allowed) throw new HttpsError('resource-exhausted', 'Delivery was checked many times in the last hour. Please try again later.');

    const result = await checkSessionDelivery({ companyId, sessionId, everyLog: true });
    if (result.status === 'not_found') throw new HttpsError('not-found', 'Campaign not found.');
    if (result.status === 'checked' && result.counts.pending > 0) {
        await queueDeliveryCheck(companyId, sessionId, RECHECK_DELAY_MS).catch((error) => {
            console.error(`[smsDelivery] Could not queue campaign ${sessionId}:`, error.message);
        });
    }
    return { status: result.status, counts: result.counts };
});
