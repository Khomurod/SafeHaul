import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: vi.fn(() => toast)
}));
vi.mock('@/context/DataContext', () => ({ useData: vi.fn(() => ({})) }));
vi.mock('../SMSDiagnosticModal', () => ({ SMSDiagnosticModal: () => <div /> }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

let CONFIG_DATA;
let MEMBERSHIPS;       // [{ userId, role }] -> company roster
let USERS;             // roster user docs [{ id, name, email }]
let EXTERNAL_POOL;     // resolvable user docs NOT in the roster [{ id, name, email }]
let ROSTER_FAILURES;   // how many `listCompanyTeam` calls fail before one answers

// The roster as `listCompanyTeam` answers it: each membership with its profile.
const listCompanyTeam = vi.fn(async () => {
    if (ROSTER_FAILURES > 0) {
        ROSTER_FAILURES -= 1;
        throw new Error('unavailable');
    }
    return {
        data: {
            members: MEMBERSHIPS.map((m) => {
                const user = USERS.find((u) => u.id === m.userId) || {};
                return { id: m.userId, role: m.role, name: user.name || '', email: user.email || '' };
            }),
        },
    };
});

// Query-aware Firestore mock: resolves any `users` query (filtered by the
// documentId() `in` list) from the fixture pools, for the "resolve missing
// assignment owner" fetch. The roster itself comes from `listCompanyTeam`.
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
import { SmsSettingsPage } from './SmsSettingsPage';

// Every callable but the roster answers with `callable`.
const serve = (callable = vi.fn()) => vi.mocked(httpsCallable)
    .mockImplementation((_functions, name) => (name === 'listCompanyTeam' ? listCompanyTeam : callable));

beforeEach(() => {
    EXTERNAL_POOL = [];
    ROSTER_FAILURES = 0;
    vi.clearAllMocks();
    serve();
});

const userRowSelect = (name) => screen.getByRole('combobox', { name: `Texts from, ${name}` });
const findMember = (name) => screen.findByRole('combobox', { name: `Texts from, ${name}` });
// The phone-lines table marks the default line with a "Default" badge.
const defaultRows = () => within(screen.getByRole('table', { name: 'Phone lines' }))
    .getAllByRole('row')
    .filter((row) => within(row).queryByText('Default', { exact: true }));
// The dropdown's `value` is now a non-phone stable lineId; the visible number lives
// in the selected option's text. Assert on the rendered text instead of the raw value.
const selText = (select) => select.options[select.selectedIndex]?.textContent?.trim() || '';
const rowSelText = (name) => selText(userRowSelect(name));

describe('SmsSettingsPage — linked-number display (frozen token model)', () => {
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        // Resolves to canonical E.164 and matches the inventory entry exactly...
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
        // ...so it must NOT be flagged as out-of-sync.
        expect(screen.queryByText(/Missing from sync/)).not.toBeInTheDocument();
    });

    it('CASE C: configured default not in synced inventory is still shown, as a warning', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000001', usageType: 'DirectNumber' }],
            defaultPhoneNumber: '+15559999999', // configured + sending, but not in inventory
            assignments: {},
        };
        MEMBERSHIPS = [];
        USERS = [];

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await screen.findByRole('table', { name: 'Phone lines' });
        expect(screen.getByText(/\+15559999999 is the default line, but it is missing from the synced lines/)).toBeInTheDocument();
        expect(defaultRows()).toHaveLength(0);
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await screen.findByRole('table', { name: 'Phone lines' });
        expect(defaultRows()).toHaveLength(1);
        expect(defaultRows()[0]).toHaveTextContent('+15550000001');
        // matched inventory, so no stale-sync warning
        expect(screen.queryByText(/missing from the synced lines/)).not.toBeInTheDocument();
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        expect(rowSelText('Tom Robinson')).toContain('+5550000002');
        expect(defaultRows()[0]).toHaveTextContent('+5550000002');
        expect(screen.queryByText(/Missing from sync|missing from the synced lines/)).not.toBeInTheDocument();
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        expect(rowSelText('Tom Robinson')).toBe('Default line');
        expect(defaultRows()).toHaveLength(0);
        expect(screen.queryByText(/Missing from sync|missing from the synced lines/)).not.toBeInTheDocument();
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        expect(rowSelText('Tom Robinson')).toBe('Default line');
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        // The assigned line is now visible on Tom's appended row...
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
        // ...and flagged so the admin understands it's outside the current roster.
        expect(userRowSelect('Tom Robinson').closest('tr')).toHaveTextContent('Former member');
        // The actual roster member with no line still reads empty.
        expect(rowSelText('Nova')).toBe('Default line');
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Unknown / former user');
        expect(rowSelText('Unknown / former user')).toContain('+15550000003');
    });

    it('lists the team as the server resolves it, never reading memberships from the browser', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000002', usageType: 'DirectNumber' }],
            assignments: { uidTom: '+15550000002' },
        };
        MEMBERSHIPS = [
            { userId: 'uidTom', companyId: 'c1', role: 'hr_user' },
            { userId: 'uidNova', companyId: 'c1', role: 'company_admin' },
        ];
        USERS = [
            { id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' },
            { id: 'uidNova', name: 'Nova', email: 'nova@x.com' },
        ];
        const { getDocs } = await import('firebase/firestore');

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
        expect(rowSelText('Nova')).toBe('Default line');
        expect(listCompanyTeam).toHaveBeenCalledWith({ companyId: 'c1' });
        expect(vi.mocked(getDocs)).not.toHaveBeenCalled();
        expect(screen.queryByText('Former member')).not.toBeInTheDocument();
    });

    it('says when the team could not load, marks nobody as a former member, and retries', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ phoneNumber: '+15550000002', usageType: 'DirectNumber' }],
            assignments: { uidTom: '+15550000002' },
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'hr_user' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];
        ROSTER_FAILURES = 1;

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        expect(await screen.findByText("Couldn't load your team")).toBeInTheDocument();
        expect(screen.queryByText(/Unknown \/ former user|Former member/)).not.toBeInTheDocument();

        // Who uses each line is not known either: no line reads "Nobody".
        const lines = screen.getByRole('table', { name: 'Phone lines' });
        expect(within(lines).getByText('Not known')).toBeInTheDocument();
        expect(within(lines).queryByText('Nobody')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await findMember('Tom Robinson');
        expect(within(lines).queryByText('Not known')).toBeNull();
        expect(rowSelText('Tom Robinson')).toContain('+15550000002');
        expect(screen.queryByText("Couldn't load your team")).not.toBeInTheDocument();
    });



    it('CASE K: saves redacted selections by token through the backend callable', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        serve(callable);
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.change(userRowSelect('Tom Robinson'), { target: { value: 'line_sofia' } });
        fireEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }));

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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        expect(defaultRows()).toHaveLength(1);
        expect(within(defaultRows()[0]).getByRole('rowheader')).toHaveTextContent('Sofia');
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        expect(within(defaultRows()[0]).getByRole('rowheader')).toHaveTextContent('Sofia');
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

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        // Must NOT collapse to the first line.
        expect(rowSelText('Tom Robinson')).toBe('Default line');
        // Options remain selectable and distinguishable by label.
        const select = userRowSelect('Tom Robinson');
        const optionTexts = [...select.options].map(o => o.textContent);
        expect(optionTexts.some(t => /Main Number/.test(t))).toBe(true);
        expect(optionTexts.some(t => /Sofia/.test(t))).toBe(true);
    });

    it('CASE N: auto-heals legacy assignments (no line tokens) by calling the backfill once', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        serve(callable);
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ lineId: 'line_sofia', phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' }],
            assignments: { uidTom: '+15550000002' }, // legacy: assignment present, NO assignmentLineTokens
            defaultPhoneNumber: '',
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
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
        serve(callable);
        CONFIG_DATA = {
            isActive: true,
            inventory: [{ lineId: 'line_sofia', phoneNumber: '', label: 'Sofia', usageType: 'DirectNumber' }],
            assignments: { uidTom: '' },
            assignmentLineTokens: { uidTom: 'line_sofia' }, // tokens already present
            defaultPhoneNumber: '',
        };
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'company_admin' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];

        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        await Promise.resolve();
        expect(callable).not.toHaveBeenCalledWith({ companyId: 'c1', assignmentTokens: {} });
    });
});

