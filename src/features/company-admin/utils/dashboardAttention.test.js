/**
 * What each "Needs attention" row says, from `getDashboardAttention`'s answer:
 * rows with nothing to show are hidden, a failed count is "could not be
 * checked", and a row links where a page shows its records. All names and ids
 * are artificial.
 */
import { describe, expect, it } from 'vitest';
import { ATTENTION_LINKS, attentionItems, formatDay, localDay } from './dashboardAttention';

const zero = { status: 'ok', count: 0 };
const QUIET = {
    windows: { awaitingDays: 7, draftDays: 5, dqDays: 30 },
    rows: {
        sealFailed: zero,
        awaitingSignature: zero,
        pevWaiting: zero,
        pevNoResponse: zero,
        pendingChanges: zero,
        draftsExpiring: zero,
        dqExpiring: { status: 'ok', count: 0, drivers: [] },
    },
};
const TODAY = '2026-11-04';
const withRows = (rows) => ({ ...QUIET, rows: { ...QUIET.rows, ...rows } });
const itemsOf = (rows) => attentionItems(withRows(rows), { today: TODAY });

describe('attentionItems', () => {
    it('is empty when every count is zero', () => {
        expect(attentionItems(QUIET, { today: TODAY })).toEqual([]);
    });

    it('leaves out a row the answer does not carry (a feature that is off)', () => {
        const rows = Object.fromEntries(Object.entries(withRows({ sealFailed: { status: 'failed' } }).rows)
            .filter(([id]) => id !== 'sealFailed'));
        expect(attentionItems({ ...QUIET, rows }, { today: TODAY })).toEqual([]);
    });

    it('lists each row with something to show, in a fixed order, singular and plural', () => {
        const items = itemsOf({
            draftsExpiring: { status: 'ok', count: 1 },
            sealFailed: { status: 'ok', count: 2 },
            awaitingSignature: { status: 'ok', count: 1 },
            pevWaiting: { status: 'ok', count: 4 },
            pevNoResponse: { status: 'ok', count: 1 },
            pendingChanges: { status: 'ok', count: 3 },
        });

        expect(items.map((item) => [item.id, item.state, item.title])).toEqual([
            ['sealFailed', 'todo', '2 signed documents could not be sealed'],
            ['awaitingSignature', 'todo', '1 document has waited more than 7 days for a signature'],
            ['pevWaiting', 'todo', '4 PEV requests are waiting for the employer'],
            ['pevNoResponse', 'todo', '1 PEV request is marked no response'],
            ['pendingChanges', 'todo', '3 drivers have company changes to approve'],
            ['draftsExpiring', 'todo', '1 unfinished application will be removed within 5 days'],
        ]);
    });

    it('links each row to the page that shows its records, and the PEV and changes rows to none', () => {
        const items = itemsOf({
            sealFailed: { status: 'ok', count: 1 },
            awaitingSignature: { status: 'ok', count: 1 },
            pevWaiting: { status: 'ok', count: 1 },
            pevNoResponse: { status: 'ok', count: 1 },
            pendingChanges: { status: 'ok', count: 1 },
            draftsExpiring: { status: 'ok', count: 1 },
            dqExpiring: { status: 'ok', count: 1, drivers: [{ id: 'a1', name: 'Ann Driver', date: '2026-11-20' }] },
        });
        const links = Object.fromEntries(items.map((item) => [item.id, item.link || null]));

        expect(links).toEqual({
            sealFailed: { href: ATTENTION_LINKS.documents, label: 'Open documents' },
            awaitingSignature: { href: ATTENTION_LINKS.sentDocuments, label: 'Open sent documents' },
            pevWaiting: null,
            pevNoResponse: null,
            pendingChanges: null,
            draftsExpiring: { href: ATTENTION_LINKS.unfinished, label: 'Open unfinished applications' },
            dqExpiring: { href: ATTENTION_LINKS.applications, state: { segment: 'hired' }, label: 'Open hired drivers' },
        });
        expect(ATTENTION_LINKS).toEqual({
            documents: '/company/e-docs',
            sentDocuments: '/company/e-docs?view=sent',
            unfinished: '/company/drivers/unfinished',
            applications: '/company/drivers/applications',
        });
    });

    it('says a failed count could not be checked, keeping its link, and never a number', () => {
        const items = itemsOf({ sealFailed: { status: 'failed' }, pevWaiting: { status: 'failed' } });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'sealFailed',
                state: 'unknown',
                title: 'Documents whose seal failed',
                text: 'This could not be checked just now.',
                link: { href: ATTENTION_LINKS.documents, label: 'Open documents' },
            }),
            expect.objectContaining({ id: 'pevWaiting', state: 'unknown', title: 'PEV requests waiting for the employer' }),
        ]);
        expect(items[1]).not.toHaveProperty('link');
    });

    it('takes a row it cannot read as not checked', () => {
        expect(itemsOf({ pendingChanges: { status: 'ok', count: 'many' } })).toEqual([
            expect.objectContaining({ id: 'pendingChanges', state: 'unknown' }),
        ]);
    });

    it('names the hired drivers, each with when their document expires or expired, and how many more', () => {
        const [item] = itemsOf({
            dqExpiring: {
                status: 'ok',
                count: 7,
                drivers: [
                    { id: 'a1', name: 'Ben Hauler', date: '2026-09-25' },
                    { id: 'a2', name: 'Dee Lane', date: '2026-11-04' },
                    { id: 'a3', name: 'Ann Driver', date: '2026-11-20' },
                ],
            },
        });

        expect(item).toMatchObject({
            id: 'dqExpiring',
            state: 'todo',
            title: '7 hired drivers have DQ documents that expire within 30 days or have expired',
            drivers: [
                { id: 'a1', name: 'Ben Hauler', when: 'expired Sep 25, 2026' },
                { id: 'a2', name: 'Dee Lane', when: 'expires today' },
                { id: 'a3', name: 'Ann Driver', when: 'expires Nov 20, 2026' },
            ],
            others: '4 more',
            // Each opens on the dossier's DQ File tab.
            driverTab: 'dq',
        });
    });

    it('uses the windows the server counted with', () => {
        const items = attentionItems({
            windows: { awaitingDays: 10, draftDays: 3, dqDays: 60 },
            rows: {
                awaitingSignature: { status: 'ok', count: 2 },
                draftsExpiring: { status: 'ok', count: 2 },
                dqExpiring: { status: 'ok', count: 1, drivers: [] },
            },
        }, { today: TODAY });

        expect(items.map((item) => item.title)).toEqual([
            '2 documents have waited more than 10 days for a signature',
            '2 unfinished applications will be removed within 3 days',
            '1 hired driver has DQ documents that expire within 60 days or have expired',
        ]);
    });
});

describe('dates', () => {
    it('formats a stored day without moving it across a time zone', () => {
        expect(formatDay('2026-01-01')).toBe('Jan 1, 2026');
        expect(formatDay('2026-12-31')).toBe('Dec 31, 2026');
    });

    it('rejects a day that does not exist, and names no driver with one', () => {
        // The field is server-maintained, but the rules let the team write an application's fields.
        expect(formatDay('2026-02-30')).toBe('');
        expect(formatDay('2026-13-01')).toBe('');
        const [item] = attentionItems({
            windows: { awaitingDays: 7, draftDays: 5, dqDays: 30 },
            rows: {
                dqExpiring: {
                    status: 'ok',
                    count: 2,
                    drivers: [
                        { id: 'a1', name: 'Ann Driver', date: '2026-02-30' },
                        { id: 'a2', name: 'Ben Hauler', date: '2026-03-02' },
                    ],
                },
            },
        }, { today: '2026-03-01' });
        expect(item.drivers.map((driver) => driver.id)).toEqual(['a2']);
    });

    it('reads today in the reader\'s own calendar', () => {
        expect(localDay(new Date(2026, 10, 4, 23, 30))).toBe('2026-11-04');
        expect(localDay(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
    });
});
