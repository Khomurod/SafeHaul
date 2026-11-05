/**
 * A sent document's status badge in the history table. A failed send explains
 * the status only while the document is still with its signer: once it is
 * signed or voided, its own status is what the row says. All values are
 * artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EnvelopeStatusBadge } from './EnvelopeStatus';

const badgeOf = (document) => render(<EnvelopeStatusBadge document={document} />);
const toneOf = (text) => screen.getByText(text).closest('.ds-badge').getAttribute('data-tone');

afterEach(cleanup);

describe('EnvelopeStatusBadge', () => {
    it('says Delivery Failed, with the reason, for a document still with its signer', () => {
        badgeOf({ status: 'sent', sendSms: true, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });

        expect(toneOf('Delivery Failed')).toBe('danger');
        expect(screen.getByText('Line unavailable (artificial)')).toBeInTheDocument();
        expect(screen.queryByText('Sent')).toBeNull();
    });

    it('says Signed for a signed document whose text failed', () => {
        badgeOf({ status: 'signed', sendSms: true, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });

        expect(toneOf('Signed')).toBe('success');
        expect(screen.queryByText('Delivery Failed')).toBeNull();
        expect(screen.queryByText('Line unavailable (artificial)')).toBeNull();
    });

    it.each([
        ['voided', 'Voided'],
        ['error_sealing', 'Seal Failed'],
        ['pending_seal', 'Sealing...'],
    ])('says what a %s document whose email failed is', (status, label) => {
        badgeOf({ status, emailStatus: 'failed', emailError: 'SMTP 550 rejected (artificial)' });

        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText('Delivery Failed')).toBeNull();
        expect(screen.queryByText('SMTP 550 rejected (artificial)')).toBeNull();
    });
});