describe('SmsSettingsPage — default line, save bar and removal', () => {
    const twoLines = () => ({
        isActive: true,
        inventory: [
            { lineId: 'line_main', phoneNumber: '+15550000001', label: 'Main Number', usageType: 'DirectNumber' },
            { lineId: 'line_sofia', phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' },
        ],
        defaultPhoneNumber: '(555) 000-0001', // stored unformatted: still not a change
        defaultLineToken: 'line_main',
        assignments: { uidTom: '+15550000002' },
        assignmentLineTokens: { uidTom: 'line_sofia' },
    });
    const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

    beforeEach(() => {
        CONFIG_DATA = twoLines();
        MEMBERSHIPS = [{ userId: 'uidTom', companyId: 'c1', role: 'hr_user' }];
        USERS = [{ id: 'uidTom', name: 'Tom Robinson', email: 'tom@x.com' }];
    });

    it('shows no save bar on load when the default is stored in another format', async () => {
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        expect(saveBar()).not.toBeInTheDocument();
    });

    it('says who texts from each line, the default line covering everyone else', async () => {
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');
        const table = screen.getByRole('table', { name: 'Phone lines' });
        const row = (name) => within(table).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('tr');
        expect(row('Main Number')).toHaveTextContent('Everyone');
        expect(row('Sofia')).toHaveTextContent('Tom Robinson');
        expect(rowSelText('Tom Robinson')).toContain('Sofia');
        expect(within(userRowSelect('Tom Robinson').closest('tr')).getByText('Recruiter')).toBeInTheDocument();
    });

    it('saves a new default line by its token', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        serve(callable);
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.click(screen.getByRole('button', { name: 'Set Sofia as default' }));
        expect(saveBar()).toHaveTextContent('Default line changed');
        expect(defaultRows()[0]).toHaveTextContent('Sofia');
        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(callable).toHaveBeenCalledWith({
            companyId: 'c1', assignmentTokens: {}, defaultToken: 'line_sofia',
        }));
    });

    it('saves "no default line" as an empty token', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true } }));
        serve(callable);
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.click(screen.getByRole('button', { name: 'Unset Main Number as default' }));
        expect(defaultRows()).toHaveLength(0);
        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(callable).toHaveBeenCalledWith({
            companyId: 'c1', assignmentTokens: {}, defaultToken: '',
        }));
    });

    it('names the member who changed and puts every edit back on Discard', async () => {
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.change(userRowSelect('Tom Robinson'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Set Sofia as default' }));
        expect(saveBar()).toHaveTextContent('1 change · Tom Robinson · Default line changed');

        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Discard' }));
        expect(saveBar()).not.toBeInTheDocument();
        expect(rowSelText('Tom Robinson')).toContain('Sofia');
        expect(within(defaultRows()[0]).getByRole('rowheader')).toHaveTextContent('Main Number');
    });

    it('asks before removing a line and removes it by the number as stored', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { success: true, message: 'Removed.' } }));
        serve(callable);
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.click(screen.getByRole('button', { name: 'Remove line Sofia' }));
        const dialog = screen.getByRole('dialog', { name: 'Remove phone line?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove line' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(httpsCallable).toHaveBeenCalledWith({}, 'removePhoneLine');
        expect(callable).toHaveBeenCalledWith({ companyId: 'c1', phoneNumber: '+15550000002' });
    });

    it('checks a line through verifyLineConnection and shows the result in words', async () => {
        const callable = vi.fn(() => Promise.resolve({ data: { identity: 'artificial-identity', timestamp: '2026-07-27T00:00:00.000Z' } }));
        serve(callable);
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await findMember('Tom Robinson');

        fireEvent.click(screen.getByRole('button', { name: 'Check line Sofia' }));
        await waitFor(() => expect(screen.getByText('Working')).toBeInTheDocument());
        expect(callable).toHaveBeenCalledWith({ companyId: 'c1', phoneNumber: '+15550000002' });
    });
});

