import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NORTH_AMERICAN_REGION_NAMES } from '@shared/utils/northAmericanRegions';
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
        searchQuery=""
        setSearchQuery={noop}
        filters={{}}
        setFilters={noop}
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
        fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Texas' } });

        expect(setFilters).toHaveBeenCalledTimes(1);
        // Called with an updater, so apply it to see what it would store.
        expect(setFilters.mock.calls[0][0]({ driverType: 'Reefer' }))
            .toEqual({ driverType: 'Reefer', state: 'Texas' });
    });

    it('offers by full name the regions an application address can be in', () => {
        renderToolbar({ filters: { state: 'Ontario' } });

        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
        const state = screen.getByRole('combobox', { name: 'State' });

        expect(within(state).getAllByRole('option').map((option) => option.textContent))
            .toEqual(['All States', ...NORTH_AMERICAN_REGION_NAMES]);
        expect(within(state).getAllByRole('group').map((group) => group.getAttribute('label')))
            .toEqual(['United States', 'Canada', 'Mexico']);
        expect(state).toHaveValue('Ontario');
    });
});

describe('DashboardToolbar on the list-page toolbar', () => {
    it('says how many of its filters apply, counting the Filters row only', () => {
        renderToolbar({ filters: { state: 'Texas', driverType: 'Reefer', myAssignmentsOnly: true } });

        expect(screen.getByRole('button', { name: 'Filters 2 applied' })).toBeInTheDocument();
    });

    it('clears the Filters row and leaves the switch alone', () => {
        const setFilters = vi.fn();
        renderToolbar({ setFilters, filters: { state: 'Texas', assignee: 'u1', myAssignmentsOnly: true } });
        fireEvent.click(screen.getByRole('button', { name: 'Filters 2 applied' }));

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        expect(setFilters.mock.calls[0][0]({ state: 'Texas', assignee: 'u1', myAssignmentsOnly: true, segment: 'x' }))
            .toEqual({
                state: '', driverType: '', assignee: '', dateFilter: '', dob: '',
                myAssignmentsOnly: true, segment: 'x',
            });
    });

    it('offers no Clear filters while nothing applies', () => {
        renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

        expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    });

    it('shows the "only mine" switch with its words, and reports the value it moves to', () => {
        const onToggleMyAssignments = vi.fn();
        renderToolbar({ showMyAssignmentsToggle: true, myAssignmentsOnly: false, onToggleMyAssignments });

        fireEvent.click(screen.getByText('Only mine'));

        expect(screen.getByRole('switch', { name: 'Only mine' })).toBeInTheDocument();
        expect(onToggleMyAssignments).toHaveBeenCalledWith(true);
    });

    it('names the segments as a set and presses the current one', () => {
        const onChange = vi.fn();
        renderToolbar({
            segments: { items: [{ id: 'all', label: 'All Applications' }, { id: 'new', label: 'New' }], value: 'all', onChange },
        });

        const group = screen.getByRole('group', { name: 'Pipeline segment' });
        expect(within(group).getByRole('button', { name: 'All Applications' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(within(group).getByRole('button', { name: 'New' }));
        expect(onChange).toHaveBeenCalledWith('new');
    });

    it('offers Assign only to someone who can assign, once rows are selected', () => {
        const onAssignLeads = vi.fn();
        const { rerender } = renderToolbar({ canAssign: true, selectedCount: 0, onAssignLeads });
        expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull();

        rerender(
            <DashboardToolbar
                searchQuery=""
                setSearchQuery={noop}
                filters={{}}
                setFilters={noop}
                canAssign
                selectedCount={3}
                onAssignLeads={onAssignLeads}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Assign (3)' }));
        expect(onAssignLeads).toHaveBeenCalledTimes(1);
    });
});
