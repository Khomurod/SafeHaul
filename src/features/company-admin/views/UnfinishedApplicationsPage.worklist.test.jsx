/**
 * The worklist as a recruiter works it: the count beside its heading, the
 * search, the filters and their counts, and what each row says about time — with the clock
 * fixed, because "3 days ago" and "Removed in 4 days" are only true at a moment.
 *
 * The rows are the E2E fixture (`mockDrafts`), the same six the pixel lane
 * photographs: one per state, and rows for every filter.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ byName: {}, profile: null }));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => mocks.byName[name] || (async () => {
        throw Object.assign(new Error(`unexpected callable ${name}`), { code: 'functions/internal' });
    }),
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: mocks.profile, currentUserClaims: { roles: { 'company-1': 'recruiter' } } }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';
import { mockDrafts } from './unfinishedApplicationsMock';

/**
 * Noon, local time: the pixel lane's instant is noon in its UTC zone
 * (`e2e/visual/settle.cjs`), and noon wherever this runs keeps "today" and
 * "yesterday" the same in every time zone.
 */
const NOW = new Date(2026, 5, 15, 12, 0).getTime();

const listSpy = vi.fn();

beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.resetAllMocks();
    mocks.profile = { id: 'company-1', appSlug: 'acme' };
    listSpy.mockImplementation(async () => ({ data: { drafts: mockDrafts(NOW), retentionDays: 30 } }));
    mocks.byName.listApplicationDrafts = listSpy;
});

afterEach(() => {
    vi.useRealTimers();
});

/** The worklist, once its rows are there. */
async function renderWorklist() {
    render(<UnfinishedApplicationsPage />);
    await screen.findByText('Dana Whitfield');
}

const table = () => screen.getByRole('table', { name: 'Unfinished applications' });
/** The name each row is headed by: the first line of its Driver cell. */
const shownNames = () => within(table()).getAllByRole('rowheader').map((cell) => cell.querySelector('span').textContent);
const filter = (name) => screen.getByRole('button', { name });

/** The number beside the page's heading: the rows the filter and the search keep. */
const headingCount = () => within(screen.getByRole('heading', { level: 1 }).closest('header')).getByRole('status');

