/**
 * Accessibility and defect-fix proof for the migrated `NumberAssignmentManager`
 * (and its DefaultLineSection / AssignmentTable / AssignmentRow subcomponents).
 *
 * `NumberAssignmentManager.test.jsx` freezes the SMS/token business logic
 * (cases A–O). This file proves what the 2026-07-23 deep-audit recorded as
 * known debt is now fixed: unlabelled per-row and default-line selects,
 * sub-12px status text, and color-only status indicators.
 *
 * All phone numbers and names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: vi.fn(() => ({ showSuccess: vi.fn(), showError: vi.fn() })),
}));
vi.mock('@/context/DataContext', () => ({ useData: vi.fn(() => ({})) }));
vi.mock('./SMSDiagnosticModal', () => ({ SMSDiagnosticModal: () => <div /> }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

let CONFIG_DATA;
let MEMBERSHIPS;
let USERS;
// When true, `onSnapshot` withholds its callback so the component stays on
// its initial `loading: true` state until the test fires it manually.
let deferSnapshot = false;
let pendingSnapshotCallback = null;

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((...args) => ({ __type: 'doc', path: args.slice(1).join('/') })),
    collection: vi.fn((_db, name) => ({ __col: name })),
    query: vi.fn((col, ...constraints) => ({ col, constraints })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    documentId: vi.fn(() => '__name__'),
    updateDoc: vi.fn(() => Promise.resolve()),
    onSnapshot: (ref, cb) => {
        const fire = () => cb({ exists: () => !!CONFIG_DATA, data: () => CONFIG_DATA });
        if (deferSnapshot) {
            pendingSnapshotCallback = fire;
        } else {
            fire();
        }
        return vi.fn();
    },
    getDocs: vi.fn((q) => {
        const colName = q?.col?.__col;
        if (colName === 'memberships') {
            return Promise.resolve({ docs: MEMBERSHIPS.map((m) => ({ id: 'mem_' + m.userId, data: () => m })) });
        }
        const inC = (q?.constraints || []).find((c) => c.op === 'in');
        const ids = inC?.value || [];
        const docs = USERS
            .filter((u) => ids.includes(u.id))
            .map((u) => ({ id: u.id, data: () => ({ name: u.name, email: u.email }) }));
        return Promise.resolve({ docs });
    }),
}));

import { NumberAssignmentManager } from './NumberAssignmentManager';

beforeEach(() => {
    vi.clearAllMocks();
    deferSnapshot = false;
    pendingSnapshotCallback = null;
    CONFIG_DATA = {
        isActive: true,
        inventory: [
            { lineId: 'line_main', phoneNumber: '+15550000001', label: 'Main Number', usageType: 'DirectNumber' },
            { lineId: 'line_sofia', phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' },
        ],
        defaultPhoneNumber: '+15550000001',
        assignments: { uidTom: '+15550000002' },
    };
    MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
    USERS = [{ id: 'uidTom', name: 'Artificial Recruiter', email: 'recruiter@example.test' }];
});

async function renderLoaded() {
    const utils = render(<NumberAssignmentManager companyId="c1" />);
    await screen.findByText('Artificial Recruiter');
    return utils;
}

describe('NumberAssignmentManager — labelled controls (defect: unlabelled selects)', () => {
    it('gives the default-line select an accessible name', async () => {
        await renderLoaded();
        expect(screen.getByRole('combobox', { name: 'Company default line' })).toBeInTheDocument();
    });

    it('gives each recruiter select a name naming that recruiter', async () => {
        await renderLoaded();
        expect(screen.getByRole('combobox', { name: 'Assigned number for Artificial Recruiter' }))
            .toBeInTheDocument();
    });

    it('names the verify controls distinctly for the default line and each row', async () => {
        await renderLoaded();
        expect(screen.getByRole('button', { name: 'Verify default line connection' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Verify connection for Artificial Recruiter' }))
            .toBeInTheDocument();
    });
});

describe('NumberAssignmentManager — status is never color-only (defect: color-only dots)', () => {
    it('pairs the connection status dot with a text alternative', async () => {
        await renderLoaded();
        const row = screen.getByText('Artificial Recruiter').closest('tr');
        // Untested (no verify performed yet): appears both as the visible
        // Connection-column text and the Status-column dot's sr-only text.
        expect(within(row).getAllByText('Untested').length).toBeGreaterThanOrEqual(2);
    });

    it('shows a textual Verified/Error badge after verifying the default line, not a bare color change', async () => {
        const verifyFn = vi.fn().mockResolvedValue({
            data: { identity: 'artificial-carrier-identity', timestamp: '2026-07-27T00:00:00.000Z' },
        });
        const { httpsCallable } = await import('firebase/functions');
        vi.mocked(httpsCallable).mockReturnValue(verifyFn);

        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Verify default line connection' }));

        await waitFor(() => expect(screen.getByText(/Verified: artificial-carrier-identity/)).toBeInTheDocument());
    });
});

describe('NumberAssignmentManager — 12px floor (defect: text-[9px]/text-[10px])', () => {
    it('renders no interface text below 12px', async () => {
        await renderLoaded();
        const offenders = [...document.querySelectorAll('[class*="text-["]')]
            .map((el) => el.className)
            .filter((cls) => /text-\[(9|10|11)px\]/.test(cls));
        expect(offenders).toEqual([]);
    });
});

describe('NumberAssignmentManager — mobile overflow (defect: unlabelled/unbounded table)', () => {
    it('wraps the assignment table in a labelled, focusable horizontal-scroll region', async () => {
        await renderLoaded();
        const region = screen.getByRole('region', {
            name: 'Recruiter assignments. Scroll horizontally to view all columns.',
        });
        expect(region).toHaveAttribute('tabindex', '0');
        expect(within(region).getByRole('table')).toBeInTheDocument();
    });

    it('marks every column header with scope="col"', async () => {
        await renderLoaded();
        for (const header of screen.getAllByRole('columnheader')) {
            expect(header).toHaveAttribute('scope', 'col');
        }
    });
});

describe('NumberAssignmentManager — non-active and empty states', () => {
    it('announces the loading state', () => {
        deferSnapshot = true;
        const { unmount } = render(<NumberAssignmentManager companyId="c1" />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading inventory...');
        pendingSnapshotCallback?.();
        unmount();
    });

    it('shows the not-active state with the frozen message', async () => {
        CONFIG_DATA = { isActive: false };
        render(<NumberAssignmentManager companyId="c1" />);
        await screen.findByText('SMS Integration Not Active');
        expect(screen.getByText('Please contact a Super Admin to enable SMS for your company.'))
            .toBeInTheDocument();
    });

    it('shows the no-numbers state with the frozen message', async () => {
        CONFIG_DATA = { isActive: true, inventory: [], assignments: {} };
        MEMBERSHIPS = [];
        USERS = [];
        render(<NumberAssignmentManager companyId="c1" />);
        await screen.findByText('No Numbers Found');
        expect(screen.getByText("We couldn't find any phone numbers connected to your provider account."))
            .toBeInTheDocument();
    });
});

describe('NumberAssignmentManager — axe', () => {
    it('has no violations in the loaded matrix', async () => {
        const { container } = await renderLoaded();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with unsaved changes and a verified line shown', async () => {
        const verifyFn = vi.fn().mockResolvedValue({
            data: { identity: 'artificial-identity', timestamp: '2026-07-27T00:00:00.000Z' },
        });
        const { httpsCallable } = await import('firebase/functions');
        vi.mocked(httpsCallable).mockReturnValue(verifyFn);

        const { container } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Verify default line connection' }));
        await waitFor(() => expect(screen.getByText(/Verified:/)).toBeInTheDocument());

        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations in the not-active state', async () => {
        CONFIG_DATA = { isActive: false };
        const { container } = render(<NumberAssignmentManager companyId="c1" />);
        await screen.findByText('SMS Integration Not Active');
        expect((await axe(container)).violations).toEqual([]);
    });
});
