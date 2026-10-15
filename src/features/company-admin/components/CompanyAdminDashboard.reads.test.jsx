/**
 * What the company dashboard reads: its four counts and the signed-in user's
 * name. It shows no list, so it asks for no records, no list counts and no team.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({ reads: [] }));

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
            const data = ref.path === 'users/uid-1' ? { name: 'Ann Admin' } : null;
            return { exists: () => Boolean(data), data: () => data };
        },
        getDocs: async (q) => {
            fx.reads.push(`docs ${q.path}`);
            return { docs: [], empty: true };
        },
        getCountFromServer: async (q) => {
            fx.reads.push(`count ${q.path}`);
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
vi.mock('@lib/firebase', () => {
    const user = { uid: 'uid-1', email: 'ann@example.com' };
    return {
        db: {},
        functions: {},
        auth: {
            currentUser: user,
            onAuthStateChanged: (callback) => {
                callback(user);
                return () => {};
            },
        },
    };
});
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));
// The leaderboard reads its own day of stats, with a suite of its own.
vi.mock('./InlineLeaderboard', () => ({ InlineLeaderboard: () => null }));

import { DataContext } from '@/context/DataContext';
import { ToastProvider } from '@shared/components/feedback/ToastProvider';
import { CompanyAdminDashboard } from './CompanyAdminDashboard';

describe('the company dashboard', () => {
    it('reads its counts and the user’s name, and no records', async () => {
        render(
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

        expect(await screen.findByRole('heading', { name: 'Welcome back, Ann Admin' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
        expect([...fx.reads].sort()).toEqual([
            'count companies/co-1/applications',
            'count companies/co-1/applications',
            'count companies/co-1/leads',
            'count companies/co-1/leads',
            'doc users/uid-1',
        ]);
    });
});
