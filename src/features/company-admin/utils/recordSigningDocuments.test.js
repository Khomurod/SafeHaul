/**
 * The dossier's list of a driver's signing documents: what each request's state
 * is (with "Link expired" derived, never stored), which required post-application
 * forms show as "Not started", and where Send to driver is offered. All ids,
 * titles and dates are artificial.
 */
import { describe, expect, it } from 'vitest';
import {
    isLinkExpired,
    nextLinkExpiry,
    postApplicationRequestId,
    recordDocumentRows,
    recordLinkField,
    sendResultMessage,
    sendErrorMessage,
    signingDocumentState,
} from './recordSigningDocuments';

const NOW = Date.UTC(2026, 10, 4, 12);
const at = (days) => ({ toMillis: () => NOW + days * 24 * 60 * 60 * 1000 });
const FORMS = [
    { templateId: 'tpl-w9', title: 'W-9', enabled: true, required: true, order: 0 },
    { templateId: 'tpl-dd', title: 'Direct deposit', enabled: true, required: false, order: 1 },
    { templateId: 'tpl-hb', title: 'Handbook', enabled: true, required: true, order: 2 },
];
const postapp = (templateId, extra = {}) => ({
    id: postApplicationRequestId('app-1', templateId),
    templateId,
    title: `Form ${templateId}`,
    status: 'sent',
    sendEmail: false,
    sendSms: false,
    createdAt: at(-1),
    expiresAt: at(6),
    ...extra,
});

describe('the record a request is linked to', () => {
    it('is sourceApplicationId for an application and sourceLeadId for a lead', () => {
        expect(recordLinkField('applications')).toBe('sourceApplicationId');
        expect(recordLinkField('leads')).toBe('sourceLeadId');
    });

    it('names a post-application request as the server does', () => {
        expect(postApplicationRequestId('app-1', 'tpl-w9')).toBe('postapp_app-1_tpl-w9');
    });
});

describe('a request\'s state', () => {
    it.each([
        [{ status: 'sent', expiresAt: at(1) }, 'awaiting'],
        [{ status: 'sent', expiresAt: at(-1) }, 'link_expired'],
        [{ status: 'opened', expiresAt: at(-1) }, 'link_expired'],
        [{ status: 'sent' }, 'awaiting'],
        [{ status: 'processing', expiresAt: at(-1) }, 'submitting'],
        [{ status: 'pending_seal' }, 'sealing'],
        [{ status: 'signed' }, 'signed'],
        [{ status: 'sealed' }, 'signed'],
        [{ status: 'completed' }, 'signed'],
        [{ status: 'error_sealing' }, 'seal_failed'],
        [{ status: 'voided', expiresAt: at(-1) }, 'voided'],
        [{ status: 'something_new' }, 'other'],
    ])('%o is %s', (request, state) => {
        expect(signingDocumentState(request, NOW)).toBe(state);
    });

    it('expires only an unsigned link whose time has passed', () => {
        expect(isLinkExpired({ status: 'sent', expiresAt: at(-0.01) }, NOW)).toBe(true);
        expect(isLinkExpired({ status: 'sent', expiresAt: { seconds: (NOW - 1000) / 1000 } }, NOW)).toBe(true);
        expect(isLinkExpired({ status: 'signed', expiresAt: at(-1) }, NOW)).toBe(false);
        expect(isLinkExpired({ status: 'sent', expiresAt: null }, NOW)).toBe(false);
    });
});

describe('the rows of an application', () => {
    it('lists each required form no request carries as Not started, in the company\'s order, then the requests newest first', () => {
        const requests = [
            { id: 'r-old', templateId: 'tpl-other', title: 'Offer', status: 'signed', createdAt: at(-9) },
            { id: 'r-new', templateId: 'tpl-x', title: 'Lease', status: 'sent', createdAt: at(-2), expiresAt: at(5) },
        ];
        const rows = recordDocumentRows({ requests, forms: FORMS, applicationId: 'app-1', now: NOW });

        expect(rows.map((row) => [row.title, row.state])).toEqual([
            ['W-9', 'not_started'],
            ['Handbook', 'not_started'],
            ['Lease', 'awaiting'],
            ['Offer', 'signed'],
        ]);
        // The row a Not started form becomes keeps its key, so a message stays with it.
        expect(rows[0]).toMatchObject({ key: 'postapp_app-1_tpl-w9', templateId: 'tpl-w9', canSend: true });
    });

    it('takes a required form as started once any linked request carries its template', () => {
        const requests = [
            postapp('tpl-w9', { status: 'signed' }),
            { id: 'wizard-1', templateId: 'tpl-hb', title: 'Handbook', status: 'sent', createdAt: at(0) },
        ];
        const rows = recordDocumentRows({ requests, forms: FORMS, applicationId: 'app-1', now: NOW });
        expect(rows.some((row) => row.state === 'not_started')).toBe(false);
    });

    it('does not count another sender\'s voided copy as the form, but does count the form\'s own voided request', () => {
        const voidedCopy = { id: 'wizard-1', templateId: 'tpl-w9', title: 'W-9', status: 'voided', createdAt: at(0) };
        expect(recordDocumentRows({ requests: [voidedCopy], forms: FORMS, applicationId: 'app-1', now: NOW })
            .filter((row) => row.state === 'not_started').map((row) => row.templateId)).toEqual(['tpl-w9', 'tpl-hb']);

        const ownVoided = postapp('tpl-w9', { status: 'voided' });
        expect(recordDocumentRows({ requests: [ownVoided], forms: FORMS, applicationId: 'app-1', now: NOW })
            .filter((row) => row.state === 'not_started').map((row) => row.templateId)).toEqual(['tpl-hb']);
    });

    it('offers Send to driver on an unsigned post-application request nobody sent, expired or not', () => {
        const rows = recordDocumentRows({
            requests: [
                postapp('tpl-w9', { expiresAt: at(-2) }),
                postapp('tpl-dd'),
                postapp('tpl-hb', { sendEmail: true }),
            ],
            forms: FORMS,
            applicationId: 'app-1',
            now: NOW,
        });
        const sendable = Object.fromEntries(rows.map((row) => [row.templateId, row.canSend]));
        expect(sendable).toEqual({ 'tpl-w9': true, 'tpl-dd': true, 'tpl-hb': false });
        expect(rows.find((row) => row.templateId === 'tpl-w9').state).toBe('link_expired');
    });

    it.each([
        ['signed', postapp('tpl-w9', { status: 'signed' })],
        ['voided', postapp('tpl-w9', { status: 'voided' })],
        ['texted', postapp('tpl-w9', { sendSms: true })],
        ['no longer a post-application form', postapp('tpl-gone')],
        ['sent from the template wizard', { id: 'wizard-1', templateId: 'tpl-w9', status: 'sent', sendEmail: false }],
    ])('offers no Send to driver on a request %s', (_label, request) => {
        const [row] = recordDocumentRows({ requests: [request], forms: FORMS, applicationId: 'app-1', now: NOW })
            .filter((r) => r.kind === 'request');
        expect(row.canSend).toBe(false);
    });
});

