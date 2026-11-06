/**
 * Assign Leads offers the company's team from its saved team list
 * (`companies/{id}.teamMembers`), read fresh once when the window opens: one
 * document read, not the memberships and one profile per member. An assignment
 * writes the member's uid as `assignedTo`, a name as `assignedToName` ("Unknown"
 * when there is none), both timestamps, and who assigned it
 * (`assignmentChangedBy`, `assignmentChangedAt`), so the bell tells the new owner
 * unless they took the leads themselves.
 *
 * The browser Firestore refuses a field holding undefined, so the batch double
 * below throws as it does. Round Robin wrote the profile's bare `name`, so a
 * member without one made the whole assignment fail.
 *
 * The `firebase/firestore` double also answers the memberships and `users/*`
 * reads the window used to make, so this file runs against the old code too.
 *
 * All names, emails and ids below are artificial.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    data: {},
    fresh: null,
    memberships: [],
    profiles: {},
    updates: [],
    order: [],
    getCompanyProfile: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    logActivity: vi.fn(),
}));

vi.mock('@/context/DataContext', () => ({ useData: () => fx.data }));
vi.mock('@features/companies/services/companyService', () => ({
    getCompanyProfile: (...args) => fx.getCompanyProfile(...args),
}));
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'uid-ann' } } }));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: (...args) => fx.logActivity(...args) }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (...args) => fx.getDocs(...args),
    getDoc: (...args) => fx.getDoc(...args),
    serverTimestamp: () => '__serverTimestamp__',
    writeBatch: () => ({
        update: (ref, data) => {
            fx.updates.push({ path: ref.path, data });
            if (Object.values(data).includes(undefined)) {
                throw new Error('Function WriteBatch.update() called with invalid data. Unsupported field value: undefined');
            }
        },
        commit: async () => { fx.order.push('commit'); },
    }),
}));

import { LeadAssignmentModal } from './LeadAssignmentModal';

// The saved team list, as the server writes it: a member it could not name is
// 'Unknown', and the pickers show their email instead.
const ANN = { userId: 'uid-ann', name: 'Ann Baker', email: 'ann@example.test', role: 'company_admin' };
const BEN = { userId: 'uid-ben', name: 'Unknown', email: 'ben@example.test', role: 'recruiter' };
const CARA = { userId: 'uid-cara', name: 'Cara Diaz', email: 'cara@example.test', role: 'recruiter' };

// The same people as the old reads saw them: Ben's profile has no `name`.
const PROFILES = {
    'uid-ann': { name: 'Ann Baker', email: 'ann@example.test' },
    'uid-ben': { email: 'ben@example.test' },
    'uid-cara': { name: 'Cara Diaz', email: 'cara@example.test' },
};

const membershipsOf = (members) => members.map(({ userId, role }) => ({ data: () => ({ companyId: 'co-1', userId, role }) }));

function setTeam({ entered, fresh }) {
    fx.data = {
        // The copy read when the admin entered the company: Cara joined since.
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight', teamMembers: entered },
        currentUserClaims: { roles: { 'co-1': 'company_admin' } },
    };
    fx.fresh = fresh === null ? null : { id: 'co-1', companyName: 'Artificial Freight', teamMembers: fresh };
    fx.memberships = membershipsOf(fresh || entered);
}

function openModal(selectedLeadIds = ['lead-1', 'lead-2']) {
    const onClose = vi.fn(() => fx.order.push('onClose'));
    const onSuccess = vi.fn(() => fx.order.push('onSuccess'));
    render(<LeadAssignmentModal companyId="co-1" selectedLeadIds={selectedLeadIds} onClose={onClose} onSuccess={onSuccess} />);
    return { onClose, onSuccess };
}

/** The recruiter picker's options once the team is listed (not the placeholder). */
async function teamOptions() {
    await screen.findByRole('option', { name: 'Ann Baker' });
    return within(screen.getByRole('combobox', { name: 'Assigned to' }))
        .getAllByRole('option')
        .slice(1)
        .map((option) => [option.value, option.textContent]);
}

const assignments = () => fx.updates.map(({ data }) => [data.assignedTo, data.assignedToName]);

beforeEach(() => {
    vi.resetAllMocks();
    fx.updates = [];
    fx.order = [];
    fx.profiles = {};
    setTeam({ entered: [BEN, ANN], fresh: [CARA, BEN, ANN] });
    fx.getCompanyProfile.mockImplementation(async () => fx.fresh);
    fx.getDocs.mockImplementation(async (target) => (target.path === 'memberships' ? { docs: fx.memberships } : { docs: [] }));
    fx.getDoc.mockImplementation(async (ref) => {
        const id = ref.path.split('/').pop();
        const profile = fx.profiles[id] ?? PROFILES[id];
        return { id, exists: () => Boolean(profile), data: () => profile };
    });
    fx.logActivity.mockImplementation(async (...args) => { fx.order.push(`log:${args[2]}`); });
});

