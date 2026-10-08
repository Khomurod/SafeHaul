/**
 * How the worklist reads a row, with the clock stated in every test: how far it
 * got, whether it is nearly done or quiet, when it goes, and what the search and
 * the filters keep.
 */
import { describe, expect, it } from 'vitest';
import { buildSemanticStepOrder } from '@shared/components/layout/Stepper';
import {
    WORKLIST_FILTERS,
    countByFilter,
    describeActivity,
    describeSent,
    isQuiet,
    matchesSearch,
    progressOf,
    removalOf,
    visibleRows,
    wizardSteps,
} from './unfinishedWorklist';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Noon, local time, so whole days back from it never cross midnight by an hour. */
const NOW = new Date(2026, 5, 15, 12, 0).getTime();
const ago = (millis) => new Date(NOW - millis).toISOString();

const DRIVER = { origin: 'driver', status: 'in_progress' };
const PREPARED = { origin: 'company', status: 'prepared' };
const SENT = { origin: 'company', status: 'sent' };
const TAKEN_OVER = { origin: 'company', status: 'driver_in_progress' };

describe('the wizard’s pages', () => {
    it('are the wizard’s own, in its order, with and without the company’s questions', () => {
        expect(wizardSteps(true)).toEqual(buildSemanticStepOrder(true));
        expect(wizardSteps(false)).toEqual(buildSemanticStepOrder(false));
    });
});

describe('how far an application got', () => {
    it('names the page it reached, out of the pages there are', () => {
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'license' }))
            .toEqual({ step: 3, total: 9, label: 'License & credentials', almostDone: false });
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'license' }, { hasCustomQuestions: true }))
            .toMatchObject({ step: 3, total: 10 });
    });

    it('counts the company’s questions on a row that reached them, whatever the company asks now', () => {
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'custom_questions' }))
            .toMatchObject({ step: 8, total: 10, label: 'Company questions' });
    });

    it('is almost done with only the review or the signature left', () => {
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'review' }).almostDone).toBe(true);
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'consent' })).toMatchObject({ step: 9, almostDone: true });
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'general' }).almostDone).toBe(false);
    });

    it('shows a draft saved before pages had names by its number alone, within the pages there are', () => {
        expect(progressOf({ ...DRIVER, lastStep: 4 })).toEqual({ step: 5, total: 9, label: null, almostDone: false });
        expect(progressOf({ ...DRIVER, lastStep: 40 })).toMatchObject({ step: 9, label: null });
        expect(progressOf({ ...DRIVER, lastSemanticStep: 'invented', lastStep: -3 })).toMatchObject({ step: 1, label: null });
        expect(progressOf({})).toMatchObject({ step: 1, total: 9, label: null });
    });

    it('says the driver has not started on a carrier’s application they have not taken over', () => {
        expect(progressOf({ ...PREPARED, lastSemanticStep: 'consent' }))
            .toMatchObject({ step: 9, label: 'Prepared by us', almostDone: false });
        expect(progressOf({ ...SENT, lastSemanticStep: 'contact' }))
            .toMatchObject({ step: 1, label: 'Not started by the driver yet' });
        expect(progressOf({ ...TAKEN_OVER, lastSemanticStep: 'employment' }))
            .toMatchObject({ step: 6, label: 'Employment history' });
    });
});

