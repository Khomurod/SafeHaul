// functions/bulkActions/delivery/deliveryState.js
//
// What became of a campaign text after RingCentral accepted it. Accepting a
// text only queues it: the carrier can still refuse it (a spam filter, a
// landline), and RingCentral's message store records that later. These pure
// helpers read that record and match it to the campaign's log entry, by the
// message id the send loop now stores, or, for a log written before the id was
// kept, by the recipient's number and the time of the send.

const { normalizePhone } = require('../../shared/normalizePhone');

/** States a later check does not change. */
const FINAL_STATES = new Set(['delivered', 'failed', 'unconfirmed', 'unknown']);
const FAILED_STATUSES = new Set(['DeliveryFailed', 'SendingFailed']);

/** How long RingCentral gets to report a delivery before "Sent" is all it will say. */
const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** An old log matches a record created at most this long before or after it was written. */
const MATCH_BEFORE_MS = 2 * 60 * 1000;
const MATCH_AFTER_MS = 30 * 1000;

function millisOf(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/** A log entry whose text RingCentral accepted and whose fate is not settled yet. */
function needsDeliveryCheck(log) {
    const accepted = log?.isSuccess === true || log?.status === 'delivered';
    return accepted && !FINAL_STATES.has(log?.delivery?.state);
}

/** The delivery RingCentral's record reports: delivered, failed or still pending. */
function deliveryFromRecord(record) {
    const recipient = (Array.isArray(record?.to) && record.to[0]) || {};
    const providerStatus = recipient.messageStatus || record?.messageStatus || null;
    if (providerStatus === 'Delivered') return { state: 'delivered', providerStatus };
    if (FAILED_STATUSES.has(providerStatus)) {
        const errorCode = recipient.errorCode || record?.deliveryErrorCode || null;
        return { state: 'failed', providerStatus, errorCode };
    }
    return { state: 'pending', providerStatus };
}

/** The reason a log shows for a text RingCentral did not deliver. */
function failureReason({ providerStatus, errorCode }) {
    const code = errorCode ? `, code ${errorCode}` : '';
    return `Not delivered: RingCentral reported ${providerStatus}${code}.`;
}

/**
 * Pairs each log with the RingCentral record of its text. A log with the stored
 * message id takes that record; an older one takes the nearest unclaimed record
 * to the same number created around the time the log was written.
 * Returns a Map of log id → record.
 */
function matchLogsToRecords(logs, records) {
    const byId = new Map();
    const byPhone = new Map();
    for (const record of records) {
        if (record?.id != null) byId.set(String(record.id), record);
        const phone = normalizePhone(record?.to?.[0]?.phoneNumber);
        const createdAt = millisOf(record?.creationTime);
        if (!phone || createdAt == null) continue;
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone).push({ record, createdAt });
    }

    const matches = new Map();
    const claimed = new Set();
    for (const log of logs) {
        if (!log.providerMessageId) continue;
        const record = byId.get(String(log.providerMessageId));
        if (record) {
            matches.set(log.id, record);
            claimed.add(record);
        }
    }
    for (const log of logs) {
        if (log.providerMessageId) continue;
        const phone = normalizePhone(log.recipientIdentity);
        const sentAt = millisOf(log.timestamp);
        if (!phone || sentAt == null) continue;
        let best = null;
        for (const candidate of byPhone.get(phone) || []) {
            if (claimed.has(candidate.record)) continue;
            const offset = candidate.createdAt - sentAt;
            if (offset < -MATCH_BEFORE_MS || offset > MATCH_AFTER_MS) continue;
            if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { ...candidate, offset };
        }
        if (best) {
            matches.set(log.id, best.record);
            claimed.add(best.record);
        }
    }
    return matches;
}

/**
 * The delivery a log should now carry, or null when nothing has changed.
 * `listedEverything` is false when the message store had more pages than the
 * check read: a missing record then proves nothing.
 */
function nextDelivery(log, record, { now, listedEverything }) {
    const sentAt = millisOf(log.timestamp);
    const waitedLongEnough = sentAt != null && now - sentAt > CONFIRMATION_WINDOW_MS;
    let next;
    if (record) {
        next = deliveryFromRecord(record);
        if (next.state === 'pending' && waitedLongEnough) next = { ...next, state: 'unconfirmed' };
    } else if (waitedLongEnough && listedEverything) {
        next = { state: 'unknown', providerStatus: null };
    } else {
        next = { state: 'pending', providerStatus: log.delivery?.providerStatus || null };
    }
    const current = log.delivery || {};
    if (current.state === next.state && (current.providerStatus || null) === (next.providerStatus || null)) return null;
    return next;
}

module.exports = {
    CONFIRMATION_WINDOW_MS,
    FINAL_STATES,
    millisOf,
    needsDeliveryCheck,
    deliveryFromRecord,
    failureReason,
    matchLogsToRecords,
    nextDelivery,
};
