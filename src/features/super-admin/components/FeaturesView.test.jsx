/**
 * Contract freeze + defect proof for the migrated `FeaturesView`.
 *
 * This matrix writes feature flags for every company on the platform, so the
 * exact `features.{key}` / `featureSchedules.{key}` update shapes are frozen
 * first. The headline fix is that the toggles previously had no accessible name
 * and no state at all.
 *
 * All company names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDoc = vi.fn(() => Promise.resolve());
const getDocs = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
const showInfo = vi.fn();

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, col, id) => ({ path: `${col}/${id}` })),
    collection: vi.fn((_db, ...p) => ({ path: p.join('/') })),
    updateDoc: (...a) => updateDoc(...a),
    getDocs: (...a) => getDocs(...a),
    writeBatch: vi.fn(() => ({ update: vi.fn(), commit: vi.fn() })),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));

import { FeaturesView } from './FeaturesView';

const COMPANIES = [
    { id: 'co-1', companyName: 'Artificial Freight Co', features: { pev: true, eDocs: false }, featureSchedules: {} },
    { id: 'co-2', companyName: 'Second Artificial Carrier', features: {}, featureSchedules: {} },
];

function renderView(props = {}) {
    return render(<FeaturesView companyList={COMPANIES} onDataUpdate={vi.fn()} {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocs.mockResolvedValue({ docs: [] });
});

describe('FeaturesView — frozen write contract', () => {
    it('writes the feature flag and clears its schedule in one update', async () => {
        const onDataUpdate = vi.fn();
        renderView({ onDataUpdate });

        fireEvent.click(screen.getByRole('checkbox', { name: 'E-Docs for Artificial Freight Co' }));

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(updateDoc.mock.calls[0][0]).toEqual({ path: 'companies/co-1' });
        expect(updateDoc.mock.calls[0][1]).toEqual({
            'features.eDocs': true,
            'featureSchedules.eDocs': null,
        });
        expect(showSuccess).toHaveBeenCalledWith('Updated Artificial Freight Co');
        expect(onDataUpdate).toHaveBeenCalled();
    });

    it('inverts an already-enabled feature', async () => {
        renderView();
        fireEvent.click(screen.getByRole('checkbox', { name: 'PEV for Artificial Freight Co' }));
        await waitFor(() => expect(updateDoc.mock.calls[0][1]['features.pev']).toBe(false));
    });

    it('exposes the five feature columns in the frozen order', () => {
        renderView();
        const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
        expect(headers).toEqual(['Company Name', 'PEV', 'Campaigns', 'E-Docs', 'Import Leads', 'Call Tracking']);
    });

    it('reports a failed toggle through the frozen toast', async () => {
        updateDoc.mockRejectedValueOnce(new Error('nope'));
        renderView();
        fireEvent.click(screen.getByRole('checkbox', { name: 'PEV for Artificial Freight Co' }));
        await waitFor(() => expect(showError).toHaveBeenCalledWith('Failed to toggle feature.'));
    });

    it('filters companies by name', () => {
        renderView();
        fireEvent.change(screen.getByLabelText('Search companies by name'), { target: { value: 'second' } });
        expect(screen.queryByText('Artificial Freight Co')).not.toBeInTheDocument();
        expect(screen.getByText('Second Artificial Carrier')).toBeInTheDocument();
    });
});

describe('FeaturesView — toggles are named and stateful (defect)', () => {
    it('gives every toggle an accessible name identifying feature and company', () => {
        renderView();
        // 2 companies x 5 features
        expect(screen.getAllByRole('checkbox')).toHaveLength(10);
        expect(screen.getByRole('checkbox', { name: 'Campaigns for Second Artificial Carrier' })).toBeInTheDocument();
    });

    it('exposes the on/off state programmatically, not by colour', () => {
        renderView();
        expect(screen.getByRole('checkbox', { name: 'PEV for Artificial Freight Co' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'E-Docs for Artificial Freight Co' })).not.toBeChecked();
    });

    it('is operable by keyboard', async () => {
        renderView();
        const box = screen.getByRole('checkbox', { name: 'E-Docs for Artificial Freight Co' });
        box.focus();
        expect(box).toHaveFocus();
        fireEvent.click(box);
        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    });
});

describe('FeaturesView — schedule dialog (defects)', () => {
    const scheduled = [{ ...COMPANIES[0], featureSchedules: { pev: '2099-01-01T10:00:00.000Z' } }];

    it('opens as a real dialog with labelled date and time fields', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Schedule deactivation of PEV for Artificial Freight Co' }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName(/Schedule Deactivation/);
        expect(within(dialog).getByLabelText('Date')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Time')).toBeInTheDocument();
    });

    it('keeps the frozen past-date guard', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Schedule deactivation of PEV for Artificial Freight Co' }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2000-01-01' } });
        fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:00' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('Cannot schedule in the past.'));
        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('writes an ISO string to the exact schedule field', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Schedule deactivation of PEV for Artificial Freight Co' }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2099-01-01' } });
        fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:00' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        const payload = updateDoc.mock.calls[0][1];
        expect(Object.keys(payload)).toEqual(['featureSchedules.pev']);
        expect(payload['featureSchedules.pev']).toMatch(/^2099-01-01T/);
    });

    it('names the cancel-schedule control', () => {
        renderView({ companyList: scheduled });
        expect(
            screen.getByRole('button', { name: 'Cancel scheduled deactivation of PEV for Artificial Freight Co' }),
        ).toBeInTheDocument();
    });

    it('clears the schedule field on cancel', async () => {
        renderView({ companyList: scheduled });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled deactivation of PEV for Artificial Freight Co' }));
        await waitFor(() => expect(updateDoc).toHaveBeenCalledWith({ path: 'companies/co-1' }, { 'featureSchedules.pev': null }));
    });
});

describe('FeaturesView — alert stats dialog', () => {
    const scheduled = [{ ...COMPANIES[0], featureSchedules: { pev: '2099-01-01T10:00:00.000Z' } }];

    it('aggregates alerts per user for the chosen feature only', async () => {
        getDocs.mockResolvedValue({
            docs: [
                { data: () => ({ featureKey: 'pev', userEmail: 'a@example.test', views: 2, dismisses: 1, salesClicks: 0 }) },
                { data: () => ({ featureKey: 'pev', userEmail: 'a@example.test', views: 3, dismisses: 0, salesClicks: 1 }) },
                { data: () => ({ featureKey: 'eDocs', userEmail: 'b@example.test', views: 9 }) },
            ],
        });
        renderView({ companyList: scheduled });

        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));

        const table = await screen.findByRole('table', { name: 'Alert interactions by user' });
        const row = within(table).getByText('a@example.test').closest('tr');
        // By position: views, dismisses, salesClicks. Two of these are "1", so
        // assert the cells rather than the text.
        const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
        expect(cells).toEqual(['5', '1', '1']);
        // The other feature's row must not appear.
        expect(within(table).queryByText('b@example.test')).not.toBeInTheDocument();
    });

    it('falls back to userId then Unknown', async () => {
        getDocs.mockResolvedValue({
            docs: [
                { data: () => ({ featureKey: 'pev', userId: 'uid-1', views: 1 }) },
                { data: () => ({ featureKey: 'pev', views: 1 }) },
            ],
        });
        renderView({ companyList: scheduled });
        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));

        expect(await screen.findByText('uid-1')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('keeps the frozen empty-stats copy', async () => {
        renderView({ companyList: scheduled });
        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));
        expect(await screen.findByText('No alert interactions recorded yet.')).toBeInTheDocument();
    });
});

describe('FeaturesView — accessibility', () => {
    it('has no violations in the matrix', async () => {
        const { container } = renderView();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('keeps the frozen empty-list copy', () => {
        renderView({ companyList: [] });
        expect(screen.getByText('No companies found.')).toBeInTheDocument();
    });
});
