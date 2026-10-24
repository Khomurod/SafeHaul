// Referral Links fixture rows, kept apart from `useReferralLinks.js`, which
// shows them only in E2E test mode.

/*
 * Fixture rows for the `?e2eReferrals=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets. Without them the
 * harness reads no links, so the table could be measured and pictured only
 * empty.
 *
 * Two links switched on, one with a long name and no phone, and one switched
 * off; one link brought nothing yet. Every person and number is made up, on
 * 555 numbers.
 *
 * Each time is an age measured back from `now`: the pixel lane fixes the clock
 * (`e2e/visual/settle.cjs`), so its pictures never move.
 */

const DAY = 24 * 60 * 60 * 1000;

/** A Firestore Timestamp's one method this page reads. */
const stamp = (millis) => ({ toDate: () => new Date(millis) });

/** The links as `listReferralLinks` would answer them at `now`: switched-on ones first. */
export function mockReferralLinks(now = Date.now()) {
    const ago = (days) => stamp(now - days * DAY);
    return [
        {
            code: 'KX7P2M9Q',
            referrerName: 'Rosa Delgado',
            referrerPhone: '(555) 010-3321',
            createdBy: 'e2e-recruiter',
            createdByName: 'Rae Recruiter',
            active: true,
            createdAt: ago(2),
        },
        {
            code: 'H4TQ8ZRW',
            referrerName: 'Jean-Baptiste Okonkwo-Fairweather',
            createdBy: 'e2e-sourcer',
            createdByName: 'Sam Sourcer',
            active: true,
            createdAt: ago(9),
        },
        {
            code: 'M2VB6CJN',
            referrerName: 'Ali Hassan',
            referrerPhone: '(555) 010-7788',
            createdBy: 'e2e-recruiter',
            createdByName: 'Rae Recruiter',
            active: false,
            createdAt: ago(40),
            deactivatedAt: ago(5),
        },
    ];
}

/** What each link brought in, as `countReferrals` would answer. */
export function mockReferralCounts() {
    return {
        KX7P2M9Q: { leads: 3, applications: 2, hired: 1 },
        H4TQ8ZRW: { leads: 0, applications: 0, hired: 0 },
        M2VB6CJN: { leads: 5, applications: 1, hired: 0 },
    };
}