describe('the count', () => {
    it('sits beside the heading, says what the list shows, and is spoken as it changes', async () => {
        await renderWorklist();

        expect(screen.getByRole('heading', { level: 1, name: 'Unfinished applications' })).toBeInTheDocument();
        expect(headingCount()).toHaveTextContent(/^6 unfinished applications$/);
        // One heading: no second one above the table, and no "Showing X of Y".
        expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
        expect(screen.queryByText(/^Showing/)).toBeNull();
        // Starting and refreshing are the page's own actions, in its header.
        const header = screen.getByRole('heading', { level: 1 }).closest('header');
        expect(within(header).getByRole('button', { name: 'Start an application' })).toBeInTheDocument();
        expect(within(header).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });

    it('says when the list holds only the most recent, and that every filter count is then "at least"', async () => {
        listSpy.mockImplementation(async () => ({
            data: { drafts: mockDrafts(NOW).slice(0, 2), truncated: true, retentionDays: 30 },
        }));
        await renderWorklist();

        expect(headingCount()).toHaveTextContent(/^2 unfinished applications$/);
        expect(filter('All 2+')).toBeInTheDocument();
        expect(filter('No activity for a week 0+')).toBeInTheDocument();
        expect(screen.getByText('Only the 2 most recently active are listed.')).toBeInTheDocument();
    });

    it('counts nothing until the list is in, and nothing when it could not be read', async () => {
        let fail;
        listSpy.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
        render(<UnfinishedApplicationsPage />);

        // Loading: the filters are there to choose, without a zero beside each.
        expect(await screen.findByRole('button', { name: 'All' })).toBeInTheDocument();
        expect(headingCount()).toBeEmptyDOMElement();

        fail(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
        expect(await screen.findByText(/could not be loaded|connection/i)).toBeInTheDocument();
        expect(headingCount()).toBeEmptyDOMElement();
        expect(filter('All')).toBeInTheDocument();
    });
});

describe('the filters', () => {
    it('count what each would show, with All chosen first', async () => {
        await renderWorklist();

        const group = screen.getByRole('group', { name: 'Show' });
        expect(within(group).getAllByRole('button').map((chip) => chip.textContent))
            .toEqual(['All 6', 'Almost done 1', 'Started by drivers 3', 'Prepared by us 3', 'No activity for a week 2']);
        expect(filter('All 6')).toHaveAttribute('aria-pressed', 'true');
    });

    it('narrow the list to their rows, and say how many of all are showing', async () => {
        await renderWorklist();

        fireEvent.click(filter('Almost done 1'));
        expect(shownNames()).toEqual(['Dana Whitfield']);
        expect(filter('Almost done 1')).toHaveAttribute('aria-pressed', 'true');
        expect(filter('All 6')).toHaveAttribute('aria-pressed', 'false');
        expect(headingCount()).toHaveTextContent(/^1 unfinished application$/);

        fireEvent.click(filter('Prepared by us 3'));
        expect(shownNames()).toEqual(['Priya Raman', 'Marcus Iyer', 'Tomas Okafor']);

        fireEvent.click(filter('No activity for a week 2'));
        expect(shownNames()).toEqual(['Name not entered yet', 'Jordan Ellis']);

        fireEvent.click(filter('Started by drivers 3'));
        expect(shownNames()).toEqual(['Dana Whitfield', 'Name not entered yet', 'Jordan Ellis']);
    });
});

describe('the search', () => {
    const search = () => screen.getByRole('searchbox', { name: 'Search by name, phone or email' });

    it('finds by name, by email and by phone however it is typed', async () => {
        await renderWorklist();

        fireEvent.change(search(), { target: { value: 'jordan' } });
        expect(shownNames()).toEqual(['Jordan Ellis']);

        fireEvent.change(search(), { target: { value: 'starter@' } });
        expect(shownNames()).toEqual(['Name not entered yet']);

        fireEvent.change(search(), { target: { value: '(555) 010-44' } });
        expect(shownNames()).toEqual(['Marcus Iyer']);
        expect(headingCount()).toHaveTextContent(/^1 unfinished application$/);

        // With the country code, as a driver says it on the phone.
        fireEvent.change(search(), { target: { value: '+1 (555) 010-44' } });
        expect(shownNames()).toEqual(['Marcus Iyer']);
    });

    it('works within the chosen filter, and the counts stay the whole list’s', async () => {
        await renderWorklist();

        fireEvent.click(filter('Prepared by us 3'));
        fireEvent.change(search(), { target: { value: 'dana' } });

        expect(screen.getByText('Nothing here matches.')).toBeInTheDocument();
        expect(filter('All 6')).toBeInTheDocument();
        expect(headingCount()).toHaveTextContent(/^0 unfinished applications$/);
    });

    it('keeps the empty list’s own words for a company with nothing unfinished', async () => {
        listSpy.mockImplementation(async () => ({ data: { drafts: [], retentionDays: 30 } }));
        render(<UnfinishedApplicationsPage />);

        expect(await screen.findByText('Nothing is unfinished.')).toBeInTheDocument();
        expect(headingCount()).toHaveTextContent(/^0 unfinished applications$/);
    });
});

describe('each row', () => {
    const rowOf = (name) => within(table()).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('[role="row"], tr');

    it('has who it is and how to reach them in one cell: the name, the email, and the phone as a call', async () => {
        await renderWorklist();

        const dana = rowOf('Dana Whitfield');
        const call = within(dana).getByRole('link', { name: 'Call Dana Whitfield at (555) 010-2233' });
        expect(call).toHaveAttribute('href', 'tel:+15550102233');
        // Under the name, in the row's own header cell: no column of its own.
        expect(within(dana).getByRole('rowheader')).toContainElement(call);
        expect(within(table()).queryByRole('columnheader', { name: 'Phone' })).toBeNull();
        expect(within(dana).getByRole('rowheader')).toHaveTextContent(/^Dana Whitfielddana\.whitfield@example\.test\(555\) 010-2233$/);
        // The initials lead the row, out of a screen reader's way: the name says who.
        const initials = within(dana).getByText('DW');
        expect(initials).toHaveAttribute('aria-hidden', 'true');
        expect(initials.closest('td')).toBe(dana.firstElementChild);

        // No phone, no call, and nothing in its place; no name, an empty ring for initials.
        const noPhone = rowOf('Name not entered yet');
        expect(within(noPhone).queryByRole('link')).toBeNull();
        expect(within(noPhone).getByRole('rowheader')).toHaveTextContent(/^Name not entered yetstarter@example\.test$/);
        expect(noPhone.firstElementChild).toHaveTextContent(/^$/);
    });

    it('says how far it got, and calls the last two pages almost done', async () => {
        await renderWorklist();

        expect(within(rowOf('Dana Whitfield')).getByText('Step 9 of 9')).toBeInTheDocument();
        expect(within(rowOf('Dana Whitfield')).getByText('Almost done')).toBeInTheDocument();
        // The page's name under the bar, on a line of its own.
        expect(within(rowOf('Priya Raman')).getByText('Employment history')).toBeInTheDocument();
        expect(within(rowOf('Tomas Okafor')).getByText('Prepared by us')).toBeInTheDocument();
        expect(within(rowOf('Marcus Iyer')).getByText('Not started by the driver yet')).toBeInTheDocument();
    });

    it('counts the company’s own questions among the pages', async () => {
        mocks.profile = { id: 'company-1', appSlug: 'acme', customQuestions: [{ id: 'q1', label: 'Lane?' }] };
        await renderWorklist();

        expect(within(rowOf('Dana Whitfield')).getByText('Step 10 of 10')).toBeInTheDocument();
        expect(within(rowOf('Jordan Ellis')).getByText('Step 3 of 10')).toBeInTheDocument();
    });

    it('says when it last moved, and when it will be removed, warning in its last week', async () => {
        await renderWorklist();

        expect(within(rowOf('Dana Whitfield')).getByText(/^Today, /)).toBeInTheDocument();
        expect(within(rowOf('Dana Whitfield')).getByText('Removed in 30 days')).toBeInTheDocument();
        expect(within(rowOf('Priya Raman')).getByText(/^Yesterday, /)).toBeInTheDocument();
        expect(within(rowOf('Marcus Iyer')).getByText('3 days ago')).toBeInTheDocument();
        // Who prepared it and when its link went, each a line of its own under the status.
        expect(within(rowOf('Marcus Iyer')).getByText('Prepared by Rae Recruiter')).toBeInTheDocument();
        expect(within(rowOf('Marcus Iyer')).getByText('Sent 3 days ago')).toBeInTheDocument();
        expect(within(rowOf('Jordan Ellis')).getByText('26 days ago')).toBeInTheDocument();
        expect(within(rowOf('Jordan Ellis')).getByText('Removed in 4 days')).toBeInTheDocument();
    });

    it('measures every row from the moment the list was read', async () => {
        await renderWorklist();
        vi.setSystemTime(NOW + 3 * 24 * 60 * 60 * 1000);

        // Nothing moves until the list is read again.
        fireEvent.click(filter('Almost done 1'));
        fireEvent.click(filter('All 6'));
        expect(within(rowOf('Jordan Ellis')).getByText('Removed in 4 days')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(within(rowOf('Jordan Ellis')).getByText('Removed in 1 day')).toBeInTheDocument());
    });
});

/**
 * The other shapes of the list, by the width the page is read at: the media
 * queries the table asks are answered here as a laptop's or a phone's would be.
 */
describe('at other widths', () => {
    const realMatchMedia = window.matchMedia;
    /** Answers the queries a width matches, as the browser would. */
    const atWidth = (matching) => {
        window.matchMedia = (query) => ({
            ...realMatchMedia(query),
            matches: matching.includes(query),
        });
    };
    afterEach(() => { window.matchMedia = realMatchMedia; });
    const rowOf = (name) => within(table()).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('[role="row"], tr');

    it('reads the last activity under the status on a laptop, once, rather than in a column of its own', async () => {
        atWidth(['(min-width: 768px) and (max-width: 1439px)']);
        await renderWorklist();

        expect(within(table()).queryByRole('columnheader', { name: 'Last activity' })).toBeNull();
        const jordan = rowOf('Jordan Ellis');
        const status = within(jordan).getByText('Started by driver').closest('td');
        expect(within(status).getByText(/^Last activity/)).toBeInTheDocument();
        expect(within(status).getByText('26 days ago')).toBeInTheDocument();
        expect(within(status).getByText('Removed in 4 days')).toBeInTheDocument();
        // Once on the page, not a second copy kept out of sight.
        expect(screen.getAllByText('Removed in 4 days')).toHaveLength(1);
    });

    it('makes each row a card on a phone: the name as its title, then how to reach them, how far they got and when it moved', async () => {
        atWidth(['(max-width: 767px)']);
        await renderWorklist();

        const marcus = rowOf('Marcus Iyer');
        // The title is the name alone; the email and the call are a line of their own.
        expect(within(marcus).getByRole('rowheader', { name: 'Marcus Iyer' })).toBeInTheDocument();
        const call = within(marcus).getByRole('link', { name: 'Call Marcus Iyer at (555) 010-4417' });
        expect(within(marcus).getByRole('rowheader')).not.toContainElement(call);
        expect(within(marcus).getByText('marcus.iyer@example.test')).toBeInTheDocument();
        expect(within(marcus).getByText('Prepared by Rae Recruiter')).toBeInTheDocument();
        expect(within(marcus).getByText('Sent 3 days ago')).toBeInTheDocument();
        expect(within(marcus).getByText('Step 1 of 9')).toBeInTheDocument();
        expect(within(marcus).getByText(/^Last activity/)).toBeInTheDocument();
        expect(within(marcus).getByText('3 days ago')).toBeInTheDocument();
        // A driver's own row adds nothing to its status, and its card says nothing there.
        expect(within(rowOf('Dana Whitfield')).queryByText(/^Prepared by/)).toBeNull();
        // Every action is still the row's own, by name.
        for (const name of ['Open the application for Marcus Iyer', 'New link for Marcus Iyer', 'Email link to Marcus Iyer']) {
            expect(within(marcus).getByRole('button', { name })).toBeInTheDocument();
        }
    });
});

describe('a link made on a row', () => {
    beforeEach(() => {
        let minted = 0;
        mocks.byName.mintApplicationInvite = vi.fn(async ({ applicantKey }) => {
            minted += 1;
            return { data: { inviteToken: `invite-${minted}`, applicantKey, expiresInDays: 14 } };
        });
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    });

    it('leaves the row saying its link went, so a later press says it replaces it', async () => {
        await renderWorklist();
        const tomas = () => within(table()).getByRole('rowheader', { name: /^Tomas Okafor/ }).closest('[role="row"], tr');
        expect(within(tomas()).getByText('5 days ago')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy link for Tomas Okafor' }));
        await screen.findByText(/invite-1/);
        // Another row's link takes the one place a link is shown.
        fireEvent.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }));
        await screen.findByText(/invite-2/);

        // Tomas's link went: pressing again would retire it, and the button says so.
        expect(screen.getByRole('button', { name: 'New link for Tomas Okafor' })).toBeInTheDocument();
        expect(within(tomas()).getByText(/^Today, /)).toBeInTheDocument();
        expect(within(tomas()).getByText('Removed in 30 days')).toBeInTheDocument();
        expect(within(tomas()).getByText('Sent today')).toBeInTheDocument();
    });

    it('keeps a quiet row and its new link in view, in its place, when the clipboard refuses it', async () => {
        navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
        await renderWorklist();
        fireEvent.click(filter('No activity for a week 2'));
        expect(shownNames()).toEqual(['Name not entered yet', 'Jordan Ellis']);

        fireEvent.click(screen.getByRole('button', { name: 'Copy link for Jordan Ellis' }));
        // Active now, so no longer quiet, and still here with the link to copy by hand.
        await waitFor(() => expect(filter('No activity for a week 1')).toBeInTheDocument());
        expect(shownNames()).toEqual(['Name not entered yet', 'Jordan Ellis']);
        expect(screen.getByText(/invite-1/)).toBeInTheDocument();
        expect(headingCount()).toHaveTextContent(/^2 unfinished applications$/);

        // In its place under All too: the order is the last read's until Refresh.
        fireEvent.click(filter('All 6'));
        expect(shownNames().at(-1)).toBe('Jordan Ellis');
    });
});
