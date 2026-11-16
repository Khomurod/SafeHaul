/**
 * A super admin switches a company's feature while its team is working in it:
 * the open workspace follows at once, through the listener it already keeps on
 * the company's document, with no reload, no second read and nothing else lost.
 * The real session provider and the sidebar's own offering rule. All ids are
 * artificial.
 */
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ listeners: [], unsubscribed: [], mounts: 0 }));

vi.mock('@lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth, callback) => {
        callback({ uid: 'u-1', getIdTokenResult: async () => ({ claims: { roles: { 'co-1': 'recruiter' } } }) });
        return () => {};
    },
    onIdTokenChanged: () => () => {},
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, collection, id) => ({ path: `${collection}/${id}`, id }),
    getDoc: vi.fn(async ({ id }) => ({
        exists: () => true,
        id,
        data: () => ({ companyName: 'Artificial Co', features: { eDocs: true } }),
    })),
    onSnapshot: vi.fn((ref, next) => {
        const listener = { path: ref.path, next };
        fx.listeners.push(listener);
        return () => fx.unsubscribed.push(listener);
    }),
    collection: vi.fn(),
    getCountFromServer: vi.fn(),
}));
vi.mock('@shared/components/modals', () => ({ CompanyChooserModal: () => <p>Choose Company</p> }));

import { getDoc, onSnapshot } from 'firebase/firestore';
import { DataProvider, useData } from '@/context/DataContext';
import { canOfferCompanyRoute, companyRoute } from '@app/routes/companyRouteAccess';
import { useLiveCompany } from './useLiveCompany';

/** The workspace frame, as `CompanyAppShell` keeps it. */
function Workspace({ children }) {
    const deactivated = useLiveCompany();
    return deactivated ? <p>Deactivated</p> : children;
}

/** A screen in the workspace: the sidebar's E-Docs entry, and a draft the person is typing. */
function Screen() {
    const { currentCompanyProfile } = useData();
    const [draft, setDraft] = useState('');
    useEffect(() => { fx.mounts += 1; }, []);
    const offered = canOfferCompanyRoute(companyRoute('eDocs'), { isCompanyAdmin: false, features: currentCompanyProfile?.features });
    return (
        <>
            <p>{currentCompanyProfile?.companyName}</p>
            <p>{offered ? 'E-Docs offered' : 'E-Docs hidden'}</p>
            <label>Draft<input value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
        </>
    );
}

const emit = (data) => act(() => { fx.listeners.at(-1).next({ exists: () => true, data: () => data }); });

beforeEach(() => {
    localStorage.clear();
    fx.listeners.length = 0;
    fx.unsubscribed.length = 0;
    fx.mounts = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('a feature switched while the workspace is open', () => {
    it('shows or hides at once, without a reload, a remount, a second read or a lost draft', async () => {
        render(<DataProvider><Workspace><Screen /></Workspace></DataProvider>);
        expect(await screen.findByText('E-Docs offered')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Half-typed note' } });
        expect(fx.listeners.map((l) => l.path)).toEqual(['companies/co-1']);

        // The listener's first answer matches what sign-in read: nothing changes.
        emit({ companyName: 'Artificial Co', features: { eDocs: true } });
        expect(screen.getByText('E-Docs offered')).toBeInTheDocument();

        // A super admin switches E-Docs off.
        emit({ companyName: 'Artificial Co', features: { eDocs: false } });
        expect(screen.getByText('E-Docs hidden')).toBeInTheDocument();

        // And on again.
        emit({ companyName: 'Artificial Co', features: { eDocs: true } });
        expect(screen.getByText('E-Docs offered')).toBeInTheDocument();

        expect(screen.getByLabelText('Draft')).toHaveValue('Half-typed note');
        expect(screen.getByText('Artificial Co')).toBeInTheDocument();
        expect(fx.mounts).toBe(1);
        expect(getDoc).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Loading Platform...')).not.toBeInTheDocument();
    });

    it('stops following a company the person leaves, and follows the one they open next', async () => {
        let data;
        function Grab() { data = useData(); return null; }
        render(<DataProvider><Workspace><Screen /><Grab /></Workspace></DataProvider>);
        expect(await screen.findByText('E-Docs offered')).toBeInTheDocument();

        act(() => data.returnToCompanyChooser());
        expect(fx.unsubscribed.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(await screen.findByText('Choose Company')).toBeInTheDocument();

        await act(async () => { await data.loginToCompany('co-2', 'recruiter'); });
        expect(fx.listeners.map((l) => l.path)).toEqual(['companies/co-1', 'companies/co-2']);
        expect(screen.getByText('E-Docs offered')).toBeInTheDocument();

        emit({ companyName: 'Artificial Co', features: { eDocs: false } });
        expect(screen.getByText('E-Docs hidden')).toBeInTheDocument();
        expect(data.currentCompanyProfile.id).toBe('co-2');
    });
});
