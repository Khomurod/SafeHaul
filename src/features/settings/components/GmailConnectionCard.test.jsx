import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailConnectionCard } from './GmailConnectionCard';

const DISCLOSURE = "SafeHaul will send your company's emails from this account. SafeHaul can only send; it cannot read your mailbox.";
const CONNECTED_AT = Date.UTC(2026, 10, 30, 15);

const NOT_CONNECTED = { connected: false, email: null, status: null, statusReason: null, connectedAt: null, connectedByName: null };
const ACTIVE = {
    connected: true, email: 'hiring@acme.test', status: 'active', statusReason: null,
    connectedAt: CONNECTED_AT, connectedByName: 'Anna Lee',
};
const BROKEN = { ...ACTIVE, status: 'needs_reconnect', statusReason: 'invalid_grant' };

const connection = vi.hoisted(() => ({
    connect: vi.fn(),
    connecting: false,
    connectError: null,
    disconnect: vi.fn(),
    disconnecting: false,
    disconnectError: null,
    clearDisconnectError: vi.fn(),
    sendTest: vi.fn(),
    testing: false,
    testResult: null,
}));

function renderCard(props = {}) {
    return render(<GmailConnectionCard gmail={NOT_CONNECTED} switchOn connection={connection} {...props} />);
}

const section = () => screen.getByRole('region', { name: 'Send from Gmail' });
const button = (name) => screen.queryByRole('button', { name });

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(connection, { connecting: false, connectError: null, disconnecting: false, disconnectError: null, testing: false, testResult: null });
    connection.disconnect.mockResolvedValue(true);
});

describe('GmailConnectionCard — the four states', () => {
    it('offers Connect Gmail with what SafeHaul may do, when not connected', async () => {
        renderCard();
        expect(section()).toHaveTextContent(DISCLOSURE);
        expect(section()).toHaveTextContent('Not connected');
        expect(button('Disconnect')).toBeNull();
        expect(button('Send test email')).toBeNull();

        await userEvent.click(button('Connect Gmail'));
        expect(connection.connect).toHaveBeenCalledOnce();
    });

    it('says which account sends, who connected it and when, with Send test email and Disconnect', async () => {
        renderCard({ gmail: ACTIVE });
        expect(section()).toHaveTextContent('Connected');
        expect(section()).toHaveTextContent('Sending from hiring@acme.test · connected by Anna Lee on Nov 30, 2026');
        expect(button('Connect Gmail')).toBeNull();

        await userEvent.click(button('Send test email'));
        expect(connection.sendTest).toHaveBeenCalledOnce();
        expect(button('Disconnect')).toBeEnabled();
    });

    it('leaves out who and when where the server does not know them', () => {
        renderCard({ gmail: { ...ACTIVE, connectedByName: null, connectedAt: null } });
        const line = screen.getByText(/^Sending from/);
        expect(line).toHaveTextContent(/^Sending from hiring@acme\.test$/);
    });

    it('warns that no email is sent and offers Reconnect Gmail when Google stopped the account', async () => {
        renderCard({ gmail: BROKEN });
        expect(section()).toHaveTextContent('Needs reconnecting');
        expect(section()).toHaveTextContent('Emails are not being sent');
        expect(section()).toHaveTextContent('Nothing is sent through your mail server instead.');
        expect(button('Send test email')).toBeNull();

        await userEvent.click(button('Reconnect Gmail'));
        expect(connection.connect).toHaveBeenCalledOnce();
        expect(button('Disconnect')).toBeInTheDocument();
    });

    it('keeps a connected Gmail sending, and offers no way to connect, while the switch is off', () => {
        renderCard({ gmail: ACTIVE, switchOn: false });
        expect(section()).toHaveTextContent('Send from Gmail is switched off');
        expect(section()).toHaveTextContent('This account keeps sending');
        expect(button('Send test email')).toBeInTheDocument();
        expect(button('Disconnect')).toBeInTheDocument();
        expect(button('Connect Gmail')).toBeNull();
        expect(button('Reconnect Gmail')).toBeNull();
    });

    it('offers no Reconnect while the switch is off, and says to disconnect instead', () => {
        renderCard({ gmail: BROKEN, switchOn: false });
        expect(section()).toHaveTextContent('so it cannot be reconnected: disconnect it');
        expect(button('Reconnect Gmail')).toBeNull();
        expect(button('Disconnect')).toBeInTheDocument();
    });
});

