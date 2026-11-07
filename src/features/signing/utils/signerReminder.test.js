/**
 * Remind: where the button is offered, and how what the server answered is
 * worded. The server decides (`functions/remindSigner.js`); these choose the
 * button and the words. All documents and addresses are artificial.
 */
import { describe, expect, it } from 'vitest';
import { canRemindSigner, reminderErrorMessage, reminderResultMessage, sharedByCopiedLink } from './signerReminder';

const sent = (overrides = {}) => ({
    id: 'req-1',
    status: 'sent',
    recipientEmail: 'pat@example.test',
    recipientPhone: '555-0142',
    sendEmail: true,
    sendSms: false,
    ...overrides,
});

describe('where Remind is offered', () => {
    it('on a document waiting for its signature that went by email or by text', () => {
        expect(canRemindSigner(sent())).toBe(true);
        expect(canRemindSigner(sent({ sendEmail: undefined }))).toBe(true);
        expect(canRemindSigner(sent({ sendEmail: false, sendSms: true }))).toBe(true);
    });

    it.each(['signed', 'pending_seal', 'error_sealing', 'voided', 'processing'])('not on a %s document', (status) => {
        expect(canRemindSigner(sent({ status }))).toBe(false);
    });

    it('not on a document shared by a copied link, or one with nowhere to send it', () => {
        expect(canRemindSigner(sent({ sendEmail: false, sendSms: false }))).toBe(false);
        expect(canRemindSigner(sent({ recipientEmail: '  ', sendSms: false }))).toBe(false);
        expect(canRemindSigner(sent({ sendEmail: false, sendSms: true, recipientPhone: '' }))).toBe(false);
        expect(canRemindSigner(null)).toBe(false);
    });
});

describe('a document shared by a copied link', () => {
    it.each([
        ['no email or text', { sendEmail: false, sendSms: false }, true],
        ['text asked for without a number', { sendEmail: false, sendSms: true, recipientPhone: '' }, true],
        ['an email, whatever its status', { status: 'opened' }, false],
        ['a text number', { sendEmail: false, sendSms: true, recipientPhone: '(555) 555-0100' }, false],
    ])('%s', (_label, overrides, expected) => {
        expect(sharedByCopiedLink(sent(overrides))).toBe(expected);
    });
});

describe('what a press of Remind says', () => {
    it.each([
        [{ channels: { email: true, sms: false } }, 'Reminder sent by email. The link works for seven more days.'],
        [{ channels: { email: false, sms: true } }, 'Reminder sent by text message. The link works for seven more days.'],
        [{ channels: { email: true, sms: true } }, 'Reminder sent by email and text message. The link works for seven more days.'],
        [
            { channels: { email: true, sms: false }, textSkipped: 'no-sms-consent' },
            'Reminder sent by email. The link works for seven more days. Not texted: the driver did not answer Yes to text messages.',
        ],
        [
            { channels: { email: true, sms: false }, textSkipped: 'opted-out' },
            'Reminder sent by email. The link works for seven more days. Not texted: this number opted out of texts.',
        ],
    ])('%o', (data, text) => {
        expect(reminderResultMessage(data)).toEqual({ tone: 'success', text });
    });

    it('says which channel did not go, and never that a failed one went', () => {
        expect(reminderResultMessage({ channels: { email: true, sms: false }, failed: { email: false, sms: true } })).toEqual({
            tone: 'warning',
            text: 'Reminder sent by email. The link works for seven more days. The text message could not be sent: the document\'s details say why.',
        });
        expect(reminderResultMessage({ channels: { email: false, sms: false }, failed: { email: true, sms: false } })).toEqual({
            tone: 'danger',
            text: 'The reminder could not be sent by email. The document\'s details say why.',
        });
        expect(reminderResultMessage({ channels: { email: false, sms: false }, failed: { email: true, sms: true } })).toEqual({
            tone: 'danger',
            text: 'The reminder could not be sent by email or text message. The document\'s details say why.',
        });
    });

    it('passes on the server\'s reason for a refusal, and words anything else plainly', () => {
        const cooldown = Object.assign(
            new Error('A reminder was sent less than ten minutes ago. You can send another in 4 minutes.'),
            { code: 'functions/failed-precondition' },
        );
        expect(reminderErrorMessage(cooldown)).toBe(cooldown.message);
        expect(reminderErrorMessage(Object.assign(new Error('gone'), { code: 'functions/not-found' }))).toBe('gone');
        expect(reminderErrorMessage(Object.assign(new Error('x'), { code: 'functions/permission-denied' })))
            .toBe('You do not have access to send reminders for this company.');
        expect(reminderErrorMessage(Object.assign(new Error('internal'), { code: 'functions/internal' })))
            .toBe('Could not send the reminder. Please try again.');
        expect(reminderErrorMessage(undefined)).toBe('Could not send the reminder. Please try again.');
    });

    it('never shows a bare code as the reason: the server did not answer (a function not yet deployed)', () => {
        for (const message of ['not-found', 'NOT_FOUND', 'failed-precondition', 'aborted']) {
            const code = `functions/${message.toLowerCase().replace(/_/g, '-')}`;
            expect(reminderErrorMessage(Object.assign(new Error(message), { code })))
                .toBe('Could not send the reminder. Please try again.');
        }
    });
});
