// EnvelopeHistory contract, part 1 of 3: the live subscription, status and
// delivery presentation, titles, and the quick-action hierarchy.
// The shared harness — mock state, factories, fixtures, snapshot emitters and
// helpers — lives in `EnvelopeHistory.support.jsx`; the registrations below
// delegate to it. All fixtures are artificial (see the support's PRIVACY note).
import React from 'react';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('./EnvelopeHistory.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeHistory.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvelopeHistory.support')).libFirebaseMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeHistory.support')).feedbackMock());

import EnvelopeHistory from './EnvelopeHistory';
import {
    makeRenderHistory,
    resetHarness,
    restoreHarness,
    makeDoc,
    emit,
    emitError,
    fs,
    unsubSpy,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

beforeEach(resetHarness);

afterEach(restoreHarness);

describe('EnvelopeHistory — subscription', () => {
    it('does not subscribe without a companyId', () => {
        renderHistory({ companyId: undefined });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.collection).not.toHaveBeenCalled();
    });

    it('subscribes to the exact ordered signing_requests query and unsubscribes on unmount', () => {
        const { unmount } = renderHistory();
        expect(fs.collection).toHaveBeenCalledWith({}, 'companies', 'co-1', 'signing_requests');
        expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
        unmount();
        expect(unsubSpy).toHaveBeenCalledTimes(1);
    });

    it('announces loading before the first snapshot', () => {
        renderHistory();
        expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
        expect(screen.getByText('Loading document history')).toBeInTheDocument();
    });

    it('maps snapshot docs id-preservingly', () => {
        renderHistory();
        emit([makeDoc({ id: 'req-9', title: 'Policy Ack' })]);
        expect(screen.getByText('Policy Ack')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Link for Policy Ack' })).toBeInTheDocument();
    });

    it('shows the exact empty message when there are no documents', () => {
        renderHistory();
        emit([]);
        expect(screen.getByText('No documents sent yet.')).toBeInTheDocument();
    });

    it('surfaces a snapshot failure as an accessible alert', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderHistory();
        emitError(new Error('permission-denied'));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/Could not load document history/);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe('EnvelopeHistory — status presentation', () => {
    it.each([
        ['signed', 'Signed', 'success'],
        ['sent', 'Sent', 'info'],
        ['voided', 'Voided', 'danger'],
        ['pending_seal', 'Sealing...', 'warning'],
        ['error_sealing', 'Seal Failed', 'danger'],
        ['processing', 'Processing', 'warning'],
    ])('maps %s to "%s" with tone %s and text (never colour-only)', (status, label, tone) => {
        renderHistory();
        emit([makeDoc({ status })]);
        const badge = screen.getByText(label);
        expect(badge.closest('.ds-badge')).toHaveAttribute('data-tone', tone);
    });

    it('falls back to the raw status text for an unknown status', () => {
        renderHistory();
        emit([makeDoc({ status: 'archived_by_admin' })]);
        expect(screen.getByText('archived_by_admin')).toBeInTheDocument();
    });

    it('lets an email failure override the document status', () => {
        renderHistory();
        emit([makeDoc({ status: 'sent', emailStatus: 'failed', emailError: 'SMTP 550 rejected' })]);
        expect(screen.getByText('Delivery Failed')).toBeInTheDocument();
        expect(screen.queryByText('Sent')).not.toBeInTheDocument();
        expect(screen.getByText('SMTP 550 rejected')).toBeInTheDocument();
    });

    it('truncates an email error after 80 characters with an ellipsis', () => {
        renderHistory();
        const longError = 'E'.repeat(120);
        emit([makeDoc({ emailStatus: 'failed', emailError: longError })]);
        expect(screen.getByText(`${'E'.repeat(80)}…`)).toBeInTheDocument();
    });

    it('keeps an 80-character error untruncated', () => {
        renderHistory();
        emit([makeDoc({ emailStatus: 'failed', emailError: 'E'.repeat(80) })]);
        expect(screen.getByText('E'.repeat(80))).toBeInTheDocument();
    });

    it('uses the exact fallback when the failure carries no detail', () => {
        renderHistory();
        emit([makeDoc({ emailStatus: 'failed' })]);
        expect(screen.getByText('Email delivery failed')).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — delivery method and fallbacks', () => {
    it('shows Email and SMS badges together when both are set', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: true, sendSms: true })]);
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
        expect(screen.queryByText('Manual')).not.toBeInTheDocument();
    });

    it('shows Manual only when sendEmail is false and sendSms is not true', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: false, sendSms: false })]);
        expect(screen.getByText('Manual')).toBeInTheDocument();
        expect(screen.queryByText('Email')).not.toBeInTheDocument();
    });

    it('does not show Manual when sendSms is true', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: false, sendSms: true })]);
        expect(screen.queryByText('Manual')).not.toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
    });

    it('falls back to Untitled, plain contact-missing wording, and -- for a missing date', () => {
        renderHistory();
        emit([makeDoc({ title: undefined, recipientEmail: undefined, recipientPhone: undefined, createdAt: undefined })]);
        expect(screen.getByText('Untitled')).toBeInTheDocument();
        // A bare dash reads as an accident; the fallback says what is missing.
        expect(screen.getByText('No email or phone')).toBeInTheDocument();
        expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('falls back to the phone number when there is no email', () => {
        renderHistory();
        emit([makeDoc({ recipientEmail: undefined, recipientPhone: '555-0142' })]);
        expect(screen.getByText('555-0142')).toBeInTheDocument();
    });

    it('renders the date from createdAt.seconds', () => {
        renderHistory();
        emit([makeDoc({ createdAt: { seconds: 1700000000 } })]);
        expect(screen.getByText(new Date(1700000000 * 1000).toLocaleDateString())).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — title presentation', () => {
    it('clamps a long title to two lines while exposing the full text', () => {
        const longTitle = `Extremely long artificial onboarding packet filename ${'x'.repeat(120)}.pdf`;
        renderHistory();
        emit([makeDoc({ title: longTitle })]);
        const clamped = screen.getByText(longTitle);
        expect(clamped.className).toContain('line-clamp-2');
        // The full stored title stays reachable through the cell tooltip.
        expect(clamped.closest('[title]')).toHaveAttribute('title', longTitle);
    });
});

describe('EnvelopeHistory — quick action hierarchy', () => {
    it('offers Download as the only row action for a signed document', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'signed' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Download Offer Letter');
    });

    it('offers Copy Link as the only row action for a sent document', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Link for Offer Letter');
        // Correct and Void no longer sit in every row; they live in the details dialog.
        expect(screen.queryByRole('button', { name: 'Correct Offer Letter' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Void Offer Letter' })).not.toBeInTheDocument();
    });

    it('offers Review details as the only row action for a delivery failure', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent', emailStatus: 'failed', emailError: 'SMTP 550 rejected' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Review details for Offer Letter');
    });

    it('offers Review details as the only row action for a sealing failure', () => {
        renderHistory();
        emit([makeDoc({ status: 'error_sealing' })]);
        expect(screen.getByRole('button', { name: 'Review details for Offer Letter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Link for|Download|Void|Correct/ })).not.toBeInTheDocument();
    });

    it.each(['processing', 'pending_seal', 'voided', 'archived_by_admin'])(
        'offers View details as the only row action for a %s document',
        (status) => {
            renderHistory({ onCorrect: vi.fn() });
            emit([makeDoc({ status })]);
            const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
            const buttons = within(row).getAllByRole('button');
            expect(buttons).toHaveLength(1);
            expect(buttons[0]).toHaveAccessibleName('View details for Offer Letter');
        },
    );

    it('offsets the Actions heading and quick action toward the table edge together', () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        // Both carry the same -mr-ds-4: it compensates the scrollbar gutter +
        // shared cell padding on the table's right edge, and the heading must
        // keep the exact offset of the buttons below it or they drift apart.
        const header = screen.getByRole('columnheader', { name: 'Actions' });
        expect(header.querySelector('span')).toHaveClass('-mr-ds-4');
        const quickAction = screen.getByRole('button', { name: 'Link for Offer Letter' });
        expect(quickAction.parentElement).toHaveClass('-mr-ds-4', 'justify-end');
    });

    it('never renders more than one action control in an ordinary row', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([
            makeDoc({ id: 'a', status: 'sent' }),
            makeDoc({ id: 'b', title: 'Signed Doc', status: 'signed' }),
            makeDoc({ id: 'c', title: 'Voided Doc', status: 'voided' }),
        ]);
        for (const name of ['Details for Offer Letter', 'Details for Signed Doc', 'Details for Voided Doc']) {
            expect(within(screen.getByRole('row', { name })).getAllByRole('button')).toHaveLength(1);
        }
    });
});

