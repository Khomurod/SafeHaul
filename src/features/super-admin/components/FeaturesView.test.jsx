/**
 * Contract freeze + defect proof for `FeaturesView`, one company's Features tab.
 *
 * It writes the company's feature flags, so the exact `features.{key}` /
 * `featureSchedules.{key}` update shapes are frozen first. Every toggle has an
 * accessible name and a state, and after a write every control waits until the
 * company has been read again.
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
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));

import { FeaturesView } from './FeaturesView';

const COMPANY = { id: 'co-1', companyName: 'Artificial Freight Co', features: { pev: true, eDocs: false }, featureSchedules: {} };
const UNSET = { id: 'co-2', companyName: 'Second Artificial Carrier', features: {}, featureSchedules: {} };

function renderView(props = {}) {
    return render(<FeaturesView company={COMPANY} onChanged={vi.fn()} {...props} />);
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocs.mockResolvedValue({ docs: [] });
});

describe('FeaturesView — frozen write contract', () => {
    it('writes the feature flag and clears its schedule in one update, then has the company read again', async () => {
        const onChanged = vi.fn();
        renderView({ onChanged });

        fireEvent.click(screen.getByRole('switch', { name: 'E-Docs for Artificial Freight Co' }));

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(updateDoc.mock.calls[0][0]).toEqual({ path: 'companies/co-1' });
        expect(updateDoc.mock.calls[0][1]).toEqual({
            'features.eDocs': true,
            'featureSchedules.eDocs': null,
        });
        expect(showSuccess).toHaveBeenCalledWith('Updated Artificial Freight Co');
        expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('inverts an already-enabled feature', async () => {
        renderView();
        fireEvent.click(screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' }));
        await waitFor(() => expect(updateDoc.mock.calls[0][1]['features.pev']).toBe(false));
    });

    it('lists the five features in the frozen order', () => {
        renderView();
        const features = screen.getAllByRole('rowheader').map((h) => h.textContent);
        expect(features).toEqual(['PEV', 'Campaigns', 'E-Docs', 'Import Leads', 'Call Tracking']);
    });

    it('reports a failed toggle through the frozen toast, and lets the operator try again', async () => {
        updateDoc.mockRejectedValueOnce(new Error('nope'));
        const onChanged = vi.fn();
        renderView({ onChanged });
        const pev = screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' });
        fireEvent.click(pev);
        await waitFor(() => expect(showError).toHaveBeenCalledWith('Failed to toggle feature.'));
        expect(onChanged).not.toHaveBeenCalled();
        expect(pev).toBeEnabled();
    });
});

describe('FeaturesView — a write waits for the company to be read again', () => {
    it('holds every control after a write, so a second click cannot write the value the first replaced', async () => {
        const { rerender } = renderView();
        fireEvent.click(screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' }));
        await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1));

        const pev = screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' });
        expect(pev).toBeDisabled();
        expect(screen.getByRole('switch', { name: 'E-Docs for Artificial Freight Co' })).toBeDisabled();
        fireEvent.click(pev);
        expect(updateDoc).toHaveBeenCalledTimes(1);

        // The company as read again, with the write in it.
        rerender(<FeaturesView company={{ ...COMPANY, features: { pev: false, eDocs: false } }} onChanged={vi.fn()} />);
        expect(screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' })).toBeEnabled();
        expect(screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' })).not.toBeChecked();
    });
});

describe('FeaturesView — toggles are named and stateful (defect)', () => {
    it('gives every toggle an accessible name identifying feature and company', () => {
        renderView();
        expect(screen.getAllByRole('switch')).toHaveLength(5);
        expect(screen.getByRole('switch', { name: 'Campaigns for Artificial Freight Co' })).toBeInTheDocument();
    });

    it('exposes the on/off state programmatically, not by colour', () => {
        renderView();
        expect(screen.getByRole('switch', { name: 'PEV for Artificial Freight Co' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'E-Docs for Artificial Freight Co' })).not.toBeChecked();
    });

    it('shows a feature the company never set as on, as the app treats it, and switches it off', async () => {
        renderView({ company: UNSET });
        const campaigns = screen.getByRole('switch', { name: 'Campaigns for Second Artificial Carrier' });
        expect(campaigns).toBeChecked();

        fireEvent.click(campaigns);
        await waitFor(() => expect(updateDoc).toHaveBeenCalledWith(
            { path: 'companies/co-2' },
            { 'features.campaignsEnabled': false, 'featureSchedules.campaignsEnabled': null },
        ));
    });

    it('is operable by keyboard', async () => {
        renderView();
        const box = screen.getByRole('switch', { name: 'E-Docs for Artificial Freight Co' });
        box.focus();
        expect(box).toHaveFocus();
        fireEvent.click(box);
        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    });
});

describe('FeaturesView — schedule dialog (defects)', () => {
    const scheduled = { ...COMPANY, featureSchedules: { pev: '2099-01-01T10:00:00.000Z' } };

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

    it('names the cancel-schedule control, and still offers a new schedule beside it', () => {
        renderView({ company: scheduled });
        expect(
            screen.getByRole('button', { name: 'Schedule deactivation of PEV for Artificial Freight Co' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Cancel scheduled deactivation of PEV for Artificial Freight Co' }),
        ).toBeInTheDocument();
    });

    it('clears the schedule field on cancel', async () => {
        renderView({ company: scheduled });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled deactivation of PEV for Artificial Freight Co' }));
        await waitFor(() => expect(updateDoc).toHaveBeenCalledWith({ path: 'companies/co-1' }, { 'featureSchedules.pev': null }));
    });
});

describe('FeaturesView — alert stats dialog', () => {
    const scheduled = { ...COMPANY, featureSchedules: { pev: '2099-01-01T10:00:00.000Z' } };

    it('aggregates alerts per user for the chosen feature only', async () => {
        getDocs.mockResolvedValue({
            docs: [
                { data: () => ({ featureKey: 'pev', userEmail: 'a@example.test', views: 2, dismisses: 1, salesClicks: 0 }) },
                { data: () => ({ featureKey: 'pev', userEmail: 'a@example.test', views: 3, dismisses: 0, salesClicks: 1 }) },
                { data: () => ({ featureKey: 'eDocs', userEmail: 'b@example.test', views: 9 }) },
            ],
        });
        renderView({ company: scheduled });

        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));

        const table = await screen.findByRole('table', { name: 'Alert interactions by user' });
        const row = within(table).getByText('a@example.test').closest('tr');
        // By position: views, dismisses, salesClicks. Two of these are "1", so
        // assert the cells rather than the text.
        const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
        expect(cells).toEqual(['5', '1', '1']);
        // The other feature's row must not appear.
        expect(within(table).queryByText('b@example.test')).not.toBeInTheDocument();
        // The shared table: the counts on the end edge, nothing centred.
        expect(table.closest('.ds-data-table')).not.toBeNull();
        expect(within(table).getAllByRole('columnheader')
            .filter((th) => th.getAttribute('data-align') === 'end')
            .map((th) => th.textContent)).toEqual(['Views', 'Dismisses (X)', 'Contact Sales Clicks']);
        expect(table.querySelector('.text-center')).toBeNull();
    });

    it('falls back to userId then Unknown', async () => {
        getDocs.mockResolvedValue({
            docs: [
                { data: () => ({ featureKey: 'pev', userId: 'uid-1', views: 1 }) },
                { data: () => ({ featureKey: 'pev', views: 1 }) },
            ],
        });
        renderView({ company: scheduled });
        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));

        expect(await screen.findByText('uid-1')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('keeps the frozen empty-stats copy', async () => {
        renderView({ company: scheduled });
        fireEvent.click(screen.getByRole('button', { name: /Alerts for PEV at Artificial Freight Co/ }));
        expect(await screen.findByText('No alert interactions recorded yet.')).toBeInTheDocument();
    });
});

describe('FeaturesView — accessibility', () => {
    it('has no violations', async () => {
        const { container } = renderView({ company: { ...COMPANY, featureSchedules: { pev: '2099-01-01T10:00:00.000Z' } } });
        expect((await axe(container)).violations).toEqual([]);
    });
});
