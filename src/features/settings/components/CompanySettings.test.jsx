import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const useDataMock = vi.hoisted(() => vi.fn());

vi.mock('@/context/DataContext', () => ({
    useData: () => useDataMock(),
}));

vi.mock('./CompanyProfileTab', () => ({
    CompanyProfileTab: () => <h1>Company Profile Content</h1>,
}));
vi.mock('./TeamManagementTab', () => ({
    TeamManagementTab: () => <h1>Team Content</h1>,
}));
vi.mock('./EmailSettingsTab', () => ({
    EmailSettingsTab: () => <h1>Email Content</h1>,
}));
vi.mock('./SmsSettingsTab', () => ({
    SmsSettingsTab: () => <h1>SMS Content</h1>,
}));
vi.mock('./AutomatedSmsTab', () => ({
    AutomatedSmsTab: () => <h1>Automated SMS Content</h1>,
}));
vi.mock('./PersonalProfileTab', () => ({
    PersonalProfileTab: () => <h1>Personal Profile Content</h1>,
}));
vi.mock('./IntegrationsTab', () => ({
    IntegrationsTab: () => <h1>Integrations Content</h1>,
}));
vi.mock('@shared/components/modals', () => ({
    ManageTeamModal: () => <div>Manage Team Modal</div>,
}));

import { CompanySettings } from './CompanySettings';

const company = {
    id: 'company-1',
    planType: 'paid',
    features: { callTracking: true },
};

/** The address the settings page is at, and the browser's Back. */
function AddressProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
        <>
            <output data-testid="address">{`${location.pathname}${location.search}`}</output>
            <button type="button" onClick={() => navigate(-1)}>Browser back</button>
        </>
    );
}

function renderSettings({
    currentCompanyProfile = company,
    currentUserClaims = {
        roles: { 'company-1': 'company_admin' },
    },
    path = '/company/settings',
} = {}) {
    useDataMock.mockReturnValue({
        currentCompanyProfile,
        currentUser: { uid: 'user-1' },
        currentUserClaims,
    });

    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/company/settings" element={<CompanySettings />} />
                <Route path="/company/dashboard" element={<p>Company dashboard</p>} />
            </Routes>
            <AddressProbe />
        </MemoryRouter>,
    );
}

describe('CompanySettings shell compatibility slice', () => {
    beforeEach(() => {
        useDataMock.mockReset();
    });

    it('identifies the current section and preserves tab switching and focus', () => {
        renderSettings();

        expect(screen.getByRole('navigation', { name: 'Company settings sections' }))
            .toBeInTheDocument();
        const companyProfile = screen.getByRole('button', { name: 'Company Profile' });
        const securityProfile = screen.getByRole('button', { name: 'Security Profile' });

        expect(companyProfile).toHaveAttribute('aria-current', 'page');
        expect(companyProfile).toHaveAttribute('aria-controls', 'company-settings-content');
        expect(screen.getByRole('heading', { name: 'Company Profile Content' }))
            .toBeInTheDocument();

        securityProfile.focus();
        fireEvent.click(securityProfile);

        expect(securityProfile).toHaveFocus();
        expect(securityProfile).toHaveAttribute('aria-current', 'page');
        expect(companyProfile).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('heading', { name: 'Personal Profile Content' }))
            .toBeInTheDocument();
    });

    it('names the page with a level-1 "Company Settings" heading, suppressed only where a tab supplies its own', () => {
        renderSettings();
        expect(screen.getByRole('heading', { level: 1, name: 'Company Settings' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Security Profile' }));
        // Personal Profile already renders its own `<h1>` (mocked here as
        // "Personal Profile Content"); the shell's own heading must not also
        // render, or the page would carry two competing h1s.
        expect(screen.queryByRole('heading', { level: 1, name: 'Company Settings' })).toBeNull();
    });

    it('supports directional focus navigation across visible settings sections', () => {
        renderSettings();

        const companyProfile = screen.getByRole('button', { name: 'Company Profile' });
        const team = screen.getByRole('button', { name: 'Team & Users' });
        const securityProfile = screen.getByRole('button', { name: 'Security Profile' });

        companyProfile.focus();
        fireEvent.keyDown(companyProfile, { key: 'ArrowDown' });
        expect(team).toHaveFocus();

        fireEvent.keyDown(team, { key: 'End' });
        expect(securityProfile).toHaveFocus();
    });

    it('preserves call-tracking feature-flag visibility', () => {
        renderSettings({
            currentCompanyProfile: {
                ...company,
                features: { callTracking: false },
            },
        });

        expect(screen.queryByRole('region', { name: 'Revenue & Reach' }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Integrations' }))
            .not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Security Profile' }))
            .toBeInTheDocument();
    });

    it('preserves the company-admin permission redirect', () => {
        renderSettings({
            currentUserClaims: {
                roles: { 'company-1': 'company_member' },
            },
        });

        expect(screen.getByText('Company dashboard')).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Company settings sections' }))
            .not.toBeInTheDocument();
    });

    it('has no structural accessibility violations', async () => {
        const { container } = renderSettings();

        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('the settings section in the address', () => {
    beforeEach(() => {
        useDataMock.mockReset();
    });

    it('opens the section the address names', () => {
        renderSettings({ path: '/company/settings?section=email' });

        expect(screen.getByRole('heading', { name: 'Email Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Email Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it('writes the chosen section into the address, keeping its other parameters', () => {
        renderSettings({ path: '/company/settings?e2eAuth=company_admin' });

        fireEvent.click(screen.getByRole('button', { name: 'Team & Users' }));
        expect(screen.getByTestId('address')).toHaveTextContent('/company/settings?e2eAuth=company_admin&section=team');

        fireEvent.click(screen.getByRole('button', { name: 'Company Profile' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?e2eAuth=company_admin$/);
    });

    it('goes back to the previous section with the browser', () => {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'SMS Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Billing & Plan' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(screen.getByRole('heading', { name: 'SMS Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SMS Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens Company Profile for a section this company does not show', () => {
        renderSettings({
            currentCompanyProfile: { ...company, features: { callTracking: false } },
            path: '/company/settings?section=integrations',
        });
        expect(screen.getByRole('heading', { name: 'Company Profile Content' })).toBeInTheDocument();
    });
});
