import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: vi.fn(() => ({ showSuccess: vi.fn(), showError: vi.fn() }))
}));
vi.mock('@/context/DataContext', () => ({ useData: vi.fn(() => ({})) }));
vi.mock('./SMSDiagnosticModal', () => ({ SMSDiagnosticModal: () => <div /> }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

let CONFIG_DATA;
let MEMBERSHIPS;       // [{ userId, role }] -> company roster
let USERS;             // roster user docs [{ id, name, email }]
let EXTERNAL_POOL;     // resolvable user docs NOT in the roster [{ id, name, email }]

// Query-aware Firestore mock: resolves the `memberships` query and any `users`
// query (filtered by the documentId() `in` list) from the fixture pools, so it
// handles both the roster fetch and the "resolve missing assignment owner" fetch.
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((...args) => ({ __type: 'doc', path: args.slice(1).join('/') })),
    collection: vi.fn((_db, name) => ({ __col: name })),
    query: vi.fn((col, ...constraints) => ({ col, constraints })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    documentId: vi.fn(() => '__name__'),
    updateDoc: vi.fn(() => Promise.resolve()),
    onSnapshot: (ref, cb) => {
        cb({ exists: () => !!CONFIG_DATA, data: () => CONFIG_DATA });
        return vi.fn();
    },
    getDocs: vi.fn((q) => {
        const colName = q?.col?.__col;
        if (colName === 'memberships') {
            return Promise.resolve({
                docs: MEMBERSHIPS.map(m => ({ id: 'mem_' + m.userId, data: () => m }))
            });
        }
        // users query -> return docs from the pool whose id is in the requested list
        const inC = (q?.constraints || []).find(c => c.op === 'in');
        const ids = inC?.value || [];
        const pool = [...USERS, ...EXTERNAL_POOL];
        const docs = pool
            .filter(u => ids.includes(u.id))
            .map(u => ({ id: u.id, data: () => ({ name: u.name, email: u.email }) }));
        return Promise.resolve({ docs });
    }),
}));

import { httpsCallable } from 'firebase/functions';
import { NumberAssignmentManager } from './NumberAssignmentManager';

beforeEach(() => {
    EXTERNAL_POOL = [];
    vi.clearAllMocks();
});

const userRowSelect = (name) => {
    const row = screen.getByText(name).closest('tr');
    return within(row).getByRole('combobox');
};
// The dropdown's `value` is now a non-phone stable lineId; the visible number lives
// in the selected option's text. Assert on the rendered text instead of the raw value.
const selText = (select) => select.options[select.selectedIndex]?.textContent?.trim() || '';
const rowSelText = (name) => selText(userRowSelect(name));

