import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '@/context/DataContext';
import { useUnsavedChanges } from '@/design-system/patterns';
import { CompanySidebar } from './CompanySidebar';
import { UnsavedChangesBoundary } from './UnsavedChangesBoundary';

/** A page that holds an unsaved edit, as a Settings section does. */
function UnsavedEdit() {
    useUnsavedChanges(true);
    return null;
}

/** Where the menu has taken the person. */
function Where() {
    const { pathname, search } = useLocation();
    return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderSidebar({
    role = 'company_admin',
    features = {},
    expanded = true,
    onExpandedChange = vi.fn(),
    onNavigate = vi.fn(),
    unsaved = false,
    path = '/company/dashboard',
} = {}) {
    const company = { id: 'company-1', companyName: 'Test Logistics', features };
    const claims = { roles: { [company.id]: role } };

    const result = render(
        <MemoryRouter initialEntries={[path]}>
            <DataContext.Provider
                value={{
                    currentCompanyProfile: company,
                    currentUserClaims: claims,
                }}
            >
                <UnsavedChangesBoundary>
                    <CompanySidebar
                        isExpanded={expanded}
                        onExpandedChange={onExpandedChange}
                        onNavigate={onNavigate}
                    />
                    {unsaved && <UnsavedEdit />}
                    <Where />
                </UnsavedChangesBoundary>
            </DataContext.Provider>
        </MemoryRouter>,
    );

    return { ...result, onExpandedChange, onNavigate };
}

describe('CompanySidebar', () => {
    it('keeps permission and feature-flag decisions inside the feature', () => {
        renderSidebar({
            role: 'recruiter',
            features: { campaignsEnabled: false, eDocs: false, importLeads: false },
        });

        expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Campaigns' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'E-Docs' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Import Leads' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
        expect(screen.getByText('Team Member')).toBeInTheDocument();
    });

    it("leads a company admin into Settings once, through the account section's item", () => {
        renderSidebar({ role: 'company_admin' });

        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/company/settings');
        expect(screen.queryByRole('button', { name: 'Company Settings' })).not.toBeInTheDocument();
        expect(screen.getByText('Company Admin')).toBeInTheDocument();
    });

    it('preserves expandable navigation and route callbacks', () => {
        const onExpandedChange = vi.fn();
        const onNavigate = vi.fn();
        renderSidebar({ expanded: true, onExpandedChange, onNavigate });

        const group = screen.getByRole('button', { name: 'Driver Applications & Leads' });
        expect(group).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(group);
        expect(group).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
        expect(onNavigate).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
        expect(onExpandedChange).toHaveBeenCalledWith(false);
    });

    it('keeps keyboard focus on the link it follows', () => {
        renderSidebar();
        const settings = screen.getByRole('link', { name: 'Settings' });
        settings.focus();

        fireEvent.click(settings);

        // The menu re-rendered for the new page and kept each link in place:
        // the same link is now the current page, and still has focus.
        expect(screen.getByRole('link', { name: 'Settings' })).toBe(settings);
        expect(settings).toHaveAttribute('aria-current', 'page');
        expect(settings).toHaveFocus();
    });

    it('has no structural accessibility violations', async () => {
        const { container } = renderSidebar();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('CompanySidebar while a page holds unsaved changes', () => {
    it('follows a link at once when nothing is unsaved', () => {
        const { onNavigate } = renderSidebar();
        fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('where')).toHaveTextContent('/company/settings');
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('asks first, and stays when the person keeps editing', () => {
        const { onNavigate } = renderSidebar({ unsaved: true });
        fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

        const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/company/dashboard');
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('follows the link when the person discards the changes', () => {
        const { onNavigate } = renderSidebar({ unsaved: true });
        fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(screen.getByTestId('where')).toHaveTextContent('/company/settings');
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('neither asks nor moves for a link to the page already shown', () => {
        const { onNavigate } = renderSidebar({ unsaved: true, path: '/company/settings?section=company' });
        fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('where')).toHaveTextContent(/^\/company\/settings\?section=company$/);
        // The phone drawer still closes.
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('lets a link open in a new tab without asking', () => {
        renderSidebar({ unsaved: true });
        fireEvent.click(screen.getByRole('link', { name: 'Settings' }), { ctrlKey: true });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
