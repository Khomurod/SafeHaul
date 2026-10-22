// What the campaign report says of one recipient once the server has asked
// RingCentral what became of the text, and what the "Check delivery" button
// says of the server's answer. All data is artificial.
import { describe, expect, it } from 'vitest';
import { deliveryCheckMessage, sendResultOf } from './campaignConstants';

const sent = (delivery) => ({ status: 'delivered', isSuccess: true, error: null, ...(delivery ? { delivery } : {}) });

describe('sendResultOf', () => {
    it('keeps a log without a delivery state (an email, an unchecked text) as plain Sent', () => {
        expect(sendResultOf(sent())).toEqual({ sent: true, label: 'Sent', tone: 'success', note: null, reason: null });
    });

    it('names each delivery state RingCentral reported', () => {
        expect(sendResultOf(sent({ state: 'delivered' }))).toMatchObject({ sent: true, label: 'Delivered', tone: 'success', note: null });
        expect(sendResultOf(sent({ state: 'pending' }))).toMatchObject({
            sent: true, label: 'Awaiting delivery', tone: 'info', note: 'RingCentral has not confirmed delivery yet.',
        });
        expect(sendResultOf(sent({ state: 'unconfirmed' }))).toMatchObject({ label: 'Delivery not confirmed', tone: 'warning' });
        expect(sendResultOf(sent({ state: 'unknown' }))).toMatchObject({ label: 'Delivery unknown', tone: 'neutral' });
    });

    it('says Not delivered, with the reason, for a text RingCentral refused after accepting it', () => {
        const log = {
            status: 'failed',
            isSuccess: false,
            error: 'Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.',
            delivery: { state: 'failed', providerStatus: 'DeliveryFailed', errorCode: 'SMS-CAR-430' },
        };
        expect(sendResultOf(log)).toEqual({
            sent: false,
            label: 'Not delivered',
            tone: 'danger',
            reason: 'Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.',
            note: null,
        });
    });

    it('keeps Not sent for a send that failed outright', () => {
        expect(sendResultOf({ status: 'failed', isSuccess: false, error: 'No valid phone number' }))
            .toMatchObject({ sent: false, label: 'Not sent', reason: 'No valid phone number' });
        expect(sendResultOf({ status: 'failed' }).reason).toBe('No reason was recorded');
    });
});

describe('deliveryCheckMessage', () => {
    it('sums up a check, naming only the states it found', () => {
        expect(deliveryCheckMessage({ status: 'checked', counts: { delivered: 40, failed: 3, pending: 0, unconfirmed: 0, unknown: 0 } }))
            .toEqual({ ok: true, text: 'Delivery checked: 40 delivered, 3 not delivered.' });
        expect(deliveryCheckMessage({ status: 'checked', counts: { delivered: 1, failed: 0, pending: 2, unconfirmed: 1, unknown: 4 } }).text)
            .toBe('Delivery checked: 1 delivered, 0 not delivered, 2 still waiting, 1 not confirmed, 4 unknown.');
    });

    it('explains every answer that is not a check', () => {
        expect(deliveryCheckMessage({ status: 'nothing_to_check' })).toMatchObject({ ok: true });
        for (const status of ['not_sms', 'unsupported', 'no_permission', 'error']) {
            expect(deliveryCheckMessage({ status }).ok).toBe(false);
        }
        expect(deliveryCheckMessage({ status: 'no_permission' }).text).toContain('"Read Messages" permission');
        expect(deliveryCheckMessage().text).toBe('RingCentral could not be reached to check delivery. Please try again later.');
    });
});
