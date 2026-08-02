import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '@/context/DataContext';
import { CompanySidebar } from './CompanySidebar';

function renderSidebar({
    role = 'company_admin',
    features = {},
    expanded = true,
    onExpandedChange = vi.fn(),
    onNavigate = vi.fn(),
} = {}) {
    const company = { id: 'company-1', companyName: 'Test Logistics', features };
    const claims = { roles: { [company.id]: role } };

    const result = render(
        <MemoryRouter initialEntries={['/company/dashboard']}>
            <DataContext.Provider
                value={{
                    currentCompanyProfile: company,
                    currentUserClaims: claims,
                }}
            >
                <CompanySidebar
                    isExpanded={expanded}
                    onExpandedChange={onExpandedChange}
                    onNavigate={onNavigate}
                />
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

    it('has no structural accessibility violations', async () => {
        const { container } = renderSidebar();
        expect((await axe(container)).violations).toEqual([]);
    });
});
