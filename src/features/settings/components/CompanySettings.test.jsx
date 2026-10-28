import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const useDataMock = vi.hoisted(() => vi.fn());

vi.mock('@/context/DataContext', () => ({
    useData: () => useDataMock(),
}));

/** Company profile holds an unsaved edit while its box is ticked. */
vi.mock('./CompanyProfileTab', async () => {
    const ReactModule = await import('react');
    const { useUnsavedChanges } = await import('@/design-system/patterns');
    function CompanyProfileTab() {
        const [dirty, setDirty] = ReactModule.useState(false);
        useUnsavedChanges(dirty);
        return (
            <>
                <h1>Company Profile Content</h1>
                <label>
                    <input type="checkbox" checked={dirty} onChange={(event) => setDirty(event.target.checked)} />
                    Unsaved profile edit
                </label>
            </>
        );
    }
    return { CompanyProfileTab };
});
vi.mock('./ApplicationFormTab', () => ({
    ApplicationFormTab: () => <h1>Application Form Content</h1>,
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
vi.mock('./api-keys/ApiKeysTab', () => ({
    ApiKeysTab: () => <h1>API Keys Content</h1>,
}));
const isMobileMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@shared/hooks/useIsMobile', () => ({
    useIsMobile: () => isMobileMock(),
}));

/** A section that holds an unsaved edit while its box is ticked. */
vi.mock('./BillingTab', async () => {
    const ReactModule = await import('react');
    const { useUnsavedChanges } = await import('@/design-system/patterns');
    function BillingTab() {
        const [dirty, setDirty] = ReactModule.useState(false);
        useUnsavedChanges(dirty);
        return (
            <>
                <h1>Plan Content</h1>
                <label>
                    <input type="checkbox" checked={dirty} onChange={(event) => setDirty(event.target.checked)} />
                    Unsaved edit
                </label>
            </>
        );
    }
    return { BillingTab };
});

import { CompanySettings } from './CompanySettings';
import { UnsavedChangesBoundary } from '@features/company-admin/layout/UnsavedChangesBoundary';

const company = {
    id: 'company-1',
    planType: 'paid',
    features: { callTracking: true },
};

/** The address the settings page is at, the browser's Back, and the app menu's Settings link. */
function AddressProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
        <>
            <output data-testid="address">{`${location.pathname}${location.search}`}</output>
            <button type="button" onClick={() => navigate(-1)}>Browser back</button>
            <button type="button" onClick={() => navigate('/company/settings')}>App menu Settings</button>
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
            <UnsavedChangesBoundary>
                <Routes>
                    <Route path="/company/settings" element={<CompanySettings />} />
                    <Route path="/company/dashboard" element={<p>Company dashboard</p>} />
                </Routes>
            </UnsavedChangesBoundary>
            <AddressProbe />
        </MemoryRouter>,
    );
}