describe('when it last moved', () => {
    const time = (millis) => new Date(NOW - millis).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    it('reads today and yesterday with the time, and days after that', () => {
        expect(describeActivity({ updatedAt: ago(75 * 60 * 1000) }, NOW)).toBe(`Today, ${time(75 * 60 * 1000)}`);
        expect(describeActivity({ updatedAt: ago(20 * HOUR) }, NOW)).toBe(`Yesterday, ${time(20 * HOUR)}`);
        expect(describeActivity({ updatedAt: ago(3 * DAY) }, NOW)).toBe('3 days ago');
        expect(describeActivity({ updatedAt: ago(26 * DAY) }, NOW)).toBe('26 days ago');
    });

    it('counts calendar days, so last night is yesterday however few hours ago', () => {
        expect(describeActivity({ updatedAt: ago(13 * HOUR) }, NOW)).toMatch(/^Yesterday, /);
    });

    it('says so when the list does not know', () => {
        expect(describeActivity({}, NOW)).toBe('Unknown');
        expect(describeActivity({ updatedAt: 'not a date' }, NOW)).toBe('Unknown');
    });

    it('reads a save stamped a little ahead of this clock as today', () => {
        expect(describeActivity({ updatedAt: ago(-5 * 60 * 1000) }, NOW)).toMatch(/^Today, /);
    });

    it('is quiet from a week without a save', () => {
        expect(isQuiet({ updatedAt: ago(6 * DAY) }, NOW)).toBe(false);
        expect(isQuiet({ updatedAt: ago(7 * DAY) }, NOW)).toBe(true);
        expect(isQuiet({}, NOW)).toBe(false);
    });

    it('says when a carrier’s link went, and only while it waits for the driver', () => {
        expect(describeSent({ ...SENT, invitedAt: ago(3 * DAY) }, NOW)).toBe('sent 3 days ago');
        expect(describeSent({ ...SENT, invitedAt: ago(HOUR) }, NOW)).toBe('sent today');
        expect(describeSent({ ...TAKEN_OVER, invitedAt: ago(3 * DAY) }, NOW)).toBeNull();
        expect(describeSent({ ...DRIVER, invitedAt: ago(3 * DAY) }, NOW)).toBeNull();
        expect(describeSent(SENT, NOW)).toBeNull();
    });
});

describe('when it will be removed', () => {
    it('counts down the days since the last save', () => {
        expect(removalOf({ updatedAt: ago(HOUR) }, 30, NOW)).toEqual({ days: 30, label: 'Removed in 30 days', soon: false });
        expect(removalOf({ updatedAt: ago(DAY) }, 30, NOW)).toMatchObject({ days: 29 });
        expect(removalOf({ updatedAt: ago(12 * DAY) }, 30, NOW)).toMatchObject({ label: 'Removed in 18 days', soon: false });
    });

    it('warns from a week left', () => {
        expect(removalOf({ updatedAt: ago(22 * DAY) }, 30, NOW)).toMatchObject({ days: 8, soon: false });
        expect(removalOf({ updatedAt: ago(23 * DAY) }, 30, NOW)).toMatchObject({ days: 7, soon: true });
        expect(removalOf({ updatedAt: ago(29 * DAY) }, 30, NOW)).toEqual({ days: 1, label: 'Removed in 1 day', soon: true });
    });

    it('is due once the days have run out, since the deletion itself comes some hours later', () => {
        expect(removalOf({ updatedAt: ago(30 * DAY) }, 30, NOW)).toEqual({ days: 0, label: 'Due for removal', soon: true });
        expect(removalOf({ updatedAt: ago(31 * DAY) }, 30, NOW)).toMatchObject({ label: 'Due for removal' });
    });

    it('counts a save stamped a little ahead of this clock as today, across midnight too', () => {
        const lateEvening = new Date(2026, 5, 15, 23, 59).getTime();
        const justAfterMidnight = new Date(2026, 5, 16, 0, 2).toISOString();
        expect(removalOf({ updatedAt: justAfterMidnight }, 30, lateEvening)).toMatchObject({ days: 30, label: 'Removed in 30 days' });
    });

    it('says nothing without a save time or a retention', () => {
        expect(removalOf({}, 30, NOW)).toBeNull();
        expect(removalOf({ updatedAt: ago(DAY) }, 0, NOW)).toBeNull();
        expect(removalOf({ updatedAt: ago(DAY) }, undefined, NOW)).toBeNull();
    });
});

describe('the search', () => {
    const dana = {
        firstName: 'Dana', lastName: 'Whitfield', email: 'dana.w@example.test', phone: '5550102233',
    };

    it('finds a name, an email, and every word of either', () => {
        expect(matchesSearch(dana, 'dana')).toBe(true);
        expect(matchesSearch(dana, '  WHITFIELD ')).toBe(true);
        expect(matchesSearch(dana, 'dana whit')).toBe(true);
        expect(matchesSearch(dana, 'example.test')).toBe(true);
        expect(matchesSearch(dana, 'dana iyer')).toBe(false);
    });

    it('finds a phone however it is typed', () => {
        expect(matchesSearch(dana, '(555) 010-22')).toBe(true);
        expect(matchesSearch(dana, '555.010.2233')).toBe(true);
        expect(matchesSearch(dana, '0102233')).toBe(true);
        expect(matchesSearch(dana, '(214)')).toBe(false);
        expect(matchesSearch({ firstName: 'Ana' }, '555')).toBe(false);
    });

    it('finds a phone typed with its country code, and one stored with it', () => {
        expect(matchesSearch(dana, '+1 555 010 2233')).toBe(true);
        expect(matchesSearch(dana, '1-555-010-2233')).toBe(true);
        expect(matchesSearch(dana, '15550102233')).toBe(true);
        expect(matchesSearch(dana, '+1 (555)')).toBe(true);
        expect(matchesSearch({ ...dana, phone: '+1 (555) 010-2233' }, '(555) 010-2233')).toBe(true);
        expect(matchesSearch(dana, '+1 (214)')).toBe(false);
    });

    it('finds digits in an email or a name as well as in a phone', () => {
        expect(matchesSearch({ email: 'driver123@example.test' }, '123')).toBe(true);
        expect(matchesSearch({ email: 'driver123@example.test', phone: '5550102233' }, '0102')).toBe(true);
    });

    it('keeps everything while it is empty', () => {
        expect(matchesSearch(dana, '')).toBe(true);
        expect(matchesSearch(dana, '   ')).toBe(true);
        expect(matchesSearch({}, undefined)).toBe(true);
    });
});

