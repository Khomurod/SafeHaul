/**
 * The dashboard's hiring brief: one line, "This month: 18 applications · 42 in
 * process · 3 hired since Nov 6", each number a link to the list it counts.
 * While it loads it is a placeholder and after a failure a sentence with Try
 * again: never a number that was not counted.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';

const fx = vi.hoisted(() => ({ state: null, refresh: () => {} }));

vi.mock('@features/companies', () => ({ useHiringBrief: () => fx.state }));

import { HiringBrief } from './HiringBrief';

const LOADED = { brief: { applications: 18, inProcess: 42, hired: 3 }, month: '2026-11', isLoading: false, error: null };

function Opened() {
    const location = useLocation();
    return <p>Opened {location.pathname} with {JSON.stringify(location.state)}</p>;
}

function renderBrief(state) {
    fx.state = { refresh: fx.refresh, ...state };
    return render(
        <MemoryRouter initialEntries={['/company/dashboard']}>
            <Routes>
                <Route path="/company/dashboard" element={<HiringBrief companyId="co-1" />} />
                <Route path="/company/drivers/applications" element={<Opened />} />
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    fx.state = null;
    fx.refresh = () => {};
});

describe('the hiring brief', () => {
    it('reads as one sentence, each number a link', async () => {
        const { container } = renderBrief(LOADED);

        expect(screen.getByRole('region', { name: 'This month' }))
            .toHaveTextContent('This month: 18 applications · 42 in process · 3 hired since Nov 6');
        expect(screen.getByRole('link', { name: '18 applications' })).toHaveAttribute('href', '/company/drivers/applications');
        expect(screen.getByRole('link', { name: '42 in process' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '3 hired since Nov 6' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('This month’s numbers loaded.');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('says "hired this month" once a whole month has been recorded, and "1 application" for one', () => {
        renderBrief({ ...LOADED, brief: { applications: 1, inProcess: 0, hired: 2 }, month: '2026-12' });

        expect(screen.getByRole('link', { name: '1 application' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '0 in process' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '2 hired this month' })).toBeInTheDocument();
    });

    it.each([
        ['18 applications', { period: { field: 'createdAt', month: '2026-11' } }],
        ['42 in process', { segment: 'in_process' }],
        ['3 hired since Nov 6', { period: { field: 'hiredAt', month: '2026-11' } }],
    ])('opens the list "%s" counts', (name, state) => {
        renderBrief(LOADED);

        fireEvent.click(screen.getByRole('link', { name }));

        expect(screen.getByText(`Opened /company/drivers/applications with ${JSON.stringify(state)}`)).toBeInTheDocument();
    });

    it('shows a placeholder, not a number, while it loads', () => {
        const { container } = renderBrief({ brief: null, month: '2026-11', isLoading: true, error: null });

        expect(screen.getByRole('status')).toHaveTextContent('Loading this month’s numbers.');
        expect(container.querySelector('.ds-skeleton')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByRole('link')).toBeNull();
        expect(container).not.toHaveTextContent(/\d/);
    });

    it('says it could not load, with Try again, and shows no number', () => {
        const refresh = vi.fn();
        fx.refresh = refresh;
        const { container } = renderBrief({ brief: null, month: '2026-11', isLoading: false, error: new Error('unavailable') });

        expect(screen.getByText('This month’s numbers could not be loaded just now.')).toBeInTheDocument();
        expect(screen.queryByRole('link')).toBeNull();
        expect(container).not.toHaveTextContent(/\d/);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('renders nothing without a company', () => {
        fx.state = { ...LOADED, refresh: () => {} };
        const { container } = render(<MemoryRouter><HiringBrief companyId={undefined} /></MemoryRouter>);

        expect(container).toBeEmptyDOMElement();
    });
});
