/**
 * Referral Links: who sees which links, and what each action writes. The
 * Firestore calls are recorded, not made. All names are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
    links: {},
    writes: [],
    counts: {},
    claims: {},
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({
        currentCompanyProfile: { id: 'co-1', appSlug: 'artificial-freight', teamMembers: [{ userId: 'rec-1', name: 'Riley Recruiter' }] },
        currentUser: { uid: 'rec-1', email: 'riley@example.test' },
        currentUserClaims: store.claims,
    }),
}));
vi.mock('firebase/firestore', () => {
    const pathOf = (ref) => ref.path;
    return {
        collection: (base, ...segments) => ({ path: [base.path, ...segments].filter(Boolean).join('/') }),
        doc: (base, ...segments) => (segments.length
            ? { path: [base.path, ...segments].filter(Boolean).join('/'), id: segments.at(-1) }
            : { path: `${base.path}/AUTO`, id: 'AUTO' }),
        where: (field, op, value) => ({ field, op, value }),
        query: (ref, ...filters) => ({ path: ref.path, filters }),
        serverTimestamp: () => 'SERVER_TIME',
        getDocs: async (ref) => {
            const filters = ref.filters || [];
            const docs = Object.entries(store.links)
                .filter(([, data]) => filters.every((f) => data[f.field] === f.value))
                .map(([id, data]) => ({ id, data: () => data }));
            return { docs };
        },
        getCountFromServer: async (ref) => {
            const key = [pathOf(ref).split('/').pop(), ...ref.filters.map((f) => `${f.field}=${f.value}`)].join('|');
            return { data: () => ({ count: store.counts[key] ?? 0 }) };
        },
        runTransaction: async (_db, run) => {
            const sets = [];
            await run({
                get: async (ref) => ({ exists: () => Boolean(store.links[ref.id]) }),
                set: (ref, data) => sets.push([ref, data]),
            });
            for (const [ref, data] of sets) {
                store.writes.push({ kind: 'set', path: ref.path, data });
                store.links[ref.id] = { ...data, createdAt: { toDate: () => new Date('2026-10-23T12:00:00Z') } };
            }
        },
        updateDoc: async (ref, data) => {
            store.writes.push({ kind: 'update', path: ref.path, data });
            store.links[ref.id] = { ...store.links[ref.id], ...data };
        },
    };
});

import { ReferralLinksPage } from './ReferralLinksPage';

const at = (iso) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });
const MINE = { companyId: 'co-1', code: 'ABCD2345', referrerName: 'Rita Referrer', referrerPhone: '555-0100', createdBy: 'rec-1', createdByName: 'Riley Recruiter', active: true, createdAt: at('2026-10-20T12:00:00Z') };
const THEIRS = { companyId: 'co-1', code: 'WXYZ6789', referrerName: 'Sam Sender', createdBy: 'rec-2', createdByName: 'Robin', active: true, createdAt: at('2026-10-21T12:00:00Z') };

beforeEach(() => {
    vi.clearAllMocks();
    store.links = { ABCD2345: { ...MINE }, WXYZ6789: { ...THEIRS } };
    store.writes = [];
    store.counts = {
        'leads|referral.code=ABCD2345': 3,
        'applications|referral.code=ABCD2345': 2,
        'applications|referral.code=ABCD2345|status=Hired': 1,
    };
    store.claims = { roles: { 'co-1': 'recruiter' } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('Referral Links', () => {
    it('shows a recruiter their own links, with what each brought in', async () => {
        const { container } = render(<ReferralLinksPage />);

        const row = (await screen.findByText('Rita Referrer')).closest('tr');
        expect(screen.queryByText('Sam Sender')).toBeNull();
        await waitFor(() => expect(within(row).getByText('3 leads · 2 applications · 1 hired')).toBeInTheDocument());
        expect(within(row).getByText('ABCD2345')).toBeInTheDocument();
        expect(screen.getByText('You see the links you made.')).toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('shows a Company Admin every link in the company', async () => {
        store.claims = { roles: { 'co-1': 'company_admin' } };
        render(<ReferralLinksPage />);

        expect(await screen.findByText('Sam Sender')).toBeInTheDocument();
        expect(screen.getByText('Rita Referrer')).toBeInTheDocument();
    });

    it('creates a link under a fresh code, as its creator, with the referring driver', async () => {
        render(<ReferralLinksPage />);
        await screen.findByText('Rita Referrer');

        fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
        expect(await within(dialog).findByText('Enter the referring driver’s name.')).toBeInTheDocument();
        expect(store.writes).toEqual([]);

        fireEvent.change(within(dialog).getByRole('textbox', { name: /Referring driver’s name/ }), { target: { value: '  Pat   Pointer ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

        await waitFor(() => expect(store.writes).toHaveLength(1));
        const [write] = store.writes;
        expect(write.path).toMatch(/^companies\/co-1\/referral_links\/[A-HJ-NP-Z2-9]{8}$/);
        expect(write.data).toEqual({
            companyId: 'co-1', code: write.path.split('/').pop(), referrerName: 'Pat Pointer',
            createdBy: 'rec-1', createdByName: 'Riley Recruiter', active: true, createdAt: 'SERVER_TIME',
        });
        expect(await screen.findByText('Pat Pointer')).toBeInTheDocument();
    });

    it('copies the public link with the code', async () => {
        render(<ReferralLinksPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Copy the link for Rita Referrer' }));

        await waitFor(() => expect(navigator.clipboard.writeText)
            .toHaveBeenCalledWith(`${window.location.origin}/apply/artificial-freight?ref=ABCD2345`));
        expect(toast.showSuccess).toHaveBeenCalledWith('The link for Rita Referrer is copied.');
    });

    it('switches a link off after asking, and offers nothing more for it', async () => {
        render(<ReferralLinksPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate the link for Rita Referrer' }));
        const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

        await waitFor(() => expect(store.writes).toEqual([
            { kind: 'update', path: 'companies/co-1/referral_links/ABCD2345', data: { active: false, deactivatedAt: 'SERVER_TIME' } },
        ]));
        const row = (await screen.findByText('Deactivated')).closest('tr');
        expect(within(row).queryByRole('button', { name: /Copy/ })).toBeNull();
        expect(within(row).queryByRole('button', { name: /Deactivate/ })).toBeNull();
    });
});
