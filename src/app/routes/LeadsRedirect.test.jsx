/**
 * The menu's Leads item opens the tab a person starts on: All for a company
 * admin, who hands leads out, and Assigned to me for anyone else. Both see all
 * three tabs; this only picks the first.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { DataContext } from '@/context/DataContext';
import { LeadsRedirect } from './LeadsRedirect';

/** Reports where the router actually resolved to, rather than what we hoped. */
function Landed() {
    const { pathname, search, state } = useLocation();
    const navigation = useNavigationType();
    return <div data-testid="landed" data-state={JSON.stringify(state)} data-navigation={navigation}>{`${pathname}${search}`}</div>;
}

function renderAt(entry, role) {
    return render(
        <DataContext.Provider value={{ currentCompanyProfile: { id: 'company-1' }, currentUserClaims: { roles: { 'company-1': role } } }}>
            <MemoryRouter initialEntries={[entry]}>
                <Routes>
                    <Route path="/company/drivers/leads" element={<LeadsRedirect />} />
                    <Route path="/company/drivers/leads/company" element={<Landed />} />
                    <Route path="/company/drivers/leads/my" element={<Landed />} />
                </Routes>
            </MemoryRouter>
        </DataContext.Provider>,
    );
}

describe('the Leads menu item', () => {
    it('opens All for a company admin', async () => {
        renderAt('/company/drivers/leads', 'company_admin');

        expect(await screen.findByTestId('landed')).toHaveTextContent(/^\/company\/drivers\/leads\/company$/);
    });

    it.each(['recruiter', 'hr_user'])('opens Assigned to me for a %s', async (role) => {
        renderAt('/company/drivers/leads', role);

        expect(await screen.findByTestId('landed')).toHaveTextContent(/^\/company\/drivers\/leads\/my$/);
    });

    it('carries the query string and any state a link sent', async () => {
        // `?e2eAuth=company_admin` is how the browser suite signs in.
        renderAt({ pathname: '/company/drivers/leads', search: '?e2eAuth=company_admin', state: { segment: 'new' } }, 'company_admin');

        const landed = await screen.findByTestId('landed');
        expect(landed).toHaveTextContent('/company/drivers/leads/company?e2eAuth=company_admin');
        expect(JSON.parse(landed.dataset.state)).toEqual({ segment: 'new' });
    });

    it('replaces the entry, so Back does not bounce through it', async () => {
        renderAt('/company/drivers/leads', 'recruiter');

        expect((await screen.findByTestId('landed')).dataset.navigation).toBe('REPLACE');
    });
});
