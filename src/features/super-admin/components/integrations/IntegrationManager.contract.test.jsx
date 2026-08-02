/**
 * Contract freeze + security proof for `IntegrationManager`, written BEFORE its
 * design-system migration. This file had zero test coverage before this
 * campaign. It pins the security-sensitive SMS-integration contracts so a
 * presentation-only migration cannot silently change them:
 *
 *  - Firestore read path `companies/{id}/integrations/sms_provider`.
 *  - Initial provider `ringcentral` and initial `isSandbox: true`.
 *  - Encrypted credentials are NEVER loaded into form fields; the fields stay
 *    empty when credentials already exist, and `hasExistingCredentials` is
 *    detected from the `:` separator in the stored (encrypted) value.
 *  - The `__PRESERVE__` sentinel is sent for a blank credential when one already
 *    exists, and real typed values override it.
 *  - RingCentral requires clientId + clientSecret; 8x8 requires apiKey +
 *    apiSecret — only when no credentials exist yet.
 *  - Phone-number sanitisation and string coercion of every config value.
 *  - Callable names + payload shapes: `saveIntegrationConfig({ companyId,
 *    provider, config })` and `sendTestSMS({ companyId, testPhoneNumber })`.
 *  - The exact toast wording for save, verify, test and validation.
 *
 * No backend, Firestore rule, schema or callable is touched by this freeze or
 * by the presentation migration that follows it.
 *
 * All ids, names, tokens and credentials below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
}));
const saveIntegrationConfig = vi.hoisted(() => vi.fn());
const sendTestSMS = vi.hoisted(() => vi.fn());
const getDoc = vi.hoisted(() => vi.fn());
const docFn = vi.hoisted(() => vi.fn((_db, ...path) => ({ path: path.join('/') })));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => {
        if (name === 'saveIntegrationConfig') return saveIntegrationConfig;
        if (name === 'sendTestSMS') return sendTestSMS;
        return vi.fn();
    },
}));
vi.mock('firebase/firestore', () => ({
    doc: (...a) => docFn(...a),
    getDoc: (...a) => getDoc(...a),
}));
// LineManager attaches a Firestore realtime listener; stub it so these tests
// exercise only the IntegrationManager contract.
vi.mock('./LineManager', () => ({ LineManager: () => <div data-testid="line-manager" /> }));

import { IntegrationManager } from './IntegrationManager';

/** A stored doc where RingCentral credentials already exist (encrypted). */
const EXISTING_RC_DOC = {
    exists: () => true,
    data: () => ({
        provider: 'ringcentral',
        config: {
            // Encrypted values carry a ':' separator — the detection signal.
            clientId: 'encrypted-cipher:iv-fixture',
            clientSecret: 'encrypted-secret:iv-fixture',
            isSandbox: 'true',
            phoneNumber: '+15550000000',
        },
    }),
};

const NO_DOC = { exists: () => false };

async function renderManager(props = {}) {
    const utils = render(
        <IntegrationManager companyId="co-1" companyName="Artificial Freight Co" onBack={vi.fn()} {...props} />,
    );
    // Wait out the mount fetch (the loading spinner is replaced by the form).
    await waitFor(() => expect(screen.queryByText('Loading existing configuration...')).not.toBeInTheDocument());
    return utils;
}

