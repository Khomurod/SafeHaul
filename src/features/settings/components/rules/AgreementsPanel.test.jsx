import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMocks = vi.hoisted(() => ({ calls: [], impl: {} }));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async (payload) => {
        callableMocks.calls.push({ name, payload });
        const impl = callableMocks.impl[name];
        if (!impl) throw new Error(`No callable stub for ${name}`);
        return { data: await impl(payload) };
    },
}));

import { AgreementsPanel } from './AgreementsPanel';

const agreement = (overrides = {}) => ({
    id: 'mvrAuthorization',
    title: 'MOTOR VEHICLE RECORD (MVR) AUTHORIZATION',
    presentedOn: 'drivingRecord',
    platformVersion: 'v1',
    platformBody: 'Platform wording for Acme Freight about motor vehicle records.',
    currentVersion: null,
    currentBody: null,
    versions: [],
    ...overrides,
});

describe('AgreementsPanel', () => {
    beforeEach(() => {
        callableMocks.calls.length = 0;
        callableMocks.impl = {
            listCompanyAgreementWording: async () => ({ agreements: [agreement()] }),
        };
        toastMocks.showSuccess.mockClear();
        toastMocks.showError.mockClear();
    });

    it('lists each agreement with where it is shown and the wording in force', async () => {
        render(<AgreementsPanel companyId="company-1" />);
        expect(await screen.findByText('MOTOR VEHICLE RECORD (MVR) AUTHORIZATION')).toBeInTheDocument();
        expect(screen.getByText(/Motor Vehicle Record step/)).toBeInTheDocument();
        expect(screen.getByText('Platform wording for Acme Freight about motor vehicle records.')).toBeInTheDocument();
        expect(screen.getByTestId('mvrAuthorization-source')).toHaveTextContent('Platform wording · version v1');
        expect(callableMocks.calls[0]).toEqual({ name: 'listCompanyAgreementWording', payload: { companyId: 'company-1' } });
    });

    it('is read-only for a company admin, and says who can change legal wording', async () => {
        render(<AgreementsPanel companyId="company-1" canPublish={false} />);
        await screen.findByText('MOTOR VEHICLE RECORD (MVR) AUTHORIZATION');
        expect(screen.queryByRole('button', { name: 'Publish new wording' })).toBeNull();
        expect(screen.getByText(/made by a SafeHaul super admin/)).toBeInTheDocument();
    });

    it('lets a super admin publish new wording through the callable, then shows the new version', async () => {
        callableMocks.impl.publishCompanyAgreementWording = async ({ body }) => ({
            agreements: [agreement({
                currentVersion: 'c-abc123def456',
                currentBody: body,
                versions: [{ id: 'c-abc123def456', body, createdAt: '2026-09-02T00:00:00Z', createdBy: 'sa', note: null }],
            })],
        });
        render(<AgreementsPanel companyId="company-1" canPublish />);
        fireEvent.click(await screen.findByRole('button', { name: 'Publish new wording' }));
        fireEvent.change(screen.getByRole('textbox', { name: /New wording for/ }), { target: { value: 'Company-specific wording that names {{companyName}} explicitly.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        await waitFor(() => expect(screen.getByTestId('mvrAuthorization-source')).toHaveTextContent('Company wording · version c-abc123def456'));
        expect(callableMocks.calls.at(-1)).toEqual({
            name: 'publishCompanyAgreementWording',
            payload: { companyId: 'company-1', agreementId: 'mvrAuthorization', body: 'Company-specific wording that names {{companyName}} explicitly.' },
        });
        expect(toastMocks.showSuccess).toHaveBeenCalled();
        expect(screen.getByText(/Version history \(1\)/)).toBeInTheDocument();
    });

    it('offers "Use platform wording" only when company wording is in force, and reverts through the callable', async () => {
        callableMocks.impl.listCompanyAgreementWording = async () => ({
            agreements: [agreement({ currentVersion: 'c-abc123def456', currentBody: 'Company wording.', versions: [{ id: 'c-abc123def456', body: 'Company wording.', createdAt: null }] })],
        });
        callableMocks.impl.revertCompanyAgreementWording = async () => ({ agreements: [agreement()] });
        render(<AgreementsPanel companyId="company-1" canPublish />);
        fireEvent.click(await screen.findByRole('button', { name: 'Use platform wording' }));
        await waitFor(() => expect(screen.getByTestId('mvrAuthorization-source')).toHaveTextContent('Platform wording · version v1'));
        expect(callableMocks.calls.at(-1)).toEqual({
            name: 'revertCompanyAgreementWording',
            payload: { companyId: 'company-1', agreementId: 'mvrAuthorization' },
        });
    });

    it('reports a load failure instead of showing nothing', async () => {
        callableMocks.impl.listCompanyAgreementWording = async () => { throw new Error('permission-denied'); };
        render(<AgreementsPanel companyId="company-1" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('permission-denied');
    });
});