describe('where Remind is offered', () => {
    it('on a request waiting for its signature that went by email or text, its link expired or not', () => {
        const rows = recordDocumentRows({
            requests: [
                postapp('tpl-w9', { sendEmail: true, recipientEmail: 'dana@example.test', expiresAt: at(-2) }),
                postapp('tpl-hb', { sendSms: true, recipientPhone: '555-0100' }),
                postapp('tpl-dd'),
                { id: 'wizard-1', templateId: 'tpl-x', title: 'Lease', status: 'signed', sendEmail: true, recipientEmail: 'dana@example.test' },
            ],
            forms: FORMS,
            applicationId: 'app-1',
            now: NOW,
        });
        const remindable = Object.fromEntries(rows.filter((row) => row.kind === 'request').map((row) => [row.key, row.canRemind]));
        expect(remindable).toEqual({
            'postapp_app-1_tpl-w9': true,
            'postapp_app-1_tpl-hb': true,
            // Nobody sent it: Send to driver is its button, not Remind.
            'postapp_app-1_tpl-dd': false,
            'wizard-1': false,
        });
        expect(rows.find((row) => row.kind === 'form')).toBeUndefined();
    });
});

describe('the rows of a lead', () => {
    it('lists its linked requests only: a lead has no post-application forms', () => {
        const rows = recordDocumentRows({
            requests: [{ id: 'r-1', templateId: 'tpl-w9', title: 'W-9', status: 'sent', createdAt: at(0) }],
            forms: FORMS,
            applicationId: null,
            now: NOW,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'request', canSend: false });
    });
});

describe('what a press of Send to driver says', () => {
    it.each([
        [{ outcome: 'sent', channels: { email: true, sms: false } }, 'success', 'Sent to the driver by email.'],
        [{ outcome: 'sent', channels: { email: false, sms: true } }, 'success', 'Sent to the driver by text message.'],
        [{ outcome: 'sent', channels: { email: true, sms: true } }, 'success', 'Sent to the driver by email and text message.'],
        [{ outcome: 'already-sent' }, 'info', 'This form was already sent to the driver. Nothing was sent again. To send its link again, use Remind.'],
        [{ outcome: 'signed' }, 'info', 'The driver has already signed this form.'],
    ])('%o', (data, tone, text) => {
        expect(sendResultMessage(data)).toEqual({ tone, text });
    });

    it('passes on the server\'s reason for a refusal, and words anything else plainly', () => {
        const refusal = Object.assign(new Error('Not sent: this application has no email address we can use.'), { code: 'functions/failed-precondition' });
        expect(sendErrorMessage(refusal)).toBe('Not sent: this application has no email address we can use.');
        expect(sendErrorMessage(Object.assign(new Error('x'), { code: 'functions/permission-denied' })))
            .toBe('You do not have access to send documents for this company.');
        expect(sendErrorMessage(Object.assign(new Error('internal'), { code: 'functions/internal' })))
            .toBe('Could not send the form. Please try again.');
    });
});

describe('the next link to run out', () => {
    it('is the soonest unsigned link still running', () => {
        expect(nextLinkExpiry([
            postapp('a', { expiresAt: at(5) }),
            postapp('b', { status: 'opened', expiresAt: at(2) }),
            postapp('c', { status: 'signed', expiresAt: at(1) }),
            postapp('d', { expiresAt: at(-1) }),
        ], NOW)).toBe(at(2).toMillis());
    });

    it('is none when no unsigned link is still running', () => {
        expect(nextLinkExpiry([postapp('d', { expiresAt: at(-1) }), postapp('e', { status: 'voided' })], NOW)).toBeNull();
        expect(nextLinkExpiry([], NOW)).toBeNull();
    });
});
