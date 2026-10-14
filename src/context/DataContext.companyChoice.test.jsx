/**
 * Which company a staff member lands in after signing in: the one chosen last
 * if they still belong to it, else the only one they belong to, else they choose.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ claims: null, companies: [] }));

vi.mock('@lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth, callback) => {
        callback({ uid: 'u-1', getIdTokenResult: async () => ({ claims: session.claims }) });
        return () => {};
    },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, _collection, id) => ({ id }),
    getDoc: vi.fn(async ({ id }) => ({
        exists: () => session.companies.includes(id),
        id,
        data: () => ({ companyName: `Carrier ${id}` }),
    })),
    collection: vi.fn(),
    getCountFromServer: vi.fn(),
}));
vi.mock('@shared/components/modals', () => ({ CompanyChooserModal: () => <p>Choose Company</p> }));

import { getDoc } from 'firebase/firestore';
import { DataProvider, useData } from './DataContext';
import { SESSION_KEYS } from './dataContext/sessionKeys';

function SignedInCompany() {
    const { currentCompanyProfile } = useData();
    return <p>In {currentCompanyProfile?.id ?? 'no company'}</p>;
}

function signIn(roles, saved) {
    session.claims = { roles };
    if (saved) localStorage.setItem(SESSION_KEYS.SELECTED_COMPANY_ID, saved);
    render(<DataProvider><SignedInCompany /></DataProvider>);
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    session.companies = ['co-1', 'co-2', 'co-gone'];
});

describe('after signing in, a staff member', () => {
    it('goes straight into their only company', async () => {
        signIn({ 'co-1': 'recruiter' });

        expect(await screen.findByText('In co-1')).toBeInTheDocument();
        expect(screen.queryByText('Choose Company')).not.toBeInTheDocument();
    });

    it('chooses when they belong to more than one', async () => {
        signIn({ 'co-1': 'recruiter', 'co-2': 'company_admin' });

        expect(await screen.findByText('Choose Company')).toBeInTheDocument();
        expect(screen.getByText('In no company')).toBeInTheDocument();
    });

    it('goes back into the company they chose last', async () => {
        signIn({ 'co-1': 'recruiter', 'co-2': 'company_admin' }, 'co-2');

        expect(await screen.findByText('In co-2')).toBeInTheDocument();
        expect(screen.queryByText('Choose Company')).not.toBeInTheDocument();
    });

    it('is not taken into a company they no longer belong to', async () => {
        signIn({ 'co-1': 'recruiter' }, 'co-gone');

        expect(await screen.findByText('In co-1')).toBeInTheDocument();
        expect(getDoc).not.toHaveBeenCalledWith({ id: 'co-gone' });
    });

    it('chooses when the company chosen last is no longer theirs and several are', async () => {
        signIn({ 'co-1': 'recruiter', 'co-2': 'hr_user' }, 'co-gone');

        expect(await screen.findByText('Choose Company')).toBeInTheDocument();
        expect(getDoc).not.toHaveBeenCalled();
    });
});
