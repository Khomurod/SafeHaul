/**
 * The worklist as a recruiter works it: the summary above it, the search, the
 * filters and their counts, and what each row says about time — with the clock
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
const shownNames = () => within(table()).getAllByRole('rowheader').map((cell) => cell.firstChild.firstChild.textContent);
const filter = (name) => screen.getByRole('button', { name });

describe('the summary', () => {
    it('says how many there are, how many are nearly done and how many have gone quiet', async () => {
        await renderWorklist();

        expect(screen.getByRole('heading', { level: 2, name: '6 unfinished' })).toBeInTheDocument();
        expect(screen.getByText('1 almost done · 2 with no activity for a week or more')).toBeInTheDocument();
        // Spoken as it changes, so a search or a filter says what it kept.
        expect(screen.getByText('Showing 6 of 6')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByText('Newest activity first, as of the last refresh')).toBeInTheDocument();
    });

    it('says when the list holds only the most recent, and that every count is then "at least"', async () => {
        listSpy.mockImplementation(async () => ({
            data: { drafts: mockDrafts(NOW).slice(0, 2), truncated: true, retentionDays: 30 },
        }));
        await renderWorklist();

        expect(screen.getByRole('heading', { level: 2, name: '2+ unfinished' })).toBeInTheDocument();
        expect(screen.getByText('1+ almost done · 0+ with no activity for a week or more')).toBeInTheDocument();
        expect(filter('No activity for a week 0+')).toBeInTheDocument();
        expect(screen.getByText('Showing 2 of the 2 most recently active')).toBeInTheDocument();
    });

    it('counts nothing until the list is in, and nothing when it could not be read', async () => {
        let fail;
        listSpy.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
        render(<UnfinishedApplicationsPage />);

        // Loading: the filters are there to choose, without a zero beside each.
        expect(await screen.findByRole('button', { name: 'All' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 2, name: /unfinished/ })).toBeNull();
        expect(screen.queryByText(/almost done ·/)).toBeNull();

        fail(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
        expect(await screen.findByText(/could not be loaded|connection/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 2, name: /unfinished/ })).toBeNull();
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
        expect(screen.getByText('Showing 1 of 6')).toBeInTheDocument();

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
        expect(screen.getByText('Showing 1 of 6')).toBeInTheDocument();

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
        expect(screen.getByText('Showing 0 of 6')).toBeInTheDocument();
    });

    it('keeps the empty list’s own words for a company with nothing unfinished', async () => {
        listSpy.mockImplementation(async () => ({ data: { drafts: [], retentionDays: 30 } }));
        render(<UnfinishedApplicationsPage />);

        expect(await screen.findByText('Nothing is unfinished.')).toBeInTheDocument();
        expect(screen.queryByText(/^Showing/)).toBeNull();
    });
});

describe('each row', () => {
    const rowOf = (name) => within(table()).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('[role="row"], tr');

    it('says how far it got, and calls the last two pages almost done', async () => {
        await renderWorklist();

        expect(within(rowOf('Dana Whitfield')).getByText('Step 9 of 9')).toBeInTheDocument();
        expect(within(rowOf('Dana Whitfield')).getByText('Almost done')).toBeInTheDocument();
        expect(within(rowOf('Priya Raman')).getByText(/· Employment history/)).toBeInTheDocument();
        expect(within(rowOf('Tomas Okafor')).getByText(/· Prepared by us/)).toBeInTheDocument();
        expect(within(rowOf('Marcus Iyer')).getByText(/· Not started by the driver yet/)).toBeInTheDocument();
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
        expect(within(rowOf('Marcus Iyer')).getByText('Prepared by Rae Recruiter · sent 3 days ago')).toBeInTheDocument();
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
        expect(within(tomas()).getByText(/sent today/)).toBeInTheDocument();
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
        expect(screen.getByText('Showing 2 of 6')).toBeInTheDocument();

        // In its place under All too: the order is the last read's until Refresh.
        fireEvent.click(filter('All 6'));
        expect(shownNames().at(-1)).toBe('Jordan Ellis');
    });
});
