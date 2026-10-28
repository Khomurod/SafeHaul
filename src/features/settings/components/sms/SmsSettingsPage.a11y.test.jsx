/**
 * Accessibility proof for the SMS settings page (`SmsSettingsPage` with its
 * phone-lines table, `AssignmentTable` and setup checklist).
 *
 * `SmsSettingsPage.contract.test.jsx` freezes the SMS/token business logic
 * (cases A–O). This file proves the presentation: every control is named, no
 * text is below 12px, status is words and not colour, both tables become cards
 * on a phone, and axe finds nothing in the loaded, dirty and checklist states.
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
vi.mock('../SMSDiagnosticModal', () => ({ SMSDiagnosticModal: () => <div /> }));
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

import { SmsSettingsPage } from './SmsSettingsPage';

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
    const utils = render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
    await screen.findByRole('combobox', { name: 'Texts from, Artificial Recruiter' });
    return utils;
}

describe('SmsSettingsPage — named controls', () => {
    it('names each member select after that member', async () => {
        await renderLoaded();
        expect(screen.getByRole('combobox', { name: 'Texts from, Artificial Recruiter' })).toBeInTheDocument();
    });

    it('names every line action after its line', async () => {
        await renderLoaded();
        for (const name of ['Check line Main Number', 'Unset Main Number as default', 'Remove line Main Number',
            'Check line Sofia', 'Set Sofia as default', 'Remove line Sofia']) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        }
    });

    it('puts the page actions in the header', async () => {
        await renderLoaded();
        expect(screen.getByRole('heading', { level: 1, name: 'Text messages (SMS)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send a test' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    });
});

describe('SmsSettingsPage — status is words, not colour', () => {
    it('says a line has not been checked, then that it works', async () => {
        const verifyFn = vi.fn(async () => ({
            data: { identity: 'artificial-identity', timestamp: '2026-07-27T00:00:00.000Z' },
        }));
        const { httpsCallable } = await import('firebase/functions');
        vi.mocked(httpsCallable).mockReturnValue(verifyFn);

        await renderLoaded();
        expect(screen.getAllByText('Not checked')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Check line Main Number' }));
        await waitFor(() => expect(screen.getByText('Working')).toBeInTheDocument());
    });
});

describe('SmsSettingsPage — 12px floor', () => {
    it('renders no interface text below 12px', async () => {
        await renderLoaded();
        const offenders = [...document.querySelectorAll('[class*="text-["]')]
            .map((el) => el.className)
            .filter((cls) => /text-\[(9|10|11)px\]/.test(cls));
        expect(offenders).toEqual([]);
    });
});

describe('SmsSettingsPage — tables on a phone', () => {
    it.each([
        ['Phone lines', 'Main Number', ['Used by', 'Status', '']],
        ['Who texts from which line', 'Artificial Recruiter', ['Role', 'Texts from']],
    ])('the %s table becomes cards with every value labelled', async (tableName, rowName, labels) => {
        await renderLoaded();
        const table = screen.getByRole('table', { name: tableName });
        const shell = table.closest('[data-mobile-presentation]');
        expect(shell).toHaveAttribute('data-mobile-presentation', 'cards');
        expect(table).toHaveAttribute('role', 'table');
        for (const header of within(table).getAllByRole('columnheader')) {
            expect(header).toHaveAttribute('scope', 'col');
        }
        const row = within(table).getByRole('rowheader', { name: new RegExp(`^${rowName}`) }).closest('tr');
        expect(row).toHaveAttribute('role', 'row');
        const cells = within(row).getAllByRole('cell');
        expect(cells.map((cell) => cell.getAttribute('data-label') ?? '')).toEqual(labels);
    });
});

describe('SmsSettingsPage — loading and setup states', () => {
    it('announces the loading state', () => {
        deferSnapshot = true;
        const { unmount } = render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading phone lines');
        pendingSnapshotCallback?.();
        unmount();
    });

    it('shows the setup checklist while SMS is not set up', async () => {
        CONFIG_DATA = { isActive: false };
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        const steps = await screen.findByRole('list', { name: 'Setup steps' });
        expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
        expect(screen.getByRole('heading', { level: 2, name: 'Connect RingCentral (to do)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy request for support' })).toBeInTheDocument();
    });

    it('marks done steps as done', async () => {
        CONFIG_DATA = { isActive: true, inventory: [], config: { clientId: 'id', clientSecret: 'set' }, assignments: {} };
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        expect(await screen.findByRole('heading', { level: 2, name: 'Connect RingCentral (done)' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Add your first line (to do)' })).toBeInTheDocument();
    });

    it('says texting is switched off when lines exist but SMS is not active', async () => {
        CONFIG_DATA = { ...CONFIG_DATA, isActive: false };
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        expect(await screen.findByText('Text messaging is switched off')).toBeInTheDocument();
    });
});

describe('SmsSettingsPage — axe', () => {
    it('has no violations on the loaded page', async () => {
        const { container } = await renderLoaded();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with unsaved changes and a checked line shown', async () => {
        const verifyFn = vi.fn(async () => ({
            data: { identity: 'artificial-identity', timestamp: '2026-07-27T00:00:00.000Z' },
        }));
        const { httpsCallable } = await import('firebase/functions');
        vi.mocked(httpsCallable).mockReturnValue(verifyFn);

        const { container } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Check line Main Number' }));
        await waitFor(() => expect(screen.getByText('Working')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Set Sofia as default' }));
        expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument();

        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations on the setup checklist', async () => {
        CONFIG_DATA = { isActive: false };
        const { container } = render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await screen.findByRole('list', { name: 'Setup steps' });
        expect((await axe(container)).violations).toEqual([]);
    });
});
