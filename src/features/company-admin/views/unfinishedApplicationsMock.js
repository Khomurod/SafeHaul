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
 * The rows are one per state the worklist can show — both origins, all four
 * statuses — plus the two shapes that used to break the old table: a draft with no
 * name typed yet, and one with no contact details at all. Timestamps are fixed and
 * sit before the lane's frozen clock.
 */
export const MOCK_DRAFTS = Object.freeze([
    Object.freeze({
        applicantKey: 'aaaa1111bbbb2222cccc',
        origin: 'driver',
        status: 'in_progress',
        firstName: 'Dana',
        lastName: 'Whitfield',
        email: 'dana.whitfield@example.test',
        phone: '(555) 010-2233',
        lastSemanticStep: 'license',
        lastStep: 2,
        updatedAt: '2026-06-14T16:45:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'dddd3333eeee4444ffff',
        origin: 'company',
        status: 'driver_in_progress',
        firstName: 'Priya',
        lastName: 'Raman',
        email: 'priya.raman@example.test',
        phone: '(555) 010-8890',
        lastSemanticStep: 'employment',
        lastStep: 5,
        preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
        lockedEmployerCount: 2,
        updatedAt: '2026-06-13T11:20:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'bbbb5555cccc6666dddd',
        origin: 'driver',
        status: 'in_progress',
        email: 'starter@example.test',
        lastSemanticStep: 'contact',
        lastStep: 0,
        updatedAt: '2026-06-12T09:05:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'eeee7777ffff8888aaaa',
        origin: 'company',
        status: 'sent',
        firstName: 'Marcus',
        lastName: 'Iyer',
        email: 'marcus.iyer@example.test',
        phone: '(555) 010-4417',
        lastSemanticStep: 'contact',
        lastStep: 0,
        preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
        lockedEmployerCount: 1,
        updatedAt: '2026-06-10T14:02:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'cccc9999dddd0000eeee',
        origin: 'company',
        status: 'prepared',
        firstName: 'Tomas',
        lastName: 'Okafor',
        email: 'tomas.okafor@example.test',
        phone: '(555) 010-7712',
        lastSemanticStep: null,
        lastStep: 0,
        preparedBy: { uid: 'u-2', name: 'Sam Sourcer' },
        updatedAt: '2026-06-09T21:30:00.000Z',
    }),
]);
