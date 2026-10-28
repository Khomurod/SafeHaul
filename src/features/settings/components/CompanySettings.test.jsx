import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('./api-keys/ApiKeysTab', () => ({
    ApiKeysTab: () => <h1>API Keys Content</h1>,
}));
vi.mock('../hooks/useSettingsOverview', () => ({
    useSettingsOverview: () => ({ team: { label: '3 people', tone: 'neutral' } }),
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

describe('CompanySettings shell', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => false);
    });

    it('opens on Overview, the way into every section', () => {
        renderSettings();

        const overview = screen.getByRole('button', { name: 'Overview' });
        expect(overview).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        for (const label of ['Company profile', 'Team', 'Email', 'Text messages (SMS)', 'Automated texts', 'API keys', 'Facebook leads', 'Plan', 'My profile']) {
            expect(screen.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')} `) })).toBeInTheDocument();
        }
    });

    it('shows where a section stands on its Overview row', () => {
        renderSettings();

        expect(screen.getByRole('button', { name: /^Team / })).toHaveTextContent('3 people');
        expect(screen.getByRole('button', { name: /^Email / })).not.toHaveTextContent(/people/);
    });

    it('opens a section from an Overview row', () => {
        renderSettings();

        fireEvent.click(screen.getByRole('button', { name: /^Plan / }));

        expect(screen.getByRole('heading', { name: 'Plan Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
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
        const labels = ['Overview', 'Company profile', 'Team', 'Email', 'Text messages (SMS)', 'Automated texts', 'API keys', 'Facebook leads', 'Plan', 'My profile'];
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
        const team = screen.getByRole('button', { name: 'Team' });
        const myProfile = screen.getByRole('button', { name: 'My profile' });

        companyProfile.focus();
        fireEvent.keyDown(companyProfile, { key: 'ArrowDown' });
        expect(team).toHaveFocus();

        fireEvent.keyDown(team, { key: 'End' });
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

    it('has no structural accessibility violations on Overview or a section', async () => {
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

    it('moves when the person discards the changes', () => {
        openDirtyPlan();

        fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(screen.getByRole('heading', { name: 'Email Content' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent('section=email');
    });

    /** Overview first, then Plan with an edit, so the browser's Back leads to Overview. */
    function openDirtyPlanFromOverview() {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unsaved edit' }));
    }

    it('asks before the browser Back button leaves the edit, and keeps it on Keep editing', () => {
        openDirtyPlanFromOverview();

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
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings$/);
    });

    it('follows the browser Back button once the person discards the changes', () => {
        openDirtyPlanFromOverview();

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings$/);
    });

    it('follows the browser Back button at once when nothing is changed', () => {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('Settings on a phone', () => {
    beforeEach(() => {
        useDataMock.mockReset();
        isMobileMock.mockReset();
        isMobileMock.mockImplementation(() => true);
    });

    it('shows no rail: Overview is the way to every section', () => {
        renderSettings({ path: '/company/settings?e2eAuth=company_admin' });

        expect(screen.queryByRole('navigation', { name: 'Company settings sections' })).toBeNull();
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    });

    it('opens a section from its row, and the Settings link returns to Overview keeping the other parameters', () => {
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

    it('has no structural accessibility violations', async () => {
        const { container } = renderSettings({ path: '/company/settings?section=billing' });
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

        fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/company\/settings\?e2eAuth=company_admin$/);
    });

    it('goes back to the previous section with the browser', () => {
        renderSettings();
        fireEvent.click(screen.getByRole('button', { name: 'Text messages (SMS)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(screen.getByRole('heading', { name: 'SMS Content' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Text messages (SMS)' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens Overview for a section this company does not show', () => {
        renderSettings({
            currentCompanyProfile: { ...company, features: { callTracking: false } },
            path: '/company/settings?section=integrations',
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    });
});
