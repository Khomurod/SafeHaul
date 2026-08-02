/**
 * Contract freeze + a11y proof for `QuickLeadModal`, written with its
 * design-system migration (2026-07-28).
 *
 * This is the dashboard-launched modal, deliberately out of scope of the
 * 2026-07-27 `QuickAddLeadPage` campaign and recorded as residual debt since. It
 * has its own four-field set, its own phone-or-email rule and its own payload.
 *
 * Frozen here: the `companies/{companyId}/leads` path, the exact write payload
 * (tenant `companyId`, trimmed names, `phone`/`email` trimmed-or-`null`,
 * `LEAD_DEFAULT_STATUS`, `source: 'Manual Entry'`, `serverTimestamp()`, and the
 * `createdBy` / `createdByName` fallbacks), both validation rules, all four toast
 * strings, and the `onSuccess`-then-`onClose` ordering.
 *
 * All names, phone numbers and emails below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addDoc = vi.hoisted(() => vi.fn());
const collectionFn = vi.hoisted(() => vi.fn((_db, ...path) => ({ path: path.join('/') })));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const authState = vi.hoisted(() => ({ currentUser: { uid: 'user-1', displayName: 'Test Recruiter' } }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {}, get auth() { return authState; } }));
vi.mock('firebase/firestore', () => ({
    collection: (...a) => collectionFn(...a),
    addDoc: (...a) => addDoc(...a),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

import { QuickLeadModal } from './QuickLeadModal';
import { LEAD_DEFAULT_STATUS } from '@shared/constants/atsStatus';

function renderModal(props = {}) {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const utils = render(
        <QuickLeadModal companyId="co-1" onClose={onClose} onSuccess={onSuccess} {...props} />,
    );
    return { ...utils, onClose, onSuccess };
}

function fillNames() {
    fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: '  Test  ' } });
    fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: '  Driver  ' } });
}

function submit() {
    fireEvent.submit(screen.getByRole('button', { name: /Add Lead/ }).closest('form'));
}

beforeEach(() => {
    vi.clearAllMocks();
    addDoc.mockResolvedValue({ id: 'lead-1' });
    authState.currentUser = { uid: 'user-1', displayName: 'Test Recruiter' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('QuickLeadModal — write contract', () => {
    it('writes to the frozen collection path', async () => {
        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: ' 5550001111 ' } });
        submit();

        await waitFor(() => expect(collectionFn).toHaveBeenCalledWith({}, 'companies', 'co-1', 'leads'));
    });

    it('writes the frozen payload with trimmed values', async () => {
        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: ' 5550001111 ' } });
        fireEvent.change(screen.getByLabelText(/^Email Address/), { target: { value: ' d@example.test ' } });
        submit();

        await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1));
        expect(addDoc.mock.calls[0][1]).toEqual({
            companyId: 'co-1',
            firstName: 'Test',
            lastName: 'Driver',
            phone: '5550001111',
            email: 'd@example.test',
            status: LEAD_DEFAULT_STATUS,
            source: 'Manual Entry',
            createdAt: 'SERVER_TIMESTAMP',
            createdBy: 'user-1',
            createdByName: 'Test Recruiter',
        });
    });

    it('nulls an omitted phone or email rather than storing an empty string', async () => {
        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Email Address/), { target: { value: 'd@example.test' } });
        submit();

        await waitFor(() => expect(addDoc).toHaveBeenCalled());
        expect(addDoc.mock.calls[0][1].phone).toBeNull();
        expect(addDoc.mock.calls[0][1].email).toBe('d@example.test');
    });

    it('keeps the unknown-author fallbacks', async () => {
        authState.currentUser = null;
        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: '5550001111' } });
        submit();

        await waitFor(() => expect(addDoc).toHaveBeenCalled());
        expect(addDoc.mock.calls[0][1].createdBy).toBe('unknown');
        expect(addDoc.mock.calls[0][1].createdByName).toBe('Unknown');
    });

    it('announces success then calls onSuccess before onClose', async () => {
        const { onClose, onSuccess } = renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: '5550001111' } });
        submit();

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Lead added successfully!'));
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    });

    it('keeps the frozen failure toast and does not close', async () => {
        addDoc.mockRejectedValueOnce(new Error('permission denied'));
        const { onClose } = renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: '5550001111' } });
        submit();

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Failed to add lead: permission denied'));
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('QuickLeadModal — validation rules (both now reachable)', () => {
    it('blocks and announces the frozen name message, focusing the first offender', () => {
        renderModal();
        submit();

        expect(toastMocks.showError).toHaveBeenCalledWith('Please provide first and last name');
        expect(addDoc).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^First Name/)).toHaveFocus();
        expect(screen.getByLabelText(/^First Name/)).toHaveAttribute('aria-invalid', 'true');
    });

    it('focuses Last Name when only that one is missing', () => {
        renderModal();
        fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: 'Test' } });
        submit();

        expect(screen.getByLabelText(/^Last Name/)).toHaveFocus();
        expect(screen.getByLabelText(/^First Name/)).not.toHaveAttribute('aria-invalid');
    });

    it('treats whitespace-only names as missing', () => {
        renderModal();
        fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: '   ' } });
        fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: '   ' } });
        submit();

        expect(toastMocks.showError).toHaveBeenCalledWith('Please provide first and last name');
        expect(addDoc).not.toHaveBeenCalled();
    });

    it('enforces the phone-or-email rule with the frozen message', () => {
        renderModal();
        fillNames();
        submit();

        expect(toastMocks.showError).toHaveBeenCalledWith('Please provide at least a phone number or email');
        expect(addDoc).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Phone Number/)).toHaveFocus();
    });

    it.each([
        ['phone only', /^Phone Number/],
        ['email only', /^Email Address/],
    ])('accepts %s', async (_name, label) => {
        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(label), { target: { value: label.source.includes('Email') ? 'd@example.test' : '5550001111' } });
        submit();

        await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1));
    });

    it('clears a field error as soon as the field is corrected', () => {
        renderModal();
        submit();
        expect(screen.getByLabelText(/^First Name/)).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: 'Test' } });
        expect(screen.getByLabelText(/^First Name/)).not.toHaveAttribute('aria-invalid');
    });

    it('lets the app own validation rather than the browser preempting it', () => {
        renderModal();
        expect(screen.getByLabelText(/^First Name/).closest('form')).toHaveAttribute('novalidate');
        // Semantics are still exposed for assistive technology.
        expect(screen.getByLabelText(/^First Name/)).toHaveAttribute('aria-required', 'true');
    });
});

describe('QuickLeadModal — dialog behaviour (hand-built overlay replaced)', () => {
    it('is a real modal dialog named by its heading', () => {
        renderModal();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Quick Add Lead');
        expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Quick Add Lead');
    });

    it('moves focus into the dialog on open', () => {
        renderModal();
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('closes on Escape', () => {
        const { onClose } = renderModal();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('restores focus to the trigger on close', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const { unmount } = renderModal();
        expect(document.activeElement).not.toBe(trigger);

        unmount();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('names the close control and the cancel action', () => {
        const { onClose } = renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Close quick add lead' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('rejects a second submit dispatched before the first resolves', async () => {
        let release;
        addDoc.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'lead-1' }); }));

        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: '5550001111' } });
        const form = screen.getByRole('button', { name: /Add Lead/ }).closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(addDoc).toHaveBeenCalledTimes(1);
        release();
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalled());
    });

    it('shows an announced busy state while saving', async () => {
        let release;
        addDoc.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'lead-1' }); }));

        renderModal();
        fillNames();
        fireEvent.change(screen.getByLabelText(/^Phone Number/), { target: { value: '5550001111' } });
        submit();

        const button = await screen.findByRole('button', { name: /Adding\.\.\./ });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
        release();
    });
});

describe('QuickLeadModal — accessibility', () => {
    it('names all four fields, which previously had no accessible name at all', () => {
        renderModal();
        expect(screen.getByLabelText(/^First Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Last Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Phone Number/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Email Address/)).toBeInTheDocument();
    });

    it('wires the phone-or-email hint as the description of both contact fields', () => {
        const { container } = renderModal();
        const phoneDescribedBy = screen.getByLabelText(/^Phone Number/).getAttribute('aria-describedby');
        const emailDescribedBy = screen.getByLabelText(/^Email Address/).getAttribute('aria-describedby');

        expect(phoneDescribedBy).toBeTruthy();
        expect(emailDescribedBy).toBeTruthy();
        const hintId = phoneDescribedBy.split(' ').find((id) => emailDescribedBy.includes(id));
        expect(container.querySelector(`#${hintId}`)).toHaveTextContent('At least phone or email is required');
    });

    it('has no jsdom axe violations', async () => {
        const { container } = renderModal();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations with both validation errors shown', async () => {
        const { container } = renderModal();
        submit();
        expect((await axe(container)).violations).toEqual([]);
    });
});