describe('GmailConnectionCard — leaving for Google waits for unsaved changes', () => {
    it.each([
        ['Connect Gmail', NOT_CONNECTED],
        ['Reconnect Gmail', BROKEN],
    ])('holds %s while the page has unsaved changes, and says why', async (name, gmail) => {
        renderCard({ gmail, blocked: true });
        const action = button(name);
        expect(action).toBeDisabled();
        expect(action).toHaveAccessibleDescription('Save or discard your changes first.');
        await userEvent.click(action);
        expect(connection.connect).not.toHaveBeenCalled();
    });

    it('shows why a connection did not start', () => {
        connection.connectError = 'Sending from Gmail is not switched on for this company.';
        renderCard();
        expect(within(section()).getByRole('alert')).toHaveTextContent('Sending from Gmail is not switched on for this company.');
    });
});

describe('GmailConnectionCard — Disconnect asks first', () => {
    it('disconnects only once confirmed, naming the account and what sends instead', async () => {
        renderCard({ gmail: ACTIVE });
        await userEvent.click(button('Disconnect'));

        const dialog = screen.getByRole('dialog', { name: 'Disconnect Gmail?' });
        expect(dialog).toHaveAccessibleDescription(/SafeHaul stops sending from hiring@acme\.test\. Emails go out through your mail-server settings again/);
        expect(connection.disconnect).not.toHaveBeenCalled();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect Gmail' }));
        expect(connection.disconnect).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('changes nothing on Cancel', async () => {
        renderCard({ gmail: ACTIVE });
        await userEvent.click(button('Disconnect'));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(connection.disconnect).not.toHaveBeenCalled();
        expect(connection.clearDisconnectError).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('stays open with the reason when the disconnect failed', async () => {
        connection.disconnect.mockResolvedValue(false);
        const { rerender } = renderCard({ gmail: ACTIVE });
        await userEvent.click(button('Disconnect'));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect Gmail' }));

        connection.disconnectError = 'Too many attempts. Wait a few minutes, then try again.';
        rerender(<GmailConnectionCard gmail={ACTIVE} switchOn connection={{ ...connection }} />);
        expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Too many attempts.');
    });

    it('says Gmail cannot come back while the switch is off', async () => {
        renderCard({ gmail: ACTIVE, switchOn: false });
        await userEvent.click(button('Disconnect'));
        expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/cannot be connected again while Send from Gmail is switched off/);
    });

    it('waits while the page is saving', () => {
        renderCard({ gmail: ACTIVE, busy: true });
        expect(button('Disconnect')).toBeDisabled();
    });
});

describe('GmailConnectionCard — the test email', () => {
    it.each([
        [{ success: true, message: 'A test email was sent to admin@acme.test. Check that it arrived.' }, 'status', 'Test email sent'],
        [{ success: false, message: 'Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.' }, 'alert', 'Test email not sent'],
    ])('announces the result', (testResult, role, title) => {
        connection.testResult = testResult;
        renderCard({ gmail: ACTIVE });
        const notice = within(section()).getByRole(role);
        expect(notice).toHaveTextContent(title);
        expect(notice).toHaveTextContent(testResult.message);
    });
});

describe('GmailConnectionCard — accessibility', () => {
    it.each([
        ['not connected', { gmail: NOT_CONNECTED, blocked: true }],
        ['connected', { gmail: ACTIVE }],
        ['needs reconnecting', { gmail: BROKEN }],
        ['switched off', { gmail: ACTIVE, switchOn: false }],
    ])('has no violations when %s', async (_label, props) => {
        const { container } = renderCard(props);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with the confirm dialog open', async () => {
        renderCard({ gmail: ACTIVE });
        await userEvent.click(button('Disconnect'));
        expect((await axe(document.body)).violations).toEqual([]);
    });
});
