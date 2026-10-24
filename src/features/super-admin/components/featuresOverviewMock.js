// Features overview fixture rows, kept apart from `FeaturesOverview.jsx`, which
// shows them only in E2E test mode.

/*
 * Fixture rows for the `?e2eFeatures=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets. Without them the
 * harness reads no companies, so the table could be measured and pictured
 * only empty.
 *
 * One company with everything on, one with a long name and two features off,
 * and one with a switch-off scheduled. Every company is made up.
 */

/** The companies as the overview reads them from `companies`. */
export function mockFeatureCompanies() {
    return [
        { id: 'e2e-co-1', companyName: 'Artificial Freight Lines', features: {} },
        {
            id: 'e2e-co-2',
            companyName: 'Northern Plains Refrigerated Transport Cooperative',
            features: { pev: false, callTracking: false },
        },
        {
            id: 'e2e-co-3',
            companyName: 'Sample Haulage',
            features: { campaignsEnabled: true },
            featureSchedules: { campaignsEnabled: '2026-10-30T15:00:00.000Z' },
        },
    ];
}
