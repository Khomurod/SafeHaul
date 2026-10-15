/**
 * The company chooser reads the companies of a member of several side by side,
 * so it waits for the slowest read, not for all of them in turn. The list keeps
 * the order of the memberships, and a company that cannot be read is left out.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    // One object for every render: the chooser reads again when the claims change.
    claims: { roles: { 'co-a': 'company_admin', 'co-b': 'recruiter', 'co-c': 'recruiter', globalRole: 'none' } },
    reads: new Map(),
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentUserClaims: fx.claims, loginToCompany: () => {}, handleLogout: () => {} }),
}));
vi.mock('@features/companies/services/companyService', () => ({
    getCompanyProfile: (companyId) => new Promise((resolve) => { fx.reads.set(companyId, resolve); }),
}));

import { CompanyChooserModal } from './CompanyChooserModal';

describe('the company chooser', () => {
    it('reads every company at once, and lists them in the order of the memberships', async () => {
        render(<CompanyChooserModal />);
        expect([...fx.reads.keys()]).toEqual(['co-a', 'co-b', 'co-c']);

        fx.reads.get('co-c')({ id: 'co-c', companyName: 'Artificial Carrier C' });
        fx.reads.get('co-b')(null);
        fx.reads.get('co-a')({ id: 'co-a', companyName: 'Artificial Carrier A' });

        const list = screen.getByRole('region', { name: 'Choose Company' });
        expect(await within(list).findByText('Artificial Carrier C')).toBeInTheDocument();
        expect(within(list).getAllByRole('button').map((row) => row.textContent)).toEqual([
            expect.stringContaining('Artificial Carrier A'),
            expect.stringContaining('Artificial Carrier C'),
        ]);
    });
});