describe('NumberAssignmentManager — linked-number display', () => {
    it('CASE A: clean E.164 assignment shows the linked number', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { phoneNumber: '+15550000001', usageType: 'DirectNumber' },
                { phoneNumber: '+15550000002', usageType: 'DirectNumber' },
            ],
            defaultPhoneNumber: '+15550000001',
            assignments: { uidTom: '+15550000002' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
    });

    it('CASE B: assignment stored in a different format still matches inventory (no false mismatch)', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000002', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15550000002',
            assignments: { uidTom: '(555) 000-0002' }, // unformatted, no country code
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());

        const row = screen.getByText('Tom Robinson').closest('tr');
        // Resolves to canonical E.164 and matches the inventory entry exactly.
        expect(selText(within(row).getByRole('combobox'))).toContain('+15550000002');
        // ...so it must NOT be flagged as out-of-sync.
        expect(within(row).queryByText('Inventory Mismatch')).not.toBeInTheDocument();
    });

    it('CASE C: configured default not in synced inventory is still shown selected', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15559999999', // configured + sending, but not in inventory
            assignments: {},
        };
        MEMBERSHIPS = [];
        USERS = [];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Company Default Line')).toBeInTheDocument());
        const defaultSelect = screen.getAllByRole('combobox')[0];
        expect(selText(defaultSelect)).toContain('+15559999999');
        expect(screen.getByText(/Missing from sync/)).toBeInTheDocument();
    });

    it('CASE D: default stored in a different format matches inventory and shows selected', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '5550000001', // 10-digit, no +1
            assignments: {},
        };
        MEMBERSHIPS = [];
        USERS = [];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Company Default Line')).toBeInTheDocument());
        const defaultSelect = screen.getAllByRole('combobox')[0];
        expect(selText(defaultSelect)).toContain('+15550000001');
        // matched inventory, so no stale-sync marker
        expect(screen.queryByText(/Missing from sync/)).not.toBeInTheDocument();
    });

    it('CASE F: a "+"-prefixed line without a country code is preserved exactly (keychain safety)', async () => {
        // Backend keychain/inventory store this 10-digit number as "+5550000002" (just a
        // leading +). We must NOT rewrite it to +1..., or it would stop matching the
        // inventory option and line verification would fail.
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+5550000002', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+5550000002',
            assignments: { uidTom: '+5550000002' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        expect(rowSelText('Tom Robinson')).toContain('+5550000002');
        expect(selText(screen.getAllByRole('combobox')[0])).toContain('+5550000002');
        expect(screen.queryByText(/Missing from sync/)).not.toBeInTheDocument();
    });

    it('CASE G: malformed/blank line ("+") resolves to empty (no false assignment)', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+',
            assignments: { uidTom: '+' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        expect(rowSelText('Tom Robinson')).toBe('No Direct Line');
        expect(selText(screen.getAllByRole('combobox')[0])).toContain('Select Default Number');
        expect(screen.queryByText(/Missing from sync/)).not.toBeInTheDocument();
    });

    it('CASE E: empty assignment correctly shows "No Direct Line"', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15550000001',
            assignments: {}, // no assignment for the user
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        expect(rowSelText('Tom Robinson')).toBe('No Direct Line');
    });

    it('CASE H: a line assigned to a uid missing from the roster is still surfaced (resolved user doc)', async () => {
        // Reproduces the production case: assignment keyed by a uid the membership
        // -> users join didn't return, but the user doc is resolvable.
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000002', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15550000002',
            assignments: { '5921L1GIU7Z7O5dq22DuMZ0dzMY2': '+15550000002' },
        };
        MEMBERSHIPS = [{ userId: 'uidNova', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidNova', name: 'Nova', email: 'nova@x.com' }];
        EXTERNAL_POOL = [{ id: '5921L1GIU7Z7O5dq22DuMZ0dzMY2', name: 'Tom Robinson', email: 'tom@raystarllc.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        // The assigned line is now visible on Tom's appended row...
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
        // ...and flagged so the admin understands it's outside the current roster.
        expect(screen.getByText('Not in current team')).toBeInTheDocument();
        // The actual roster member with no line still reads empty.
        expect(rowSelText('Nova')).toBe('No Direct Line');
    });

    it('CASE I: a line assigned to a uid with no user doc shows a placeholder row (still manageable)', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000003', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15550000003',
            assignments: { flBompzYPpVoJbCcooLiSzrFkTH3: '+15550000003' },
        };
        MEMBERSHIPS = [{ userId: 'uidNova', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidNova', name: 'Nova', email: 'nova@x.com' }];
        EXTERNAL_POOL = []; // no user doc resolvable for the assigned uid

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Unknown / former user')).toBeInTheDocument());
        const row = screen.getByText('Unknown / former user').closest('tr');
        expect(selText(within(row).getByRole('combobox'))).toContain('+15550000003');
    });



    it('CASE K: saves redacted selections by token through the backend callable', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        vi.mocked(httpsCallable).mockReturnValue(callable);
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { lineId: 'line_main', phoneNumber: '', label: 'Main Number', usageType: 'DirectNumber' },
                { lineId: 'line_sofia', phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' },
            ],
            defaultPhoneNumber: '',
            assignments: {},
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());

        fireEvent.change(userRowSelect('Tom Robinson'), { target: { value: 'line_sofia' } });
        fireEvent.click(screen.getByText('Save Changes Now'));

        await waitFor(() => expect(callable).toHaveBeenCalledWith({
            companyId: 'c1',
            assignmentTokens: { uidTom: 'line_sofia' }
        }));
    });



    it('CASE L: persisted line tokens keep saved selections visible when phone numbers stay redacted', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { lineId: 'line_main', phoneNumber: '', label: 'Main Number', usageType: 'DirectNumber' },
                { lineId: 'line_sofia', phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' },
            ],
            defaultPhoneNumber: '',
            defaultLineToken: 'line_sofia',
            assignments: { uidTom: '' },
            assignmentLineTokens: { uidTom: 'line_sofia' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());

        expect(selText(screen.getAllByRole('combobox')[0])).toContain('Sofia');
        expect(rowSelText('Tom Robinson')).toContain('Sofia');
    });


    it('CASE M: legacy lnN saved tokens are resolved to stable lineId options after migration', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { lineId: 'line_main', phoneNumber: '', label: 'Main Number', usageType: 'DirectNumber' },
                { lineId: 'line_sofia', phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' },
            ],
            defaultPhoneNumber: '',
            defaultLineToken: 'ln1',
            assignments: { uidTom: '' },
            assignmentLineTokens: { uidTom: 'ln1' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());

        expect(screen.getAllByRole('combobox')[0].value).toBe('line_sofia');
        expect(userRowSelect('Tom Robinson').value).toBe('line_sofia');
    });

    it('CASE J: lines with stripped/empty phone numbers do NOT collapse unassigned rows to the first line', async () => {
        // Simulates a browser/DLP layer that removes phone numbers from the data the page
        // receives: every inventory line arrives with an empty phoneNumber. An unassigned
        // recruiter must still read "No Direct Line" -- not silently show the first line
        // ("Main Number") -- and the options stay distinguishable by their labels.
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { phoneNumber: '', label: 'Main Number', usageType: 'DirectNumber' },
                { phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' },
            ],
            defaultPhoneNumber: '',
            assignments: {},
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        // Must NOT collapse to the first line.
        expect(rowSelText('Tom Robinson')).toBe('No Direct Line');
        // Options remain selectable and distinguishable by label.
        const select = userRowSelect('Tom Robinson');
        const optionTexts = [...select.options].map(o => o.textContent);
        expect(optionTexts.some(t => /Main Number/.test(t))).toBe(true);
        expect(optionTexts.some(t => /Sofia/.test(t))).toBe(true);
    });

    it('CASE N: auto-heals legacy assignments (no line tokens) by calling the backfill once', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        vi.mocked(httpsCallable).mockReturnValue(callable);
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ lineId: 'line_sofia', phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' }],
            assignments: { uidTom: '+15550000002' }, // legacy: assignment present, NO assignmentLineTokens
            defaultPhoneNumber: '',
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        // Auto-heal fires a non-destructive backfill (no assignment changes).
        await waitFor(() => expect(callable).toHaveBeenCalledWith({ companyId: 'c1', assignmentTokens: {} }));
        // ...and only once.
        const backfillCalls = callable.mock.calls.filter(
            ([arg]) => arg && Object.keys(arg.assignmentTokens || {}).length === 0 && !('defaultToken' in arg)
        );
        expect(backfillCalls).toHaveLength(1);
    });

    it('CASE O: does NOT auto-heal when line tokens already exist', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        vi.mocked(httpsCallable).mockReturnValue(callable);
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ lineId: 'line_sofia', phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' }],
            assignments: { uidTom: '' },
            assignmentLineTokens: { uidTom: 'line_sofia' }, // tokens already present
            defaultPhoneNumber: '',
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<NumberAssignmentManager companyId="c1" />);
        await waitFor(() => expect(screen.getByText('Tom Robinson')).toBeInTheDocument());
        await Promise.resolve();
        expect(callable).not.toHaveBeenCalledWith({ companyId: 'c1', assignmentTokens: {} });
    });
});
