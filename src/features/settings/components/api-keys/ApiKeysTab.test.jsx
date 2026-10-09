/**
 * Settings → API Keys: what a Company Admin sees and what each action asks the
 * server. The key itself is on screen once, in the dialog that made it.
 * All names and keys here are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    listCompanyApiKeys: vi.fn(),
    createCompanyApiKey: vi.fn(),
    revokeCompanyApiKey: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => calls[name] }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));

import { ApiKeysTab } from './ApiKeysTab';

const COMPANY = 'artificial-company-1';
// Built at run time: a key-shaped literal in source is what the secret scan
// is for, and this one is made up.
const NEW_KEY = ['shk', '0123456789abcdef', 'A'.repeat(43)].join('_');
const keyRow = (overrides = {}) => ({
    keyId: '0123456789abcdef', name: 'Artificial TMS', prefix: 'shk_0123456789abcdef_…',
    scopes: ['applications:read'], createdAt: '2026-10-01T15:00:00.000Z', createdByName: 'Dana Admin',
    lastUsedAt: null, revokedAt: null, revokedByName: null, ...overrides,
});
const listed = (keys, maxActiveKeys = 5) => ({ data: { keys, maxActiveKeys, scopes: {} } });
const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

beforeEach(() => {
    vi.resetAllMocks();
    calls.listCompanyApiKeys.mockImplementation(async () => listed([
        keyRow(),
        keyRow({ keyId: 'fedcba9876543210', name: 'Old payroll', prefix: 'shk_fedcba9876543210_…', revokedAt: '2026-10-05T12:00:00.000Z' }),
    ]));
    calls.createCompanyApiKey.mockImplementation(async ({ name, scopes }) => ({
        data: { keyId: '0123456789abcdef', key: NEW_KEY, name, prefix: 'shk_0123456789abcdef_…', scopes: ['applications:read', ...scopes] },
    }));
    calls.revokeCompanyApiKey.mockImplementation(async ({ keyId }) => ({ data: { keyId, revoked: true } }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

afterEach(() => vi.resetAllMocks());

async function renderTab() {
    const utils = render(<ApiKeysTab companyId={COMPANY} />);
    await screen.findByRole('button', { name: /^Turn off / });
    return utils;
}

describe('the list', () => {
    it('shows each key by name and id, what it may read, and whether it is on', async () => {
        await renderTab();
        expect(calls.listCompanyApiKeys).toHaveBeenCalledWith({ companyId: COMPANY });
        const table = screen.getByRole('table', { name: 'API keys' });
        expect(within(table).getByText('Artificial TMS')).toBeInTheDocument();
        expect(within(table).getByText('shk_0123456789abcdef_…')).toBeInTheDocument();
        expect(within(table).getAllByText('Applications')).toHaveLength(2);
        expect(within(table).getAllByText('Never')).toHaveLength(2);
        expect(within(table).getByText('Turned off')).toBeInTheDocument();
        // Only the key that is on can be turned off.
        expect(within(table).getAllByRole('button', { name: /^Turn off / })).toHaveLength(1);
        expect(within(table).getByRole('button', { name: 'Turn off Artificial TMS' })).toBeInTheDocument();
    });

    it('says when the list could not load, and tries again', async () => {
        calls.listCompanyApiKeys.mockImplementation(async () => { throw refusal('unavailable', 'unavailable'); });
        render(<ApiKeysTab companyId={COMPANY} />);
        expect(await screen.findByText(/could not reach SafeHaul/)).toBeInTheDocument();

        calls.listCompanyApiKeys.mockImplementation(async () => listed([keyRow()]));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('Artificial TMS')).toBeInTheDocument();
    });

    it('stops making keys at the limit, and says why', async () => {
        calls.listCompanyApiKeys.mockImplementation(async () => listed([keyRow()], 1));
        await renderTab();
        expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
        expect(screen.getByText(/You have 1 keys turned on/)).toBeInTheDocument();
    });
});

describe('making a key', () => {
    it('asks for a name before it asks the server', async () => {
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
        const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        expect(await within(dialog).findByText('Give the key a name.')).toBeInTheDocument();
        expect(calls.createCompanyApiKey).not.toHaveBeenCalled();
    });

    it('sends the name and the chosen permissions, then shows the key once to copy', async () => {
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
        const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
        fireEvent.change(within(dialog).getByLabelText(/Key name/), { target: { value: '  Artificial TMS ' } });
        fireEvent.click(within(dialog).getByLabelText('The full Social Security Number'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

        const shown = await screen.findByRole('dialog', { name: 'Copy your new key' });
        expect(calls.createCompanyApiKey).toHaveBeenCalledWith({ companyId: COMPANY, name: 'Artificial TMS', scopes: ['ssn:read'] });
        expect(within(shown).getByLabelText('Your API key')).toHaveValue(NEW_KEY);
        await waitFor(() => expect(document.activeElement).toBe(within(shown).getByRole('button', { name: 'Done' })));

        fireEvent.click(within(shown).getByRole('button', { name: 'Copy key' }));
        await waitFor(() => expect(within(shown).getByText('Copied.')).toBeInTheDocument());
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(NEW_KEY);

        // Escape does not throw away a key that cannot be shown again; Done does close.
        fireEvent.keyDown(shown, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: 'Copy your new key' })).toBeInTheDocument();
        fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body.textContent).not.toContain(NEW_KEY);
        expect(calls.listCompanyApiKeys).toHaveBeenCalledTimes(2);
    });

    it('shows the server’s own refusal and keeps the form', async () => {
        calls.createCompanyApiKey.mockImplementation(async () => {
            throw refusal('failed-precondition', 'A company can have 5 keys turned on. Turn one off before making another.');
        });
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
        const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
        fireEvent.change(within(dialog).getByLabelText(/Key name/), { target: { value: 'Artificial TMS' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        expect(await within(dialog).findByText(/A company can have 5 keys turned on/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/Key name/)).toHaveValue('Artificial TMS');
    });

    it('says plainly when copying is blocked', async () => {
        navigator.clipboard.writeText.mockImplementation(async () => { throw new Error('denied'); });
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
        const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
        fireEvent.change(within(dialog).getByLabelText(/Key name/), { target: { value: 'Artificial TMS' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        const shown = await screen.findByRole('dialog', { name: 'Copy your new key' });
        fireEvent.click(within(shown).getByRole('button', { name: 'Copy key' }));
        expect(await within(shown).findByText(/Copying was blocked/)).toBeInTheDocument();
    });
});

describe('turning a key off', () => {
    it('asks first, then turns it off and reloads the list', async () => {
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Turn off Artificial TMS' }));
        const confirm = screen.getByRole('dialog', { name: 'Turn off “Artificial TMS”?' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(calls.revokeCompanyApiKey).toHaveBeenCalledWith({ companyId: COMPANY, keyId: '0123456789abcdef' });
        expect(calls.listCompanyApiKeys).toHaveBeenCalledTimes(2);
        expect(toast.showSuccess).toHaveBeenCalledWith('“Artificial TMS” is turned off.');
    });

    it('keeps the question open with the reason when it fails', async () => {
        calls.revokeCompanyApiKey.mockImplementation(async () => { throw refusal('internal', 'internal'); });
        await renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Turn off Artificial TMS' }));
        const confirm = screen.getByRole('dialog', { name: 'Turn off “Artificial TMS”?' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
        expect(await within(confirm).findByText(/Something went wrong on our side/)).toBeInTheDocument();
    });
});

describe('accessibility', () => {
    it('has no detectable violations on the list or in the dialog', async () => {
        const { container } = await renderTab();
        expect((await axe(container)).violations).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
        expect((await axe(screen.getByRole('dialog'))).violations).toEqual([]);
    });
});
