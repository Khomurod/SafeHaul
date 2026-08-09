/**
 * Contract and safety proof for Super Admin → Landing Page Settings.
 *
 * The properties asserted here are the ones a visual review cannot catch:
 *
 *  1. **The bot token never reaches the screen.** The server has no callable
 *     that returns it, and this view must never grow a control that implies
 *     otherwise. A rendered token is a token in the DOM, in a screen share and
 *     in a browser extension's reach.
 *  2. **The token input is cleared once it is saved.** Leaving a credential
 *     sitting in an input after the operator has finished with it is how it ends
 *     up in a screenshot.
 *  3. **A failed delivery is explained, not swallowed.** The classified codes
 *     the server returns must reach the operator as something actionable.
 *  4. **A contact-only lead is presented as a lead**, because those are the
 *     submissions the previous single-step form threw away.
 *
 * All names, emails and identifiers below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true } }));

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() };
vi.mock('@shared/components/feedback', () => ({ useToast: () => toast }));

vi.mock('../components/environment/ReauthenticateModal', () => ({
    ReauthenticateModal: ({ onSuccess }) => (
        <button type="button" onClick={onSuccess}>Confirm password</button>
    ),
}));

import { LandingPageSettingsView } from './LandingPageSettingsView';

/** A realistic-looking token that must never appear in the rendered output. */
const SECRET_TOKEN = '987654321:AAFakeTokenForTestingOnly_qrstuvwxyz';

const settings = (over = {}) => ({
    telegram: {
        enabled: true,
        configured: true,
        source: 'firestore',
        // Zero-entropy on purpose: real-looking hex beside a `botToken…` key is
        // exactly what the secret scanner exists to catch.
        botTokenFingerprint: 'ffffffffffff',
        botUsername: 'safehaul_leads_bot',
        chatIdLast4: '7890',
        updatedAt: 1754600000000,
        updatedByEmail: 'admin@safehaul.example',
        lastDelivery: { status: 'delivered', code: null, at: 1754600500000 },
        secretManagerFallbackAvailable: false,
        ...(over.telegram || {}),
    },
    content: null,
    contentUpdatedAt: null,
});

const leads = (over = []) => ({
    leads: over.length ? over : [
        {
            id: 'lead-a', fullName: 'Dana Whitfield', workEmail: 'dana@example.test',
            companyName: 'Ridgeline Carriers', companySize: '51-200', phone: null,
            primaryGoal: 'Compliance', stage: 'qualified', sourcePage: '/', utmSource: null,
            delivery: { status: 'delivered', code: null, attempts: 1 }, createdAt: 1754600000000,
        },
        {
            id: 'lead-b', fullName: 'Sam Okafor', workEmail: 'sam@example.test',
            companyName: null, companySize: null, phone: null, primaryGoal: null,
            stage: 'contact', sourcePage: '/pricing', utmSource: 'linkedin',
            delivery: { status: 'failed', code: 'telegram-unavailable', attempts: 2 },
            createdAt: 1754600100000,
        },
    ],
});

let calls;

function routeCallables(overrides = {}) {
    calls = [];
    httpsCallable.mockImplementation((_functions, name) => async (payload) => {
        calls.push({ name, payload });
        if (overrides[name]) return { data: await overrides[name](payload) };
        if (name === 'getLandingPageSettings') return { data: settings() };
        if (name === 'listLandingLeads') return { data: leads() };
        if (name === 'updateLandingTelegramConfig') {
            return { data: { verified: true, botTokenFingerprint: 'newfingerprint', botUsername: 'safehaul_leads_bot' } };
        }
        if (name === 'sendLandingTelegramTest') return { data: { ok: true, code: null, source: 'firestore' } };
        if (name === 'retryLandingLeadDelivery') return { data: { ok: true, code: null } };
        return { data: {} };
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    routeCallables();
});

describe('Landing Page Settings — the token never reaches the browser', () => {
    it('identifies the credentials by fingerprint, not by value', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        expect(screen.getByText('@safehaul_leads_bot')).toBeInTheDocument();
        expect(screen.getByText('Ending 7890')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain(SECRET_TOKEN);
    });

    it('offers no reveal control at all', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        // The environment vault pairs a masked value with an eye. This screen
        // deliberately does not, and must not acquire one.
        expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /show token/i })).toBeNull();
        expect(calls.map((c) => c.name)).not.toContain('revealEnvironmentValue');
    });

    it('renders the token field as a password input', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        const field = screen.getByLabelText(/bot token/i);
        expect(field).toHaveAttribute('type', 'password');
        expect(field).toHaveAttribute('autocomplete', 'off');
    });

    it('clears the token out of the form as soon as it is stored', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        const token = screen.getByLabelText(/bot token/i);
        const chat = screen.getByLabelText(/destination chat/i);
        fireEvent.change(token, { target: { value: SECRET_TOKEN } });
        fireEvent.change(chat, { target: { value: '-1001234567890' } });
        fireEvent.click(screen.getByRole('button', { name: /verify and save/i }));

        await waitFor(() => expect(token).toHaveValue(''));
        expect(chat).toHaveValue('');
        expect(document.body.textContent).not.toContain(SECRET_TOKEN);

        const save = calls.find((c) => c.name === 'updateLandingTelegramConfig');
        expect(save.payload.botToken).toBe(SECRET_TOKEN);
    });

    it('cannot submit an empty credential pair', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        expect(screen.getByRole('button', { name: /verify and save/i })).toBeDisabled();
    });
});

