import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardToolbar } from './DashboardToolbar';

/**
 * The filter panel is behind a toggle, which is exactly why it went unchecked:
 * this component had no tests, and nothing in the e2e suite clicked Filters. A
 * `FormField` was given a JSX label while the primitive throws on anything but a
 * non-empty string, so opening the panel crashed the toolbar — on the screen the
 * design-system campaign used as its worked example.
 */
const noop = () => {};

const renderToolbar = (props = {}) => render(
    <DashboardToolbar
        activeTab="applications"
        dataCount={8}
        totalCount={8}
        searchQuery=""
        setSearchQuery={noop}
        filters={{}}
        setFilters={noop}
        clearFilters={noop}
        {...props}
    />,
);

describe('DashboardToolbar filter panel', () => {
    it('opens without throwing, and shows every filter', () => {
        renderToolbar();

        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));

        // The four filters, each reachable by its own accessible name — the
        // reason `FormField` is used here at all is that the previous markup
        // labelled these controls with a `<label>` carrying no `htmlFor`, so
        // each announced as an anonymous combobox.
        expect(screen.getByLabelText('Freight type')).toBeInTheDocument();
        expect(screen.getByLabelText('State')).toBeInTheDocument();
        expect(screen.getByLabelText('Assigned to')).toBeInTheDocument();
        expect(screen.getByLabelText('Filter by date')).toBeInTheDocument();
    });

    it('reports its open state to assistive technology', () => {
        renderToolbar();
        const trigger = screen.getByRole('button', { name: /Filters/ });

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('passes each filter change through unchanged', () => {
        const setFilters = vi.fn();
        renderToolbar({ setFilters });

        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
        fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } });

        expect(setFilters).toHaveBeenCalledTimes(1);
        // Called with an updater, so apply it to see what it would store.
        expect(setFilters.mock.calls[0][0]({ driverType: 'Reefer' }))
            .toEqual({ driverType: 'Reefer', state: 'TX' });
    });
});
