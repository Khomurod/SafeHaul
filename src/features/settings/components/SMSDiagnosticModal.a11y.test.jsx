/**
 * Accessibility and defect-fix proof for the migrated `SMSDiagnosticModal`.
 *
 * `SMSDiagnosticModal.contract.test.jsx` freezes the callable contracts.
 * This file proves the dialog and labelling defects are fixed.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const callables = vi.hoisted(() => ({ verifySmsConfig: vi.fn(), sendTestSMS: vi.fn() }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));

import { SMSDiagnosticModal } from './SMSDiagnosticModal';

const INVENTORY = [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }];

function setup(overrides = {}) {
    const onClose = vi.fn();
    const utils = render(
        <SMSDiagnosticModal companyId="artificial-company-1" inventory={INVENTORY} onClose={onClose} {...overrides} />,
    );
    return { ...utils, onClose };
}

beforeEach(() => {
    vi.clearAllMocks();
    callables.verifySmsConfig.mockResolvedValue({ data: { message: 'OK.' } });
    callables.sendTestSMS.mockResolvedValue({ data: { success: true } });
});

describe('SMSDiagnosticModal — dialog semantics (defect: bare fixed-inset overlay)', () => {
    it('is a labelled modal dialog', () => {
        setup();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('SMS Diagnostic Lab');
    });

    it('moves focus into the dialog on open', () => {
        setup();
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('closes on Escape and restores focus', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const { onClose } = setup();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        trigger.remove();
    });

    it('names the close control unambiguously', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
});

describe('SMSDiagnosticModal — labelled controls (defect: unassociated label)', () => {
    it('associates the sender label with its select via FormField', () => {
        setup();
        expect(screen.getByRole('combobox', { name: 'Send From (Source)' })).toBeInTheDocument();
    });

    it('associates the destination label with its input', () => {
        setup();
        expect(screen.getByRole('textbox', { name: 'Send To (Destination)' })).toBeInTheDocument();
    });
});

describe('SMSDiagnosticModal — axe', () => {
    it('has no violations in the default state', async () => {
        const { container } = setup();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with a verification result shown', async () => {
        const { container } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Verify Configuration/ }));
        await screen.findByText('OK.');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with a verification failure shown', async () => {
        callables.verifySmsConfig.mockRejectedValue(new Error('artificial failure'));
        const { container } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Verify Configuration/ }));
        await screen.findByText('artificial failure');
        expect((await axe(container)).violations).toEqual([]);
    });
});
