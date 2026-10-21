/**
 * One company's screen opens from the list or from its address
 * (`/super-admin/companies/<id>[/sms]`). Its SMS form saves under that company,
 * and the server does not check the company exists, so an address whose
 * company was deleted or mistyped opens a notice with the way back, never a
 * form. The screen reads the company again after a feature changes and after
 * its details are saved.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ reads: [], answers: [] }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: (ref) => {
        fx.reads.push(ref.path);
        return fx.answers.shift() ?? Promise.reject(new Error('no answer prepared'));
    },
}));
vi.mock('./integrations/IntegrationManager', () => ({
    IntegrationManager: ({ companyId, companyName }) => (
        <section aria-label="SMS setup form">{`Setting up SMS for ${companyName} (${companyId})`}</section>
    ),
}));
vi.mock('./FeaturesView.jsx', () => ({
    FeaturesView: ({ company, onChanged }) => (
        <section aria-label="Features form">
            <p>{`PEV is ${company.features?.pev === false ? 'off' : 'on'}`}</p>
            <button type="button" onClick={onChanged}>Saved a feature</button>
        </section>
    ),
}));

import { CompanyView } from './CompanyView';

const company = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });
const ARTIFICIAL = { companyName: 'Artificial Freight Co', appSlug: 'artificial-freight', planType: 'paid', features: { pev: true } };

function renderView(props = {}) {
    const handlers = { onTabChange: vi.fn(), onBack: vi.fn(), onEdit: vi.fn(), onViewApps: vi.fn() };
    const result = render(<CompanyView companyId="co-7" tab="features" {...handlers} {...props} />);
    return { ...result, ...handlers };
}

beforeEach(() => {
    fx.reads = [];
    fx.answers = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("a company's screen", () => {
    it('reads the company first, and opens on its features', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        renderView();

        expect(screen.getByText('Loading the company')).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Artificial Freight Co', level: 2 })).toBeInTheDocument();
        expect(fx.reads).toEqual(['companies/co-7']);
        expect(screen.getByText('/artificial-freight')).toBeInTheDocument();
        expect(screen.getByText('Pro Plan')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        const tabs = screen.getByRole('tablist', { name: 'Artificial Freight Co settings' });
        expect(within(tabs).getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('PEV is on');
        expect(screen.queryByRole('region', { name: 'SMS setup form' })).not.toBeInTheDocument();
    });

    it('opens the SMS setup on its tab, with the name it read', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        renderView({ tab: 'sms' });

        expect(await screen.findByText('Setting up SMS for Artificial Freight Co (co-7)')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'SMS' })).toHaveAttribute('aria-selected', 'true');
    });

    it('asks for the tab chosen, and leaves the address to the panel', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        const { onTabChange } = renderView();

        fireEvent.click(await screen.findByRole('tab', { name: 'SMS' }));
        expect(onTabChange).toHaveBeenCalledWith('sms');
    });

    it('opens the details editor, the applications and the list from its header', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        const { onEdit, onViewApps, onBack } = renderView();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
        expect(onEdit).toHaveBeenCalledWith('co-7');
        fireEvent.click(screen.getByRole('button', { name: 'View applications' }));
        expect(onViewApps).toHaveBeenCalledWith({ id: 'co-7', name: 'Artificial Freight Co' });
        fireEvent.click(screen.getByRole('button', { name: 'All companies' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows an inactive company as inactive', async () => {
        fx.answers.push(Promise.resolve(company('co-7', { ...ARTIFICIAL, planType: 'free', isActive: false })));
        renderView();

        expect(await screen.findByText('Inactive')).toBeInTheDocument();
        expect(screen.getByText('Free Plan')).toBeInTheDocument();
    });

    it('reads the company again after a feature is saved, and shows what was saved', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        fx.answers.push(Promise.resolve(company('co-7', { ...ARTIFICIAL, features: { pev: false } })));
        renderView();

        fireEvent.click(await screen.findByRole('button', { name: 'Saved a feature' }));
        expect(await screen.findByText('PEV is off')).toBeInTheDocument();
        expect(fx.reads).toEqual(['companies/co-7', 'companies/co-7']);
    });

    it('reads the company again when its details are saved elsewhere on the panel', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        fx.answers.push(Promise.resolve(company('co-7', { ...ARTIFICIAL, companyName: 'Renamed Artificial Co' })));
        const { rerender, ...handlers } = renderView();
        await screen.findByRole('heading', { name: 'Artificial Freight Co', level: 2 });

        rerender(<CompanyView companyId="co-7" tab="features" revision={1} onTabChange={handlers.onTabChange}
            onBack={handlers.onBack} onEdit={handlers.onEdit} onViewApps={handlers.onViewApps} />);
        expect(await screen.findByRole('heading', { name: 'Renamed Artificial Co', level: 2 })).toBeInTheDocument();
    });

    it('does not open a form for an address whose company does not exist', async () => {
        fx.answers.push(Promise.resolve(company('co-gone', null)));
        const { onBack } = renderView({ companyId: 'co-gone' });

        expect(await screen.findByRole('heading', { name: 'Company not found' })).toBeInTheDocument();
        expect(screen.getByText(/No company has the ID “co-gone”/)).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /All companies/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('says when the company could not be read, and reads it again on Try again', async () => {
        fx.answers.push(Promise.reject(new Error('offline')));
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        renderView();

        expect(await screen.findByRole('heading', { name: 'Could not load this company' })).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('heading', { name: 'Artificial Freight Co', level: 2 })).toBeInTheDocument();
        expect(fx.reads).toEqual(['companies/co-7', 'companies/co-7']);
    });

    it('reads another company when the address names another one, and never shows the first one under it', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        let resolveSecond;
        fx.answers.push(new Promise((resolve) => { resolveSecond = resolve; }));
        const { rerender, ...handlers } = renderView();
        await screen.findByRole('heading', { name: 'Artificial Freight Co', level: 2 });

        rerender(<CompanyView companyId="co-8" tab="features" onTabChange={handlers.onTabChange}
            onBack={handlers.onBack} onEdit={handlers.onEdit} onViewApps={handlers.onViewApps} />);
        expect(screen.getByText('Loading the company')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Artificial Freight Co' })).not.toBeInTheDocument();

        resolveSecond(company('co-8', { ...ARTIFICIAL, companyName: 'Second Artificial Carrier' }));
        expect(await screen.findByRole('heading', { name: 'Second Artificial Carrier', level: 2 })).toBeInTheDocument();
        await waitFor(() => expect(fx.reads).toEqual(['companies/co-7', 'companies/co-8']));
    });

    it('has no accessibility violations', async () => {
        fx.answers.push(Promise.resolve(company('co-7', ARTIFICIAL)));
        const { container } = renderView();
        await screen.findByRole('heading', { name: 'Artificial Freight Co', level: 2 });
        expect((await axe(container)).violations).toEqual([]);
    });
});
