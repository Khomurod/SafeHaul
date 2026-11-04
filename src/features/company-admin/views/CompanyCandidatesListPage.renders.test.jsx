/**
 * Typing in the list's search changes only the hook's `searchQuery` until the
 * debounced search answers, so the rows the table draws stay the same. The page
 * hands the memoized `DataTable` the same props then, and its memo skips the
 * redraw; the toolbar, which shows what is typed, gets the same props when
 * something it does not show changes. A real change (a ticked row) still
 * reaches the table.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const fx = vi.hoisted(() => {
    const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });
    const noop = () => {};
    return {
        // Artificial records, in the order the hook returns them. Held once,
        // as the hook holds them in state.
        records: [
            { id: 'ben', firstName: 'Ben', lastName: 'Middle', status: 'New Application', createdAt: at('2026-10-08T15:00:00Z') },
            { id: 'ann', firstName: 'Ann', lastName: 'Early', status: 'New Application', createdAt: at('2026-10-05T15:00:00Z') },
        ],
        filters: { myAssignmentsOnly: false },
        teamMembers: [],
        claims: { roles: { 'company-1': 'company_admin' } },
        searchQuery: '',
        loading: false,
        noop,
        setFilters: () => {},
        refreshData: () => {},
        nextPage: () => {},
        prevPage: () => {},
        setSearchQuery: () => {},
        setPipelineSegment: () => {},
        setDateOrder: () => {},
        tableProps: [],
        toolbarProps: [],
    };
});

vi.mock('@features/companies', () => ({
    DashboardToolbar: (props) => {
        fx.toolbarProps.push(props);
        return null;
    },
    // The page passes `scope` as the hook's tab, so the tab follows it.
    useCompanyDashboard: (_companyId, options) => ({
        activeTab: options?.initialTab, setActiveTab: fx.noop,
        pipelineSegment: 'all', setPipelineSegment: fx.setPipelineSegment,
        searchQuery: fx.searchQuery, setSearchQuery: fx.setSearchQuery,
        filters: fx.filters, setFilters: fx.setFilters,
        paginatedData: fx.records, loading: fx.loading, error: '', listCountError: '',
        currentPage: 1, totalPages: 1, totalCount: fx.records.length,
        nextPage: fx.nextPage, prevPage: fx.prevPage, refreshData: fx.refreshData,
        teamMembers: fx.teamMembers, undatedCount: 0,
        dateOrder: 'desc', setDateOrder: fx.setDateOrder,
    }),
}));
// A plain recorder around the real table, so the real memo decides.
vi.mock('@/design-system/components', async (importOriginal) => {
    const actual = await importOriginal();
    const { createElement } = await import('react');
    return {
        ...actual,
        DataTable: (props) => {
            fx.tableProps.push(props);
            return createElement(actual.DataTable, props);
        },
    };
});
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'company-1' }, currentUserClaims: fx.claims }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: () => {}, showSuccess: () => {} }),
}));
vi.mock('@shared/components/modals/CallOutcomeModal', () => ({ CallOutcomeModal: () => null }));
vi.mock('../components/LeadAssignmentModal', () => ({ LeadAssignmentModal: () => null }));

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';

afterEach(() => {
    fx.searchQuery = '';
    fx.loading = false;
    fx.tableProps = [];
    fx.toolbarProps = [];
});

const page = (scope) => <MemoryRouter><CompanyCandidatesListPage scope={scope} /></MemoryRouter>;

/** The keys whose values are not the same object (or primitive) in the two renders. */
function changedKeys(before, after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => !Object.is(before[key], after[key]));
}

/** Renders the page, changes the fixture, renders it again: the props recorded last before and after. */
function rerenderedWith(scope, change, recorded) {
    const { rerender } = render(page(scope));
    const before = fx[recorded].at(-1);
    change();
    rerender(page(scope));
    return { before, after: fx[recorded].at(-1) };
}

describe('the candidate list while the search is typed', () => {
    it('hands the table the same props on Applications, so the rows are not redrawn', () => {
        const { before, after } = rerenderedWith('applications', () => { fx.searchQuery = 'm'; }, 'tableProps');

        expect(fx.toolbarProps.at(-1).searchQuery).toBe('m');
        expect(changedKeys(before, after)).toEqual([]);
    });

    it('hands the table the same props on Company Leads for an admin, its selection included', () => {
        const { before, after } = rerenderedWith('company_leads', () => { fx.searchQuery = 'm'; }, 'tableProps');

        expect(after.selection).toBeDefined();
        expect(changedKeys(before, after)).toEqual([]);
    });
});

describe('the toolbar', () => {
    it('gets the same props when only the loading state changes', () => {
        const { before, after } = rerenderedWith('company_leads', () => { fx.loading = true; }, 'toolbarProps');

        expect(fx.tableProps.at(-1).isLoading).toBe(true);
        expect(changedKeys(before, after)).toEqual([]);
    });
});

describe('a real change', () => {
    it('reaches the table: a ticked row is selected', async () => {
        render(page('company_leads'));
        const ann = screen.getByRole('checkbox', { name: 'Select Ann Early' });

        await userEvent.click(ann);

        expect(fx.tableProps.at(-1).selection.selectedIds).toEqual(['ann']);
        expect(screen.getByRole('checkbox', { name: 'Select Ann Early' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Ben Middle' })).not.toBeChecked();
    });
});
