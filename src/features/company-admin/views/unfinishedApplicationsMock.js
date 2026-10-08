// The worklist's fixture rows, kept apart from `UnfinishedApplicationsPage.jsx`,
// which shows them only in E2E test mode.

/*
 * Fixture rows for the `?e2eUnfinished=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets.
 *
 * It exists because this screen is in the blocking pixel lane and its content
 * came from a real `listApplicationDrafts` callable. With no credentials the call
 * fails, and *how* it fails decides what renders — so the committed baseline was a
 * loading skeleton in one environment and CI captured something 30% different. A
 * screenshot of a screen whose content depends on a network failure is not a
 * baseline.
 *
 * One row per state the worklist can show — both origins, all four statuses —
 * and rows for every filter: one nearly done, two quiet for over a week, one of
 * them days from its removal. Plus the two shapes that used to break the old
 * table: a draft with no name typed yet, and one with no phone. Phones are
 * digits, as the server sends them.
 *
 * Each time is an age measured back from `now`, the page's clock: the pixel lane
 * fixes that clock (`e2e/visual/settle.cjs`), so its pictures never move, and a
 * functional run reads "Today" and "Removed in 4 days" whatever day it runs.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The worklist's rows as `listApplicationDrafts` would answer them at `now`. */
export function mockDrafts(now = Date.now()) {
    const ago = (millis) => new Date(now - millis).toISOString();
    return [
        {
            applicantKey: 'aaaa1111bbbb2222cccc',
            origin: 'driver',
            status: 'in_progress',
            firstName: 'Dana',
            lastName: 'Whitfield',
            email: 'dana.whitfield@example.test',
            phone: '5550102233',
            lastSemanticStep: 'consent',
            lastStep: 8,
            updatedAt: ago(HOUR + 15 * MINUTE),
        },
        {
            applicantKey: 'dddd3333eeee4444ffff',
            origin: 'company',
            status: 'driver_in_progress',
            firstName: 'Priya',
            lastName: 'Raman',
            email: 'priya.raman@example.test',
            phone: '5550108890',
            lastSemanticStep: 'employment',
            lastStep: 5,
            preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
            lockedEmployerCount: 2,
            invitedAt: ago(3 * DAY),
            updatedAt: ago(19 * HOUR + 40 * MINUTE),
        },
        {
            applicantKey: 'eeee7777ffff8888aaaa',
            origin: 'company',
            status: 'sent',
            firstName: 'Marcus',
            lastName: 'Iyer',
            email: 'marcus.iyer@example.test',
            phone: '5550104417',
            lastSemanticStep: 'contact',
            lastStep: 0,
            preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
            lockedEmployerCount: 1,
            invitedAt: ago(3 * DAY),
            updatedAt: ago(3 * DAY),
        },
        {
            applicantKey: 'cccc9999dddd0000eeee',
            origin: 'company',
            status: 'prepared',
            firstName: 'Tomas',
            lastName: 'Okafor',
            email: 'tomas.okafor@example.test',
            phone: '5550107712',
            lastSemanticStep: null,
            lastStep: 0,
            preparedBy: { uid: 'u-2', name: 'Sam Sourcer' },
            updatedAt: ago(5 * DAY),
        },
        {
            applicantKey: 'bbbb5555cccc6666dddd',
            origin: 'driver',
            status: 'in_progress',
            email: 'starter@example.test',
            lastSemanticStep: 'contact',
            lastStep: 0,
            updatedAt: ago(12 * DAY),
        },
        {
            applicantKey: 'ffff1212aaaa3434bbbb',
            origin: 'driver',
            status: 'in_progress',
            firstName: 'Jordan',
            lastName: 'Ellis',
            email: 'jordan.ellis@example.test',
            phone: '5550106620',
            lastSemanticStep: 'license',
            lastStep: 2,
            updatedAt: ago(26 * DAY),
        },
    ];
}
