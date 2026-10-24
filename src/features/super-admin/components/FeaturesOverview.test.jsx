/**
 * Every company's features in one view-only table: on or off, and a scheduled
 * switch-off. A row opens that company's Features tab. All names are artificial.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    getDocs: (...args) => fs.getDocs(...args),
}));

import { FeaturesOverview } from './FeaturesOverview';

const companies = (list) => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })) });

beforeEach(() => {
    fs.getDocs.mockReset();
    fs.getDocs.mockResolvedValue(companies([
        { id: 'co-b', companyName: 'Blue Line', features: { pev: false, eDocs: true } },
        { id: 'co-a', companyName: 'Acme Freight', features: { campaignsEnabled: true }, featureSchedules: { campaignsEnabled: '2026-10-30T15:00:00.000Z' } },
    ]));
});

describe('the features overview', () => {
    it('lists every company by name with each feature on or off, and nothing to switch', async () => {
        render(<FeaturesOverview onOpenCompany={vi.fn()} />);

        const acme = (await screen.findByRole('rowheader', { name: /Acme Freight/ })).closest('tr');
        const blue = screen.getByRole('rowheader', { name: /Blue Line/ }).closest('tr');
        expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
            expect.stringContaining('Acme Freight'), expect.stringContaining('Blue Line'),
        ]);
        // A feature is on unless the company switched it off.
        expect(within(blue).getAllByText('Off')).toHaveLength(1);
        expect(within(blue).getAllByText('On')).toHaveLength(4);
        expect(within(acme).getByText(/Off from/)).toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it("opens a company's Features tab from its row", async () => {
        const onOpenCompany = vi.fn();
        render(<FeaturesOverview onOpenCompany={onOpenCompany} />);

        await userEvent.click(await screen.findByRole('row', { name: 'Open Blue Line features' }));
        expect(onOpenCompany).toHaveBeenCalledWith(expect.objectContaining({ id: 'co-b' }));

        // From the keyboard too, as every list's row opens its record.
        screen.getByRole('row', { name: 'Open Acme Freight features' }).focus();
        await userEvent.keyboard('{Enter}');
        expect(onOpenCompany).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'co-a' }));
        // Nothing else on the row competes for the press.
        expect(screen.queryByRole('button', { name: /Open/ })).toBeNull();
    });

    it('says the companies could not be read, and reads them again on Retry', async () => {
        fs.getDocs.mockRejectedValueOnce(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<FeaturesOverview onOpenCompany={vi.fn()} />);

        await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

        expect(await screen.findByRole('rowheader', { name: /Acme Freight/ })).toBeInTheDocument();
        expect(fs.getDocs).toHaveBeenCalledTimes(2);
    });
});
