/**
 * Contract freeze for `SMSDiagnosticModal`, written before its design-system
 * migration. This component previously had zero test coverage (it is stubbed
 * out in `NumberAssignmentManager.test.jsx`), so this file is the first freeze
 * of its callable contracts and messages:
 *
 *  - `verifySmsConfig({ companyId })` -> `{ message }`
 *  - `sendTestSMS({ companyId, testPhoneNumber, fromNumber|null })`
 *  - the destination-required guard and its exact message
 *  - the `fromNumber: null` "system default" sentinel when no sender is chosen
 *  - `onClose` firing on a successful send, not on a verify or a failed send
 *
 * All phone numbers below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const callables = vi.hoisted(() => ({ verifySmsConfig: vi.fn(), sendTestSMS: vi.fn() }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));

import { SMSDiagnosticModal } from './SMSDiagnosticModal';

const INVENTORY = [
    { phoneNumber: '+15550000001', usageType: 'DirectNumber' },
    { phoneNumber: '+15550000002', usageType: 'Local' },
];

function setup(overrides = {}) {
    const onClose = vi.fn();
    const utils = render(
        <SMSDiagnosticModal companyId="artificial-company-1" inventory={INVENTORY} onClose={onClose} {...overrides} />,
    );
    return { ...utils, onClose };
}

beforeEach(() => {
    vi.clearAllMocks();
    callables.verifySmsConfig.mockResolvedValue({ data: { message: 'Configuration OK.' } });
    callables.sendTestSMS.mockResolvedValue({ data: { success: true } });
});

describe('SMSDiagnosticModal — preserved contracts', () => {
    it('lists every inventory number as a sender option with the frozen default', () => {
        setup();
        const options = [...document.querySelectorAll('select option')].map((o) => o.textContent);
        expect(options).toEqual([
            'System Default (Auto-Route)',
            '+15550000001 (DirectNumber)',
            '+15550000002 (Local)',
        ]);
    });

    it('blocks sending without a destination using the frozen message', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: /Send Test Message/ }));

        expect(toastMocks.showError).toHaveBeenCalledWith('Please enter a destination phone number.');
        expect(callables.sendTestSMS).not.toHaveBeenCalled();
    });

    it('sends with fromNumber: null when no sender is chosen (system default)', async () => {
        const { onClose } = setup();
        fireEvent.change(document.querySelector('input[type="tel"]'), {
            target: { value: '+15559999999' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Send Test Message/ }));

        await waitFor(() => expect(callables.sendTestSMS).toHaveBeenCalledWith({
            companyId: 'artificial-company-1',
            testPhoneNumber: '+15559999999',
            fromNumber: null,
        }));
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Test message sent to +15559999999');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sends with the selected sender number', async () => {
        setup();
        fireEvent.change(document.querySelector('select'), { target: { value: '+15550000002' } });
        fireEvent.change(document.querySelector('input[type="tel"]'), {
            target: { value: '+15559999999' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Send Test Message/ }));

        await waitFor(() => expect(callables.sendTestSMS).toHaveBeenCalledWith({
            companyId: 'artificial-company-1',
            testPhoneNumber: '+15559999999',
            fromNumber: '+15550000002',
        }));
    });

    it('reports a send failure and does not close', async () => {
        callables.sendTestSMS.mockRejectedValue(new Error('artificial send failure'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { onClose } = setup();

        fireEvent.change(document.querySelector('input[type="tel"]'), {
            target: { value: '+15559999999' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Send Test Message/ }));

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('artificial send failure'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('calls verifySmsConfig with only the companyId and shows the returned message', async () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: /Verify Configuration/ }));

        await waitFor(() => expect(callables.verifySmsConfig)
            .toHaveBeenCalledWith({ companyId: 'artificial-company-1' }));
        expect(await screen.findByText('Configuration OK.')).toBeInTheDocument();
    });

    it('shows a verify failure message without closing', async () => {
        callables.verifySmsConfig.mockRejectedValue(new Error('artificial verify failure'));
        const { onClose } = setup();

        fireEvent.click(screen.getByRole('button', { name: /Verify Configuration/ }));
        expect(await screen.findByText('artificial verify failure')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
