/**
 * Regression proof for the `sms_provider` listener defect.
 *
 * `useLineAssignments` called `onSnapshot(ref, next)` with **no error callback**.
 * When the listen itself failed — permission denied, a rules change, a Firestore
 * outage — neither callback ever ran, so `loading` stayed `true` forever and the
 * screen showed "Loading inventory..." indefinitely with nothing surfaced to the
 * user. That is the silent-loading class of defect the design-system campaign is
 * meant to eliminate.
 *
 * It is also what broke `frontend-quality` after #123: CI injects the real
 * `VITE_FIREBASE_*` secrets into the Playwright dev server, so the E2E browser
 * reached the real Firestore project while `DataContext` supplied a mock
 * (non-Firebase) user. Every listen came back `PERMISSION_DENIED` and the SMS
 * spec timed out waiting for a state the component could never reach. Locally
 * there is no `.env`, the placeholder project applied, and the same specs passed.
 *
 * These tests drive the error path directly, so they fail against the old hook
 * regardless of environment.
 *
 * All phone numbers and names below are artificial.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: vi.fn(() => ({ showSuccess: vi.fn(), showError: vi.fn() })),
}));
vi.mock('@/context/DataContext', () => ({ useData: vi.fn(() => ({})) }));
vi.mock('./SMSDiagnosticModal', () => ({ SMSDiagnosticModal: () => <div /> }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

let CONFIG_DATA;
/** Captured per render so a test can decide when/whether to fail the listen. */
let snapshotHandlers;

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((...args) => ({ __type: 'doc', path: args.slice(1).join('/') })),
    collection: vi.fn((_db, name) => ({ __col: name })),
    query: vi.fn((col, ...constraints) => ({ col, constraints })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    documentId: vi.fn(() => '__name__'),
    updateDoc: vi.fn(() => Promise.resolve()),
    onSnapshot: (_ref, next, error) => {
        snapshotHandlers = { next, error };
        return vi.fn();
    },
    getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import { NumberAssignmentManager } from './NumberAssignmentManager';

beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandlers = null;
    CONFIG_DATA = { isActive: true, inventory: [], defaultPhoneNumber: '', assignments: {} };
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

function permissionDenied() {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
}

describe('NumberAssignmentManager — failed sms_provider listen (defect: infinite silent loading)', () => {
    it('registers an error callback with onSnapshot at all', () => {
        render(<NumberAssignmentManager companyId="c1" />);
        expect(typeof snapshotHandlers.error).toBe('function');
    });

    it('leaves the loading state when the listen fails instead of spinning forever', async () => {
        render(<NumberAssignmentManager companyId="c1" />);
        expect(screen.getByText('Loading inventory...')).toBeInTheDocument();

        snapshotHandlers.error(permissionDenied());

        await waitFor(() => {
            expect(screen.queryByText('Loading inventory...')).not.toBeInTheDocument();
        });
    });

    it('announces the failure rather than showing it silently', async () => {
        render(<NumberAssignmentManager companyId="c1" />);
        snapshotHandlers.error(permissionDenied());

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/couldn't reach your SMS configuration/i);
    });

    it('does not claim SMS is inactive when the read failed', async () => {
        render(<NumberAssignmentManager companyId="c1" />);
        snapshotHandlers.error(permissionDenied());

        await screen.findByText("Couldn't Load SMS Settings");
        // The "not active" copy is a statement of fact about the company's
        // configuration. A failed read tells us nothing about it, so claiming it
        // would be actively misleading — and would send the admin to a Super Admin
        // to "enable SMS" that may already be enabled.
        expect(screen.queryByText('SMS Integration Not Active')).not.toBeInTheDocument();
        expect(
            screen.queryByText('Please contact a Super Admin to enable SMS for your company.'),
        ).not.toBeInTheDocument();
    });

    it('recovers to the normal state if a later snapshot succeeds', async () => {
        render(<NumberAssignmentManager companyId="c1" />);
        snapshotHandlers.error(permissionDenied());
        await screen.findByText("Couldn't Load SMS Settings");

        // Firestore retries a failed listen; a recovered stream must clear the error.
        snapshotHandlers.next({ exists: () => true, data: () => CONFIG_DATA });

        await waitFor(() => {
            expect(screen.queryByText("Couldn't Load SMS Settings")).not.toBeInTheDocument();
        });
        expect(screen.getByText('No Numbers Found')).toBeInTheDocument();
    });

    it('still shows the not-active state when the read succeeds and no doc exists', async () => {
        render(<NumberAssignmentManager companyId="c1" />);

        snapshotHandlers.next({ exists: () => false, data: () => undefined });

        expect(await screen.findByText('SMS Integration Not Active')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