describe('Landing Page Settings — delivery status is actionable', () => {
    it('explains a classified failure rather than showing a code', async () => {
        routeCallables({
            getLandingPageSettings: async () => settings({
                telegram: { lastDelivery: { status: 'failed', code: 'bot-blocked-or-not-in-chat', at: 1754600500000 } },
            }),
        });

        render(<LandingPageSettingsView />);
        await screen.findByText(/the bot is not a member of that chat/i);
    });

    it('reports a failed test send through the toast, in words', async () => {
        routeCallables({
            sendLandingTelegramTest: async () => ({ ok: false, code: 'invalid-token' }),
        });

        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');
        fireEvent.click(screen.getByRole('button', { name: /send test message/i }));

        await waitFor(() => {
            expect(toast.showError).toHaveBeenCalledWith(expect.stringMatching(/rejected the bot token/i));
        });
    });

    it('shows Not configured when neither source has credentials', async () => {
        routeCallables({
            getLandingPageSettings: async () => settings({
                telegram: {
                    configured: false, enabled: false, source: 'none',
                    botTokenFingerprint: null, botUsername: null, chatIdLast4: null,
                    lastDelivery: null, secretManagerFallbackAvailable: false,
                },
            }),
        });

        render(<LandingPageSettingsView />);
        await screen.findByText('No credentials stored');

        // The status badge is the at-a-glance answer; the field below it says
        // where the credentials would come from.
        expect(screen.getByText('Not configured')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /send test message/i })).toBeDisabled();
    });

    it('reports when delivery is still running on the deploy-time fallback', async () => {
        routeCallables({
            getLandingPageSettings: async () => settings({
                telegram: {
                    configured: false, source: 'secret-manager',
                    botTokenFingerprint: null, botUsername: null, chatIdLast4: null,
                    secretManagerFallbackAvailable: true,
                },
            }),
        });

        render(<LandingPageSettingsView />);
        await screen.findByText(/secret manager \(deploy-time fallback\)/i);
    });
});

describe('Landing Page Settings — captured leads', () => {
    it('lists a contact-only lead as a lead, not as a failure', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('Sam Okafor');

        // This is the submission the old single-step form discarded entirely.
        expect(screen.getByText('Contact only')).toBeInTheDocument();
        expect(screen.getByText('Qualified')).toBeInTheDocument();
    });

    it('offers a resend only for leads that were not delivered', async () => {
        render(<LandingPageSettingsView />);
        await screen.findByText('Sam Okafor');

        const resend = screen.getAllByRole('button', { name: /resend/i });
        expect(resend).toHaveLength(1);

        fireEvent.click(resend[0]);
        await waitFor(() => {
            expect(calls.find((c) => c.name === 'retryLandingLeadDelivery')?.payload).toEqual({ leadId: 'lead-b' });
        });
    });

    it('announces an empty list rather than rendering a bare table', async () => {
        routeCallables({ listLandingLeads: async () => ({ leads: [] }) });

        render(<LandingPageSettingsView />);
        await screen.findByText('No leads yet.');
    });
});

describe('Landing Page Settings — shell and failure behaviour', () => {
    it('leaves the single h1 to the Super Admin masthead', async () => {
        const { container } = render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        expect(container.querySelector('h1')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Landing Page Settings', level: 2 })).toBeInTheDocument();
    });

    it('announces a load failure and offers a retry', async () => {
        routeCallables({
            getLandingPageSettings: async () => { throw Object.assign(new Error('nope'), { code: 'functions/internal' }); },
        });

        render(<LandingPageSettingsView />);
        await screen.findByText(/landing page settings could not be loaded/i);
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('prompts for the password once when the session is stale, then retries', async () => {
        let attempts = 0;
        routeCallables({
            sendLandingTelegramTest: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw Object.assign(new Error('REAUTH_REQUIRED: re-enter your password'), {
                        code: 'functions/failed-precondition',
                    });
                }
                return { ok: true, code: null, source: 'firestore' };
            },
        });

        render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');
        fireEvent.click(screen.getByRole('button', { name: /send test message/i }));

        const confirm = await screen.findByRole('button', { name: /confirm password/i });
        fireEvent.click(confirm);

        await waitFor(() => expect(attempts).toBe(2));
        expect(toast.showSuccess).toHaveBeenCalledWith(expect.stringMatching(/test message delivered/i));
    });

    it('has no detectable accessibility violations', async () => {
        const { container } = render(<LandingPageSettingsView />);
        await screen.findByText('ffffffffffff');

        const results = await axe(container);
        expect(results.violations).toEqual([]);
    });
});
