/**
 * What became of a campaign text (`bulkActions/delivery/deliveryState.js`):
 * RingCentral's record read as delivered, failed or pending; a log matched to
 * its record by the stored message id, or, for a log written before ids were
 * kept, by number and send time; and when "still waiting" becomes final. All
 * data is artificial.
 */

const {
    CONFIRMATION_WINDOW_MS,
    needsDeliveryCheck,
    deliveryFromRecord,
    failureReason,
    matchLogsToRecords,
    nextDelivery,
} = require('../../bulkActions/delivery/deliveryState');

const SENT_AT = Date.parse('2026-10-20T15:00:00Z');
const at = (ms) => ({ toMillis: () => ms });
const record = (id, phone, createdAt, status = 'Delivered', extra = {}) => ({
    id,
    creationTime: new Date(createdAt).toISOString(),
    messageStatus: status,
    to: [{ phoneNumber: phone, messageStatus: status, ...extra }],
});

describe('deliveryFromRecord', () => {
    it('reads the recipient status RingCentral reports', () => {
        expect(deliveryFromRecord(record(1, '+15551234567', SENT_AT))).toEqual({ state: 'delivered', providerStatus: 'Delivered' });
        expect(deliveryFromRecord(record(1, '+15551234567', SENT_AT, 'Sent'))).toEqual({ state: 'pending', providerStatus: 'Sent' });
        expect(deliveryFromRecord(record(1, '+15551234567', SENT_AT, 'Queued'))).toEqual({ state: 'pending', providerStatus: 'Queued' });
    });

    it('takes a refused text as failed, with its error code', () => {
        expect(deliveryFromRecord(record(1, '+15551234567', SENT_AT, 'DeliveryFailed', { errorCode: 'SMS-CAR-430' })))
            .toEqual({ state: 'failed', providerStatus: 'DeliveryFailed', errorCode: 'SMS-CAR-430' });
        expect(deliveryFromRecord({ messageStatus: 'SendingFailed', deliveryErrorCode: 'SMS-UP-410' }))
            .toEqual({ state: 'failed', providerStatus: 'SendingFailed', errorCode: 'SMS-UP-410' });
    });

    it('says what RingCentral reported when a text was not delivered', () => {
        expect(failureReason({ providerStatus: 'DeliveryFailed', errorCode: 'SMS-CAR-430' }))
            .toBe('Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.');
        expect(failureReason({ providerStatus: 'SendingFailed', errorCode: null }))
            .toBe('Not delivered: RingCentral reported SendingFailed.');
    });
});

describe('needsDeliveryCheck', () => {
    it('checks an accepted text until its state is final', () => {
        expect(needsDeliveryCheck({ isSuccess: true, status: 'delivered' })).toBe(true);
        expect(needsDeliveryCheck({ isSuccess: true, delivery: { state: 'pending' } })).toBe(true);
        for (const state of ['delivered', 'failed', 'unconfirmed', 'unknown']) {
            expect(needsDeliveryCheck({ isSuccess: true, delivery: { state } })).toBe(false);
        }
        expect(needsDeliveryCheck({ isSuccess: false, status: 'failed' })).toBe(false);
    });
});

describe('matchLogsToRecords', () => {
    it('matches a log to the record of its stored message id', () => {
        const logs = [{ id: 'lead-1', providerMessageId: '42', recipientIdentity: '(555) 123-4567', timestamp: at(SENT_AT) }];
        const records = [record(41, '+15551234567', SENT_AT), record(42, '+15551234567', SENT_AT + 60000)];

        expect(matchLogsToRecords(logs, records).get('lead-1')).toBe(records[1]);
    });

    it('matches an older log by number and the nearest send time', () => {
        const logs = [{ id: 'lead-1', recipientIdentity: '(555) 123-4567', timestamp: at(SENT_AT) }];
        const earlier = record(1, '+15551234567', SENT_AT - 90000);
        const nearest = record(2, '+15551234567', SENT_AT - 2000);
        const otherNumber = record(3, '+15559876543', SENT_AT - 1000);

        expect(matchLogsToRecords(logs, [earlier, nearest, otherNumber]).get('lead-1')).toBe(nearest);
    });

    it('leaves an older log unmatched when no record is close to its send', () => {
        const logs = [{ id: 'lead-1', recipientIdentity: '5551234567', timestamp: at(SENT_AT) }];
        const records = [record(1, '+15551234567', SENT_AT - 3 * 60000), record(2, '+15551234567', SENT_AT + 60000)];

        expect(matchLogsToRecords(logs, records).has('lead-1')).toBe(false);
    });

    it('gives each record to one log: an id claims it before any number match', () => {
        const logs = [
            { id: 'old', recipientIdentity: '5551234567', timestamp: at(SENT_AT) },
            { id: 'new', providerMessageId: '7', recipientIdentity: '5551234567', timestamp: at(SENT_AT) },
        ];
        const records = [record(7, '+15551234567', SENT_AT - 1000)];

        const matches = matchLogsToRecords(logs, records);
        expect(matches.get('new')).toBe(records[0]);
        expect(matches.has('old')).toBe(false);
    });

    it('gives two texts to the same number in one campaign their own records', () => {
        const logs = [
            { id: 'a', recipientIdentity: '5551234567', timestamp: at(SENT_AT) },
            { id: 'b', recipientIdentity: '5551234567', timestamp: at(SENT_AT + 3000) },
        ];
        const records = [record(1, '+15551234567', SENT_AT - 500), record(2, '+15551234567', SENT_AT + 2500)];

        const matches = matchLogsToRecords(logs, records);
        expect(new Set([matches.get('a'), matches.get('b')])).toEqual(new Set(records));
    });
});

describe('nextDelivery', () => {
    const log = (extra = {}) => ({ id: 'lead-1', timestamp: at(SENT_AT), isSuccess: true, ...extra });
    const soon = SENT_AT + 10 * 60000;
    const nextDay = SENT_AT + CONFIRMATION_WINDOW_MS + 60000;

    it('records what the record says', () => {
        expect(nextDelivery(log(), record(1, '+1', SENT_AT, 'DeliveryFailed'), { now: soon, listedEverything: true }))
            .toEqual({ state: 'failed', providerStatus: 'DeliveryFailed', errorCode: null });
    });

    it('keeps a text that is still on its way waiting, then calls it unconfirmed after a day', () => {
        const sent = record(1, '+1', SENT_AT, 'Sent');
        expect(nextDelivery(log(), sent, { now: soon, listedEverything: true })).toEqual({ state: 'pending', providerStatus: 'Sent' });
        expect(nextDelivery(log(), sent, { now: nextDay, listedEverything: true })).toEqual({ state: 'unconfirmed', providerStatus: 'Sent' });
    });

    it('calls a text RingCentral has no record of unknown only after a day and a full listing', () => {
        expect(nextDelivery(log(), undefined, { now: soon, listedEverything: true })).toEqual({ state: 'pending', providerStatus: null });
        expect(nextDelivery(log(), undefined, { now: nextDay, listedEverything: false })).toEqual({ state: 'pending', providerStatus: null });
        expect(nextDelivery(log(), undefined, { now: nextDay, listedEverything: true })).toEqual({ state: 'unknown', providerStatus: null });
    });

    it('reports no change when the state is what the log already holds', () => {
        const waiting = log({ delivery: { state: 'pending', providerStatus: 'Queued' } });
        expect(nextDelivery(waiting, record(1, '+1', SENT_AT, 'Queued'), { now: soon, listedEverything: true })).toBeNull();
    });
});
