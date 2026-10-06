/**
 * Super Admin → System Health → Telegram alerts.
 *
 * The callables are mocked at the service boundary; the server's own suites own
 * what they do. Pinned here: the three steps unlock in order, the token dialog
 * never shows a value and keeps a refusal on screen, a stale session gets the
 * password prompt and one retry, and the watcher's last view is read out in
 * words, not colour alone.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    getPlatformAlerts: vi.fn(),
    savePlatformAlertToken: vi.fn(),
    connectPlatformAlertChat: vi.fn(),
    sendPlatformAlertTest: vi.fn(),
    deletePlatformAlerts: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));

vi.mock('../../services/platformAlerts', async (importOriginal) => ({ ...(await importOriginal()), ...services }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('../environment/ReauthenticateModal', () => ({
    ReauthenticateModal: ({ onSuccess, onCancel }) => (
        <div role="dialog" aria-label="Confirm your password">
            <button type="button" onClick={onSuccess}>Password accepted</button>
            <button type="button" onClick={onCancel}>Dismiss prompt</button>
        </div>
    ),
}));

import { TelegramAlertsCard } from './TelegramAlertsCard';

const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const NOTHING = { bot: null, chat: null, watch: { lastRunAt: null, checks: {}, lastDeliveryError: null } };
const CONNECTED = {
    bot: { username: 'safehaul_alerts_bot' },
    chat: { title: 'Dana Alvarez' },
    watch: {
        lastRunAt: '2026-08-02T15:40:00.000Z',
        checks: { vision: { status: 'down', since: '2026-08-02T14:40:00.000Z' }, text: { status: 'ok', since: null } },
        lastDeliveryError: null,
    },
};
const reauthRequired = () => Object.assign(new Error('REAUTH_REQUIRED: sign in again'), { code: 'functions/failed-precondition' });

beforeEach(() => {
    vi.resetAllMocks();
    services.getPlatformAlerts.mockResolvedValue(NOTHING);
});

const button = (name) => screen.getByRole('button', { name });

describe('setting it up', () => {
    it('offers the token first, and the later steps only once each can work', async () => {
        render(<TelegramAlertsCard />);

        await screen.findByText('1. Add a bot token');
        expect(button('Add token')).toBeTruthy();
        expect(button('Connect chat').disabled).toBe(true);
        expect(button('Send test').disabled).toBe(true);
        expect(screen.getByText(/Not checked yet/)).toBeTruthy();
    });

    it('saves a token from a dialog that never shows one, then says what to do next', async () => {
        services.savePlatformAlertToken.mockResolvedValue({ bot: { username: 'safehaul_alerts_bot' } });
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add token' }));

        const field = screen.getByLabelText(/Bot token/);
        expect(field.type).toBe('password');
        expect(field.value).toBe('');
        fireEvent.change(field, { target: { value: `  ${TOKEN} ` } });
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add token' }));

        await waitFor(() => expect(services.savePlatformAlertToken).toHaveBeenCalledWith(TOKEN));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith(
            'Token saved. In Telegram, send /start to @safehaul_alerts_bot, then press Connect chat.',
        ));
        expect(services.getPlatformAlerts).toHaveBeenCalledTimes(2);
    });

    it('keeps the dialog open with Telegram\'s refusal in it', async () => {
        services.savePlatformAlertToken.mockRejectedValue(Object.assign(
            new Error('Telegram did not accept this token. Copy it again from @BotFather.'),
            { code: 'functions/failed-precondition' },
        ));
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add token' }));
        fireEvent.change(screen.getByLabelText(/Bot token/), { target: { value: TOKEN } });
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add token' }));

        expect(await screen.findByText('Telegram did not accept this token. Copy it again from @BotFather.')).toBeTruthy();
        expect(screen.getByLabelText(/Bot token/)).toBeTruthy();
    });

    it('asks for the password when the session is stale, then retries once', async () => {
        services.getPlatformAlerts.mockResolvedValue({ ...NOTHING, bot: { username: 'safehaul_alerts_bot' } });
        services.connectPlatformAlertChat
            .mockRejectedValueOnce(reauthRequired())
            .mockResolvedValueOnce({ chat: { title: 'Dana Alvarez' } });
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Connect chat' }));

        const prompt = await screen.findByRole('dialog', { name: 'Confirm your password' });
        fireEvent.click(within(prompt).getByRole('button', { name: 'Password accepted' }));

        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith(
            'Connected to Dana Alvarez. A confirmation is in your Telegram.',
        ));
        expect(services.connectPlatformAlertChat).toHaveBeenCalledTimes(2);
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it('says nothing failed when the password prompt is dismissed', async () => {
        services.getPlatformAlerts.mockResolvedValue({ ...NOTHING, bot: { username: 'safehaul_alerts_bot' } });
        services.connectPlatformAlertChat.mockRejectedValue(reauthRequired());
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Connect chat' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Dismiss prompt' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(toast.showError).not.toHaveBeenCalled();
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });
});

describe('once it is connected', () => {
    beforeEach(() => {
        services.getPlatformAlerts.mockResolvedValue(CONNECTED);
    });

    it('reads out what the last check saw, in words', async () => {
        render(<TelegramAlertsCard />);

        const list = await screen.findByRole('list', { name: 'What the last check saw' });
        expect(within(list).getByText('AI reading photos: Not working')).toBeTruthy();
        expect(within(list).getByText('AI reading text: Working')).toBeTruthy();
        expect(within(list).getByText('Blog publishing: Not checked')).toBeTruthy();
        expect(screen.getByText('2. Chat: Dana Alvarez')).toBeTruthy();
    });

    it('sends a test', async () => {
        services.sendPlatformAlertTest.mockResolvedValue({ sent: true });
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Send test' }));

        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Test message sent. Check your Telegram.'));
    });

    it('says when the last alert could not be delivered', async () => {
        services.getPlatformAlerts.mockResolvedValue({ ...CONNECTED, watch: { ...CONNECTED.watch, lastDeliveryError: 'blocked' } });
        render(<TelegramAlertsCard />);

        expect(await screen.findByText(/The last alert could not be delivered/)).toBeTruthy();
    });

    it('turns alerts off only after it is confirmed', async () => {
        services.deletePlatformAlerts.mockResolvedValue({ deleted: true });
        render(<TelegramAlertsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
        expect(services.deletePlatformAlerts).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByRole('button', { name: 'Turn off alerts' }));

        await waitFor(() => expect(services.deletePlatformAlerts).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Telegram alerts are off, and the bot token was destroyed.'));
    });

    it('has no jsdom axe violations', async () => {
        const { container } = render(<TelegramAlertsCard />);
        await screen.findByRole('list', { name: 'What the last check saw' });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('when the settings cannot be read', () => {
    it('says so and offers to try again', async () => {
        services.getPlatformAlerts
            .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'functions/internal' }))
            .mockResolvedValueOnce(NOTHING);
        render(<TelegramAlertsCard />);

        expect(await screen.findByText('The alert settings could not be loaded.')).toBeTruthy();
        fireEvent.click(button('Try again'));
        expect(await screen.findByText('1. Add a bot token')).toBeTruthy();
    });
});