describe('SmsSettingsPage — one removal at a time, and the support request', () => {
    beforeEach(() => {
        MEMBERSHIPS = [];
        USERS = [];
    });

    it('ignores a second removal while the first is still running', async () => {
        CONFIG_DATA = {
            isActive: true,
            inventory: [
                { lineId: 'line_main', phoneNumber: '+15550000001', label: 'Main Number' },
                { lineId: 'line_sofia', phoneNumber: '+15550000002', label: 'Sofia' },
            ],
            defaultPhoneNumber: '+15550000001',
            defaultLineToken: 'line_main', // already tokenised, so no backfill call
            assignments: {},
        };
        let finish;
        const callable = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        serve(callable);
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);
        await screen.findByRole('table', { name: 'Phone lines' });

        fireEvent.click(screen.getByRole('button', { name: 'Remove line Sofia' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove line' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove line Main Number' })).toBeDisabled());
        expect(callable).toHaveBeenCalledTimes(1);

        finish({ data: { success: true } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove line Main Number' })).toBeEnabled());
    });

    it('says the support request was copied only when it was', async () => {
        CONFIG_DATA = null;
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Copy request for support' }));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Request copied. Send it to SafeHaul support.'));
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Artificial Co (company id c1)'));
    });

    it('says what to ask for when the browser refuses the clipboard', async () => {
        CONFIG_DATA = null;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
        render(<SmsSettingsPage companyId="c1" companyName="Artificial Co" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Copy request for support' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith(
            'Could not copy the request. Ask SafeHaul support to set up text messaging for your company.',
        ));
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });
});
