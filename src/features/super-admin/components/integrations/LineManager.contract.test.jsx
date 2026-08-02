/**
 * Contract freeze + a11y proof for `LineManager` (the RingCentral "Digital
 * Wallet"), written with its design-system migration. It pins the
 * security-sensitive line-management contracts so a presentation change cannot
 * silently alter them:
 *
 *  - Real-time listener on `companies/{id}/integrations/sms_provider`, mapping
 *    `inventory` / `config.clientId+clientSecret → hasCredentials` /
 *    `defaultPhoneNumber`.
 *  - The line identity used for removal is the phone number (the stable token
 *    this component keys and removes by); `removePhoneLine({ companyId,
 *    phoneNumber })` and its success / cleared-assignments / failure toasts.
 *  - The destructive confirmation wording.
 *  - `hasCredentials` handed to `AddLineModal`.
 *
 * The migration replaces the blocking `window.confirm` with the shared
 * accessible dialog and the legacy palette with `--ds-*` tokens; no callable,
 * payload, listener path or toast string changes.
 *
 * All phone numbers, labels and ids below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const removePhoneLine = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const docFn = vi.hoisted(() => vi.fn((_db, ...path) => ({ path: path.join('/') })));
const onSnapshotMock = vi.hoisted(() => vi.fn());
const snapState = vi.hoisted(() => ({ exists: true, data: {} }));
const addLineModalProps = vi.hoisted(() => ({ current: null }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'removePhoneLine' ? removePhoneLine : vi.fn()),
}));
vi.mock('firebase/firestore', () => ({
    doc: (...a) => docFn(...a),
    onSnapshot: (...a) => onSnapshotMock(...a),
}));
vi.mock('./AddLineModal', () => ({
    AddLineModal: (props) => {
        addLineModalProps.current = props;
        return <div data-testid="add-line-modal" />;
    },
}));

import { LineManager } from './LineManager';

const INVENTORY = [
    { phoneNumber: '+15550001111', label: 'Recruiting', usageType: 'shared', status: 'active' },
    { phoneNumber: '+15550002222', label: '', status: 'pending' },
];

function renderManager(props = {}) {
    return render(<LineManager companyId="co-1" companyName="Artificial Freight Co" {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    snapState.exists = true;
    snapState.data = {
        inventory: INVENTORY,
        defaultPhoneNumber: '+15550001111',
        config: { clientId: 'enc:iv', clientSecret: 'enc:iv' },
    };
    onSnapshotMock.mockImplementation((_ref, onNext) => {
        onNext({ exists: () => snapState.exists, data: () => snapState.data });
        return () => {};
    });
    removePhoneLine.mockResolvedValue({ data: { success: true, message: 'Line removed.' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('LineManager — listener + rendering', () => {
    it('subscribes to the frozen sms_provider doc path', () => {
        renderManager();
        expect(docFn).toHaveBeenCalledWith({}, 'companies', 'co-1', 'integrations', 'sms_provider');
        expect(onSnapshotMock).toHaveBeenCalled();
    });

    it('renders each provisioned line with number, label, status and default', () => {
        renderManager();
        expect(screen.getByText('+15550001111')).toBeInTheDocument();
        expect(screen.getByText('Recruiting')).toBeInTheDocument();
        expect(screen.getByText('shared')).toBeInTheDocument();

        const activeRow = screen.getByText('+15550001111').closest('tr');
        expect(within(activeRow).getByText('Active')).toBeInTheDocument();
        expect(within(activeRow).getByText('Default')).toBeInTheDocument();

        const pendingRow = screen.getByText('+15550002222').closest('tr');
        expect(within(pendingRow).getByText('pending')).toBeInTheDocument();
        expect(within(pendingRow).queryByText('Default')).not.toBeInTheDocument();
    });

    it('shows the empty state when there are no lines', () => {
        snapState.data = { inventory: [] };
        renderManager();
        expect(screen.getByText('No Phone Lines')).toBeInTheDocument();
    });

    it('keeps the security notice', () => {
        renderManager();
        expect(screen.getByText('JWT tokens are encrypted and never exposed to Company Admins')).toBeInTheDocument();
    });

    it('hands hasCredentials to AddLineModal', () => {
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: /Add Line/ }));
        expect(addLineModalProps.current.sharedCredentials).toEqual({ hasCredentials: true });
    });
});

describe('LineManager — remove line contract (blocking confirm replaced)', () => {
    it('removes via an accessible dialog with the frozen payload and toast', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Remove line +15550001111' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Any users assigned to this line will be unassigned/)).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove line' }));

        await waitFor(() => expect(removePhoneLine).toHaveBeenCalledWith({ companyId: 'co-1', phoneNumber: '+15550001111' }));
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Line removed.');
        vi.unstubAllGlobals();
    });

    it('also announces cleared assignments when the backend clears them', async () => {
        removePhoneLine.mockResolvedValue({ data: { success: true, clearedAssignments: 2 } });
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Remove line +15550001111' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove line' }));

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('2 assignment(s) cleared.'));
    });

    it('does not remove when the confirmation is cancelled', async () => {
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Remove line +15550001111' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(removePhoneLine).not.toHaveBeenCalled();
    });

    it('surfaces a remove failure through the frozen toast', async () => {
        removePhoneLine.mockRejectedValueOnce(new Error('nope'));
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Remove line +15550001111' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove line' }));
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('nope'));
    });
});

describe('LineManager — accessibility (jsdom baseline)', () => {
    it('has no violations with lines present', async () => {
        const { container } = renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations in the empty state', async () => {
        snapState.data = { inventory: [] };
        const { container } = renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });
});
