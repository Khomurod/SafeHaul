/**
 * Permissions and inventory presentation: what each role may do, and how the inventory is grouped and described.
 *
 * Part of the EnvironmentIntegrationsView contract suite, split from the
 * original single file by subject. The fixtures, callable stubs, spies and
 * the security-proof context live in
 * `EnvironmentIntegrationsView.contract.support.jsx`. Each `vi.mock` below
 * has to stay in this file, because vitest hoists it per file and cannot
 * register one from a helper.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvironmentIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./EnvironmentIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvironmentIntegrationsView.contract.support')).feedbackMock());

import { EnvironmentIntegrationsView } from './EnvironmentIntegrationsView';
import {
    PROTECTED_REASON,
    listResponse,
    installCallables,
    rowFor,
    renderLoaded,
    resetHarness,
} from './EnvironmentIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('permissions', () => {
    it('keeps unavailable actions on screen, focusable, and explained', async () => {
        await renderLoaded();

        const edit = screen.getByRole('button', {
            name: `Edit ARTIFICIAL_MASTER_KEY — unavailable: ${PROTECTED_REASON}`,
        });
        expect(edit).toBeInTheDocument();
        expect(edit).toHaveAttribute('aria-disabled', 'true');
        // aria-disabled, not disabled: the explanation must stay reachable.
        expect(edit).not.toBeDisabled();
        expect(edit).toHaveAttribute('title', PROTECTED_REASON);

        for (const action of ['Replace', 'Add', 'Delete']) {
            expect(screen.getByRole('button', {
                name: new RegExp(`^${action} ARTIFICIAL_MASTER_KEY — unavailable: `),
            })).toBeInTheDocument();
        }
    });

    it('offers real controls on an editable row', async () => {
        await renderLoaded();
        expect(screen.getByRole('button', { name: 'Edit clientSecret' })).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('button', { name: 'Delete clientSecret' })).not.toHaveAttribute('aria-disabled');
    });

    it('summarises the permissions of each row in text, not colour', async () => {
        await renderLoaded();
        const protectedRow = rowFor('ARTIFICIAL_MASTER_KEY');
        expect(within(protectedRow).getByText('Reveal')).toBeInTheDocument();
        expect(within(protectedRow).getByText('No edit')).toBeInTheDocument();
        expect(within(protectedRow).getByText('No delete')).toBeInTheDocument();
    });
});

describe('inventory presentation', () => {
    it('counts total, configured, missing, protected and needs-deployment', async () => {
        await renderLoaded();
        const summary = screen.getByLabelText('Inventory summary');
        expect(within(summary).getByText('Total keys').parentElement).toHaveTextContent('5');
        expect(within(summary).getByText('Missing').parentElement).toHaveTextContent('1');
        // Four of the five fixtures are not editable.
        expect(within(summary).getByText('Protected').parentElement).toHaveTextContent('4');
    });

    it('refines a build-time row status from the bundle rather than the server', async () => {
        await renderLoaded();
        const row = rowFor('VITE_FIREBASE_PROJECT_ID');
        expect(within(row).getByText('Configured')).toBeInTheDocument();
    });

    it('filters by source', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'github-actions-secret' } });

        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).not.toBeInTheDocument();
    });

    it('filters by search text', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText(/Search keys/), { target: { value: 'client' } });

        expect(screen.getByRole('button', { name: 'Reveal clientSecret' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).not.toBeInTheDocument();
    });

    it('shows an empty state that explains the filters', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText(/Search keys/), { target: { value: 'nothing-matches-this' } });
        expect(screen.getByText('No entries match these filters.')).toBeInTheDocument();
    });

    it('names the real reason when the inventory is denied', async () => {
        // Regression: the Firebase SDK prefixes callable codes with `functions/`,
        // so an inline `=== 'permission-denied'` never matched and a denied
        // Super Admin check was reported as a generic load failure.
        const denied = vi.fn().mockRejectedValue(
            Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
        );
        installCallables({ list: denied });
        render(<EnvironmentIntegrationsView />);

        expect(await screen.findByText('Super Admin access is required for this action.')).toBeInTheDocument();
    });

    it('shows an error state with a retry that reloads', async () => {
        const failing = vi.fn().mockRejectedValueOnce(new Error('offline'));
        installCallables({ list: failing });
        render(<EnvironmentIntegrationsView />);

        const retry = await screen.findByRole('button', { name: 'Retry' });
        failing.mockResolvedValueOnce(listResponse());
        fireEvent.click(retry);

        await screen.findByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' });
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('reports a partial company failure without blanking the global inventory', async () => {
        const list = vi.fn().mockResolvedValue(listResponse({
            companyError: 'Company integration credentials could not be listed.',
        }));
        await renderLoaded({ list });
        expect(screen.getByText(/Company integration credentials could not be listed/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).toBeInTheDocument();
    });
});

