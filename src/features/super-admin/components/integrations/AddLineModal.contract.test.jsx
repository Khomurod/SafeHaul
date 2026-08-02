/**
 * Contract freeze + a11y proof for `AddLineModal`, written with its
 * design-system migration. The migration moves the hand-built `fixed inset-0`
 * overlay to the shared accessible `Modal` and the legacy palette to `--ds-*`
 * tokens. It must not change:
 *
 *  - The `usePerLineCredentials` / `needsCredentials` logic derived from
 *    `sharedCredentials.hasCredentials`, and the initial `isSandbox: true`.
 *  - `testLineConnection` and `addPhoneLine` callable names and exact payload
 *    shapes (including omitting credentials when they are not needed, and the
 *    `label || phoneNumber` fallback).
 *  - Every validation guard and its wording, and the success/verify toasts.
 *
 * All ids, numbers, tokens and credentials below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testLineConnection = vi.hoisted(() => vi.fn());
const addPhoneLine = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => {
        if (name === 'testLineConnection') return testLineConnection;
        if (name === 'addPhoneLine') return addPhoneLine;
        return vi.fn();
    },
}));

import { AddLineModal } from './AddLineModal';

const onClose = vi.fn();
const onSuccess = vi.fn();

function renderModal(props = {}) {
    return render(
        <AddLineModal
            companyId="co-1"
            onClose={onClose}
            onSuccess={onSuccess}
            sharedCredentials={{ hasCredentials: false }}
            {...props}
        />,
    );
}

function fill(placeholder, value) {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

beforeEach(() => {
    vi.clearAllMocks();
    testLineConnection.mockResolvedValue({
        data: { message: 'ok', accountId: 'acc', extensionName: 'Main Line', availableNumbers: [] },
    });
    addPhoneLine.mockResolvedValue({ data: { success: true, phoneNumber: '+15551234567', message: 'Line added.' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AddLineModal — dialog shell', () => {
    it('renders as an accessible dialog and closes', () => {
        renderModal();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAccessibleName('Add Phone Line');
        fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('AddLineModal — credentials mode', () => {
    it('shows credential fields when there are no shared credentials', () => {
        renderModal();
        expect(screen.getByPlaceholderText('Enter RingCentral Client ID')).toBeInTheDocument();
    });

    it('hides credential fields when shared credentials exist, until the toggle is set', () => {
        renderModal({ sharedCredentials: { hasCredentials: true } });
        expect(screen.queryByPlaceholderText('Enter RingCentral Client ID')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: /per-line credentials/i }));
        expect(screen.getByPlaceholderText('Enter RingCentral Client ID')).toBeInTheDocument();
    });
});

describe('AddLineModal — test connection contract', () => {
    it('disables Test Connection until a JWT is entered', () => {
        renderModal();
        expect(screen.getByRole('button', { name: /Test Connection/ })).toBeDisabled();
        fill('eyJ0...', 'jwt-token');
        expect(screen.getByRole('button', { name: /Test Connection/ })).not.toBeDisabled();
    });

    it('requires credentials to test when they are needed', () => {
        renderModal();
        fill('eyJ0...', 'jwt-token');
        fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
        expect(toastMocks.showError).toHaveBeenCalledWith('Client ID and Client Secret are required to test connection.');
        expect(testLineConnection).not.toHaveBeenCalled();
    });

    it('sends the frozen testLineConnection payload and success toast', async () => {
        renderModal();
        fill('eyJ0...', 'jwt-token');
        fill('Enter RingCentral Client ID', 'cid');
        fill('••••••••••••', 'csecret');
        fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));

        await waitFor(() => expect(testLineConnection).toHaveBeenCalledWith({
            companyId: 'co-1',
            jwt: 'jwt-token',
            clientId: 'cid',
            clientSecret: 'csecret',
            isSandbox: true,
        }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('✓ Connected! Main Line'));
        expect(screen.getByText('Connection Successful!')).toBeInTheDocument();
    });
});

describe('AddLineModal — add line contract', () => {
    it('requires a phone number', () => {
        const { container } = renderModal();
        fireEvent.submit(container.querySelector('form'));
        expect(toastMocks.showError).toHaveBeenCalledWith('Phone number is required.');
        expect(addPhoneLine).not.toHaveBeenCalled();
    });

    it('sends the frozen addPhoneLine payload, toasts, and closes on success', async () => {
        const { container } = renderModal();
        fill('+1 (555) 123-4567', '+15551234567');
        fill('eyJ0...', 'jwt-token');
        fill('Enter RingCentral Client ID', 'cid');
        fill('••••••••••••', 'csecret');
        fireEvent.submit(container.querySelector('form'));

        await waitFor(() => expect(addPhoneLine).toHaveBeenCalledWith({
            companyId: 'co-1',
            phoneNumber: '+15551234567',
            // label defaults to the phone number when blank
            label: '+15551234567',
            jwt: 'jwt-token',
            clientId: 'cid',
            clientSecret: 'csecret',
            isSandbox: true,
        }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Line added.'));
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('uses the typed label and announces backend verification identity', async () => {
        addPhoneLine.mockResolvedValue({
            data: { success: true, phoneNumber: '+15551234567', message: 'Line added.', verification: { identity: 'RC User' } },
        });
        const { container } = renderModal();
        fill('+1 (555) 123-4567', '+15551234567');
        fill('Recruitment Hotline', 'Recruiting');
        fill('eyJ0...', 'jwt-token');
        fill('Enter RingCentral Client ID', 'cid');
        fill('••••••••••••', 'csecret');
        fireEvent.submit(container.querySelector('form'));

        await waitFor(() => expect(addPhoneLine).toHaveBeenCalledWith(expect.objectContaining({ label: 'Recruiting' })));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verified: RC User'));
    });

    it('omits credentials from the payload when shared credentials are used', async () => {
        const { container } = renderModal({ sharedCredentials: { hasCredentials: true } });
        fill('+1 (555) 123-4567', '+15551234567');
        fill('eyJ0...', 'jwt-token');
        fireEvent.submit(container.querySelector('form'));

        await waitFor(() => expect(addPhoneLine).toHaveBeenCalled());
        const payload = addPhoneLine.mock.calls[0][0];
        expect(payload).not.toHaveProperty('clientId');
        expect(payload).not.toHaveProperty('clientSecret');
        expect(payload).not.toHaveProperty('isSandbox');
    });
});

describe('AddLineModal — accessibility (jsdom baseline)', () => {
    it('has no violations', async () => {
        const { container } = renderModal();
        expect((await axe(container)).violations).toEqual([]);
    });
});
