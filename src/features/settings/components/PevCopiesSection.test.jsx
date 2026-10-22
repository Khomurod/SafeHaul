import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({ saveCompanySettings: vi.fn() }));
const toastMocks = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
const fsMocks = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('@features/companies', () => ({ saveCompanySettings: serviceMocks.saveCompanySettings }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (...parts) => parts.slice(1).join('/'), getDoc: (...args) => fsMocks.getDoc(...args) }));

import { PevCopiesSection } from './PevCopiesSection';

const field = () => screen.getByRole('textbox', { name: /CC addresses/i });
const save = () => screen.getByRole('button', { name: 'Save Copies' });

describe('PevCopiesSection', () => {
    beforeEach(() => {
        serviceMocks.saveCompanySettings.mockReset();
        serviceMocks.saveCompanySettings.mockResolvedValue();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        fsMocks.getDoc.mockReset();
        // No newer list on the company document, unless a test says otherwise.
        fsMocks.getDoc.mockResolvedValue({ exists: () => false });
    });

    // The signed-in profile is read once per session. A list saved since,
    // here or in another tab, must show when Settings opens again.
    it('shows the list saved since the profile was loaded', async () => {
        fsMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ pevCcEmails: ['safety@carrier.test'] }) });
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);

        await waitFor(() => expect(field()).toHaveValue('safety@carrier.test'));
        expect(fsMocks.getDoc).toHaveBeenCalledWith('companies/co-1');
    });

    it('keeps what was typed when the saved list arrives later', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['safety@carrier.test'] }) }));
        expect(field()).toHaveValue('ops@carrier.test');
    });

    it('keeps the list just saved when an older read answers after the save', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        fireEvent.click(save());
        await waitFor(() => expect(save()).not.toHaveAttribute('aria-busy', 'true'));
        expect(toastMocks.showSuccess).toHaveBeenCalled();

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['old@carrier.test'] }) }));
        expect(field()).toHaveValue('ops@carrier.test');
    });

    it('keeps the list just saved without typing when an older read answers after the save', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<PevCopiesSection currentCompanyProfile={{ id: 'co-1', pevCcEmails: ['ops@carrier.test'] }} />);
        fireEvent.click(save());
        await waitFor(() => expect(save()).not.toHaveAttribute('aria-busy', 'true'));
        expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('co-1', { pevCcEmails: ['ops@carrier.test'] });

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['old@carrier.test'] }) }));
        expect(field()).toHaveValue('ops@carrier.test');
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