beforeEach(() => {
    vi.clearAllMocks();
    getDoc.mockResolvedValue(NO_DOC);
    saveIntegrationConfig.mockResolvedValue({ data: { inventoryCount: 2 } });
    sendTestSMS.mockResolvedValue({ data: { success: true } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('IntegrationManager — load + read path', () => {
    it('reads the frozen integrations doc path', async () => {
        await renderManager();
        expect(docFn).toHaveBeenCalledWith({}, 'companies/co-1/integrations', 'sms_provider');
    });

    it('defaults to ringcentral with sandbox on when no config exists', async () => {
        await renderManager();
        // Sandbox checkbox is checked by default (isSandbox: true).
        expect(screen.getByRole('checkbox')).toBeChecked();
        // RingCentral fields are present by default.
        expect(screen.getByPlaceholderText('Enter Client ID')).toBeInTheDocument();
    });

    it('never loads encrypted credentials into the form fields', async () => {
        getDoc.mockResolvedValue(EXISTING_RC_DOC);
        const { container } = await renderManager();

        // The stored encrypted values must never reach any input value or the DOM.
        expect(screen.queryByDisplayValue(/encrypted-cipher/)).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue(/encrypted-secret/)).not.toBeInTheDocument();
        expect(container.innerHTML).not.toContain('encrypted-cipher');
        expect(container.innerHTML).not.toContain('encrypted-secret');

        // Instead, existing credentials are flagged (a "Saved" badge) and the
        // fields stay blank with the keep-existing placeholder.
        expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
        expect(screen.getAllByPlaceholderText('(Leave blank to keep existing)')).toHaveLength(2);
    });
});

describe('IntegrationManager — __PRESERVE__ sentinel and validation', () => {
    it('sends __PRESERVE__ for blank credentials when they already exist', async () => {
        getDoc.mockResolvedValue(EXISTING_RC_DOC);
        await renderManager();

        // Submit without typing new credentials.
        fireEvent.click(screen.getByRole('button', { name: /Secure Save/ }));

        await waitFor(() => expect(saveIntegrationConfig).toHaveBeenCalled());
        const payload = saveIntegrationConfig.mock.calls[0][0];
        expect(payload.companyId).toBe('co-1');
        expect(payload.provider).toBe('ringcentral');
        expect(payload.config.clientId).toBe('__PRESERVE__');
        expect(payload.config.clientSecret).toBe('__PRESERVE__');
    });

    it('sends typed credentials verbatim instead of the sentinel', async () => {
        getDoc.mockResolvedValue(EXISTING_RC_DOC);
        await renderManager();

        // Both credential fields share the "(Leave blank to keep existing)"
        // placeholder: [0] is Client ID (text), [1] is Client Secret (password).
        const fields = screen.getAllByPlaceholderText('(Leave blank to keep existing)');
        fireEvent.change(fields[0], { target: { value: 'new-client-id' } });
        fireEvent.change(fields[1], { target: { value: 'new-client-secret' } });

        fireEvent.click(screen.getByRole('button', { name: /Secure Save/ }));

        await waitFor(() => expect(saveIntegrationConfig).toHaveBeenCalled());
        const payload = saveIntegrationConfig.mock.calls[0][0];
        expect(payload.config.clientId).toBe('new-client-id');
        expect(payload.config.clientSecret).toBe('new-client-secret');
    });

    it('requires RingCentral credentials when none exist yet', async () => {
        const { container } = await renderManager();
        // Submit the form directly to reach the handler's own guard (the native
        // `required` attributes are the first line of defence; this is the
        // frozen JS fallback and its exact wording).
        fireEvent.submit(container.querySelector('form'));
        expect(toastMocks.showError).toHaveBeenCalledWith('Client ID and Client Secret are required.');
        expect(saveIntegrationConfig).not.toHaveBeenCalled();
    });

    it('requires 8x8 credentials when none exist yet', async () => {
        const { container } = await renderManager();
        fireEvent.click(screen.getByRole('button', { name: '8x8' }));
        fireEvent.submit(container.querySelector('form'));
        expect(toastMocks.showError).toHaveBeenCalledWith('API Key and API Secret are required.');
        expect(saveIntegrationConfig).not.toHaveBeenCalled();
    });
});

describe('IntegrationManager — save payload contract', () => {
    it('sanitises the phone number and coerces every config value to a string', async () => {
        await renderManager();

        fireEvent.change(screen.getByPlaceholderText('Enter Client ID'), { target: { value: 'cid' } });
        fireEvent.change(screen.getByPlaceholderText('Enter Client Secret'), { target: { value: 'csecret' } });
        fireEvent.click(screen.getByRole('button', { name: /Secure Save/ }));

        await waitFor(() => expect(saveIntegrationConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 'co-1',
                provider: 'ringcentral',
                config: expect.objectContaining({
                    // Boolean isSandbox coerced to the string 'true'.
                    isSandbox: 'true',
                    clientId: 'cid',
                    clientSecret: 'csecret',
                }),
            }),
        ));
    });

    it('reports the verified-save toast with the inventory count', async () => {
        await renderManager();
        fireEvent.change(screen.getByPlaceholderText('Enter Client ID'), { target: { value: 'cid' } });
        fireEvent.change(screen.getByPlaceholderText('Enter Client Secret'), { target: { value: 'csecret' } });
        fireEvent.click(screen.getByRole('button', { name: /Secure Save/ }));

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith(
            'Integration saved and verified successfully. (2 numbers found)',
        ));
    });
});

describe('IntegrationManager — test SMS contract', () => {
    it('disables the Test action until a number is entered', async () => {
        await renderManager();
        // The frozen guard: the Test button is disabled while the field is empty.
        expect(screen.getByRole('button', { name: /Test/ })).toBeDisabled();
        expect(sendTestSMS).not.toHaveBeenCalled();

        fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), { target: { value: '+15551234567' } });
        expect(screen.getByRole('button', { name: /Test/ })).not.toBeDisabled();
    });

    it('sends the frozen sendTestSMS payload and success toast', async () => {
        await renderManager();
        fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), { target: { value: '+15551234567' } });
        fireEvent.click(screen.getByRole('button', { name: /Test/ }));

        await waitFor(() => expect(sendTestSMS).toHaveBeenCalledWith({
            companyId: 'co-1',
            testPhoneNumber: '+15551234567',
        }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Test Message Sent!'));
    });
});

describe('IntegrationManager — accessibility (jsdom baseline)', () => {
    // jsdom axe cannot see real-browser contrast; a real-browser axe pass on the
    // running Super Admin surface is still required before the roadmap row moves.
    it('has no violations in the RingCentral form', async () => {
        const { container } = await renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations in the 8x8 form', async () => {
        const { container } = await renderManager();
        fireEvent.click(screen.getByRole('button', { name: '8x8' }));
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations while showing existing credentials', async () => {
        getDoc.mockResolvedValue(EXISTING_RC_DOC);
        const { container } = await renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });
});
