/**
 * Switching company and logging out both leave the page, so while it holds
 * unsaved changes they ask first. All names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext } from '@/context/DataContext';
import { useUnsavedChanges } from '@/design-system/patterns';
import { UnsavedChangesBoundary } from './UnsavedChangesBoundary';

vi.mock('@features/auth', () => ({ getPortalUser: vi.fn(async () => null) }));
vi.mock('../components/NotificationDropdown', () => ({ NotificationDropdown: () => null }));

import { CompanyTopbar } from './CompanyTopbar';

const handleLogout = vi.fn(async () => {});
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
            <UnsavedChangesBoundary>
                <CompanyTopbar isNavigationOpen={false} onOpenNavigation={vi.fn()} navigationTriggerRef={{ current: null }} />
                {unsaved && <UnsavedEdit />}
            </UnsavedChangesBoundary>
        </DataContext.Provider>,
    );
}

beforeEach(() => {
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
});
