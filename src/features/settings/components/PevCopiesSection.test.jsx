import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({ saveCompanySettings: vi.fn() }));
const toastMocks = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));

vi.mock('@features/companies', () => ({ saveCompanySettings: serviceMocks.saveCompanySettings }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));

import { PevCopiesSection } from './PevCopiesSection';

const field = () => screen.getByRole('textbox', { name: /CC addresses/i });
const save = () => screen.getByRole('button', { name: 'Save Copies' });

describe('PevCopiesSection', () => {
    beforeEach(() => {
        serviceMocks.saveCompanySettings.mockReset();
        serviceMocks.saveCompanySettings.mockResolvedValue();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
    });

    it('starts from the saved list', () => {
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1', pevCcEmails: ['ops@carrier.test', 'hr@carrier.test'] }} />);
        expect(field()).toHaveValue('ops@carrier.test, hr@carrier.test');
    });

    it('saves the list as the server reads it: lower-cased, each once', async () => {
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'Ops@Carrier.test; ops@carrier.test safety@carrier.test' } });
        fireEvent.click(save());

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification copies saved.'));
        expect(field()).toHaveValue('ops@carrier.test, safety@carrier.test');
        expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('co-1', {
            pevCcEmails: ['ops@carrier.test', 'safety@carrier.test'],
        });
    });

    it('saves an empty field as copying no one', async () => {
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1', pevCcEmails: ['ops@carrier.test'] }} />);
        fireEvent.change(field(), { target: { value: '' } });
        fireEvent.click(save());

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification requests will copy no one by default.'));
        expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('co-1', { pevCcEmails: [] });
    });

    it('saves nothing while an address is not one, and says which', () => {
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test, nope' } });
        fireEvent.click(save());

        expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
        expect(field()).toHaveAccessibleDescription(expect.stringContaining('"nope" is not a valid email address.'));
    });

    it('keeps the typed list and reports the failure when the save fails', async () => {
        serviceMocks.saveCompanySettings.mockRejectedValue(new Error('offline'));
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        fireEvent.click(save());

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Could not save the verification copies: offline'));
        expect(field()).toHaveValue('ops@carrier.test');
    });
});