describe('CompanySettings shell', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => false);
    });

    it('opens on Company profile, with no Overview page, and names it in the address', () => {
        renderSettings();

        expect(screen.getByRole('button', { name: 'Company profile' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Overview/ })).toBeNull();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?section=company$/);
    });

    it('keeps Company profile and its edit when the window narrows to phone width', () => {
        renderSettings({ path: '/company/dashboard' });
        fireEvent.click(screen.getByRole('button', { name: 'App menu Settings' }));
        // The edit re-renders the page at the narrower width.
        isMobileMock.mockImplementation(() => true);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Unsaved profile edit' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Unsaved profile edit' })).toBeChecked();
        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('identifies the current section and keeps focus on the rail', () => {
        renderSettings();
        const companyProfile = screen.getByRole('button', { name: 'Company profile' });
        const myProfile = screen.getByRole('button', { name: 'My profile' });
        expect(companyProfile).toHaveAttribute('aria-controls', 'company-settings-content');

        fireEvent.click(companyProfile);
        expect(companyProfile).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Company Profile Content' })).toBeInTheDocument();

        myProfile.focus();
        fireEvent.click(myProfile);
        expect(myProfile).toHaveFocus();
        expect(myProfile).toHaveAttribute('aria-current', 'page');
        expect(companyProfile).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('heading', { name: 'Personal Profile Content' })).toBeInTheDocument();
    });

    it('leaves the page heading to each section: one level-1 heading wherever you are', () => {
        renderSettings();
        const labels = ['Company profile', 'Application form', 'Team', 'Email', 'Text messages (SMS)', 'Automated texts', 'API keys', 'Facebook leads', 'Plan', 'My profile'];
        for (const label of labels) {
            fireEvent.click(screen.getByRole('button', { name: label }));
            expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        }
    });

    it('groups the sections under Company, Messaging, Connections and Account', () => {
        renderSettings();
        const nav = screen.getByRole('navigation', { name: 'Company settings sections' });
        expect(within(nav).getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
            .toEqual(['Company', 'Messaging', 'Connections', 'Account']);
    });

    it('supports directional focus navigation across visible settings sections', () => {
        renderSettings();

        const companyProfile = screen.getByRole('button', { name: 'Company profile' });
        const application = screen.getByRole('button', { name: 'Application form' });
        const myProfile = screen.getByRole('button', { name: 'My profile' });

        companyProfile.focus();
        fireEvent.keyDown(companyProfile, { key: 'ArrowDown' });
        expect(application).toHaveFocus();

        fireEvent.keyDown(application, { key: 'End' });
        expect(myProfile).toHaveFocus();
    });

    it('hides Facebook leads with call tracking, and keeps API keys', () => {
        renderSettings({
            currentCompanyProfile: { ...company, features: { callTracking: false } },
        });

        expect(screen.queryByRole('button', { name: 'Facebook leads' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Facebook leads / })).not.toBeInTheDocument();
    });

    it('preserves the company-admin permission redirect', () => {
        renderSettings({
            currentUserClaims: { roles: { 'company-1': 'company_member' } },
        });

        expect(screen.getByText('Company dashboard')).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Company settings sections' })).not.toBeInTheDocument();
    });

    it('has no structural accessibility violations on the first section or another', async () => {
        const { container } = renderSettings();
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('leaving a section with unsaved changes', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => false);
    });

    function openDirtyPlan() {
        renderSettings({ path: '/company/settings?section=billing' });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unsaved edit' }));
    }

    it('moves at once when nothing is changed', () => {
        renderSettings({ path: '/company/settings?section=billing' });

        fireEvent.click(screen.getByRole('button', { name: 'Email' }));

        expect(screen.getByRole('heading', { name: 'Email Content' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks first, and stays when the person keeps editing', () => {
        openDirtyPlan();

        fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

        expect(screen.getByRole('heading', { name: 'Plan Content' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Unsaved edit' })).toBeChecked();
    });

    it('does not ask when the section already shown is chosen again', () => {
        openDirtyPlan();

        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('checkbox', { name: 'Unsaved edit' })).toBeChecked();
    });

    it('moves when the person discards the changes', () => {
        openDirtyPlan();

        fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(screen.getByRole('heading', { name: 'Email Content' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent('section=email');
    });

    /** Company profile first, then Plan with an edit, so the browser's Back leads to Company profile. */
    function openDirtyPlanFromCompanyProfile() {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unsaved edit' }));
    }

    it('asks before the browser Back button leaves the edit, and keeps it on Keep editing', () => {
        openDirtyPlanFromCompanyProfile();

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        expect(screen.getByRole('checkbox', { name: 'Unsaved edit' })).toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

        expect(screen.getByRole('heading', { name: 'Plan Content' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Unsaved edit' })).toBeChecked();
        expect(screen.getByTestId('address')).toHaveTextContent('section=billing');

        // The page the person came from is still one Back away.
        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?section=company$/);
    });

    it('follows the browser Back button once the person discards the changes', () => {
        openDirtyPlanFromCompanyProfile();

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?section=company$/);
    });

    it('follows the browser Back button at once when nothing is changed', () => {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('Settings on a phone', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => true);
    });

    it('shows no rail: a menu of every section is the way in', () => {
        renderSettings({ path: '/company/settings?e2eAuth=company_admin' });

        expect(screen.queryByRole('navigation', { name: 'Company settings sections' })).toBeNull();
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
        for (const label of ['Company profile', 'Application form', 'Team', 'Email', 'Text messages (SMS)', 'Automated texts', 'API keys', 'Facebook leads', 'Plan', 'My profile']) {
            expect(screen.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')} `) })).toBeInTheDocument();
        }
        expect(screen.queryByRole('button', { name: /Overview/ })).toBeNull();
    });

    it('opens the menu for a section this company does not show', () => {
        renderSettings({
            currentCompanyProfile: { ...company, features: { callTracking: false } },
            path: '/company/settings?section=integrations',
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    });

    it('opens a section from its row, and the Settings link returns to the menu keeping the other parameters', () => {
        renderSettings({ path: '/company/settings?e2eAuth=company_admin' });

        fireEvent.click(screen.getByRole('button', { name: /^Plan / }));
        expect(screen.getByRole('heading', { name: 'Plan Content' })).toBeInTheDocument();
        const back = screen.getByRole('link', { name: 'Settings' });
        expect(back).toHaveAttribute('href', '/company/settings?e2eAuth=company_admin');

        fireEvent.click(back);
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?e2eAuth=company_admin$/);
    });

    it('asks before the Settings link leaves unsaved changes', () => {
        renderSettings({ path: '/company/settings?section=billing' });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unsaved edit' }));

        fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

        expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    });

    it('has no structural accessibility violations on the menu or a section', async () => {
        const { container } = renderSettings();
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: /^Plan / }));
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('the settings section in the address', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => false);
    });

    it('opens the section the address names, old links included', () => {
        renderSettings({ path: '/company/settings?section=email' });

        expect(screen.getByRole('heading', { name: 'Email Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-current', 'page');
    });

    it('writes the chosen section into the address, keeping its other parameters', () => {
        renderSettings({ path: '/company/settings?e2eAuth=company_admin' });

        fireEvent.click(screen.getByRole('button', { name: 'Team' }));
        expect(screen.getByTestId('address')).toHaveTextContent('/company/settings?e2eAuth=company_admin&section=team');

        fireEvent.click(screen.getByRole('button', { name: 'Company profile' }));
        expect(screen.getByTestId('address')).toHaveTextContent('/company/settings?e2eAuth=company_admin&section=company');
    });

    it('goes back to the previous section with the browser', () => {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Text messages (SMS)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(screen.getByRole('heading', { name: 'SMS Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Text messages (SMS)' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens Company profile for a section this company does not show', () => {
        renderSettings({
            currentCompanyProfile: { ...company, features: { callTracking: false } },
            path: '/company/settings?section=integrations',
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Company Profile Content' })).toBeInTheDocument();
    });
});
