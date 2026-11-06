/**
 * What the company dashboard shows before its numbers and its user's name have
 * arrived, and when they do not arrive: a card never claims a number nobody
 * read, and the greeting never invents a name.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({
    reads: [],
    // When set, every count waits for it: the test settles it before it ends.
    countsGate: null,
    countsFail: false,
    // What `users/uid-1` holds: a name, a document without one, or a failed read.
    portalUser: 'named',
    // A new object per test, so the session's cached profile is not reused.
    user: { uid: 'uid-1', email: 'ann@example.com' },
}));

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

vi.mock('firebase/firestore', () => {
    const record = (kind) => (...args) => ({ kind, args });
    return {
        collection: (_db, ...path) => ({ path: path.join('/') }),
        doc: (_db, ...path) => ({ path: path.join('/') }),
        query: (base, ...constraints) => ({ path: base.path, constraints }),
        where: record('where'),
        orderBy: record('orderBy'),
        limit: record('limit'),
        startAt: record('startAt'),
        startAfter: record('startAfter'),
        endAt: record('endAt'),
        endBefore: record('endBefore'),
        documentId: () => '__name__',
        getDoc: async (ref) => {
            fx.reads.push(`doc ${ref.path}`);
            if (ref.path === 'users/uid-1' && fx.portalUser === 'fails') throw new Error('Network unavailable.');
            const data = ref.path === 'users/uid-1'
                ? (fx.portalUser === 'named' ? { name: 'Ann Admin' } : { email: 'ann@example.com' })
                : null;
            return { exists: () => Boolean(data), data: () => data };
        },
        getDocs: async (q) => {
            fx.reads.push(`docs ${q.path}`);
            return { docs: [], empty: true };
        },
        getCountFromServer: async (q) => {
            fx.reads.push(`count ${q.path}`);
            if (fx.countsGate) await fx.countsGate.promise;
            if (fx.countsFail) throw new Error('Quota exceeded.');
            return { data: () => ({ count: 3 }) };
        },
        addDoc: vi.fn(),
        updateDoc: vi.fn(),
        deleteDoc: vi.fn(),
        setDoc: vi.fn(),
        serverTimestamp: vi.fn(),
        writeBatch: vi.fn(),
    };
});
vi.mock('@lib/firebase', () => ({
    db: {},
    functions: {},
    auth: {
        get currentUser() { return fx.user; },
        onAuthStateChanged: (callback) => {
            callback(fx.user);
            return () => {};
        },
    },
}));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));
// So do the Company setup and Needs attention cards and the hiring brief
// (`CompanyReadinessCard.test.jsx`, `NeedsAttentionCard.test.jsx`, `HiringBrief.test.jsx`).
vi.mock('./CompanyReadinessCard', () => ({ CompanyReadinessCard: () => null }));
vi.mock('./NeedsAttentionCard', () => ({ NeedsAttentionCard: () => null }));
vi.mock('./HiringBrief', () => ({ HiringBrief: () => null }));

import { DataContext } from '@/context/DataContext';
import { ToastProvider } from '@shared/components/feedback/ToastProvider';
import { CompanyAdminDashboard } from './CompanyAdminDashboard';

afterEach(() => {
    Object.assign(fx, {
        reads: [],
        countsGate: null,
        countsFail: false,
        portalUser: 'named',
        user: { uid: 'uid-1', email: 'ann@example.com' },
    });
    vi.restoreAllMocks();
});

const CARDS = ['Applications', 'Company Leads', 'My Leads', 'Hired'];

function renderDashboard() {
    return render(
        <MemoryRouter>
            <DataContext.Provider
                value={{
                    currentCompanyProfile: { id: 'co-1', companyName: 'Example Freight', teamMembers: [] },
                    currentUserClaims: { roles: { 'co-1': 'company_admin' } },
                }}
            >
                <ToastProvider>
                    <CompanyAdminDashboard />
                </ToastProvider>
            </DataContext.Provider>
        </MemoryRouter>,
    );
}

describe('the company dashboard while it loads', () => {
    it('while the counts are on their way, no card claims a number', async () => {
        fx.countsGate = deferred();
        renderDashboard();

        for (const label of CARDS) {
            expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-busy', 'true');
        }
        expect(screen.queryByRole('button', { name: /: 0$/ })).toBeNull();
        expect(screen.getByText('Loading dashboard counts.')).toHaveAttribute('role', 'status');

        await act(async () => { fx.countsGate.resolve(); });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
        for (const label of CARDS) {
            expect(screen.getByRole('button', { name: `${label}: 3` })).not.toHaveAttribute('aria-busy');
        }
        expect(screen.getByText('Dashboard counts loaded.')).toHaveAttribute('role', 'status');
        expect(await screen.findByRole('heading', { name: 'Welcome back, Ann Admin' })).toBeInTheDocument();
    });

    it('a failed first load shows a dash, never 0', async () => {
        fx.countsFail = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        renderDashboard();

        expect(await screen.findByText(/Some dashboard numbers could not load/)).toBeInTheDocument();
        for (const label of CARDS) {
            expect(screen.getByRole('button', { name: `${label}: —` })).not.toHaveAttribute('aria-busy');
        }
        expect(screen.queryByRole('button', { name: /: 0$/ })).toBeNull();
        expect(screen.queryByText('Loading dashboard counts.')).toBeNull();
        expect(await screen.findByRole('heading', { name: 'Welcome back, Ann Admin' })).toBeInTheDocument();
    });
});

describe('the greeting never invents a name', () => {
    it('says only "Welcome back" when the profile has no name', async () => {
        fx.portalUser = 'unnamed';
        renderDashboard();

        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
        await waitFor(() => expect(fx.reads).toContain('doc users/uid-1'));
        await act(async () => {});

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Welcome back$/);
        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.queryByText(/Admin User/)).toBeNull();
    });

    it('says only "Welcome back" when the name cannot be read, and rejects nothing unhandled', async () => {
        fx.portalUser = 'fails';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderDashboard();

        await waitFor(() => expect(warn).toHaveBeenCalledOnce());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.queryByText(/Admin User/)).toBeNull();
    });

    it('greets the user by the name on their profile', async () => {
        renderDashboard();

        expect(await screen.findByRole('heading', { name: 'Welcome back, Ann Admin' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
    });
});
