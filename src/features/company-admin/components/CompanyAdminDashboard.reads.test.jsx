/**
 * What the company dashboard reads: its four counts, the signed-in user's
 * name, the server's "Needs attention" counts (one call, for everyone), the
 * hiring brief's three application counts, and for a company admin the "Company
 * setup" card's few documents and the email settings, once. It shows no list,
 * so it asks for no records, no list counts and no team.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({ reads: [], user: { uid: 'uid-1', email: 'ann@example.com' } }));
const COMPANY_DOC = { contact: { email: 'office@example.com' }, postApplicationTemplates: [{ templateId: 'tpl-1', title: 'W-9' }] };

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
            const data = { 'users/uid-1': { name: 'Ann Admin' }, 'companies/co-1': COMPANY_DOC, 'companies/co-2': COMPANY_DOC }[ref.path] || null;
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
const ATTENTION = { rows: { sealFailed: { status: 'ok', count: 0 } }, windows: {} };
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async () => {
        fx.reads.push(`call ${name}`);
        if (name === 'getDashboardAttention') return { data: ATTENTION };
        return { data: { success: true, settings: { isVerified: true } } };
    },
}));
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

import { DataContext } from '@/context/DataContext';
import { ToastProvider } from '@shared/components/feedback/ToastProvider';
import { CompanyAdminDashboard } from './CompanyAdminDashboard';
import { forgetDashboardAttention } from '../hooks/useDashboardAttention';
import { forgetCompanyReadiness } from '../hooks/useCompanyReadiness';
import { forgetDashboardCounts, forgetHiringBrief } from '@features/companies';
import { DASHBOARD_KEEP_MS } from '@shared/utils/keptAnswer';

function renderDashboard(role, companyId = 'co-1') {
    return render(
        <MemoryRouter>
            <DataContext.Provider
                value={{
                    currentCompanyProfile: { id: companyId, companyName: 'Example Freight', teamMembers: [] },
                    currentUserClaims: { roles: { [companyId]: role } },
                }}
            >
                <ToastProvider>
                    <CompanyAdminDashboard />
                </ToastProvider>
            </DataContext.Provider>
        </MemoryRouter>,
    );
}

const COUNTS_AND_NAME = [
    'count companies/co-1/applications',
    'count companies/co-1/applications',
    'count companies/co-1/leads',
    'count companies/co-1/leads',
    'doc users/uid-1',
];
// This month's applications, those in process and this month's hires: counts, not records.
const BRIEF = Array(3).fill('count companies/co-1/applications');

afterEach(() => {
    fx.reads = [];
    forgetDashboardAttention();
    forgetDashboardCounts();
    forgetHiringBrief();
    forgetCompanyReadiness();
    vi.restoreAllMocks();
});

/** Renders the dashboard and waits until each of its parts has shown what it read. */
async function visit(role, companyId) {
    const view = renderDashboard(role, companyId);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(await screen.findByText('This month’s numbers loaded.')).toBeInTheDocument();
    if (role === 'company_admin') expect(await screen.findByRole('heading', { name: 'Company setup' })).toBeInTheDocument();
    return view;
}

/** What a company admin's visit reads of a company, the user's name aside. */
const companyReads = (companyId) => [
    'call getDashboardAttention',
    'call getEmailSettingsMeta',
    ...Array(5).fill(`count companies/${companyId}/applications`),
    ...Array(2).fill(`count companies/${companyId}/leads`),
    `doc companies/${companyId}`,
    `doc companies/${companyId}/integrations/sms_provider`,
    `doc companies/${companyId}/templates/tpl-1`,
];
const withoutName = (reads) => reads.filter((read) => read !== 'doc users/uid-1').sort();

describe('the company dashboard', () => {
    it('reads its counts, the user’s name, what needs attention and, for an admin, what Company setup needs, and no records', async () => {
        renderDashboard('company_admin');

        expect(await screen.findByRole('heading', { name: 'Welcome back, Ann Admin' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
        // The texting set-up is missing here, so the card lists it.
        expect(await screen.findByRole('heading', { name: 'Company setup' })).toBeInTheDocument();
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        expect(await screen.findByText('This month’s numbers loaded.')).toBeInTheDocument();
        expect([...fx.reads].sort()).toEqual([
            'call getDashboardAttention',
            'call getEmailSettingsMeta',
            ...BRIEF,
            ...COUNTS_AND_NAME.slice(0, 4),
            'doc companies/co-1',
            'doc companies/co-1/integrations/sms_provider',
            'doc companies/co-1/templates/tpl-1',
            'doc users/uid-1',
        ]);
    });

    it('reads its counts, the user’s name and what needs attention for a recruiter, who sees no Company setup', async () => {
        renderDashboard('recruiter');

        await waitFor(() => expect(screen.getByRole('button', { name: 'Hired: 3' })).toBeInTheDocument());
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        expect(await screen.findByText('This month’s numbers loaded.')).toBeInTheDocument();
        await act(async () => {});
        expect(screen.queryByText(/Company setup|Checking company setup/)).toBeNull();
        // The name was read by the test before: the session keeps it.
        expect(fx.reads.filter((read) => read !== 'doc users/uid-1').sort()).toEqual([
            'call getDashboardAttention',
            ...BRIEF,
            ...COUNTS_AND_NAME.slice(0, 4),
        ]);
    });

    it('reads nothing again when opened again within two minutes, and everything after', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        (await visit('company_admin')).unmount();
        expect(withoutName(fx.reads)).toEqual(companyReads('co-1'));

        fx.reads = [];
        now.mockReturnValue(1_000_000 + DASHBOARD_KEEP_MS - 1);
        (await visit('company_admin')).unmount();
        expect(withoutName(fx.reads)).toEqual([]);

        now.mockReturnValue(1_000_000 + DASHBOARD_KEEP_MS);
        await visit('company_admin');
        expect(withoutName(fx.reads)).toEqual(companyReads('co-1'));
    });

    it('reads anew for another company and after another sign-in, never showing what was kept', async () => {
        (await visit('company_admin')).unmount();

        fx.reads = [];
        (await visit('company_admin', 'co-2')).unmount();
        expect(withoutName(fx.reads)).toEqual(companyReads('co-2'));

        fx.reads = [];
        fx.user = { uid: 'uid-1', email: 'ann@example.com' };
        await visit('company_admin', 'co-2');
        expect(withoutName(fx.reads)).toEqual(companyReads('co-2'));
    });
});
