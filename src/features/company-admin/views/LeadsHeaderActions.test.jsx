/**
 * The Leads page's header offers Add lead to every staff member and Import
 * leads to a company admin whose company has the feature on: the two menu items
 * they replaced, under the same rules.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const fx = vi.hoisted(() => ({ data: {} }));
vi.mock('@/context/DataContext', () => ({ useData: () => fx.data }));

import { LeadsHeaderActions } from './LeadsHeaderActions';

const COMPANY_ID = 'artificial-company-1';

function Where() {
    return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAs(role, features) {
    fx.data = {
        currentUserClaims: { roles: { [COMPANY_ID]: role } },
        currentCompanyProfile: { id: COMPANY_ID, ...(features ? { features } : {}) },
    };
    return render(
        <MemoryRouter initialEntries={['/company/drivers/leads/company']}>
            <Routes>
                <Route path="*" element={<><LeadsHeaderActions /><Where /></>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('the Leads page header', () => {
    it('offers a company admin both, as links to their pages', () => {
        renderAs('company_admin');

        expect(screen.getByRole('link', { name: 'Add lead' })).toHaveAttribute('href', '/company/quick-add-lead');
        expect(screen.getByRole('link', { name: 'Import leads' })).toHaveAttribute('href', '/company/import-leads');
    });

    it('offers a super admin both', () => {
        fx.data = {
            currentUserClaims: { globalRole: 'super_admin' },
            currentCompanyProfile: { id: COMPANY_ID },
        };
        render(<MemoryRouter><LeadsHeaderActions /></MemoryRouter>);
        expect(screen.getByRole('link', { name: 'Import leads' })).toBeInTheDocument();
    });

    it.each(['recruiter', 'hr_user'])('offers a %s Add lead only', (role) => {
        renderAs(role);

        expect(screen.getByRole('link', { name: 'Add lead' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Import leads' })).not.toBeInTheDocument();
    });

    it("hides Import leads when the company's import feature is off, and only then", () => {
        const { unmount } = renderAs('company_admin', { importLeads: false });
        expect(screen.queryByRole('link', { name: 'Import leads' })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Add lead' })).toBeInTheDocument();
        unmount();

        renderAs('company_admin', { importLeads: true });
        expect(screen.getByRole('link', { name: 'Import leads' })).toBeInTheDocument();
    });

    it('moves within the app on an ordinary click', async () => {
        renderAs('company_admin');

        await userEvent.click(screen.getByRole('link', { name: 'Import leads' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/company/import-leads');
    });

    it('has no structural accessibility violations', async () => {
        const { container } = renderAs('company_admin');
        expect((await axe(container)).violations).toEqual([]);
    });
});
