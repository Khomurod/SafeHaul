/**
 * "Email to driver", on the worklist and in the prepared-application screen.
 *
 * The server emails the link to the application's own address and answers with
 * that address masked, never the token (`functions/shared/linkDelivery.js`). What
 * these pin is the screen's half: the press asks for delivery and copies nothing,
 * the screen says where it went and shows no link, it says why when there is no
 * address to use, and a refusal is said rather than swallowed. Copy link stays.
 */
import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const callables = vi.hoisted(() => ({ httpsCallable: vi.fn(), calls: [], drafts: [], refuse: null }));

vi.mock('firebase/functions', () => ({ httpsCallable: callables.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {}, db: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', appSlug: 'blue-line' } }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

const DANA = {
    applicantKey: 'key-dana',
    origin: 'company',
    status: 'prepared',
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: 'dana@example.test',
    phone: '2145550147',
    lastStep: 0,
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T09:00:00Z',
};
const PHONE_ONLY = { ...DANA, applicantKey: 'key-marcus', firstName: 'Marcus', lastName: 'Iyer', email: '' };
const PLACEHOLDER = {
    ...DANA, applicantKey: 'key-priya', firstName: 'Priya', lastName: 'Raman', email: 'p@placeholder.safehaulapp.com',
};

const masked = (email) => `${email[0]}***${email.slice(email.indexOf('@'))}`;

beforeAll(() => import('../applicationPrep/unfinishedApplicationViews'));

beforeEach(() => {
    vi.resetAllMocks();
    callables.calls = [];
    callables.drafts = [DANA, PHONE_ONLY, PLACEHOLDER];
    callables.refuse = null;
    callables.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
        callables.calls.push({ name, payload });
        if (name === 'listApplicationDrafts') return { data: { drafts: callables.drafts, retentionDays: 30 } };
        if (name === 'saveCompanyPreparedApplication') {
            return { data: { saved: true, applicantKey: `key-${payload.email}`, lockedEmployers: [] } };
        }
        if (name === 'mintApplicationInvite' && payload.deliver === 'email') {
            if (callables.refuse) throw callables.refuse;
            const to = payload.applicantKey === 'key-dana' ? DANA.email : payload.applicantKey.replace(/^key-/, '');
            return { data: { delivered: { channel: 'email', to: masked(to) }, applicantKey: payload.applicantKey, expiresInDays: 14 } };
        }
        if (name === 'mintApplicationInvite') {
            return { data: { inviteToken: 'tok-abc', applicantKey: payload.applicantKey, expiresInDays: 14 } };
        }
        return { data: {} };
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

const mints = () => callables.calls.filter((entry) => entry.name === 'mintApplicationInvite');
const rowOf = async (name) => (await screen.findByRole('rowheader', { name: new RegExp(`^${name}`) })).closest('tr');

describe('on the worklist', () => {
    it('emails the link to the row’s driver, says where, and shows no link', async () => {
        render(<UnfinishedApplicationsPage />);
        const row = await rowOf('Dana Alvarez');

        fireEvent.click(within(row).getByRole('button', { name: 'Email link to Dana Alvarez' }));

        expect(await within(row).findByText(/Emailed to d\*\*\*@example\.test/)).toBeInTheDocument();
        expect(mints()).toEqual([{
            name: 'mintApplicationInvite',
            payload: { companyId: 'co-1', applicantKey: 'key-dana', deliver: 'email', appBaseUrl: window.location.origin },
        }]);
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        expect(within(row).queryByText(/tok-abc|invite=/)).toBeNull();
        // A link now exists, so the copy action says it makes a new one.
        expect(within(row).getByRole('button', { name: 'New link for Dana Alvarez' })).toBeInTheDocument();
        expect(within(row).getByText('Link sent')).toBeInTheDocument();
    });

    it.each([
        ['no email', 'Marcus Iyer'],
        ['a placeholder email', 'Priya Raman'],
    ])('offers no email for a row with %s, says why, and keeps Copy link', async (_label, name) => {
        render(<UnfinishedApplicationsPage />);
        const row = await rowOf(name);

        expect(within(row).queryByRole('button', { name: new RegExp(`^Email link to ${name}`) })).toBeNull();
        expect(within(row).getByText(/No email address on file, so this link can only be copied/)).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: `Copy link for ${name}` })).toBeInTheDocument();
    });

    it('says why the server would not send it, on that row only', async () => {
        callables.refuse = Object.assign(new Error('Email is not set up for your company, so nothing was sent.'), {
            code: 'functions/failed-precondition', details: { reason: 'email-not-configured' },
        });
        render(<UnfinishedApplicationsPage />);
        const row = await rowOf('Dana Alvarez');

        fireEvent.click(within(row).getByRole('button', { name: 'Email link to Dana Alvarez' }));

        expect(await within(row).findByRole('alert')).toHaveTextContent('Email is not set up for your company');
        expect(within(row).queryByText(/Emailed to/)).toBeNull();
        expect(within(await rowOf('Marcus Iyer')).queryByRole('alert')).toBeNull();
        // Nothing was minted, so the row still reads as never sent.
        expect(within(row).getByRole('button', { name: 'Copy link for Dana Alvarez' })).toBeInTheDocument();
    });
});

describe('in the prepared-application screen', () => {
    const field = (id) => document.getElementById(`${id}-edit`);

    async function savedApplication(email) {
        callables.drafts = [];
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Start typing/i }));
        await screen.findByRole('heading', { name: 'Driver details' });
        fireEvent.change(field('phone'), { target: { value: '2145550147' } });
        if (email) fireEvent.change(field('email'), { target: { value: email } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
        await waitFor(() => expect(callables.calls.some((entry) => entry.name === 'saveCompanyPreparedApplication')).toBe(true));
    }

    it('emails it, says where, shows no link, and fixes the contact that keys it', async () => {
        await savedApplication('dana@example.test');

        fireEvent.click(await screen.findByRole('button', { name: /Email it to the driver/i }));

        expect(await screen.findByText(/Emailed to d\*\*\*@example\.test\. It works for 14 days/)).toBeInTheDocument();
        expect(mints()).toEqual([{
            name: 'mintApplicationInvite',
            payload: {
                companyId: 'co-1', applicantKey: 'key-dana@example.test', deliver: 'email', appBaseUrl: window.location.origin,
            },
        }]);
        expect(screen.queryByTestId('invite-link')).toBeNull();
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        // The email went to the saved key's driver: re-keying now would strand it.
        expect(screen.getByText(/A link is out for this driver/)).toBeInTheDocument();
        // Copy stays, as the way to make a link to send by hand instead.
        expect(screen.getByRole('button', { name: /Create a link to copy/i })).toBeInTheDocument();
    });

    it('offers no email without an address, and says why', async () => {
        await savedApplication('');

        expect(screen.queryByRole('button', { name: /Email it to the driver/i })).toBeNull();
        expect(screen.getByText(/No email address on this application, so the link can only be copied/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create the driver's link/i })).toBeInTheDocument();
    });

    it('asks for a save first, and offers to save and email in one press', async () => {
        await savedApplication('dana@example.test');
        fireEvent.change(field('firstName'), { target: { value: 'Dana' } });

        fireEvent.click(screen.getByRole('button', { name: /Email it to the driver/i }));
        expect(await screen.findByText(/Save your changes first/)).toBeInTheDocument();
        expect(mints()).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: /Save and email the link/i }));
        expect(await screen.findByText(/Emailed to d\*\*\*@example\.test/)).toBeInTheDocument();
        expect(mints()).toHaveLength(1);
        expect(mints()[0].payload.deliver).toBe('email');
    });
});
