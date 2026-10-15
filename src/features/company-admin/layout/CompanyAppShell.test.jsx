/**
 * The company shell opens the record the top bar asks for (a notification in
 * its bell) in the driver dossier, over whichever page is showing, and closes
 * it with the dossier's own Close or when the page changes.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ deactivated: false, logout: vi.fn() }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', companyName: 'Acme Freight' }, handleLogout: fx.logout }),
}));
vi.mock('../hooks/useCompanyDeactivated', () => ({ useCompanyDeactivated: () => fx.deactivated }));
vi.mock('./CompanySidebar', () => ({ CompanySidebar: () => null }));
vi.mock('../components/FeatureDeactivationWarning', () => ({ FeatureDeactivationWarning: () => null }));
vi.mock('./CompanyTopbar', () => ({
    CompanyTopbar: ({ onOpenRecord }) => (
        <button type="button" onClick={() => onOpenRecord?.('app-7')}>Open a notification</button>
    ),
}));
vi.mock('../components/modals/driver-dossier/DriverProfileModal', () => ({
    DriverProfileModal: ({ companyId, driverId, onClose }) => (
        <div role="dialog" aria-label="Driver dossier" data-company={companyId} data-record={driverId}>
            <button type="button" onClick={onClose}>Close dossier</button>
        </div>
    ),
}));

import { CompanyAppShell } from './CompanyAppShell';

function Dashboard() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate('/company/other')}>Go elsewhere</button>;
}

function renderShell() {
    render(
        <MemoryRouter initialEntries={['/company/dashboard']}>
            <Routes>
                <Route path="/company" element={<CompanyAppShell />}>
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="other" element={<p>Other page</p>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

describe('the record a notification names', () => {
    it("opens in the company's dossier", async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', { name: 'Open a notification' }));

        await screen.findByRole('button', { name: 'Close dossier' });
        const dossier = screen.getByRole('dialog', { name: 'Driver dossier' });
        expect(dossier).toHaveAttribute('data-record', 'app-7');
        expect(dossier).toHaveAttribute('data-company', 'co-1');
    });

    it("closes with the dossier's own Close", async () => {
        renderShell();
        await userEvent.click(screen.getByRole('button', { name: 'Open a notification' }));
        await screen.findByRole('button', { name: 'Close dossier' });

        await userEvent.click(screen.getByRole('button', { name: 'Close dossier' }));

        expect(screen.queryByRole('dialog', { name: 'Driver dossier' })).not.toBeInTheDocument();
    });

    it('closes when the page changes', async () => {
        renderShell();
        await userEvent.click(screen.getByRole('button', { name: 'Open a notification' }));
        await screen.findByRole('button', { name: 'Close dossier' });

        await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));

        expect(await screen.findByText('Other page')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Driver dossier' })).not.toBeInTheDocument();
    });
});

describe('a deactivated company', () => {
    afterEach(() => {
        fx.deactivated = false;
        fx.logout.mockReset();
    });

    it('closes the workspace with a screen that says why and signs out', async () => {
        fx.deactivated = true;
        renderShell();

        expect(screen.getByRole('heading', { level: 1, name: 'This company has been deactivated' })).toBeInTheDocument();
        expect(screen.getByText(/The Acme Freight workspace is closed/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Go elsewhere' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open a notification' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(fx.logout).toHaveBeenCalledTimes(1);
    });
});