describe('LeadAssignmentModal — the team it offers', () => {
    it('reads the company document once and neither the memberships nor any profile', async () => {
        openModal();

        expect(await teamOptions()).toHaveLength(3);
        expect(fx.getCompanyProfile).toHaveBeenCalledTimes(1);
        expect(fx.getCompanyProfile).toHaveBeenCalledWith('co-1');
        expect(fx.getDocs).not.toHaveBeenCalled();
        expect(fx.getDoc).not.toHaveBeenCalled();
    });

    it('shows "Loading team..." and keeps Confirm disabled until the read settles', async () => {
        let settle;
        fx.getCompanyProfile.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
        openModal();

        expect(screen.getByRole('status')).toHaveTextContent('Loading team...');
        expect(screen.getByRole('button', { name: 'Confirm Assignment' })).toBeDisabled();
        await waitFor(() => expect(settle).toBeTypeOf('function'));

        settle(fx.fresh);
        expect(await teamOptions()).toHaveLength(3);
        expect(screen.queryByText('Loading team...')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm Assignment' })).toBeEnabled();
    });

    it("lists the fresh document's team by name, with someone who joined after the company was entered", async () => {
        openModal();

        expect(await teamOptions()).toEqual([
            ['uid-ann', 'Ann Baker'],
            ['uid-ben', 'ben@example.test'],
            ['uid-cara', 'Cara Diaz'],
        ]);
    });

    it('uses the copy read on entering the company when the fresh read gives nothing', async () => {
        setTeam({ entered: [BEN, ANN], fresh: null });
        openModal();

        expect(await teamOptions()).toEqual([
            ['uid-ann', 'Ann Baker'],
            ['uid-ben', 'ben@example.test'],
        ]);
        expect(fx.getCompanyProfile).toHaveBeenCalledWith('co-1');
        expect(fx.getDocs).not.toHaveBeenCalled();
    });
});

describe('LeadAssignmentModal — Round Robin', () => {
    it("writes the email of a member the team list could not name, and no undefined value", async () => {
        const user = userEvent.setup();
        const { onSuccess, onClose } = openModal(['lead-1', 'lead-2', 'lead-3', 'lead-4']);
        await user.click(await screen.findByRole('button', { name: 'Round Robin' }));
        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Cara Diaz' })).toBeChecked());

        await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }));

        expect(assignments()).toEqual([
            ['uid-ann', 'Ann Baker'],
            ['uid-ben', 'ben@example.test'],
            ['uid-cara', 'Cara Diaz'],
            ['uid-ann', 'Ann Baker'],
        ]);
        fx.updates.forEach(({ data }) => expect(Object.values(data)).not.toContain(undefined));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Failed to assign leads.')).not.toBeInTheDocument();
    });

    it('starts with everyone ticked and deals the leads in name order among those still ticked', async () => {
        const user = userEvent.setup();
        const { onClose } = openModal(['lead-1', 'lead-2', 'lead-3']);
        await user.click(await screen.findByRole('button', { name: 'Round Robin' }));

        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Cara Diaz' })).toBeChecked());
        expect(screen.getByRole('checkbox', { name: 'Ann Baker' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'ben@example.test' })).toBeChecked();

        await user.click(screen.getByRole('checkbox', { name: 'Ann Baker' }));
        await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(assignments()).toEqual([
            ['uid-ben', 'ben@example.test'],
            ['uid-cara', 'Cara Diaz'],
            ['uid-ben', 'ben@example.test'],
        ]);
    });
});

describe('LeadAssignmentModal — Manual Pick and what an assignment writes', () => {
    it('writes the chosen member to every lead, then logs, then calls onSuccess before onClose', async () => {
        const user = userEvent.setup();
        const { onSuccess, onClose } = openModal(['lead-1', 'lead-2']);
        await teamOptions();

        await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned to' }), 'uid-cara');
        await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const payload = {
            assignedTo: 'uid-cara',
            assignedToName: 'Cara Diaz',
            assignedAt: '__serverTimestamp__',
            updatedAt: '__serverTimestamp__',
            assignmentChangedBy: 'uid-ann',
            assignmentChangedAt: '__serverTimestamp__',
        };
        expect(fx.updates).toEqual([
            { path: 'companies/co-1/leads/lead-1', data: payload },
            { path: 'companies/co-1/leads/lead-2', data: payload },
        ]);
        expect(fx.logActivity.mock.calls).toEqual([
            ['co-1', 'leads', 'lead-1', 'Lead Assigned', 'Assigned to specific user', 'assignment'],
            ['co-1', 'leads', 'lead-2', 'Lead Assigned', 'Assigned to specific user', 'assignment'],
        ]);
        expect(fx.order).toEqual(['commit', 'log:lead-1', 'log:lead-2', 'onSuccess', 'onClose']);
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('writes "Unknown" for a member with neither a name nor an email', async () => {
        const DAN = { userId: 'uid-dan', name: 'Unknown', email: '', role: 'recruiter' };
        setTeam({ entered: [ANN], fresh: [ANN, DAN] });
        fx.profiles = { 'uid-dan': {} };
        const user = userEvent.setup();
        const { onClose } = openModal(['lead-1']);
        await teamOptions();

        await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned to' }), 'uid-dan');
        await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(assignments()).toEqual([['uid-dan', 'Unknown']]);
    });
});
