/**
 * A sent document's status badge in the history table. A failed send explains
 * the status only while the document is still with its signer: once it is
 * signed or voided, its own status is what the row says. A text skipped for an
 * opted-out number is a note, never a failure. All values are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EnvelopeStatusBadge } from './EnvelopeStatus';

const OPTED_OUT = 'Not texted: this number opted out of texts.';

const badgeOf = (document) => render(<EnvelopeStatusBadge document={document} />);
const toneOf = (text) => screen.getByText(text).closest('.ds-badge').getAttribute('data-tone');

afterEach(cleanup);

describe('EnvelopeStatusBadge', () => {
    it('says Delivery failed, with the reason, for a document still with its signer', () => {
        badgeOf({ status: 'sent', sendSms: true, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });

        expect(toneOf('Delivery failed')).toBe('danger');
        expect(screen.getByText('Line unavailable (artificial)')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting signature')).toBeNull();
    });

    it('says Signed for a signed document whose text failed', () => {
        badgeOf({ status: 'signed', sendSms: true, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });

        expect(toneOf('Signed')).toBe('success');
        expect(screen.queryByText('Delivery failed')).toBeNull();
        expect(screen.queryByText('Line unavailable (artificial)')).toBeNull();
    });

    it.each([
        ['voided', 'Voided'],
        ['error_sealing', 'Seal failed'],
        ['pending_seal', 'Sealing'],
    ])('says what a %s document whose email failed is', (status, label) => {
        badgeOf({ status, emailStatus: 'failed', emailError: 'SMTP 550 rejected (artificial)' });

        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText('Delivery failed')).toBeNull();
        expect(screen.queryByText('SMTP 550 rejected (artificial)')).toBeNull();
    });

    it('shows a text skipped for an opted-out number as a note under Awaiting signature, not a failure', () => {
        badgeOf({ status: 'sent', sendEmail: true, sendSms: true, emailStatus: 'sent', smsStatus: 'skipped', smsNote: OPTED_OUT });

        expect(toneOf('Awaiting signature')).toBe('info');
        expect(screen.getByText(OPTED_OUT)).toBeInTheDocument();
        expect(screen.getByText(OPTED_OUT).className).not.toMatch(/danger/);
        expect(screen.queryByText('Delivery failed')).toBeNull();
    });

    it('drops the note once the document is signed', () => {
        badgeOf({ status: 'signed', smsStatus: 'skipped', smsNote: OPTED_OUT });

        expect(screen.getByText('Signed')).toBeInTheDocument();
        expect(screen.queryByText(OPTED_OUT)).toBeNull();
    });
});
