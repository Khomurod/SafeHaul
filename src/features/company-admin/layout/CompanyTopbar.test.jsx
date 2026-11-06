/**
 * Switching company, logging out and opening E-Docs or the reader's leads from
 * the bell all leave the page, so while it holds unsaved changes they ask
 * first. All names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext } from '@/context/DataContext';
import { useUnsavedChanges } from '@/design-system/patterns';
import { UnsavedChangesBoundary } from './UnsavedChangesBoundary';

const auth = vi.hoisted(() => {
    const listeners = new Set();
    return {
        profile: null,
        listeners,
        forget: (userId) => listeners.forEach((listener) => listener(userId)),
    };
});
vi.mock('@features/auth', () => ({
    getPortalUser: vi.fn(async () => auth.profile),
    onPortalUserForgotten: (listener) => {
        auth.listeners.add(listener);
        return () => auth.listeners.delete(listener);
    },
}));
// The bell, reduced to the moves it makes off the page.
vi.mock('../components/NotificationDropdown', () => ({
    NotificationDropdown: ({ onOpenDocuments, onOpenAssignedLeads }) => (
        <>
            <button type="button" onClick={onOpenDocuments}>Bell: open E-Docs</button>
            <button type="button" onClick={onOpenAssignedLeads}>Bell: open my leads</button>
        </>
    ),
}));

import { CompanyTopbar } from './CompanyTopbar';

let logoutWorks;
const handleLogout = vi.fn(async () => logoutWorks);
const returnToCompanyChooser = vi.fn();

function UnsavedEdit() {
    useUnsavedChanges(true);
    return null;
}

function renderTopbar({ unsaved = false } = {}) {
    return render(
        <DataContext.Provider
            value={{
                currentUser: { uid: 'user-1', email: 'admin@example.test' },
                currentCompanyProfile: { id: 'company-1', companyName: 'Artificial Freight' },
                currentUserClaims: { roles: { 'company-1': 'company_admin' } },
                handleLogout,
                returnToCompanyChooser,
            }}
        >
            <MemoryRouter initialEntries={['/company/dashboard']}>
                <UnsavedChangesBoundary>
                    <CompanyTopbar isNavigationOpen={false} onOpenNavigation={vi.fn()} navigationTriggerRef={{ current: null }} />
                    {unsaved && <UnsavedEdit />}
                    <Routes>
                        <Route path="/company/dashboard" element={<p>Dashboard page</p>} />
                        <Route path="/company/e-docs" element={<p>E-Docs page</p>} />
                        <Route path="/company/drivers/leads/my" element={<p>Assigned to me page</p>} />
                        <Route path="/company/profile" element={<p>Profile page</p>} />
                    </Routes>
                </UnsavedChangesBoundary>
            </MemoryRouter>
        </DataContext.Provider>,
    );
}

beforeEach(() => {
    auth.profile = null;
    logoutWorks = true;
    handleLogout.mockClear();
    returnToCompanyChooser.mockClear();
});

describe('CompanyTopbar leaving the page', () => {
    it('switches company and logs out at once when nothing is unsaved', async () => {
        renderTopbar();
        fireEvent.click(screen.getByRole('button', { name: 'Switch company' }));
        expect(returnToCompanyChooser).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
        await waitFor(() => expect(handleLogout).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks before switching company, and stays on Keep editing', () => {
        renderTopbar({ unsaved: true });
        fireEvent.click(screen.getByRole('button', { name: 'Switch company' }));

        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(returnToCompanyChooser).not.toHaveBeenCalled();
    });

    it('logs out once the person discards the changes', async () => {
        renderTopbar({ unsaved: true });
        fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
        expect(handleLogout).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        await waitFor(() => expect(handleLogout).toHaveBeenCalledTimes(1));
    });

    it('opens E-Docs from the bell at once when nothing is unsaved', () => {
        renderTopbar();
        fireEvent.click(screen.getByRole('button', { name: 'Bell: open E-Docs' }));
        expect(screen.getByText('E-Docs page')).toBeInTheDocument();
    });

    it('asks before opening E-Docs from the bell, and stays on Keep editing', () => {
        renderTopbar({ unsaved: true });
        fireEvent.click(screen.getByRole('button', { name: 'Bell: open E-Docs' }));

        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(screen.getByText('Dashboard page')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Bell: open E-Docs' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(screen.getByText('E-Docs page')).toBeInTheDocument();
    });

    it("opens the reader's Assigned to me list from an import's Leads Assigned", () => {
        renderTopbar();
        fireEvent.click(screen.getByRole('button', { name: 'Bell: open my leads' }));
        expect(screen.getByText('Assigned to me page')).toBeInTheDocument();
    });

    it('asks before opening the leads from the bell, and stays on Keep editing', () => {
        renderTopbar({ unsaved: true });
        fireEvent.click(screen.getByRole('button', { name: 'Bell: open my leads' }));

        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(screen.getByText('Dashboard page')).toBeInTheDocument();
    });

    it('guards the page again when logging out fails', async () => {
        logoutWorks = false;
        renderTopbar({ unsaved: true });
        fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        await waitFor(() => expect(handleLogout).toHaveBeenCalledTimes(1));

        // The page is still here with its edit, so closing the tab asks again.
        await waitFor(() => {
            const unload = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(unload);
            expect(unload.defaultPrevented).toBe(true);
        });
    });
});

describe('CompanyTopbar: the name and avatar open Profile', () => {
    const profileLink = () => screen.getByRole('link', { name: /^Your profile/ });

    it('is a link to Profile, named for it and for who is signed in', async () => {
        renderTopbar();
        // The name arrives from the profile read, the role from the claims.
        await waitFor(() => expect(profileLink()).toHaveAccessibleName('Your profile: admin Company Admin'));
        expect(profileLink()).toHaveAttribute('href', '/company/profile');
    });

    it('shows a name saved on Profile without a reload', async () => {
        auth.profile = { name: 'Old Name' };
        renderTopbar();
        await waitFor(() => expect(profileLink()).toHaveAccessibleName('Your profile: Old Name Company Admin'));

        // Profile saves the name, then forgets the kept profile.
        auth.profile = { name: 'New Name' };
        auth.forget('user-1');

        await waitFor(() => expect(profileLink()).toHaveAccessibleName('Your profile: New Name Company Admin'));
    });

    it('opens Profile in place on a plain press', () => {
        renderTopbar();
        fireEvent.click(profileLink());
        expect(screen.getByText('Profile page')).toBeInTheDocument();
    });

    it('leaves a modified press to the browser (a new tab)', () => {
        renderTopbar();
        const press = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
        profileLink().dispatchEvent(press);
        expect(screen.getByText('Dashboard page')).toBeInTheDocument();
        expect(press.defaultPrevented).toBe(false);
    });

    it('asks before leaving unsaved changes, and stays on Keep editing', () => {
        renderTopbar({ unsaved: true });
        fireEvent.click(profileLink());

        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(screen.getByText('Dashboard page')).toBeInTheDocument();

        fireEvent.click(profileLink());
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(screen.getByText('Profile page')).toBeInTheDocument();
    });
});