describe('the filters', () => {
    const rows = [
        { ...DRIVER, applicantKey: 'a', firstName: 'Dana', lastSemanticStep: 'consent', updatedAt: ago(HOUR) },
        { ...TAKEN_OVER, applicantKey: 'b', firstName: 'Priya', lastSemanticStep: 'employment', updatedAt: ago(DAY) },
        { ...SENT, applicantKey: 'c', firstName: 'Marcus', updatedAt: ago(3 * DAY) },
        { ...PREPARED, applicantKey: 'd', firstName: 'Tomas', lastSemanticStep: 'review', updatedAt: ago(5 * DAY) },
        { ...DRIVER, applicantKey: 'e', email: 'starter@example.test', updatedAt: ago(12 * DAY) },
        { ...DRIVER, applicantKey: 'f', firstName: 'Jordan', lastSemanticStep: 'license', updatedAt: ago(26 * DAY) },
    ];
    const keys = (list) => list.map((entry) => entry.applicantKey);

    it('are offered in this order', () => {
        expect(WORKLIST_FILTERS.map((option) => option.label))
            .toEqual(['All', 'Almost done', 'Started by drivers', 'Prepared by us', 'No activity for a week']);
    });

    it('count what each would show, before any search', () => {
        expect(countByFilter(rows, NOW)).toEqual({ all: 6, almost: 1, driver: 3, company: 3, quiet: 2 });
        expect(countByFilter([], NOW)).toEqual({ all: 0, almost: 0, driver: 0, company: 0, quiet: 0 });
    });

    it('keep their rows in the order the server sent them', () => {
        expect(keys(visibleRows(rows, { filter: 'all', now: NOW }))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(keys(visibleRows(rows, { filter: 'almost', now: NOW }))).toEqual(['a']);
        expect(keys(visibleRows(rows, { filter: 'driver', now: NOW }))).toEqual(['a', 'e', 'f']);
        expect(keys(visibleRows(rows, { filter: 'company', now: NOW }))).toEqual(['b', 'c', 'd']);
        expect(keys(visibleRows(rows, { filter: 'quiet', now: NOW }))).toEqual(['e', 'f']);
    });

    it('narrow with the search', () => {
        expect(keys(visibleRows(rows, { filter: 'driver', query: 'jor', now: NOW }))).toEqual(['f']);
        expect(keys(visibleRows(rows, { filter: 'company', query: 'jor', now: NOW }))).toEqual([]);
    });

    it('fall back to every row for a filter they do not know', () => {
        expect(visibleRows(rows, { filter: 'nonsense', now: NOW })).toHaveLength(6);
    });

    it('keep the row whose new link is on screen under any filter, in its place, but not past the search', () => {
        // Jordan's link was just made: the row is active now, and no longer quiet.
        const minted = rows.map((entry) => (entry.applicantKey === 'f' ? { ...entry, updatedAt: ago(0) } : entry));
        expect(keys(visibleRows(minted, { filter: 'quiet', now: NOW }))).toEqual(['e']);
        expect(keys(visibleRows(minted, { filter: 'quiet', now: NOW, keepKey: 'f' }))).toEqual(['e', 'f']);
        expect(keys(visibleRows(minted, { filter: 'all', now: NOW, keepKey: 'f' }))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(keys(visibleRows(minted, { filter: 'quiet', query: 'starter', now: NOW, keepKey: 'f' }))).toEqual(['e']);
    });
});
